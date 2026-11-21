// The reviewers a cleaning agent says a source starts (a whole review
// process), checked: the agent's paths are data. A file is kept only when it
// is a regular Markdown file or a skill's folder, its links followed, under
// the source's plugin or marketplace root, or the agents, skills and
// commands of the project's .claude or the user's (and the user's installed
// plugins); any other path is shown with why. Inline instructions (an agent
// the source starts with a prompt of its own) are kept as text, to be
// cleaned as a lens of their own.
import { existsSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { lensNameOf, nameOfFile, sourceLabel } from './inside.mjs'
import { claudeDir } from './lens.mjs'
import { expandHome } from './settings.mjs'
import { isSourceText } from './userlens.mjs'

/**
 * One reviewer of a process. `name`, a lens name, unique among the files and
 * inline ones; `source`, a file as Add a lens takes it (from the project,
 * `~/` or absolute), never the agent's own words; `label`, an inline one's
 * name as its agent wrote it, which a cleaning again looks for in the
 * source. A page's pick names one by its index in the list, refused ones
 * included.
 * @typedef {{ name: string, kind: 'file', source: string }
 *   | { name: string, kind: 'inline', label: string, text: string }
 *   | { name: string, kind: 'refused', file: string, reason: string }} Reviewer
 */

/** The most reviewers one process offers, as a read with no agent lists them; as many refused at most. */
const MAX_REVIEWERS = 12
/** The entries read at most: the rest are counted. */
const MAX_ENTRIES = 40
const MAX_INLINE = 32 * 1024
const MAX_LABEL = 100
/** The folders above a source looked at for its plugin's or marketplace's manifest. */
const MAX_UP = 8
/** A segment of a reviewer's path below its root: a name, never a sentence for the next agent's prompt. */
const SEGMENT = /^[\w@+-][\w.@+-]*$/
const OUTSIDE =
  "outside the source's plugin and marketplace, and the agents, skills and commands of the project's .claude and ~/.claude"

/**
 * A path, its links followed; or why it cannot be.
 * @returns {Promise<{ file: string } | { reason: string }>}
 */
async function real(/** @type {string} */ file) {
  try {
    return { file: await realpath(file) }
  } catch (error) {
    const code = errorCode(error)
    return {
      reason:
        code === 'ENOENT' || code === 'ENOTDIR'
          ? 'no such file'
          : `it cannot be read (${typeof code === 'string' ? code : 'error'})`,
    }
  }
}

/** Where `file` lies below `root`, by segments; undefined when it is not there. */
function below(/** @type {string} */ root, /** @type {string} */ file) {
  const relative = path.relative(root, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
  return relative ? relative.split(path.sep) : []
}

/**
 * The folders a source's reviewers may lie in: its plugin's root (a
 * `.claude-plugin/plugin.json` above it) and its marketplace's (a
 * `.claude-plugin/marketplace.json`, whose plugins may have no manifest of
 * their own); the agents, skills and commands of the project's `.claude`
 * and the user's, and the user's installed plugins, never their notes,
 * plans or memories. Each with its links followed, those that are there.
 * @param {string} file The source's file.
 * @param {string} project
 */
async function allowedRoots(file, project) {
  const user = claudeDir()
  const roots = [
    ...['agents', 'skills', 'commands'].flatMap((one) => [
      path.join(project, '.claude', one),
      path.join(user, one),
    ]),
    path.join(user, 'plugins'),
  ]
  let dir = path.dirname(path.resolve(file))
  for (let i = 0; i < MAX_UP; i++) {
    const manifest = path.join(dir, '.claude-plugin')
    if (existsSync(path.join(manifest, 'marketplace.json'))) {
      roots.push(dir)
      break
    }
    if (existsSync(path.join(manifest, 'plugin.json'))) roots.push(dir)
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  const found = await Promise.all(roots.map(real))
  return [...new Set(found.flatMap((one) => ('file' in one ? [one.file] : [])))]
}

/**
 * Why `file`, its links followed, may not be a reviewer, or undefined: it
 * lies under no root, or a segment below its root is no plain name.
 * @param {string[]} roots
 * @param {string} file
 */
function placeRefusal(roots, file) {
  const segments = roots.map((root) => below(root, file)).find(Boolean)
  if (!segments) return OUTSIDE
  if (!segments.every((one) => SEGMENT.test(one)))
    return 'a path of letters, digits, . @ + - and _ only below its root'
  return undefined
}

/**
 * The file a reviewer's path names, as a lens takes it: a Markdown file, or
 * a skill's folder (its SKILL.md alike, which must lie under a root too, its
 * links followed); or why it is none.
 * @param {string} file Its links followed.
 * @param {string[]} roots
 * @returns {Promise<{ file: string } | { reason: string }>}
 */
async function reviewerFile(file, roots) {
  const found = await stat(file).catch(() => undefined)
  const folder = found?.isDirectory()
    ? file
    : /^SKILL\.md$/i.test(path.basename(file))
      ? path.dirname(file)
      : undefined
  if (folder) {
    const skill = await real(path.join(folder, 'SKILL.md'))
    if (!('file' in skill)) return { reason: 'a folder with no SKILL.md' }
    const refused = placeRefusal(roots, skill.file)
    if (refused) return { reason: `its SKILL.md: ${refused}` }
    const read = await stat(skill.file).catch(() => undefined)
    return read?.isFile() ? { file: folder } : { reason: 'a folder with no SKILL.md' }
  }
  if (!found?.isFile() || !/\.md$/i.test(file))
    return { reason: "neither a Markdown file nor a skill's folder" }
  return { file }
}

/** `name`, or the first of `name-2`, `name-3`… not taken yet, as a lens name. */
function freeName(/** @type {string} */ name, /** @type {Set<string>} */ taken) {
  let free = name
  for (let i = 2; taken.has(free); i++) free = lensNameOf(`${name.slice(0, 36)}-${i}`)
  taken.add(free)
  return free
}

/**
 * The reviewers of a process, as the cleaning agent wrote them, checked
 * against the source they come from: each a file kept as Add a lens takes
 * it, inline instructions, or an entry refused with why, the offered ones
 * first. The source itself, and a file or an inline one of its name (a
 * copy of it), are left out, as is a file given twice; two of one name get
 * names of their own.
 * @param {unknown} raw
 * @param {{ file: string, folder: string, project: string }} source
 * @param {(what: string) => never} fail
 * @returns {Promise<{ reviewers: Reviewer[], more?: number }>}
 */
export async function checkReviewers(raw, source, fail) {
  if (!Array.isArray(raw)) return fail('reviewers: a list')
  const roots = await allowedRoots(source.file, source.project)
  const ownFile = await real(source.file)
  const own = 'file' in ownFile ? ownFile.file : undefined
  const ownFolder =
    own && /^SKILL\.md$/i.test(path.basename(own)) ? path.dirname(own) : own
  const ownName = nameOfFile(source.file)
  const project = await real(source.project)
  // Written from the project as its own path names it: the lenses made from it are found by it.
  const labelOf = (/** @type {string} */ file) => {
    const inside = 'file' in project ? below(project.file, file) : undefined
    return sourceLabel(
      inside ? path.join(source.project, ...inside) : file,
      'project',
      source.project,
    )
  }
  /** @type {Reviewer[]} */
  const offered = []
  /** @type {Reviewer[]} */
  const refused = []
  const files = new Set()
  const names = new Set([ownName])
  for (const one of raw.slice(0, MAX_ENTRIES)) {
    const entry = one && typeof one === 'object' && !Array.isArray(one) ? one : {}
    const given = typeof entry.name === 'string' ? entry.name.trim() : ''
    const refuse = (/** @type {string} */ shown, /** @type {string} */ reason) =>
      refused.push({
        name: given ? lensNameOf(given) : shown ? nameOfFile(shown) : 'reviewer',
        kind: 'refused',
        file: shown,
        reason,
      })
    if (typeof entry.file === 'string' && entry.file.trim()) {
      const written = entry.file.trim()
      if (!isSourceText(written)) {
        refuse('(not a path)', 'not a path on one line')
        continue
      }
      const shown = written.slice(0, 300)
      const resolved = await real(path.resolve(source.folder, expandHome(written)))
      if (!('file' in resolved)) {
        refuse(shown, resolved.reason)
        continue
      }
      const placed = placeRefusal(roots, resolved.file)
      if (placed) {
        refuse(shown, placed)
        continue
      }
      const found = await reviewerFile(resolved.file, roots)
      if ('reason' in found) {
        refuse(shown, found.reason)
        continue
      }
      if (
        found.file === own ||
        found.file === ownFolder ||
        nameOfFile(found.file) === ownName ||
        files.has(found.file)
      )
        continue
      files.add(found.file)
      offered.push({
        name: freeName(lensNameOf(given || nameOfFile(found.file)), names),
        kind: 'file',
        source: labelOf(found.file),
      })
    } else if (typeof entry.inline === 'string' && entry.inline.trim()) {
      const label = isSourceText(given) && given.length <= MAX_LABEL ? given : ''
      if (!label) {
        refuse(
          '(inline)',
          `a name on one line, ${MAX_LABEL} characters at most, is required`,
        )
        continue
      }
      if (lensNameOf(label) === ownName) continue
      if (Buffer.byteLength(entry.inline) > MAX_INLINE) {
        refuse('(inline)', `its instructions are larger than ${MAX_INLINE / 1024} KiB`)
        continue
      }
      offered.push({
        name: freeName(lensNameOf(label), names),
        kind: 'inline',
        label,
        text: entry.inline.trim(),
      })
    } else refuse('(none)', 'neither a file nor inline instructions')
  }
  const kept = offered.slice(0, MAX_REVIEWERS)
  const more = offered.length - kept.length + Math.max(0, raw.length - MAX_ENTRIES)
  return {
    reviewers: [...kept, ...refused.slice(0, MAX_REVIEWERS)],
    ...(more > 0 && { more }),
  }
}
