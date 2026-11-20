// A glob typed as a lens's source (Add a lens): the files it matches, from
// the project's root, `~/` or an absolute path, each with the lens name it
// would get and whether it reads as a reviewer. `*` and `?` stay within one
// folder (no `**`), and match no name starting with a dot unless the pattern
// does, as a shell's glob.
import os from 'node:os'
import path from 'node:path'
import { readFile, readdir, stat } from 'node:fs/promises'
import { expandHome } from './settings.mjs'

/** @typedef {{ source: string, name: string, notReviewer?: string }} Match */

/** More matches than this is a glob to narrow: each is one cleaning agent. */
export const MAX_MATCHES = 40
/** The folders and entries a glob looks at, at most: a `/*\/*` stays cheap. */
const MAX_VISITS = 5000
/** The file names a glob that matches nothing lists, to help mend it. */
const MAX_LISTED = 20
const MAX_READ = 64 * 1024

/** A glob this Tranchant refuses, and why. */
export class GlobRefusal extends Error {}

/** Whether a source is a glob: a `*`, a `?` or a `[`. */
const isGlob = (/** @type {string} */ text) => /[*?[]/.test(text)

/** One segment of a glob as a regular expression. */
function segmentRegex(/** @type {string} */ segment) {
  let out = ''
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i] ?? ''
    if (char === '*') out += '[^/]*'
    else if (char === '?') out += '[^/]'
    else if (char === '[') {
      const end = segment.indexOf(']', i + 2)
      if (end === -1) out += '\\['
      else {
        const inside = segment.slice(i + 1, end)
        const negated = inside.startsWith('!') || inside.startsWith('^')
        const body = (negated ? inside.slice(1) : inside).replace(/[\\\]]/g, '\\$&')
        out += `[${negated ? '^' : ''}${body}]`
        i = end
      }
    } else out += char.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

/**
 * The lens name a matched file gets: its file name without the extension,
 * a skill's folder name for its SKILL.md; made a lens name.
 * @param {string} file
 */
function nameOfFile(file) {
  const base = path.basename(file)
  const stem = /^SKILL\.md$/i.test(base)
    ? path.basename(path.dirname(file))
    : base.replace(/\.[^.]+$/, '')
  return (
    stem
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'lens'
  )
}

/**
 * Why a source reads as no reviewer of its own, or undefined: one that
 * starts other agents (its tools give it Task or Agent, or it names
 * subagent types) would end its cleaning without a lens.
 * @param {string} text
 */
function notReviewerReason(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const tools = /^tools:\s*(.*)$/m.exec(front)?.[1] ?? ''
  if (/\b(?:Task|Agent)\b/.test(tools) || /\bsubagent_type\b/.test(text))
    return 'It starts other agents and holds no review of its own: its cleaning would end without a lens.'
  return undefined
}

/** How a matched path is written as a source: as the glob was, from the project, `~/` or absolute. */
function labelOf(
  /** @type {string} */ file,
  /** @type {'project' | 'home' | 'absolute'} */ from,
  /** @type {string} */ project,
) {
  if (from === 'absolute') return file
  const base = from === 'home' ? os.homedir() : project
  const relative = path.relative(base, file).split(path.sep).join('/')
  return from === 'home' ? `~/${relative}` : relative
}

/** The file a matched entry is read as: itself, or a skill folder's SKILL.md; undefined for neither. */
async function readableOf(/** @type {string} */ entry) {
  const found = await stat(entry).catch(() => undefined)
  if (found?.isFile()) return /\.md$/i.test(entry) ? entry : undefined
  if (!found?.isDirectory()) return undefined
  const skill = path.join(entry, 'SKILL.md')
  return (await stat(skill).catch(() => undefined))?.isFile() ? skill : undefined
}

/**
 * The files `pattern` matches for the project at `project`, sorted: each a
 * Markdown file or a skill's folder, with its lens name and, when it reads
 * as none, why it is no reviewer. Matching nothing, the folder it looked in
 * and the names there.
 * @param {string} project
 * @param {string} pattern
 * @returns {Promise<{ matches: Match[], more?: number, folder?: { label: string, files: string[], count: number, missing?: true } }>}
 */
export async function matchSources(project, pattern) {
  const trimmed = pattern.trim()
  if (!isGlob(trimmed)) throw new GlobRefusal(`${trimmed} is not a glob: no * or ?`)
  if (trimmed.includes('**'))
    throw new GlobRefusal('** is not supported: a * matches within one folder')
  if (/^[\w-][\w.-]*:/.test(trimmed))
    throw new GlobRefusal(
      "a glob names files: a plugin's skills and agents are added one by one",
    )
  const expanded = expandHome(trimmed)
  /** @type {'project' | 'home' | 'absolute'} */
  const from =
    trimmed === '~' || trimmed.startsWith('~/')
      ? 'home'
      : path.isAbsolute(trimmed)
        ? 'absolute'
        : 'project'
  const full = path.resolve(project, expanded)
  const { root } = path.parse(full)
  const segments = full.slice(root.length).split(path.sep).filter(Boolean)
  const first = segments.findIndex(isGlob)
  const fixed = path.join(root, ...segments.slice(0, first))
  let visits = 0
  /** @type {string[]} */
  let level = [fixed]
  for (const [index, segment] of segments.slice(first).entries()) {
    const last = index === segments.length - first - 1
    /** @type {string[]} */
    const next = []
    for (const dir of level) {
      if (!isGlob(segment)) {
        next.push(path.join(dir, segment))
        continue
      }
      const regex = segmentRegex(segment)
      const names = await readdir(dir).catch(() => [])
      for (const name of names) {
        visits++
        if (visits > MAX_VISITS)
          throw new GlobRefusal(`${trimmed} looks through too many files: narrow it`)
        if (name.startsWith('.') && !segment.startsWith('.')) continue
        if (!regex.test(name)) continue
        const entry = path.join(dir, name)
        if (!last && !(await stat(entry).catch(() => undefined))?.isDirectory()) continue
        next.push(entry)
      }
    }
    level = next
  }
  const found = []
  for (const entry of level.toSorted((a, b) => a.localeCompare(b))) {
    const file = await readableOf(entry)
    if (file) found.push({ entry, file })
  }
  if (!found.length) return { matches: [], folder: await folderOf(full, from, project) }
  /** @type {Match[]} */
  const matches = []
  for (const { entry, file } of found.slice(0, MAX_MATCHES)) {
    const text = await readHead(file)
    const notReviewer = text === undefined ? undefined : notReviewerReason(text)
    matches.push({
      source: labelOf(entry, from, project),
      name: nameOfFile(file),
      ...(notReviewer && { notReviewer }),
    })
  }
  return {
    matches,
    ...(found.length > MAX_MATCHES && { more: found.length - MAX_MATCHES }),
  }
}

/** A file's first bytes, enough to tell a reviewer; undefined when it cannot be read. */
async function readHead(/** @type {string} */ file) {
  const text = await readFile(file, 'utf8').catch(() => undefined)
  return text?.slice(0, MAX_READ)
}

/**
 * The folder a glob that matched nothing looked in, as it was typed, and
 * its file names: the last segment's folder, where a typo usually lies.
 * @param {string} full
 * @param {'project' | 'home' | 'absolute'} from
 * @param {string} project
 */
async function folderOf(full, from, project) {
  const segments = full.split(path.sep)
  const dirSegments = segments.slice(0, -1)
  const firstGlob = dirSegments.findIndex(isGlob)
  const dir =
    firstGlob === -1
      ? dirSegments.join(path.sep) || path.sep
      : dirSegments.slice(0, firstGlob).join(path.sep) || path.sep
  const label = `${labelOf(dir, from, project) || '.'}/`.replace(/\/+$/, '/')
  const entries = await readdir(dir).catch(() => undefined)
  if (!entries)
    return { label, files: [], count: 0, missing: /** @type {const} */ (true) }
  const files = entries
    .filter((name) => !name.startsWith('.'))
    .toSorted((a, b) => a.localeCompare(b))
  return { label, files: files.slice(0, MAX_LISTED), count: files.length }
}
