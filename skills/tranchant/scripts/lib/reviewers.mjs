// The reviewers a cleaning agent says a source starts (a whole review
// process), checked: the agent's paths are data. A file is kept only when it
// is a regular Markdown file or a skill's folder, under the source's plugin
// or marketplace root, the project's .claude or the user's; any other path
// is shown with why. Inline instructions (an agent the source starts with a
// prompt of its own) are kept as text, to be cleaned as a lens of their own.
import { existsSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { lensNameOf, nameOfFile, sourceLabel } from './inside.mjs'
import { claudeDir } from './lens.mjs'
import { expandHome } from './settings.mjs'
import { isSourceText } from './userlens.mjs'

/**
 * @typedef {{ name: string, kind: 'file', source: string }
 *   | { name: string, kind: 'inline', text: string }
 *   | { name: string, kind: 'refused', file: string, reason: string }} Reviewer
 */

/** The most reviewers one process lists, as a read with no agent lists them. */
const MAX_REVIEWERS = 12
/** The entries read at most: the rest are counted. */
const MAX_ENTRIES = 40
const MAX_INLINE = 32 * 1024
/** The folders above a source looked at for its plugin's or marketplace's manifest. */
const MAX_UP = 8

/** A path, its links followed; undefined when it is not there. */
const real = (/** @type {string} */ file) => realpath(file).catch(() => undefined)

/** Whether `file` lies in `root` or is it. */
function within(/** @type {string} */ root, /** @type {string} */ file) {
  const relative = path.relative(root, file)
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * The folders a source's reviewers may lie in: its plugin's root (a
 * `.claude-plugin/plugin.json` above it) and its marketplace's (a
 * `.claude-plugin/marketplace.json`, whose plugins may have no manifest of
 * their own), the project's `.claude` and the user's; each with its links
 * followed, those that are there.
 * @param {string} file The source's file.
 * @param {string} project
 */
async function allowedRoots(file, project) {
  const roots = [path.join(project, '.claude'), claudeDir()]
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
  return [...new Set(found.filter((one) => one !== undefined))]
}

/**
 * The file a reviewer's path names, as a lens takes it: a Markdown file, or
 * a skill's folder (its SKILL.md alike); or why it is none.
 * @param {string} file Its links followed.
 * @returns {Promise<{ file: string } | { reason: string }>}
 */
async function reviewerFile(file) {
  const found = await stat(file).catch(() => undefined)
  if (found?.isDirectory()) {
    const skill = await stat(path.join(file, 'SKILL.md')).catch(() => undefined)
    return skill?.isFile() ? { file } : { reason: 'a folder with no SKILL.md' }
  }
  if (!found?.isFile() || !/\.md$/i.test(file))
    return { reason: "neither a Markdown file nor a skill's folder" }
  return { file: /^SKILL\.md$/i.test(path.basename(file)) ? path.dirname(file) : file }
}

/**
 * The reviewers of a process, as the cleaning agent wrote them, checked
 * against the source they come from: each a file kept as Add a lens takes
 * it (from the project, `~/` or absolute), inline instructions, or a path
 * refused with why. The source itself, and a file of its name (a copy of
 * it), are never among them; a file or a name given twice is kept once.
 * @param {unknown} raw
 * @param {{ file: string, folder: string, project: string }} source
 * @param {(what: string) => never} fail
 * @returns {Promise<{ reviewers: Reviewer[], more?: number }>}
 */
export async function checkReviewers(raw, source, fail) {
  if (!Array.isArray(raw)) return fail('reviewers: a list')
  const roots = await allowedRoots(source.file, source.project)
  const own = await real(source.file)
  const ownFolder =
    own && /^SKILL\.md$/i.test(path.basename(own)) ? path.dirname(own) : own
  const ownName = nameOfFile(source.file)
  /** @type {Reviewer[]} */
  const reviewers = []
  const files = new Set()
  const names = new Set()
  for (const one of raw.slice(0, MAX_ENTRIES)) {
    if (!one || typeof one !== 'object' || Array.isArray(one)) continue
    const given = typeof one.name === 'string' ? one.name.trim() : ''
    if (typeof one.file === 'string' && one.file.trim()) {
      const written = one.file.trim()
      // A path on more than one line is shown as none: it would break the page's line.
      const shown = isSourceText(written) ? written.slice(0, 300) : '(not a path)'
      const refused = (/** @type {string} */ reason) =>
        reviewers.push({
          name: given ? lensNameOf(given) : nameOfFile(shown),
          kind: 'refused',
          file: shown,
          reason,
        })
      if (!isSourceText(written)) {
        refused('not a path on one line')
        continue
      }
      const resolved = await real(path.resolve(source.folder, expandHome(written)))
      if (!resolved) {
        refused('no such file')
        continue
      }
      if (!roots.some((root) => within(root, resolved))) {
        refused(
          "outside the source's plugin and marketplace, the project's .claude and ~/.claude",
        )
        continue
      }
      const found = await reviewerFile(resolved)
      if ('reason' in found) {
        refused(found.reason)
        continue
      }
      const name = lensNameOf(given || nameOfFile(found.file))
      if (
        found.file === own ||
        found.file === ownFolder ||
        nameOfFile(found.file) === ownName
      )
        continue
      if (files.has(found.file) || names.has(name)) continue
      files.add(found.file)
      names.add(name)
      reviewers.push({
        name,
        kind: 'file',
        source: sourceLabel(found.file, 'project', source.project),
      })
    } else if (typeof one.inline === 'string' && one.inline.trim()) {
      const name = lensNameOf(given || `reviewer-${reviewers.length + 1}`)
      if (name === ownName || names.has(name)) continue
      if (Buffer.byteLength(one.inline) > MAX_INLINE)
        fail(`reviewers: ${name}'s inline instructions, ${MAX_INLINE / 1024} KiB at most`)
      names.add(name)
      reviewers.push({ name, kind: 'inline', text: one.inline.trim() })
    }
  }
  const kept = reviewers.slice(0, MAX_REVIEWERS)
  const more = reviewers.length - kept.length + Math.max(0, raw.length - MAX_ENTRIES)
  return { reviewers: kept, ...(more > 0 && { more }) }
}
