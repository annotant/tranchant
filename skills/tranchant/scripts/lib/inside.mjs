// The reviewers inside a source that may be no single one: a command, or an
// agent or skill that starts other agents. A read of its file, no agent:
// the agents and skills it names that resolve beside it (its plugin's root,
// or the folder its `commands`, `agents` or `skills` folder lies in), in the
// project's .claude or the user's, and the plugin:name it writes out. Each
// can become a lens; a source that names them never does. Where the read
// finds none, the cleaning agent reads the source: one lens of it, or the
// reviewers it starts (lib/reviewers.mjs checks them).
import os from 'node:os'
import path from 'node:path'
import { statSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { LensRefusal, claudeDir, installedPlugin, isPluginName } from './lens.mjs'
import { expandHome } from './settings.mjs'

/** @typedef {'agent' | 'skill' | 'command'} Kind */
/**
 * @typedef {object} Started
 * @property {string} source As Add a lens takes it: plugin:name, or a path from the project, `~/` or absolute.
 * @property {string} name The lens name it gets.
 * @property {Kind} kind
 * @property {string} [notReviewer]
 */
/**
 * @typedef {object} Inside
 * @property {Kind} kind
 * @property {string} label The source as given.
 * @property {Started[]} starts In the order the source names them.
 * @property {number} [more] Named past MAX_STARTS, left out.
 */
/** How a reviewer found by its path is written as a source. @typedef {(file: string) => string} Labeller */

/** The most reviewers one source lists: past this it is a catalogue, not a review. */
const MAX_STARTS = 12
const MAX_READ = 64 * 1024
/** The distinct plugin:name a source writes out, looked up at most: each may read Claude Code's register. */
const MAX_NAMED = 40
/** The entries of one `agents` or `skills` folder read at most: each name is a scan of the source. */
const MAX_ENTRIES = 500

/** A stem made a lens name: letters, digits, - and _, 40 at most; `lens` when nothing is left. */
export const lensNameOf = (/** @type {string} */ stem) =>
  stem
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'lens'

/**
 * The lens name a file gets: its file name without the extension, a
 * skill's folder name for its SKILL.md; made a lens name.
 * @param {string} file
 */
export function nameOfFile(file) {
  const base = path.basename(file)
  return lensNameOf(
    /^SKILL\.md$/i.test(base)
      ? path.basename(path.dirname(file))
      : base.replace(/\.[^.]+$/, ''),
  )
}

/**
 * The lens name a source gets when none is given: a plugin's skill, agent or
 * command, its name without the plugin; a file, as nameOfFile; a folder (a
 * skill's), its name whole.
 * @param {string} source
 * @param {string} project What a relative path is from.
 */
export function nameOfSource(source, project) {
  const trimmed = source.trim()
  if (isPluginName(trimmed))
    return lensNameOf(trimmed.slice(trimmed.lastIndexOf(':') + 1))
  const bare = trimmed.replace(/[/\\]+$/, '')
  // A skill's folder may hold a dot (`api.v2`): no extension to strip from it.
  const folder = statSync(path.resolve(project, expandHome(bare)), {
    throwIfNoEntry: false,
  })?.isDirectory()
  return folder ? lensNameOf(path.basename(bare)) : nameOfFile(bare)
}

/**
 * Why a source reads as no reviewer of its own, or undefined: one that
 * starts other agents (its tools, or allowed tools, give it Task or Agent,
 * or it names subagent types) would end its cleaning without a lens.
 * @param {string} text
 */
export function notReviewerReason(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const tools = /^(?:allowed-)?tools:\s*(.*)$/m.exec(front)?.[1] ?? ''
  if (/\b(?:Task|Agent)\b/.test(tools) || /\bsubagent_type\b/.test(text))
    return 'It starts other agents and holds no review of its own: its cleaning would end without a lens.'
  return undefined
}

/** How a path is written as a source: from the project, `~/` or absolute, as `from` says. */
export function labelOf(
  /** @type {string} */ file,
  /** @type {'project' | 'home' | 'absolute'} */ from,
  /** @type {string} */ project,
) {
  if (from === 'absolute') return file
  const base = from === 'home' ? os.homedir() : project
  const relative = path.relative(base, file).split(path.sep).join('/')
  return from === 'home' ? `~/${relative}` : relative
}

/**
 * A path found on its own, written as `from` asks when it can be: from the
 * project when inside it, else `~/` when inside the home, else absolute.
 * @param {string} file
 * @param {'project' | 'home' | 'absolute'} from
 * @param {string} project
 */
export function sourceLabel(file, from, project) {
  const inside = (/** @type {string} */ base) => {
    const relative = path.relative(base, file)
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  }
  if (from === 'absolute') return file
  if (from === 'project' && inside(project)) return labelOf(file, 'project', project)
  if (inside(os.homedir())) return labelOf(file, 'home', project)
  return file
}

/** A file's first bytes, enough to tell a reviewer, never the whole file; undefined when it cannot be read. */
export async function readHead(/** @type {string} */ file) {
  try {
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(MAX_READ)
      const { bytesRead } = await handle.read(buffer, 0, MAX_READ, 0)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return undefined
  }
}

const isFile = async (/** @type {string} */ file) =>
  (await stat(file).catch(() => undefined))?.isFile() ?? false

/**
 * What a file is, from the folder it lies in, never one above it (a project
 * cloned under `~/commands/`): a skill's SKILL.md, a command right in a
 * `commands` folder, an agent right in an `agents` folder; undefined for a
 * file of none (a checklist).
 * @param {string} file
 * @returns {Kind | undefined}
 */
export function kindOfPath(file) {
  if (/^SKILL\.md$/i.test(path.basename(file))) return 'skill'
  const folder = path.basename(path.dirname(file))
  if (folder === 'commands') return 'command'
  if (folder === 'agents') return 'agent'
  return undefined
}

/** Where a command's, an agent's or a skill's siblings are: the folder its `commands`, `agents` or `skills` folder lies in. */
function homeOf(/** @type {string} */ file) {
  const kind = kindOfPath(file)
  if (!kind) return undefined
  const folder = path.dirname(file)
  if (kind !== 'skill') return path.dirname(folder)
  const skills = path.dirname(folder)
  return path.basename(skills) === 'skills' ? path.dirname(skills) : undefined
}

/**
 * The skills and agents of a folder that holds them (a plugin's root, a
 * `.claude`), by name: `skills/<name>/SKILL.md`, `agents/<name>.md`. A skill
 * first, as `plugin:name` resolves to it before an agent of the same name.
 * @param {string} home
 */
async function reviewersIn(home) {
  /** @type {{ name: string, file: string, kind: Kind }[]} */
  const found = []
  const skills = await readdir(path.join(home, 'skills')).catch(() => [])
  for (const entry of skills.slice(0, MAX_ENTRIES)) {
    const file = path.join(home, 'skills', entry, 'SKILL.md')
    if (!entry.startsWith('.') && (await isFile(file)))
      found.push({ name: entry, file, kind: 'skill' })
  }
  const agents = await readdir(path.join(home, 'agents')).catch(() => [])
  for (const entry of agents.slice(0, MAX_ENTRIES)) {
    const file = path.join(home, 'agents', entry)
    // A regular file only: a link to a FIFO would hang the read for good.
    if (/\.md$/i.test(entry) && !entry.startsWith('.') && (await isFile(file)))
      found.push({ name: entry.replace(/\.md$/i, ''), file, kind: 'agent' })
  }
  return found
}

/**
 * Where `name` is first written in `text` as a word of its own (`-` part of
 * a word), or -1. A name of one plain word (`issues`) counts only quoted, in
 * backticks or as `/name`: written bare, it is prose.
 * @param {string} text
 * @param {string} name
 */
function firstMention(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Never inside `plugin:name`: that one is another plugin's, looked up as such.
  const word = `(?<![\\w:-])${escaped}(?![\\w:-])`
  const pattern = /[-_\d]/.test(name)
    ? word
    : `(?<=[\`"'/])(?<![\\w-]:)${escaped}(?=[\`"'\\s.,;)]|$)`
  return new RegExp(pattern).exec(text)?.index ?? -1
}

/**
 * An installed plugin's agent, skill or command, by `plugin:name`: its file,
 * its kind and its plugin's root; undefined when it is not there, or its
 * plugin is not installed or is turned off.
 * @param {string} label
 * @param {string} project
 * @param {Map<string, Awaited<ReturnType<typeof installedPlugin>>>} [plugins] The plugins looked up already, by name.
 */
async function pluginFile(label, project, plugins = new Map()) {
  const [plugin = '', ...rest] = label.split(':')
  if (plugin === 'tranchant' || !rest.length) return undefined
  if (!plugins.has(plugin))
    plugins.set(
      plugin,
      await installedPlugin(plugin, project).catch((error) => {
        // An unreadable register: the usual add of that source says so.
        if (error instanceof LensRefusal) return undefined
        throw error
      }),
    )
  const installed = plugins.get(plugin)
  if (!installed?.enabled) return undefined
  const inside = rest.join('/')
  /** @type {[string, Kind][]} */
  const candidates = [
    ...(rest.length === 1
      ? /** @type {[string, Kind][]} */ ([
          [path.join(installed.root, 'skills', inside, 'SKILL.md'), 'skill'],
        ])
      : []),
    [path.join(installed.root, 'agents', `${inside}.md`), 'agent'],
    [path.join(installed.root, 'commands', `${inside}.md`), 'command'],
  ]
  for (const [file, kind] of candidates) {
    if (path.relative(installed.root, file).startsWith('..')) continue
    if (await isFile(file)) return { file, kind, root: installed.root, plugin }
  }
  return undefined
}

/**
 * A source as Add a lens takes it, found: its file, its kind, and where its
 * siblings are written as `plugin:name`; undefined when it is not there.
 * @param {string} label
 * @param {string} project
 */
async function sourceFile(label, project) {
  const trimmed = label.trim()
  if (isPluginName(trimmed)) return pluginFile(trimmed, project)
  let file = path.resolve(project, expandHome(trimmed))
  const found = await stat(file).catch(() => undefined)
  if (found?.isDirectory()) file = path.join(file, 'SKILL.md')
  if (!(await isFile(file))) return undefined
  return { file, kind: kindOfPath(file), root: undefined, plugin: undefined }
}

/**
 * The reviewers `text` starts, in the order it names them: those beside it
 * (`home`, its plugin's root when `plugin`), the project's and the user's,
 * named by their names; and any installed plugin's, written `plugin:name`.
 * One file once, however it is written. Commands are left out: one that
 * starts another is its process, not a reviewer of it.
 * @param {{ text: string, file: string, home: string | undefined, plugin: string | undefined, project: string, label: Labeller }} given
 */
async function startedBy({ text, file, home, plugin, project, label: labelFile }) {
  /** @type {Map<string, { at: number, source: string, file: string, kind: Kind }>} */
  const found = new Map()
  const keep = (
    /** @type {number} */ at,
    /** @type {string} */ source,
    /** @type {string} */ one,
    /** @type {Kind} */ kind,
  ) => {
    const key = path.resolve(one)
    // A file of the source's own name is a copy of it (~/.claude/skills/<its name>), never its reviewer.
    if (
      at === -1 ||
      kind === 'command' ||
      key === path.resolve(file) ||
      nameOfFile(one) === nameOfFile(file)
    )
      return
    const known = found.get(key)
    if (!known || at < known.at) found.set(key, { at, source, file: one, kind })
  }
  const user = path.resolve(claudeDir())
  // The project's agents before the user's, as Claude Code picks them; a plugin's or a folder's own first.
  const homes = [
    ...(home && path.resolve(home) !== user ? [{ dir: home, plugin }] : []),
    { dir: path.join(project, '.claude'), plugin: undefined },
    { dir: user, plugin: undefined },
  ]
  const seen = new Set()
  // A name is the first home's that has it: a plugin's command means its own code-reviewer.
  const names = new Set()
  for (const one of homes) {
    const dir = path.resolve(one.dir)
    if (seen.has(dir)) continue
    seen.add(dir)
    const here = await reviewersIn(dir)
    const fresh = here.filter((reviewer) => !names.has(reviewer.name))
    for (const reviewer of here) names.add(reviewer.name)
    for (const reviewer of fresh)
      keep(
        firstMention(text, reviewer.name),
        one.plugin
          ? `${one.plugin}:${reviewer.name}`
          : labelFile(
              reviewer.kind === 'skill' ? path.dirname(reviewer.file) : reviewer.file,
            ),
        reviewer.file,
        reviewer.kind,
      )
  }
  /** @type {Map<string, number>} */
  const named = new Map()
  // A segment never ends with a dot: `team:linter.` ends a sentence.
  for (const match of text.matchAll(
    /(?<![\w./@-])([\w-](?:[\w.-]*[\w-])?(?::[\w-](?:[\w.-]*[\w-])?)+)(?![\w-])/g,
  )) {
    const label = match[1] ?? ''
    if (!named.has(label)) named.set(label, match.index)
    if (named.size >= MAX_NAMED) break
  }
  const plugins = new Map()
  for (const [label, at] of named) {
    const one = await pluginFile(label, project, plugins)
    if (one) keep(at, label, one.file, one.kind)
  }
  return [...found.values()].toSorted((a, b) => a.at - b.at)
}

/**
 * The reviewers inside the source `label` for the project at `project`:
 * for a command, always (none when it names no reviewer that resolves: its
 * agents written in it, or a plugin's not installed or turned off); for an
 * agent or skill that starts other agents, when it names one that resolves.
 * Undefined for a single reviewer, and for a source not found: the usual
 * add says why.
 * @param {string} project
 * @param {string} label
 * @returns {Promise<Inside | undefined>}
 */
export async function insideOf(project, label) {
  const found = await sourceFile(label, project)
  if (!found) return undefined
  return insideFile(project, {
    label: label.trim(),
    file: found.file,
    kind: found.kind,
    home: found.root ?? homeOf(found.file),
    plugin: found.plugin,
  })
}

/**
 * As insideOf, for a file already found (a glob's match). A reviewer it
 * starts that starts others is left out: it would be refused as a lens.
 * @param {string} project
 * @param {{ label: string, file: string, kind: Kind | undefined, home?: string | undefined, plugin?: string | undefined, text?: string | undefined, labelFile?: Labeller }} given
 * @returns {Promise<Inside | undefined>}
 */
export async function insideFile(project, given) {
  const text = given.text ?? (await readHead(given.file))
  if (text === undefined) return undefined
  const command = given.kind === 'command'
  if (!command && !notReviewerReason(text)) return undefined
  const named = await startedBy({
    text,
    file: given.file,
    home: given.home ?? homeOf(given.file),
    plugin: given.plugin,
    project,
    label: given.labelFile ?? ((file) => sourceLabel(file, 'project', project)),
  })
  /** @type {Started[]} */
  const reviewers = []
  for (const one of named) {
    const head = await readHead(one.file)
    if (head !== undefined && notReviewerReason(head)) continue
    reviewers.push({ source: one.source, name: nameOfFile(one.file), kind: one.kind })
  }
  if (!command && !reviewers.length) return undefined
  return {
    kind: given.kind ?? 'agent',
    label: given.label,
    starts: reviewers.slice(0, MAX_STARTS),
    ...(reviewers.length > MAX_STARTS && { more: reviewers.length - MAX_STARTS }),
  }
}

/**
 * Why a source cannot be cleaned into one lens, for the reviewers found
 * inside it (`starts` not empty): those to add instead, by name.
 * @param {Inside} inside
 */
export function insideRefusal(inside) {
  // Their lens names, never their paths: a file name is the repository's text, and this reaches the model.
  const sources = inside.starts.map((one) => one.name)
  const what =
    inside.kind === 'command'
      ? `${inside.label} is a command that starts other reviewers`
      : `${inside.label} starts other agents and holds no review of its own`
  const count = sources.length + (inside.more ?? 0)
  return `${what}: add the ${count === 1 ? 'reviewer' : `${count} reviewers`} it starts instead (${sources.join(', ')}${inside.more ? `, and ${inside.more} more` : ''}), at once from Settings › Lenses`
}
