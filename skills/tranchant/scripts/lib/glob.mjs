// A glob typed as a lens's source (Add a lens): the files it matches, from
// the project's root, `~/` or an absolute path, each with the lens name it
// would get and whether it reads as a reviewer. `*` and `?` stay within one
// folder (no `**`), and match no name starting with a dot unless the pattern
// does, as a shell's glob; `[` is a character like any other, as in a path.
import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import {
  insideFile,
  kindOfPath,
  labelOf,
  nameOfFile,
  notReviewerReason,
  readHead,
  sourceLabel,
} from './inside.mjs'
import { expandHome } from './settings.mjs'

/**
 * @typedef {object} Match
 * @property {string} source
 * @property {string} name
 * @property {string} [notReviewer]
 * @property {import('./inside.mjs').Kind} [kind]
 * @property {Already[]} [already] The lenses, and the lenses being added, made from this same file.
 * @property {Match[]} [starts] A command's, or an agent's that starts others: the reviewers it starts, never a lens itself.
 * @property {number} [more] With `starts`: those named past the most listed.
 */
/** @typedef {{ scope: 'local' | 'global', name: string, adding?: true }} Already */

/** More matches than this is a glob to narrow: each is one cleaning agent. */
export const MAX_MATCHES = 40
/** The folders and entries a glob looks at, at most: a `/*\/*` stays cheap. */
const MAX_VISITS = 5000
/** The file names a glob that matches nothing lists, to help mend it. */
const MAX_LISTED = 20

/** A glob this Tranchant refuses, and why. */
export class GlobRefusal extends Error {}

/** Whether a source is a glob: a `*` or a `?`. */
const isGlob = (/** @type {string} */ text) => /[*?]/.test(text)

/**
 * Whether `name` matches one segment of a glob. Not a regular expression:
 * `*a*a*a*b` against a long name would backtrack for minutes, the server
 * frozen; this goes back to the last `*` only, in linear time.
 * @param {string} pattern
 * @param {string} name
 */
function wildMatch(pattern, name) {
  let p = 0
  let n = 0
  let star = -1
  let resume = 0
  while (n < name.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === name[n])) {
      p++
      n++
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++
      resume = n
    } else if (star !== -1) {
      p = star + 1
      n = ++resume
    } else return false
  }
  while (pattern[p] === '*') p++
  return p === pattern.length
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
 * @returns {Promise<{ matches: Match[], more?: number, folder?: { label: string, files: string[], count: number, missing?: true, unreadable?: string } }>}
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
      const names = await readdir(dir).catch(() => [])
      for (const name of names) {
        visits++
        if (visits > MAX_VISITS)
          throw new GlobRefusal(`${trimmed} looks through too many files: narrow it`)
        if (name.startsWith('.') && !segment.startsWith('.')) continue
        if (!wildMatch(segment, name)) continue
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
    const kind = kindOfPath(file)
    const source = labelOf(entry, from, project)
    // Written as the glob is: the page knows a match it starts by its source.
    const inside = await insideFile(project, {
      label: source,
      file,
      kind,
      text,
      labelFile: (one) => sourceLabel(one, from, project),
    })
    matches.push({
      source,
      name: nameOfFile(file),
      ...(kind && { kind }),
      ...(notReviewer && { notReviewer }),
      ...(inside && {
        starts: inside.starts,
        ...(inside.more && { more: inside.more }),
      }),
    })
  }
  return {
    matches,
    ...(found.length > MAX_MATCHES && { more: found.length - MAX_MATCHES }),
  }
}

/**
 * One source as a file: a path from the project, `~/` or absolute, a skill's
 * folder and its SKILL.md alike; a plugin's name as it is.
 * @param {string} project
 * @param {string} label
 */
function fileKey(project, label) {
  const trimmed = label.trim()
  if (/^[\w-][\w.-]*(?::[\w-][\w.-]*)+$/.test(trimmed)) return trimmed
  return path.resolve(project, expandHome(trimmed)).replace(/[/\\]SKILL\.md$/i, '')
}

/**
 * The matches, each with the lenses already made from its file and those
 * being added from it: a glob run again, or over a folder whose reviewers
 * were added one by one under other names.
 * @param {string} project
 * @param {Match[]} matches
 * @param {{ source: string, scope: string, name: string, adding?: boolean }[]} known
 * @returns {Match[]}
 */
export function withAlready(project, matches, known) {
  /** @type {Map<string, Already[]>} */
  const byFile = new Map()
  for (const one of known) {
    if (one.scope !== 'local' && one.scope !== 'global') continue
    const key = fileKey(project, one.source)
    byFile.set(key, [
      ...(byFile.get(key) ?? []),
      {
        scope: one.scope,
        name: one.name,
        ...(one.adding && { adding: /** @type {const} */ (true) }),
      },
    ])
  }
  /** @returns {Match} */
  const mark = (/** @type {Match} */ match) => {
    const already = byFile.get(fileKey(project, match.source))
    const marked = already ? { ...match, already } : match
    return match.starts ? { ...marked, starts: match.starts.map(mark) } : marked
  }
  return matches.map(mark)
}

/**
 * The folder a glob that matched nothing looked in, as it was typed, and
 * its file names: the folder of the last segment, where a typo usually
 * lies; the one before the first glob when a folder's name holds one.
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
  /** @type {string[]} */
  let entries
  try {
    entries = await readdir(dir)
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : undefined
    // A folder Node may not read (macOS privacy, rights) is there: said so, not missing.
    return code === 'ENOENT' || code === 'ENOTDIR'
      ? { label, files: [], count: 0, missing: /** @type {const} */ (true) }
      : { label, files: [], count: 0, unreadable: code ?? 'unreadable' }
  }
  const files = entries
    .filter((name) => !name.startsWith('.'))
    .toSorted((a, b) => a.localeCompare(b))
  return { label, files: files.slice(0, MAX_LISTED), count: files.length }
}
