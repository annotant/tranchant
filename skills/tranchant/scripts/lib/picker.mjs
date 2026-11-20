// What Add a lens's picker lists: the installed plugins' skills, agents and
// commands, the project's `.claude` and the user's, and the folders under
// three roots (the project, Claude Code's folder, each plugin's). Names
// only: no file is read here, and no folder outside those roots is listed.
import path from 'node:path'
import { constants } from 'node:fs'
import { access, lstat, readdir, realpath, stat } from 'node:fs/promises'
import { claudeDir, installedPlugins, LensRefusal } from './lens.mjs'
import { sourceLabel } from './inside.mjs'
import { expandHome } from './settings.mjs'

/** @typedef {import('./inside.mjs').Kind} Kind */
/** @typedef {{ kind: Kind, name: string, source: string }} Item */
/**
 * @typedef {object} PluginGroup
 * @property {string} name
 * @property {string} [version]
 * @property {string} folder Its install folder, from `~/` or absolute.
 * @property {boolean} enabled Turned off for this project: its lenses would not build.
 * @property {Item[]} items
 */
/** @typedef {{ folder: string, items: Item[] }} DotClaude */
/**
 * @typedef {object} Catalog
 * @property {PluginGroup[]} plugins
 * @property {string} [pluginsError] Claude Code's register of plugins cannot be read.
 * @property {DotClaude} project
 * @property {DotClaude} user
 * @property {string[]} roots The folders the Files tab may list, as the user reads them.
 */
/** @typedef {'project' | 'user' | 'plugins'} Root */
/**
 * One entry of a folder: a folder to open, a Markdown file to pick, or one
 * shown and never opened (`hidden`, `link` leaving its root, `unreadable`,
 * `other`), `reason` saying why.
 * @typedef {{ name: string, kind: 'folder' | 'file' | 'hidden' | 'link' | 'unreadable' | 'other', source?: string, reason?: string }} Entry
 */
/**
 * @typedef {object} Folder
 * @property {Root} root
 * @property {string} path Inside its root, `/`-separated; '' for the root itself.
 * @property {string} label The folder as Source would name it.
 * @property {Entry[]} entries
 * @property {number} [more] Entries past the most listed.
 */

/** The entries of one folder listed at most: a `node_modules` stays one answer. */
const MAX_ENTRIES = 500

/** A folder whose name starts with a dot that is still opened: Claude Code's own. */
const OPENED_DOT = '.claude'

/** Folders first, then the rest, each in name order as listed. */
const rank = (/** @type {Entry} */ one) =>
  one.kind === 'folder' || one.kind === 'unreadable' ? 0 : 1

/** The roots the picker browses, as the page names them. */
const ROOTS = /** @type {const} */ (['project', 'user', 'plugins'])

/**
 * Whether `root` names one of the picker's roots.
 * @param {string} root
 * @returns {root is Root}
 */
export const isRoot = (root) => ROOTS.some((one) => one === root)

/** A folder Tranchant refuses to list, and why; `roots` the folders it may. */
export class FolderRefusal extends Error {
  /** @param {string} message @param {string[]} roots */
  constructor(message, roots) {
    super(message)
    this.roots = roots
  }
}

const isFile = async (/** @type {string} */ file) =>
  (await stat(file).catch(() => undefined))?.isFile() ?? false

const namesIn = async (/** @type {string} */ dir) =>
  (await readdir(dir).catch(() => []))
    .filter((name) => !name.startsWith('.'))
    .toSorted((a, b) => a.localeCompare(b))
    .slice(0, MAX_ENTRIES)

/**
 * The skills, agents and commands of a folder that holds them (a plugin's
 * root, a `.claude`), each written as `write` makes its source.
 * @param {string} home
 * @param {(kind: Kind, name: string, file: string) => string} write
 * @returns {Promise<Item[]>}
 */
async function itemsIn(home, write) {
  /** @type {Item[]} */
  const items = []
  for (const name of await namesIn(path.join(home, 'skills'))) {
    const file = path.join(home, 'skills', name, 'SKILL.md')
    if (await isFile(file))
      items.push({ kind: 'skill', name, source: write('skill', name, file) })
  }
  for (const kind of /** @type {const} */ (['agent', 'command'])) {
    const dir = path.join(home, `${kind}s`)
    for (const entry of await namesIn(dir)) {
      const file = path.join(dir, entry)
      // A regular file only, as Claude Code loads it: a FIFO is no agent.
      if (!/\.md$/i.test(entry) || !(await isFile(file))) continue
      const name = entry.replace(/\.md$/i, '')
      items.push({ kind, name, source: write(kind, name, file) })
    }
  }
  return items
}

/**
 * Everything the picker's lists show for the project at `project`: each
 * installed plugin's skills, agents and commands (Tranchant's own left out,
 * its lenses built in), one turned off said so; the project's `.claude` and
 * the user's. A plugin's written `plugin:name`, unless a skill or an agent
 * of the same name takes it first; a `.claude`'s by its path.
 * @param {string} project
 * @returns {Promise<Catalog>}
 */
export async function catalogOf(project) {
  /** @type {PluginGroup[]} */
  const plugins = []
  let pluginsError
  try {
    for (const one of (await installedPlugins(project)).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (one.name === 'tranchant') continue
      const taken = new Set()
      const items = await itemsIn(one.root, (kind, name, file) => {
        // plugin:name resolves to a skill first, then an agent, then a command.
        if (taken.has(name)) return sourceLabel(file, 'home', project)
        taken.add(name)
        return `${one.name}:${name}`
      })
      plugins.push({
        name: one.name,
        ...(one.version && { version: one.version }),
        folder: `${sourceLabel(one.root, 'home', project)}/`,
        enabled: one.enabled,
        items,
      })
    }
  } catch (error) {
    if (!(error instanceof LensRefusal)) throw error
    pluginsError = error.message
  }
  const dotClaude = async (
    /** @type {string} */ dir,
    /** @type {'project' | 'home'} */ from,
  ) => ({
    folder: `${sourceLabel(dir, from, project)}/`,
    items: await itemsIn(dir, (kind, _name, file) =>
      sourceLabel(kind === 'skill' ? path.dirname(file) : file, from, project),
    ),
  })
  return {
    plugins,
    ...(pluginsError && { pluginsError }),
    project: await dotClaude(path.join(project, '.claude'), 'project'),
    user: await dotClaude(claudeDir(), 'home'),
    roots: (await rootsOf(project)).labels,
  }
}

/** Whether `inner` is `outer` or lies under it. */
function within(/** @type {string} */ outer, /** @type {string} */ inner) {
  const relative = path.relative(outer, inner)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * The folders the picker may list: the project, Claude Code's folder, and
 * each installed plugin's (Tranchant's left out), as the user reads them.
 * @param {string} project
 */
async function rootsOf(project) {
  const plugins = (await installedPlugins(project).catch(() => [])).filter(
    (one) => one.name !== 'tranchant',
  )
  return {
    project,
    user: claudeDir(),
    plugins: new Map(plugins.map((one) => [one.name, one.root])),
    labels: [
      `this project (${sourceLabel(project, 'home', project)})`,
      `${sourceLabel(claudeDir(), 'home', project)}/`,
      "the installed plugins' folders",
    ],
  }
}

/** A path's real place, or undefined when it is not there or cannot be resolved. */
const realOf = (/** @type {string} */ file) => realpath(file).catch(() => undefined)

/**
 * One entry of `dir`, a folder of the root at `realRoot`: what it is,
 * without reading it. A link is followed only while it stays in its root.
 * @param {string} dir
 * @param {string} name
 * @param {string} realRoot
 * @param {string} project
 * @returns {Promise<Entry | undefined>}
 */
async function entryOf(dir, name, realRoot, project) {
  const full = path.join(dir, name)
  if (name.startsWith('.') && name !== OPENED_DOT)
    return { name, kind: 'hidden', reason: 'hidden: shown, never opened' }
  const own = await lstat(full).catch(() => undefined)
  if (!own) return undefined
  let found = own
  if (own.isSymbolicLink()) {
    const real = await realOf(full)
    if (!real) return { name, kind: 'link', reason: 'a broken link: not followed' }
    if (!within(realRoot, real))
      return { name, kind: 'link', reason: 'leaves this folder: not followed' }
    const target = await stat(full).catch(() => undefined)
    if (!target) return { name, kind: 'link', reason: 'a broken link: not followed' }
    found = target
  }
  if (found.isDirectory()) {
    const open = await access(full, constants.R_OK | constants.X_OK).then(
      () => true,
      () => false,
    )
    return open
      ? { name, kind: 'folder' }
      : { name, kind: 'unreadable', reason: 'cannot be read: not opened' }
  }
  if (!found.isFile()) return { name, kind: 'other', reason: 'not a file' }
  if (!/\.md$/i.test(name)) return { name, kind: 'other', reason: 'not a Markdown file' }
  return { name, kind: 'file', source: sourceLabel(full, 'project', project) }
}

/**
 * The folder `relative` of `root` for the project at `project`: its
 * entries, folders first; the names only, never a file's text. A path that
 * leaves its root (`..`, a hidden folder, a link out of it) is refused.
 * @param {string} project
 * @param {Root} root
 * @param {string} relative `/`-separated, '' for the root itself.
 * @returns {Promise<Folder>}
 */
export async function listFolder(project, root, relative) {
  const roots = await rootsOf(project)
  const segments = relative.split('/').filter(Boolean)
  if (segments.some((one) => one === '..' || (one.startsWith('.') && one !== OPENED_DOT)))
    throw new FolderRefusal(
      `${relative} is not listed: a hidden folder, or one above its root`,
      roots.labels,
    )
  if (root === 'plugins' && !segments.length)
    return {
      root,
      path: '',
      label: "The plugins' folders",
      entries: [...roots.plugins.keys()]
        .toSorted((a, b) => a.localeCompare(b))
        .map((name) => ({ name, kind: /** @type {const} */ ('folder') })),
    }
  let base
  if (root === 'project') base = roots.project
  else if (root === 'user') base = roots.user
  else {
    base = roots.plugins.get(segments[0] ?? '')
    if (!base)
      throw new FolderRefusal(`${segments[0]} is no installed plugin`, roots.labels)
  }
  const inside = root === 'plugins' ? segments.slice(1) : segments
  const dir = path.join(base, ...inside)
  const [realRoot, real] = await Promise.all([realOf(base), realOf(dir)])
  if (!realRoot || !real)
    throw new FolderRefusal(`${relative || base}: no such folder`, roots.labels)
  if (!within(realRoot, real))
    throw new FolderRefusal(
      `${relative} leaves its root through a link: not followed`,
      roots.labels,
    )
  /** @type {string[]} */
  let names
  try {
    names = await readdir(dir)
  } catch {
    throw new FolderRefusal(`${relative || base} cannot be read`, roots.labels)
  }
  /** @type {Entry[]} */
  const entries = []
  const sorted = names.toSorted((a, b) => a.localeCompare(b))
  for (const name of sorted.slice(0, MAX_ENTRIES)) {
    const entry = await entryOf(dir, name, realRoot, project)
    if (entry) entries.push(entry)
  }
  return {
    root,
    path: segments.join('/'),
    label: `${sourceLabel(dir, 'project', project) || '.'}/`,
    entries: entries.toSorted((a, b) => rank(a) - rank(b)),
    ...(names.length > MAX_ENTRIES && { more: names.length - MAX_ENTRIES }),
  }
}

/**
 * A folder typed in the picker (from the project, `~/` or absolute), listed
 * from the root it lies in: the plugin's, Claude Code's folder, the
 * project; refused, the roots named, when it lies in none.
 * @param {string} project
 * @param {string} typed
 * @returns {Promise<Folder>}
 */
export async function goToFolder(project, typed) {
  const roots = await rootsOf(project)
  const trimmed = typed.trim().replace(/[/\\]+$/, '')
  const full = path.resolve(project, expandHome(trimmed || '.'))
  const real = await realOf(full)
  /** @type {{ root: Root, base: string, prefix: string[] }[]} */
  const candidates = [
    ...[...roots.plugins].map(([name, dir]) => ({
      root: /** @type {Root} */ ('plugins'),
      base: dir,
      prefix: [name],
    })),
    { root: 'user', base: roots.user, prefix: [] },
    { root: 'project', base: roots.project, prefix: [] },
  ]
  /** @type {{ root: Root, relative: string, depth: number } | undefined} */
  let best
  for (const one of candidates) {
    // A folder not there is placed by its path alone: the same refusal outside, there or not.
    const realBase = real ? await realOf(one.base) : path.resolve(one.base)
    const place = real ?? full
    if (!realBase || !within(realBase, place)) continue
    // The deepest root wins: a plugin's folder lies in Claude Code's.
    const depth = realBase.length
    if (best && best.depth >= depth) continue
    const relative = path.relative(realBase, place).split(path.sep).filter(Boolean)
    best = { root: one.root, relative: [...one.prefix, ...relative].join('/'), depth }
  }
  if (!best)
    throw new FolderRefusal(
      `${trimmed || typed} is not listed: it lies outside the folders Tranchant may list`,
      roots.labels,
    )
  const found = real ? await stat(real).catch(() => undefined) : undefined
  if (!found) throw new FolderRefusal(`${trimmed}: no such folder`, roots.labels)
  if (!found.isDirectory())
    throw new FolderRefusal(`${trimmed} is not a folder`, roots.labels)
  return listFolder(project, best.root, best.relative)
}
