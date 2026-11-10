// A recipe's lenses, from the recipe in force to the prompt each reviewer
// runs: which recipe applies (a run's, the local one, the project's at BASE,
// the settings', the plugin's), what it says, where each lens's source lies
// (a plugin's skill or agent, a path, a lens of Tranchant's own), and the
// prompt built from it. The build is the same bytes for the same sources,
// skills and contract, and is stored once under <state>/lenses/<sha256>.md.
// Described in docs/review-file.md and docs/settings.md.
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { errorCode } from './errors.mjs'
import { PLUGIN_ROOT, STATE_ROOT, hashOf } from './project.mjs'
import { SETTINGS_DIR, expandHome } from './settings.mjs'

const run = promisify(execFile)

/** The plugin's own recipe, and the contract every lens built from a source follows. */
const PLUGIN_RECIPE = path.join(PLUGIN_ROOT, 'agents', 'review', 'recipe.json')
const CONTRACT = path.join(PLUGIN_ROOT, 'agents', 'review', 'contract.md')
/** Where a project keeps its recipe, from its root. */
export const PROJECT_RECIPE = path.join('.tranchant', 'recipe.json')
/** Where the built prompts are stored, one per hash. */
const LENSES_DIR = path.join(STATE_ROOT, 'lenses')

const LENS_NAME = /^[\w-]{1,40}$/
const MAX_LENSES = 12
const MAX_SKILLS = 6
/** The most a source, or a skill a lens lists, may weigh. */
const MAX_SOURCE_BYTES = 64 * 1024
const MAX_RECIPE_BYTES = 1024 * 1024
/** `plugin:skill`, `plugin:agent`, `plugin:folder:agent`. */
const PLUGIN_NAME = /^[\w.-]+(?::[\w.-]+)+$/
const MODEL = /^[\w.:-]{1,80}$/
const TOPICS = [
  'Bugs',
  'Security & Permissions',
  'Breaking Changes',
  'Tests',
  'Conventions',
  'Code Quality',
  'Deprecation & Feature Flags',
]
const LENS_KEYS = new Set([
  'name',
  'prompt',
  'source',
  'use',
  'add',
  'skills',
  'model',
  'paths',
  'topics',
  'otherwise',
])

/** A recipe this Tranchant refuses to read, and why. */
export class RecipeRefusal extends Error {}

/** A lens whose source cannot be resolved: why, and what fixes it. */
export class LensRefusal extends Error {
  /** @param {string} reason @param {string} fix */
  constructor(reason, fix) {
    super(reason)
    this.fix = fix
  }
}

/**
 * A lens as a recipe names it, checked.
 * @typedef {object} LensSpec
 * @property {string} name
 * @property {string[]} paths Empty for the `otherwise` lens.
 * @property {true} [otherwise]
 * @property {string} [prompt] A whole prompt, by path.
 * @property {string} [source] A skill or agent by name (`plugin:name`), or a path.
 * @property {string} [use] A lens of Tranchant's (`tranchant:<lens>`) the `add` source adds to.
 * @property {string} [add]
 * @property {string[]} [skills] Sources passed to the lens as references.
 * @property {string} [model]
 * @property {string[]} [topics]
 */

/**
 * Where a recipe, and every path it names, is read from: the files, or the
 * project's repository at BASE.
 * @typedef {{ kind: 'fs' } | { kind: 'git', project: string, base: string }} Origin
 */

/**
 * The recipe in force, as the Lenses step reads it.
 * @typedef {object} RecipeRef
 * @property {string} file The recipe file: absolute, or from the project's root at BASE.
 * @property {'run' | 'local' | 'project' | 'settings' | 'plugin'} from
 * @property {string} [project] With `project`: the repository.
 * @property {string} [base] With `project`: the commit it is read at.
 */

/**
 * A source, found: its text and where it lies.
 * @typedef {object} Resolved
 * @property {string} label The source as the recipe names it.
 * @property {string} text
 * @property {string} file Its file: absolute, or from the root at BASE.
 * @property {string} folder Its folder, for its relative links: absolute, or from the root at BASE.
 * @property {boolean} atBase Whether `folder` is read at BASE, with git.
 * @property {string} [version] A plugin's version.
 */

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error)

/** `file` read whole, unless it is not a regular file or weighs more than `max`. */
async function readBounded(/** @type {string} */ file, /** @type {number} */ max) {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile())
      throw Object.assign(new Error('not a regular file'), { code: 'EISDIR' })
    if (info.size > max) throw Object.assign(new Error('too large'), { code: 'E2BIG' })
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

/** git in `project`, its stdout; undefined when it fails. */
async function gitOut(/** @type {string} */ project, /** @type {string[]} */ args) {
  try {
    const { stdout } = await run('git', ['-C', project, ...args], {
      maxBuffer: 4 * 1024 * 1024,
    })
    return stdout
  } catch {
    return undefined
  }
}

/**
 * What lies at `file` for `origin`: a file's text, a folder, or nothing;
 * `large` past `max` bytes.
 * @param {Origin} origin
 * @param {string} file
 * @param {number} max
 * @returns {Promise<{ kind: 'file', text: string } | { kind: 'folder' } | { kind: 'none' } | { kind: 'large' }>}
 */
async function lookAt(origin, file, max) {
  if (origin.kind === 'git') {
    const spec = `${origin.base}:${file}`
    const type = (await gitOut(origin.project, ['cat-file', '-t', spec]))?.trim()
    if (type === 'tree') return { kind: 'folder' }
    if (type !== 'blob') return { kind: 'none' }
    const size = Number((await gitOut(origin.project, ['cat-file', '-s', spec]))?.trim())
    if (!(size <= max)) return { kind: 'large' }
    const text = await gitOut(origin.project, ['cat-file', 'blob', spec])
    return text === undefined ? { kind: 'none' } : { kind: 'file', text }
  }
  try {
    const info = await stat(file)
    if (info.isDirectory()) return { kind: 'folder' }
    if (info.size > max) return { kind: 'large' }
    return { kind: 'file', text: await readBounded(file, max) }
  } catch (error) {
    if (errorCode(error) === 'E2BIG') return { kind: 'large' }
    return { kind: 'none' }
  }
}

/** The local recipe's file, for the project at `root`: outside the repository, the user's alone. */
export const localRecipe = (/** @type {string} */ root) =>
  path.join(SETTINGS_DIR, 'projects', hashOf(root), 'recipe.json')

/**
 * The recipe in force for a review of `project` against `base`: `--recipe`,
 * then the local recipe, then the project's at BASE, then the settings',
 * then the plugin's.
 * @param {{ flag?: string, project: string, base: string, settings: string | null }} given
 * @returns {Promise<RecipeRef>}
 */
export async function findRecipe({ flag, project, base, settings }) {
  if (flag) return { file: flag, from: 'run' }
  const local = localRecipe(project)
  if (existsSync(local)) return { file: local, from: 'local' }
  const atBase = await gitOut(project, ['cat-file', '-t', `${base}:${PROJECT_RECIPE}`])
  if (atBase?.trim() === 'blob')
    return { file: PROJECT_RECIPE, from: 'project', project, base }
  if (settings) return { file: expandHome(settings), from: 'settings' }
  return { file: PLUGIN_RECIPE, from: 'plugin' }
}

/** Where `ref`'s paths are read from. @param {RecipeRef} ref @returns {Origin} */
export const originOf = (ref) =>
  ref.from === 'project' && ref.project && ref.base
    ? { kind: 'git', project: ref.project, base: ref.base }
    : { kind: 'fs' }

/**
 * The recipe `ref` names, read and checked: its lenses, the plugin's first
 * when it `extends` Tranchant (a lens of the same name replaces the plugin's).
 * @param {RecipeRef} ref
 * @returns {Promise<{ lenses: LensSpec[], imported?: unknown }>}
 */
export async function readRecipe(ref) {
  const found = await lookAt(originOf(ref), ref.file, MAX_RECIPE_BYTES)
  if (found.kind === 'none') throw new RecipeRefusal('no such file')
  if (found.kind === 'folder') throw new RecipeRefusal('not a regular file')
  if (found.kind === 'large')
    throw new RecipeRefusal(`larger than ${MAX_RECIPE_BYTES / 1024 / 1024} MiB`)
  let raw
  try {
    raw = JSON.parse(found.text)
  } catch {
    throw new RecipeRefusal('not JSON')
  }
  const own = checkRecipe(raw)
  if (ref.from === 'plugin' || ref.file === PLUGIN_RECIPE)
    return { lenses: own.map(builtIn) }
  if (raw.extends !== 'tranchant') return { lenses: own, imported: raw.imported }
  const plugin = checkRecipe(JSON.parse(await readFile(PLUGIN_RECIPE, 'utf8')))
  const mine = new Set(own.map((lens) => lens.name))
  const lenses = [...plugin.filter((lens) => !mine.has(lens.name)).map(builtIn), ...own]
  if (lenses.length > MAX_LENSES)
    throw new RecipeRefusal(`${MAX_LENSES} lenses at most, the plugin's included`)
  return { lenses, imported: raw.imported }
}

/**
 * One of the plugin's lenses, named as such: its prompt lies next to the
 * plugin's recipe, whichever recipe takes it.
 * @param {LensSpec} lens
 * @returns {LensSpec}
 */
const builtIn = (lens) => ({ ...lens, prompt: `tranchant:${lens.name}` })

/** @param {unknown} value @returns {value is string} */
const isText = (value) => typeof value === 'string' && value.trim() !== ''

/**
 * A recipe's lenses, checked: what each names, never what it says.
 * @param {any} recipe
 * @returns {LensSpec[]}
 */
export function checkRecipe(recipe) {
  const lenses = recipe?.lenses
  if (recipe?.version !== 1 || !Array.isArray(lenses) || !lenses.length)
    throw new RecipeRefusal('version 1 and at least one lens are required')
  if (recipe.extends !== undefined && recipe.extends !== 'tranchant')
    throw new RecipeRefusal('extends: "tranchant" is the only one')
  if (lenses.length > MAX_LENSES) throw new RecipeRefusal(`${MAX_LENSES} lenses at most`)
  const names = new Set()
  let otherwise = false
  return lenses.map((lens, i) => {
    const where = `lenses[${i}]`
    const refuse = (/** @type {string} */ what) => {
      throw new RecipeRefusal(`${where}${what}`)
    }
    if (!lens || typeof lens !== 'object' || Array.isArray(lens)) refuse(': an object')
    const unknown = Object.keys(lens).find((key) => !LENS_KEYS.has(key))
    if (unknown) refuse(`.${unknown}: not a lens key`)
    if (typeof lens.name !== 'string' || !LENS_NAME.test(lens.name))
      refuse('.name: letters, digits, - and _ only')
    if (names.has(lens.name)) refuse(`.name: ${lens.name} is used twice`)
    names.add(lens.name)
    const ways = ['prompt', 'source', 'use'].filter((key) => lens[key] !== undefined)
    if (ways.length !== 1) refuse(': one of prompt, source, or use with add')
    for (const key of ['prompt', 'source', 'use', 'add'])
      if (lens[key] !== undefined && !isText(lens[key])) refuse(`.${key}: a text`)
    if ((lens.use === undefined) !== (lens.add === undefined))
      refuse(': use and add go together')
    if (lens.use !== undefined && !/^tranchant:[\w-]{1,40}$/.test(lens.use))
      refuse(".use: a lens of Tranchant's, tranchant:<lens>")
    if (
      lens.skills !== undefined &&
      (!Array.isArray(lens.skills) ||
        lens.skills.length > MAX_SKILLS ||
        !lens.skills.every(isText))
    )
      refuse(`.skills: up to ${MAX_SKILLS} skills, by name or path`)
    if (
      lens.model !== undefined &&
      (typeof lens.model !== 'string' || !MODEL.test(lens.model))
    )
      refuse('.model: a model id, letters, digits, . : - and _')
    if (
      lens.topics !== undefined &&
      (!Array.isArray(lens.topics) ||
        !lens.topics.length ||
        !lens.topics.every((/** @type {unknown} */ one) => TOPICS.includes(String(one))))
    )
      refuse(`.topics: a list of ${TOPICS.join(', ')}`)
    /** @type {LensSpec} */
    const spec = {
      name: lens.name,
      paths: [],
      ...(lens.prompt !== undefined && { prompt: lens.prompt }),
      ...(lens.source !== undefined && { source: lens.source }),
      ...(lens.use !== undefined && { use: lens.use, add: lens.add }),
      ...(lens.skills?.length && { skills: [...lens.skills] }),
      ...(lens.model !== undefined && { model: lens.model }),
      ...(lens.topics !== undefined && { topics: [...new Set(lens.topics)] }),
    }
    if (lens.otherwise !== undefined) {
      if (lens.otherwise !== true) refuse('.otherwise: true, or left out')
      if (lens.paths !== undefined) refuse(': an otherwise lens has no paths')
      if (otherwise) refuse(': one otherwise lens at most')
      otherwise = true
      return { ...spec, otherwise: true }
    }
    const paths = lens.paths ?? ['**']
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.some((one) => typeof one !== 'string' || !one || one.startsWith('-'))
    )
      refuse('.paths: a list of path globs is required')
    return { ...spec, paths }
  })
}

/**
 * A Markdown file's frontmatter checked, and its body: a frontmatter opened
 * and never closed, or with a line that is not `key: value`, a list item or
 * a continuation, cannot be read.
 * @param {string} text
 * @returns {{ body: string, fields: Record<string, string> }}
 */
function splitFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { body: normalized, fields: {} }
  const end = normalized.indexOf('\n---', 3)
  const after = end === -1 ? -1 : end + 4
  if (end === -1 || (normalized[after] !== undefined && normalized[after] !== '\n'))
    throw new Error('its frontmatter is never closed')
  /** @type {Record<string, string>} */
  const fields = {}
  for (const line of normalized.slice(4, end).split('\n')) {
    if (!line.trim() || /^\s/.test(line) || line.startsWith('- ') || line.startsWith('#'))
      continue
    const pair = /^([\w-]+):(?:\s+(.*))?$/.exec(line)
    if (!pair?.[1])
      throw new Error(`its frontmatter cannot be read: ${line.slice(0, 60)}`)
    fields[pair[1]] = (pair[2] ?? '').trim()
  }
  return { body: normalized.slice(after).replace(/^\n+/, ''), fields }
}

/** Claude Code's folder: its settings and its installed plugins. */
const claudeDir = () =>
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')

/** A JSON file, or undefined when it is missing or is not JSON. */
async function jsonOf(/** @type {string} */ file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Plugin `name` as Claude Code installed it for `project`: its folder and
 * version, whether a settings file turned it off; undefined when it is not
 * installed. Read from installed_plugins.json, Claude Code's own register.
 * @param {string} name
 * @param {string} project
 */
async function installedPlugin(name, project) {
  const register = await jsonOf(
    path.join(claudeDir(), 'plugins', 'installed_plugins.json'),
  )
  const plugins = register?.plugins
  if (!plugins || typeof plugins !== 'object') return undefined
  for (const [key, entries] of Object.entries(plugins)) {
    if (key.split('@')[0] !== name || !Array.isArray(entries)) continue
    // The project's own install first: it is the one Claude Code loads there.
    const entry =
      entries.find(
        (one) =>
          (one?.scope === 'project' || one?.scope === 'local') &&
          path.resolve(String(one.projectPath ?? '')) === path.resolve(project),
      ) ?? entries.find((one) => one?.scope === 'user')
    if (!entry || typeof entry.installPath !== 'string') continue
    let enabled = true
    for (const file of [
      path.join(claudeDir(), 'settings.json'),
      path.join(project, '.claude', 'settings.json'),
      path.join(project, '.claude', 'settings.local.json'),
    ]) {
      const set = (await jsonOf(file))?.enabledPlugins?.[key]
      if (typeof set === 'boolean') enabled = set
    }
    return {
      key,
      root: entry.installPath,
      enabled,
      ...(typeof entry.version === 'string' && { version: entry.version }),
    }
  }
  return undefined
}

/** The plugin's lenses, by name: a built-in lens's prompt file. */
async function builtInLenses() {
  const recipe = checkRecipe(JSON.parse(await readFile(PLUGIN_RECIPE, 'utf8')))
  return new Map(
    recipe.flatMap((lens) =>
      lens.prompt
        ? [[lens.name, path.join(path.dirname(PLUGIN_RECIPE), lens.prompt)]]
        : [],
    ),
  )
}

const REIMPORT = 're-import the process (/tranchant import), or edit the recipe'

/**
 * Finds `label` and reads it: `tranchant:<lens>`, one of the plugin's lenses;
 * `plugin:name`, an installed plugin's skill or agent; else a path, from
 * `folder` (the recipe's) when relative, read at BASE for a project recipe.
 * Throws a LensRefusal saying why it cannot, and what fixes it.
 * @param {string} label
 * @param {{ origin: Origin, folder: string, project: string }} where
 * @returns {Promise<Resolved>}
 */
export async function resolveSource(label, { origin, folder, project }) {
  const tooLarge = () =>
    new LensRefusal(
      `${label} is larger than ${MAX_SOURCE_BYTES / 1024} KiB`,
      'shorten the source, or edit the recipe',
    )
  // A name has a colon and no slash; anything else is a path.
  const isPath = !PLUGIN_NAME.test(label)
  if (!isPath && label.startsWith('tranchant:')) {
    const name = label.slice('tranchant:'.length)
    const file = (await builtInLenses()).get(name)
    if (!file)
      throw new LensRefusal(
        `Tranchant has no lens ${name}`,
        "edit the recipe: name one of Tranchant's lenses (tranchant:bugs…)",
      )
    const found = await lookAt({ kind: 'fs' }, file, MAX_SOURCE_BYTES)
    if (found.kind !== 'file') throw new LensRefusal(`${file} cannot be read`, REIMPORT)
    return { label, text: found.text, file, folder: path.dirname(file), atBase: false }
  }
  if (!isPath) {
    const [plugin = '', ...rest] = label.split(':')
    const installed = await installedPlugin(plugin, project)
    if (!installed)
      throw new LensRefusal(
        `the plugin ${plugin} is not installed`,
        `install the plugin ${plugin} (/plugin), ${REIMPORT}`,
      )
    if (!installed.enabled)
      throw new LensRefusal(
        `the plugin ${installed.key} is turned off`,
        `turn the plugin ${installed.key} on (/plugin), or edit the recipe`,
      )
    const inside = rest.join('/')
    const candidates = [
      ...(rest.length === 1
        ? [path.join(installed.root, 'skills', inside, 'SKILL.md')]
        : []),
      path.join(installed.root, 'agents', `${inside}.md`),
    ]
    for (const file of candidates) {
      const found = await lookAt({ kind: 'fs' }, file, MAX_SOURCE_BYTES)
      if (found.kind === 'large') throw tooLarge()
      if (found.kind === 'file')
        return {
          label,
          text: found.text,
          file,
          folder: path.dirname(file),
          atBase: false,
          ...(installed.version && { version: installed.version }),
        }
    }
    throw new LensRefusal(
      `the plugin ${plugin} has no skill or agent named ${rest.join(':')}`,
      REIMPORT,
    )
  }
  const expanded = expandHome(label)
  let file
  if (origin.kind === 'git') {
    if (path.isAbsolute(expanded))
      throw new LensRefusal(
        `${label}: a project recipe names its sources inside the repository`,
        'edit the recipe: a path relative to it',
      )
    file = path.posix.normalize(path.posix.join(folder, expanded))
    if (file === '..' || file.startsWith('../'))
      throw new LensRefusal(
        `${label} lies outside the repository`,
        'edit the recipe: a path inside the repository',
      )
  } else file = path.resolve(folder, expanded)
  let found = await lookAt(origin, file, MAX_SOURCE_BYTES)
  if (found.kind === 'folder') {
    file =
      origin.kind === 'git'
        ? path.posix.join(file, 'SKILL.md')
        : path.join(file, 'SKILL.md')
    found = await lookAt(origin, file, MAX_SOURCE_BYTES)
  }
  if (found.kind === 'large') throw tooLarge()
  if (found.kind !== 'file')
    throw new LensRefusal(
      `${label}: no such file${origin.kind === 'git' ? ` at ${origin.base}` : ''}`,
      REIMPORT,
    )
  return {
    label,
    text: found.text,
    file,
    folder: origin.kind === 'git' ? path.posix.dirname(file) : path.dirname(file),
    atBase: origin.kind === 'git',
  }
}

/** A fence no line of `text` closes: one backtick more than its longest run. */
function fence(/** @type {string} */ text) {
  const longest = Math.max(
    0,
    ...[...text.matchAll(/`+/g)].map((ticks) => ticks[0].length),
  )
  return '`'.repeat(Math.max(3, longest + 1))
}

/** `body` fenced, with its source's folder for its relative links. */
function fenced(/** @type {Resolved} */ source, /** @type {string} */ body) {
  const where = source.atBase
    ? `Its folder, at BASE: \`${source.folder}\`; read the files it links to with \`git -C PROJECT show BASE:<path>\`.`
    : `Its folder: \`${source.folder}\`; the files it links to are relative to it.`
  const marker = fence(body)
  return [
    `Source: \`${source.label}\`${source.version ? `, version ${source.version}` : ''}. ${where}`,
    '',
    `${marker}markdown`,
    body.trimEnd(),
    marker,
  ].join('\n')
}

/** A source's body, its frontmatter checked and left out. */
function bodyOf(/** @type {Resolved} */ source) {
  try {
    return splitFrontmatter(source.text).body
  } catch (error) {
    throw new LensRefusal(
      `${source.label}: ${message(error)}`,
      "fix the source's frontmatter, or edit the recipe",
    )
  }
}

/**
 * A lens of the recipe, built: the prompt its reviewer runs, its hash, and
 * what review.json records of it. A whole prompt (`prompt`, a lens of
 * Tranchant's) is its body; a source is the shared contract, then the
 * source fenced as the lens's domain; an add-on is the built-in lens, then
 * the source fenced as its addition; the skills it lists follow, fenced.
 * @param {LensSpec} lens
 * @param {{ origin: Origin, folder: string, project: string }} where
 */
export async function buildLens(lens, where) {
  /** @type {string[]} */
  const parts = []
  /** @type {Resolved} */
  let main
  if (lens.prompt !== undefined) {
    main = await resolveSource(lens.prompt, where)
    parts.push(bodyOf(main).trimEnd())
  } else if (lens.use !== undefined && lens.add !== undefined) {
    const basis = await resolveSource(lens.use, where).catch((error) => {
      if (error instanceof LensRefusal)
        throw new LensRefusal(
          `the add-on's lens ${lens.use} does not exist`,
          "edit the recipe: use names one of Tranchant's lenses (tranchant:bugs…)",
        )
      throw error
    })
    main = await resolveSource(lens.add, where)
    parts.push(
      bodyOf(basis).trimEnd(),
      [
        "## This lens's addition",
        '',
        'The checklist below adds to what this lens looks at. The rules above take precedence over its own process and output: you report through add.mjs only.',
        '',
        fenced(main, bodyOf(main)),
      ].join('\n'),
    )
  } else {
    main = await resolveSource(String(lens.source), where)
    const body = bodyOf(main)
    const contract = splitFrontmatter(await readFile(CONTRACT, 'utf8')).body
    parts.push(
      contract.trimEnd(),
      [
        "## The lens's domain",
        '',
        'What follows is the source of this lens, whole: it says what to look at and what counts. Where it describes a process or an output of its own (a report, a table, comments to post, other skills or agents to start, questions to ask), the contract above takes precedence: you report through add.mjs only.',
        '',
        fenced(main, body),
      ].join('\n'),
    )
  }
  for (const skill of lens.skills ?? []) {
    let found
    try {
      found = await resolveSource(skill, where)
    } catch (error) {
      if (!(error instanceof LensRefusal)) throw error
      throw new LensRefusal(`its skill ${skill}: ${error.message}`, error.fix)
    }
    parts.push(
      [
        `## Reference: ${skill}`,
        '',
        "A skill this lens's domain relies on: read it as part of that domain, under the same rules.",
        '',
        fenced(found, bodyOf(found)),
      ].join('\n'),
    )
  }
  const text = `${parts.join('\n\n')}\n`
  const hash = createHash('sha256').update(text).digest('hex')
  const source = lens.use !== undefined ? `${lens.use}+${lens.add}` : main.label
  return {
    text,
    hash,
    record: {
      name: lens.name,
      source,
      ...(main.version && { version: main.version }),
      hash,
    },
  }
}

/**
 * Stores a built prompt under its hash, once: written to a temp file, then
 * linked into place, so two reviews at once never write it twice nor half.
 * @param {string} text
 * @param {string} hash
 * @returns {Promise<{ file: string, written: boolean }>}
 */
export async function storeLens(text, hash, dir = LENSES_DIR) {
  const file = path.join(dir, `${hash}.md`)
  if (existsSync(file)) return { file, written: false }
  await mkdir(dir, { recursive: true })
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, text)
    // A link, not a rename: it fails when another review stored it meanwhile.
    await link(temp, file).catch(async (error) => {
      if (errorCode(error) === 'EEXIST') throw error
      // No hard links on this file system: the same bytes renamed over are as good.
      await rename(temp, file)
    })
    return { file, written: true }
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return { file, written: false }
    throw error
  } finally {
    await rm(temp, { force: true }).catch(() => undefined)
  }
}

/** The folder a recipe's relative paths start from. @param {RecipeRef} ref */
export const folderOf = (ref) =>
  ref.from === 'project' ? path.posix.dirname(ref.file) : path.dirname(ref.file)

/**
 * The recipe in force for `project` at `base`, as the Settings page shows
 * it: where it comes from, its lenses, each lens's source and whether it
 * builds now, with the reason when it does not.
 * @param {{ project: string, base: string, settings: string | null }} given
 */
export async function describeRecipe(given) {
  const ref = await findRecipe(given)
  const file = ref.from === 'project' ? `${ref.base}:${ref.file}` : ref.file
  let lenses
  try {
    lenses = (await readRecipe(ref)).lenses
  } catch (error) {
    if (!(error instanceof RecipeRefusal)) throw error
    return { from: ref.from, file, lenses: [], problem: `${file}: ${error.message}` }
  }
  const where = { origin: originOf(ref), folder: folderOf(ref), project: given.project }
  return {
    from: ref.from,
    file,
    lenses: await Promise.all(
      lenses.map(async (lens) => {
        const source = lens.prompt ?? lens.source ?? `${lens.use}+${lens.add}`
        try {
          await buildLens(lens, where)
          return { name: lens.name, source }
        } catch (error) {
          return {
            name: lens.name,
            source,
            problem: message(error),
            ...(error instanceof LensRefusal && { fix: error.fix }),
          }
        }
      }),
    ),
  }
}
