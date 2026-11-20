// What Add a lens's picker lists: the installed plugins' skills, agents and
// commands, the project's `.claude` and the user's, and the folders under
// three roots (the project, Claude Code's folder, each plugin's). Names
// only: no file is read here, and no folder outside those roots is listed.
import path from 'node:path'
import { constants } from 'node:fs'
import { access, lstat, readdir, realpath, stat } from 'node:fs/promises'
import { claudeDir, installedPlugins, isPluginName, LensRefusal } from './lens.mjs'
import { errorCode } from './errors.mjs'
import { sourceLabel } from './inside.mjs'
import { expandHome } from './settings.mjs'

/** @typedef {import('./inside.mjs').Kind} Kind */
/** @typedef {{ kind: Kind, name: string, source: string }} Item */
/**
 * @typedef {object} PluginGroup
 * @property {string} name
 * @property {string} [version]
 * @property {string} folder Its install folder, from `~/` or absolute.
 * @property {boolean} enabled False when a settings file turns it off for this project: its lenses would not build.
 * @property {Item[]} items
 * @property {string} [problem] Why some of its items cannot be listed: its folder missing, or unreadable.
 * @property {number} [more] Items past the most listed.
 */
/** @typedef {{ folder: string, items: Item[], problem?: string, more?: number }} DotClaude */
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
 * shown and never opened (`hidden`; `link` leaving its root, to a hidden
 * place or broken; `unreadable`; `other`, no Markdown file or one that
 * cannot be told), `reason` saying why.
 * @typedef {{ name: string, kind: 'folder' | 'file' | 'hidden' | 'link' | 'unreadable' | 'other', source?: string, reason?: string }} Entry
 */
/**
 * @typedef {object} Folder
 * @property {Root} root
 * @property {string} path Inside its root, `/`-separated; '' for the root itself.
 * @property {string} label The folder as Source would name it; prose for the plugins' root.
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

/** Whether a path inside a root passes through a hidden folder or file. */
const hiddenIn = (/** @type {string} */ relative) =>
  relative
    .split(/[/\\]/)
    .some((one) => one === '..' || (one.startsWith('.') && one !== OPENED_DOT))

/**
 * The names of a folder that holds skills, agents or commands, those `keep`
 * accepts, at most MAX_ENTRIES; a folder missing is none, one unreadable
 * says so.
 * @param {string} dir
 * @param {(name: string) => boolean} keep
 */
async function namesIn(dir, keep) {
  /** @type {string[]} */
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { names: [], more: 0 }
    return { names: [], more: 0, unreadable: `${path.basename(dir)}/ cannot be read` }
  }
  const kept = names
    .filter((name) => !name.startsWith('.') && keep(name))
    .toSorted((a, b) => a.localeCompare(b))
  return {
    names: kept.slice(0, MAX_ENTRIES),
    more: Math.max(0, kept.length - MAX_ENTRIES),
  }
}

/**
 * The skills, agents and commands of a folder that holds them (a plugin's
 * root, a `.claude`), each written as `write` makes its source; why some
 * cannot be listed, and how many were left out.
 * @param {string} home
 * @param {(kind: Kind, name: string, file: string) => string} write
 */
async function itemsIn(home, write) {
  /** @type {Item[]} */
  const items = []
  /** @type {string[]} */
  const problems = []
  let more = 0
  const skills = await namesIn(path.join(home, 'skills'), () => true)
  more += skills.more
  if (skills.unreadable) problems.push(skills.unreadable)
  for (const name of skills.names) {
    const file = path.join(home, 'skills', name, 'SKILL.md')
    if (await isFile(file))
      items.push({ kind: 'skill', name, source: write('skill', name, file) })
  }
  for (const kind of /** @type {const} */ (['agent', 'command'])) {
    const dir = path.join(home, `${kind}s`)
    const found = await namesIn(dir, (name) => /\.md$/i.test(name))
    more += found.more
    if (found.unreadable) problems.push(found.unreadable)
    for (const entry of found.names) {
      const file = path.join(dir, entry)
      // A regular file only, as Claude Code loads it: a FIFO is no agent.
      if (!(await isFile(file))) continue
      const name = entry.replace(/\.md$/i, '')
      items.push({ kind, name, source: write(kind, name, file) })
    }
  }
  return {
    items,
    ...(problems.length && { problem: problems.join(', ') }),
    ...(more && { more }),
  }
}

/**
 * How a plugin's own skill, agent or command is written as a source:
 * `plugin:name` when that resolves to it (a skill first, then an agent, then
 * a command, as resolveSource and Claude Code look them up), else undefined.
 * @param {string} plugin
 * @param {string} root
 * @param {Kind} kind
 * @param {string} name
 */
async function pluginSource(plugin, root, kind, name) {
  const label = `${plugin}:${name}`
  if (!isPluginName(label)) return undefined
  const before = /** @type {Kind[]} */ (['skill', 'agent', 'command']).slice(
    0,
    ['skill', 'agent', 'command'].indexOf(kind),
  )
  for (const other of before) {
    const file =
      other === 'skill'
        ? path.join(root, 'skills', name, 'SKILL.md')
        : path.join(root, `${other}s`, `${name}.md`)
    if (await isFile(file)) return undefined
  }
  return label
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
      const listed = await itemsIn(one.root, (kind, name, file) => {
        // plugin:name resolves to a skill first, then an agent, then a command.
        const label = `${one.name}:${name}`
        if (taken.has(name) || !isPluginName(label))
          return sourceLabel(file, 'home', project)
        taken.add(name)
        return label
      })
      const there = (await stat(one.root).catch(() => undefined))?.isDirectory()
      plugins.push({
        name: one.name,
        ...(one.version && { version: one.version }),
        folder: `${sourceLabel(one.root, 'home', project)}/`,
        enabled: one.enabled,
        items: listed.items,
        ...(!there
          ? { problem: 'its install folder is missing: reinstall it (/plugin)' }
          : listed.problem && { problem: listed.problem }),
        ...(listed.more && { more: listed.more }),
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
    ...(await itemsIn(dir, (kind, _name, file) =>
      sourceLabel(kind === 'skill' ? path.dirname(file) : file, from, project),
    )),
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
  /** @type {Awaited<ReturnType<typeof installedPlugins>>} */
  let installed = []
  let pluginsError
  try {
    installed = await installedPlugins(project)
  } catch (error) {
    if (!(error instanceof LensRefusal)) throw error
    pluginsError = error.message
  }
  const plugins = installed.filter((one) => one.name !== 'tranchant')
  return {
    pluginsError,
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
 * without reading it. A link is followed only while it stays in its root
 * and out of its hidden places. A plugin's own skill, agent or command is
 * written `plugin:name` when that resolves to it: the form that follows its
 * updates, and the one its lenses are known by.
 * @param {string} dir
 * @param {string} name
 * @param {{ realRoot: string, project: string, plugin?: { name: string, root: string } | undefined }} where
 * @returns {Promise<Entry>}
 */
async function entryOf(dir, name, { realRoot, project, plugin }) {
  const full = path.join(dir, name)
  if (name.startsWith('.') && name !== OPENED_DOT)
    return { name, kind: 'hidden', reason: 'hidden: shown, never opened' }
  const own = await lstat(full).catch(() => undefined)
  if (!own) return { name, kind: 'other', reason: 'cannot be read' }
  let found = own
  if (own.isSymbolicLink()) {
    const real = await realOf(full)
    if (!real) return { name, kind: 'link', reason: 'a broken link: not followed' }
    if (!within(realRoot, real))
      return { name, kind: 'link', reason: 'leaves its root: not followed' }
    if (hiddenIn(path.relative(realRoot, real)))
      return { name, kind: 'link', reason: 'leads to a hidden place: not followed' }
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
  // Source would read it as a glob, and match other files with it.
  if (/[*?]/.test(name))
    return { name, kind: 'other', reason: 'its name holds * or ?: read as a glob' }
  return { name, kind: 'file', source: await sourceOfFile(full, project, plugin) }
}

/**
 * How a Markdown file is written as a source: `plugin:name` for a plugin's
 * own skill, agent or command when that resolves to it, else its path.
 * @param {string} file
 * @param {string} project
 * @param {{ name: string, root: string } | undefined} plugin
 */
async function sourceOfFile(file, project, plugin) {
  if (plugin) {
    const parts = path.relative(plugin.root, file).split(path.sep)
    const [folder, entry, last] = parts
    const own =
      parts.length === 3 && folder === 'skills' && last === 'SKILL.md'
        ? { kind: /** @type {Kind} */ ('skill'), name: entry ?? '' }
        : parts.length === 2 && (folder === 'agents' || folder === 'commands')
          ? {
              kind: /** @type {Kind} */ (folder === 'agents' ? 'agent' : 'command'),
              name: (entry ?? '').replace(/\.md$/i, ''),
            }
          : undefined
    const label =
      own && (await pluginSource(plugin.name, plugin.root, own.kind, own.name))
    if (label) return label
  }
  return sourceLabel(file, 'project', project)
}

/**
 * Walks from a root's folder down `inside`, one folder at a time: refused at
 * the first that is missing, unreadable, a link out of the root or into its
 * hidden places, before anything past it is looked at.
 * @param {string} base
 * @param {string[]} inside
 * @param {string} shown The folder as the user named it, for the refusals.
 * @param {string[]} labels
 */
async function walk(base, inside, shown, labels) {
  const realRoot = await realOf(base)
  if (!realRoot) throw new FolderRefusal(`${shown}: no such folder`, labels)
  let dir = base
  for (const segment of ['', ...inside]) {
    dir = path.join(dir, segment)
    let real
    try {
      real = await realpath(dir)
    } catch (error) {
      const code = errorCode(error)
      throw new FolderRefusal(
        code === 'ENOENT' || code === 'ENOTDIR'
          ? `${shown}: no such folder`
          : `${shown} cannot be read${typeof code === 'string' ? ` (${code})` : ''}`,
        labels,
      )
    }
    if (!within(realRoot, real))
      throw new FolderRefusal(
        `${shown} leaves its root through a link: not followed`,
        labels,
      )
    if (hiddenIn(path.relative(realRoot, real)))
      throw new FolderRefusal(`${shown} is not listed: a hidden folder`, labels)
  }
  const found = await stat(dir).catch(() => undefined)
  if (!found?.isDirectory()) throw new FolderRefusal(`${shown} is not a folder`, labels)
  // A folder listed but not entered would show empty: its files are there.
  const open = await access(dir, constants.R_OK | constants.X_OK).then(
    () => true,
    () => false,
  )
  if (!open) throw new FolderRefusal(`${shown} cannot be read`, labels)
  return { dir, realRoot }
}

/**
 * The folder `relative` of `root` for the project at `project`: its
 * entries, folders first; the names only, never a file's text. Refused: a
 * `..` or hidden segment, a link out of its root, a folder missing or
 * unreadable, an unknown plugin.
 * @param {string} project
 * @param {Root} root
 * @param {string} relative `/`-separated, '' for the root itself.
 * @returns {Promise<Folder>}
 */
export async function listFolder(project, root, relative) {
  const roots = await rootsOf(project)
  const segments = relative.split('/').filter(Boolean)
  const shown = segments.join('/') || '.'
  if (hiddenIn(segments.join('/')))
    throw new FolderRefusal(
      `${shown} is not listed: a hidden folder, or one above its root`,
      roots.labels,
    )
  if (root === 'plugins' && !segments.length) {
    if (roots.pluginsError)
      throw new FolderRefusal(
        `Claude Code's plugins cannot be listed: ${roots.pluginsError}`,
        roots.labels,
      )
    return {
      root,
      path: '',
      label: "The plugins' folders",
      entries: [...roots.plugins.keys()]
        .toSorted((a, b) => a.localeCompare(b))
        .map((name) => ({ name, kind: /** @type {const} */ ('folder') })),
    }
  }
  let base
  /** @type {{ name: string, root: string } | undefined} */
  let plugin
  if (root === 'project') base = roots.project
  else if (root === 'user') base = roots.user
  else {
    const name = segments[0] ?? ''
    base = roots.plugins.get(name)
    if (!base)
      throw new FolderRefusal(
        `${name} is not a plugin listed here: Tranchant's own, and those not installed, are not`,
        roots.labels,
      )
    plugin = { name, root: base }
  }
  const inside = root === 'plugins' ? segments.slice(1) : segments
  const { dir, realRoot } = await walk(base, inside, shown, roots.labels)
  /** @type {import('node:fs').Dirent[]} */
  let found
  try {
    found = await readdir(dir, { withFileTypes: true })
  } catch {
    throw new FolderRefusal(`${shown} cannot be read`, roots.labels)
  }
  // Folders first before the cut: a subfolder past the most listed stays reachable.
  const sorted = found.toSorted(
    (a, b) =>
      Number(!a.isDirectory()) - Number(!b.isDirectory()) || a.name.localeCompare(b.name),
  )
  /** @type {Entry[]} */
  const entries = []
  for (const one of sorted.slice(0, MAX_ENTRIES))
    entries.push(await entryOf(dir, one.name, { realRoot, project, plugin }))
  const label =
    root === 'project'
      ? `${inside.join('/') || '.'}/`
      : `${sourceLabel(dir, 'home', project)}/`
  return {
    root,
    path: segments.join('/'),
    label,
    entries: entries.toSorted((a, b) => rank(a) - rank(b)),
    ...(found.length > MAX_ENTRIES && { more: found.length - MAX_ENTRIES }),
  }
}

/**
 * A folder typed in the picker (from the project, `~/` or absolute), listed
 * from the deepest root its path lies in, by its path alone: a link is
 * looked at only by the walk, which refuses one leaving its root before
 * anything past it. Refused, the roots named, when it lies in none, the same
 * whether it is there or not.
 * @param {string} project
 * @param {string} typed
 * @returns {Promise<Folder>}
 */
export async function goToFolder(project, typed) {
  const roots = await rootsOf(project)
  const trimmed = typed.trim().replace(/[/\\]+$/, '')
  const full = path.resolve(project, expandHome(trimmed || '.'))
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
    // A root reached through a link (`/tmp` on macOS) is matched by either path.
    for (const base of [path.resolve(one.base), await realOf(one.base)]) {
      if (!base || !within(base, full)) continue
      // The deepest root wins: a plugin's folder lies in Claude Code's.
      if (best && best.depth >= base.length) continue
      const relative = path.relative(base, full).split(path.sep).filter(Boolean)
      best = {
        root: one.root,
        relative: [...one.prefix, ...relative].join('/'),
        depth: base.length,
      }
    }
  }
  if (!best)
    throw new FolderRefusal(
      `${trimmed || typed} is not listed: it lies outside the folders Tranchant may list`,
      roots.labels,
    )
  return listFolder(project, best.root, best.relative)
}
