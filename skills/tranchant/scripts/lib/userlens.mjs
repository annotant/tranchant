// The lenses a user adds (Settings › Lenses, /tranchant import), one folder
// each: <scope folder>/<name>/lens.json (its settings and its last cleaning)
// and lens.md (its domain, as the cleaning agent wrote it). Global lenses lie
// in <settings folder>/lenses/, a project's in
// <settings folder>/projects/<project hash>/lenses/: never in a repository.
// A lens of the project wins over a global one of the same name, which wins
// over the recipe's; the first of them that is on runs. Described in
// docs/settings.md.
import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { LENS_NAME, TOPICS } from './format.mjs'
import { hashOf } from './project.mjs'
import {
  LensRefusal,
  RecipeRefusal,
  autoModel,
  buildLens,
  checkRecipe,
  findRecipe,
  folderOf,
  isPluginName,
  originOf,
  readRecipe,
  resolveSource,
} from './lens.mjs'
import { SETTINGS_DIR, expandHome } from './settings.mjs'
import { kindOfPath } from './inside.mjs'

/** @typedef {import('./lens.mjs').LensSpec} LensSpec */
/** @typedef {'global' | 'local'} Scope */
/**
 * What a cleaning removed from a source and added for Tranchant, and the
 * hash of the source it read.
 * @typedef {object} Cleaned
 * @property {string} at
 * @property {string} sourceHash
 * @property {string} [version]
 * @property {{ what: string, why: string }[]} removed
 * @property {string[]} added
 */
/**
 * A lens the user added, as lens.json holds it.
 * @typedef {object} UserLens
 * @property {string} name
 * @property {string} source A plugin's skill or agent (`plugin:name`), or a path.
 * @property {string} [reviewer] A reviewer written inline in the source, by name: the lens is that one alone.
 * @property {boolean} on
 * @property {string[]} paths Empty for an `otherwise` lens.
 * @property {true} [otherwise]
 * @property {string[]} [topics]
 * @property {string} [model]
 * @property {string} rules The added instructions: the cleaning agent's, then the user's.
 * @property {true} [rulesEdited] Kept as they are when the lens is cleaned again.
 * @property {Cleaned} cleaned
 * @property {{ at: string, reason: string, sourceHash: string }} [failedCleaning]
 */

const LENS_VERSION = 1
const MODEL = /^[\w.:-]{1,80}$/
const MAX_RULES = 8 * 1024
const MAX_LIST = 20
const MAX_TEXT = 500
const MAX_PATHS = 40
const MAX_SOURCE = 1024
const MAX_REVIEWER = 100

/** A lens file, or a change to it, this Tranchant refuses, and why. */
export class LensFileRefusal extends Error {}

/** @param {string} what @returns {never} */
const refuse = (what) => {
  throw new LensFileRefusal(what)
}

/** @param {unknown} value @returns {value is Scope} */
export const isScope = (value) => value === 'global' || value === 'local'

/** The folder of the lenses of `scope`: every project's, or the project at `project`'s. */
export const scopeDir = (/** @type {Scope} */ scope, /** @type {string} */ project) =>
  scope === 'global'
    ? path.join(SETTINGS_DIR, 'lenses')
    : path.join(SETTINGS_DIR, 'projects', hashOf(project), 'lenses')

/** A lens's folder, from its name: a name, never a path. */
export function lensDir(
  /** @type {Scope} */ scope,
  /** @type {string} */ project,
  /** @type {string} */ name,
) {
  if (!LENS_NAME.test(name))
    throw new LensFileRefusal(`${name}: a lens name is letters, digits, - and _ only`)
  return path.join(scopeDir(scope, project), name)
}

/** The SHA-256 of `text`, as a lens records its source's. */
const hashText = (/** @type {string} */ text) =>
  createHash('sha256').update(text).digest('hex')

/** `value` as JSON, whole: a temp file renamed over `file`. */
export async function writeJson(
  /** @type {string} */ file,
  /** @type {unknown} */ value,
) {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** `text`, whole: a temp file renamed over `file`. */
export async function writeText(/** @type {string} */ file, /** @type {string} */ text) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, text)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** @param {unknown} value @returns {value is string} */
const isText = (value) => typeof value === 'string' && value.trim() !== ''

/**
 * A source as a lens names it: one line, no control character, since it
 * becomes a line of the cleaning agent's prompt.
 * @param {unknown} value
 * @returns {value is string}
 */
export const isSourceText = (value) =>
  isText(value) &&
  value.length <= MAX_SOURCE &&
  !Array.from({ length: value.length }, (_, i) => value.charCodeAt(i)).some(
    (code) => code < 0x20 || code === 0x7f,
  )

/**
 * What a cleaning says it removed and added, checked: `{ what, why }` and
 * short texts, 20 at most each.
 * @param {unknown} removed
 * @param {unknown} added
 * @param {(what: string) => never} fail
 */
export function checkChanges(removed, added, fail) {
  const list = (/** @type {unknown} */ value, /** @type {string} */ key) => {
    if (value === undefined) return []
    if (!Array.isArray(value) || value.length > MAX_LIST)
      fail(`${key}: up to ${MAX_LIST} entries`)
    return /** @type {unknown[]} */ (value)
  }
  return {
    removed: list(removed, 'removed').map((one, i) => {
      const field = (/** @type {string} */ key) => {
        const value = one && typeof one === 'object' ? Reflect.get(one, key) : undefined
        return typeof value === 'string' ? value.trim() : ''
      }
      const what = field('what')
      const why = field('why')
      if (!what || !why || what.length > MAX_TEXT || why.length > MAX_TEXT)
        fail(`removed[${i}]: { what, why }, two short texts`)
      return { what, why }
    }),
    added: list(added, 'added').map((one, i) => {
      if (typeof one !== 'string' || !one.trim() || one.length > MAX_TEXT)
        fail(`added[${i}]: a short text`)
      return one.trim()
    }),
  }
}

/**
 * A lens's runtime keys checked as a recipe's lens would be: its name, where
 * it runs, its topics and its model.
 * @param {{ name: unknown, paths?: unknown, otherwise?: unknown, topics?: unknown, model?: unknown }} given
 * @param {(what: string) => never} fail
 */
export function checkRuntime(given, fail) {
  try {
    const [spec] = checkRecipe({
      version: 1,
      lenses: [
        {
          name: given.name,
          source: '-',
          ...(given.otherwise === true
            ? { otherwise: true }
            : { paths: given.paths ?? ['**'] }),
          ...(given.topics !== undefined && { topics: given.topics }),
          ...(given.model !== undefined && { model: given.model }),
        },
      ],
    })
    if (!spec) return fail('a lens is required')
    if (spec.paths.length > MAX_PATHS) fail(`paths: ${MAX_PATHS} globs at most`)
    return spec
  } catch (error) {
    if (!(error instanceof RecipeRefusal)) throw error
    return fail(error.message.replace(/^lenses\[0\]\.?:? ?/, ''))
  }
}

/**
 * lens.json, checked: what it names, never what its source says.
 * @param {any} raw
 * @returns {UserLens}
 */
export function checkUserLens(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) refuse('not an object')
  if (raw.version !== LENS_VERSION)
    refuse(`version: ${LENS_VERSION} is the only one read`)
  if (typeof raw.name !== 'string' || !LENS_NAME.test(raw.name))
    refuse('name: letters, digits, - and _ only')
  if (!isSourceText(raw.source)) refuse('source: a skill or agent by name, or a path')
  if (
    raw.reviewer !== undefined &&
    !(isSourceText(raw.reviewer) && raw.reviewer.length <= MAX_REVIEWER)
  )
    refuse(`reviewer: a name on one line, ${MAX_REVIEWER} characters at most`)
  if (typeof raw.on !== 'boolean') refuse('on: true or false')
  if (typeof raw.rules !== 'string' || raw.rules.length > MAX_RULES)
    refuse(`rules: a text of ${MAX_RULES / 1024} KiB at most`)
  const spec = checkRuntime(raw, refuse)
  const cleaned = raw.cleaned
  if (
    !cleaned ||
    typeof cleaned !== 'object' ||
    !isText(cleaned.at) ||
    !isText(cleaned.sourceHash)
  )
    refuse('cleaned: { at, sourceHash, removed, added }')
  const changes = checkChanges(cleaned.removed, cleaned.added, (what) =>
    refuse(`cleaned.${what}`),
  )
  const failed = raw.failedCleaning
  if (
    failed !== undefined &&
    (!failed ||
      !isText(failed.at) ||
      !isText(failed.reason) ||
      !isText(failed.sourceHash))
  )
    refuse('failedCleaning: { at, reason, sourceHash }')
  return {
    name: raw.name,
    source: raw.source,
    ...(raw.reviewer !== undefined && { reviewer: raw.reviewer }),
    on: raw.on,
    paths: spec.paths,
    ...(spec.otherwise && { otherwise: true }),
    ...(spec.topics && { topics: spec.topics }),
    ...(spec.model && { model: spec.model }),
    rules: raw.rules,
    ...(raw.rulesEdited === true && { rulesEdited: true }),
    cleaned: {
      at: cleaned.at,
      sourceHash: cleaned.sourceHash,
      ...(isText(cleaned.version) && { version: cleaned.version }),
      ...changes,
    },
    ...(failed && {
      failedCleaning: {
        at: failed.at,
        reason: String(failed.reason).slice(0, 1000),
        sourceHash: failed.sourceHash,
      },
    }),
  }
}

/** lens.json as written: its version first. @param {UserLens} lens */
const fileOf = (lens) => ({ version: LENS_VERSION, ...lens })

/** The lens in `dir`, checked. @returns {Promise<UserLens>} */
export async function readUserLens(/** @type {string} */ dir) {
  let raw
  try {
    raw = JSON.parse(await readFile(path.join(dir, 'lens.json'), 'utf8'))
  } catch (error) {
    const code = errorCode(error)
    throw new LensFileRefusal(
      code === 'ENOENT'
        ? 'no lens.json'
        : error instanceof SyntaxError
          ? 'lens.json is not JSON'
          : `lens.json cannot be read (${typeof code === 'string' ? code : 'error'})`,
    )
  }
  return checkUserLens(raw)
}

/** Writes `lens` to `dir`, checked, with its domain when given: the domain first. */
export async function writeUserLens(
  /** @type {string} */ dir,
  /** @type {UserLens} */ lens,
  /** @type {string} */ domain = '',
) {
  const checked = checkUserLens(fileOf(lens))
  if (domain) await writeText(path.join(dir, 'lens.md'), domain)
  await writeJson(path.join(dir, 'lens.json'), fileOf(checked))
}

/**
 * One lens of a scope, read: the lens, or why it cannot be.
 * @typedef {{ scope: Scope, dir: string, name: string } & ({ lens: UserLens } | { problem: string })} Listed
 */

/**
 * The lenses of `scope` for the project at `project`, by name.
 * @param {Scope} scope
 * @param {string} project
 * @returns {Promise<Listed[]>}
 */
async function listUserLenses(scope, project) {
  const root = scopeDir(scope, project)
  const names = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && LENS_NAME.test(entry.name))
    .map((entry) => entry.name)
    .toSorted((a, b) => a.localeCompare(b))
  return Promise.all(
    names.map(async (name) => {
      const dir = path.join(root, name)
      try {
        const lens = await readUserLens(dir)
        if (lens.name !== name)
          return { scope, dir, name, problem: `lens.json names ${lens.name}` }
        return { scope, dir, name, lens }
      } catch (error) {
        if (!(error instanceof LensFileRefusal)) throw error
        return { scope, dir, name, problem: `${dir}: ${error.message}` }
      }
    }),
  )
}

/**
 * Where an added lens's sources are found: its relative paths from the
 * project's root, never at BASE.
 * @param {string} project
 */
export const whereOf = (project) => ({
  origin: /** @type {const} */ ({ kind: 'fs' }),
  folder: project,
  project,
})

/**
 * A source as a lens of `scope` records it: a global lens's path absolute,
 * since it runs from every project; a name as given.
 * @param {string} label
 * @param {Scope} scope
 * @param {string} project
 */
export function recordedSource(label, scope, project) {
  const trimmed = label.trim()
  if (/^[\w-][\w.-]*(?::[\w-][\w.-]*)+$/.test(trimmed)) return trimmed
  const expanded = expandHome(trimmed)
  return scope === 'global' && !path.isAbsolute(expanded)
    ? path.resolve(project, expanded)
    : trimmed
}

/**
 * A source's text as its hash reads it: its line ends LF, its frontmatter's
 * `model:` line left out, since each review reads that line anew
 * (Auto-detect). The frontmatter ends where splitFrontmatter ends it.
 * @param {string} text
 */
function hashedText(text) {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return text
  const end = normalized.indexOf('\n---', 3)
  // No frontmatter line, or never closed: nothing to leave out.
  if (end < 4) return text
  const kept = normalized
    .slice(4, end)
    .split('\n')
    .filter((line) => !line.startsWith('model:'))
  return ['---', ...kept].join('\n') + normalized.slice(end)
}

/**
 * The hash of a lens's source as it stands, and the source found; throws a
 * LensRefusal when it cannot be found. `wholeHash`, its whole text's: a
 * lens cleaned before the model line was left out recorded that one.
 * @param {{ source: string }} lens
 * @param {string} project
 */
export async function hashesOf(lens, project) {
  const source = await resolveSource(lens.source, whereOf(project))
  return {
    source,
    sourceHash: hashText(hashedText(source.text)),
    wholeHash: hashText(source.text),
  }
}

/**
 * Whether `lens` must be cleaned again: its source changed since its last
 * cleaning, and no cleaning failed on it as it stands (the page's Clean it
 * again tries anew). Its `model:` line alone changing is no change, once it
 * was cleaned by a Tranchant that leaves that line out of the hash.
 * @param {UserLens} lens
 * @param {{ sourceHash: string, wholeHash?: string }} now
 */
export function staleness(lens, now) {
  const is = (/** @type {string | undefined} */ hash) =>
    hash !== undefined && (hash === now.sourceHash || hash === now.wholeHash)
  if (is(lens.cleaned.sourceHash)) return 'clean'
  return is(lens.failedCleaning?.sourceHash) ? 'failed' : 'stale'
}

/**
 * A change to a stored lens from the page: its name and scope (the folder
 * moves), on or off, where it runs, its topics, model and added
 * instructions. A key left out stays as it is; `model` `null` unsets it.
 * @param {string} project
 * @param {Scope} scope
 * @param {string} name
 * @param {any} change
 */
export async function updateUserLens(project, scope, name, change) {
  if (!change || typeof change !== 'object' || Array.isArray(change))
    refuse('the change is not an object')
  const dir = lensDir(scope, project, name)
  const lens = await readUserLens(dir)
  const to = change.scope ?? scope
  if (!isScope(to)) refuse('scope: global or local')
  if (change.name !== undefined && typeof change.name !== 'string')
    refuse('name: letters, digits, - and _ only')
  const renamed = change.name ?? name
  const target = lensDir(to, project, renamed)
  if (target !== dir && existsSync(target))
    refuse(
      `a lens named ${renamed} is ${to === 'global' ? 'global' : "this project's"} already`,
    )
  /** @type {any} */
  // A global lens runs from every project: its paths are recorded absolute.
  const next = {
    ...lens,
    name: renamed,
    source: recordedSource(lens.source, to, project),
  }
  if (change.on !== undefined) next.on = change.on
  if (change.otherwise === true) {
    next.otherwise = true
    next.paths = []
  } else if (change.otherwise === false || change.paths !== undefined) {
    delete next.otherwise
    next.paths = change.paths ?? (lens.otherwise ? ['**'] : lens.paths)
  }
  for (const key of /** @type {const} */ (['topics', 'model'])) {
    if (change[key] === null || (Array.isArray(change[key]) && !change[key].length))
      delete next[key]
    else if (change[key] !== undefined) next[key] = change[key]
  }
  if (change.rules !== undefined && change.rules !== lens.rules) {
    next.rules = change.rules
    next.rulesEdited = true
  }
  if (next.topics !== undefined && !Array.isArray(next.topics))
    refuse(`topics: a list of ${TOPICS.join(', ')}`)
  if (
    next.model !== undefined &&
    (typeof next.model !== 'string' || !MODEL.test(next.model))
  )
    refuse('model: a model id, letters, digits, . : - and _')
  const checked = checkUserLens(fileOf(next))
  if (target === dir) {
    await writeUserLens(dir, checked)
    return { scope: to, name: renamed }
  }
  // Moved whole, then rewritten: a failure halfway leaves one lens, never two.
  await mkdir(path.dirname(target), { recursive: true })
  await rename(dir, target)
  await writeUserLens(target, checked)
  return { scope: to, name: renamed }
}

/** Removes a stored lens, its folder whole. */
export async function removeUserLens(
  /** @type {string} */ project,
  /** @type {Scope} */ scope,
  /** @type {string} */ name,
) {
  const dir = lensDir(scope, project, name)
  if (!existsSync(dir)) throw new LensFileRefusal(`no lens ${name} here`)
  await rm(dir, { recursive: true, force: true })
}

/**
 * One candidate for a name in the lens set: a lens of the project, a global
 * one, or one of the recipe's.
 * @typedef {object} Candidate
 * @property {'local' | 'global' | 'recipe'} scope
 * @property {string} name
 * @property {boolean} on
 * @property {boolean} runs Whether it is the one that runs under its name.
 * @property {boolean} [replaces] It runs in place of a lens of the same name below it.
 * @property {LensSpec} [spec] What a review builds; absent when it cannot be read.
 * @property {Listed} [listed] An added lens, as read.
 * @property {string} [problem]
 */

/**
 * The lenses in force: the project's, then the global ones, then the
 * recipe's; under each name, the first that is on runs. A lens whose
 * lens.json cannot be read runs not, and says why. With `members`, a
 * group's lenses: a lens is on when it is one of them, whatever its switch
 * (its spec then says `offInSettings` when that is off).
 * @param {{ project: string, recipe: LensSpec[], disabled: Set<string>, models: Record<string, string>, members?: { scope: string, name: string }[] }} given
 * @returns {Promise<Candidate[]>}
 */
export async function lensSet({ project, recipe, disabled, models, members }) {
  const added = [
    ...(await listUserLenses('local', project)),
    ...(await listUserLenses('global', project)),
  ]
  /** @type {Candidate[]} */
  const all = [
    ...added.map((listed) => {
      if (!('lens' in listed))
        return {
          scope: listed.scope,
          name: listed.name,
          on: false,
          runs: false,
          listed,
          problem: listed.problem,
        }
      const { lens } = listed
      /** @type {LensSpec} */
      const spec = {
        name: lens.name,
        paths: lens.paths,
        ...(lens.otherwise && { otherwise: true }),
        source: lens.source,
        ...(lens.model && { model: lens.model }),
        ...(lens.topics && { topics: lens.topics }),
        added: { scope: listed.scope, dir: listed.dir },
      }
      return {
        scope: listed.scope,
        name: lens.name,
        on: lens.on,
        runs: false,
        spec,
        listed,
      }
    }),
    ...recipe.map((lens) => ({
      scope: /** @type {const} */ ('recipe'),
      name: lens.name,
      on: !disabled.has(lens.name),
      runs: false,
      spec: { ...lens, ...(models[lens.name] && { model: models[lens.name] }) },
    })),
  ]
  if (members) {
    const inGroup = new Set(members.map((one) => `${one.scope}:${one.name}`))
    for (const one of all) {
      const on = inGroup.has(`${one.scope}:${one.name}`)
      if (on && !one.on && one.spec) one.spec = { ...one.spec, offInSettings: true }
      one.on = on
    }
  }
  const taken = new Set()
  for (const one of all) {
    if (!one.on || !one.spec || taken.has(one.name)) continue
    one.runs = true
    taken.add(one.name)
    const at = all.indexOf(one)
    one.replaces = all.some((other, i) => i > at && other.name === one.name)
  }
  return all
}

/** @param {unknown} error */
const reasonOf = (error) => (error instanceof Error ? error.message : String(error))

/**
 * Every lens that could run on `project`, as Settings › Lenses shows it: the
 * project's, the global ones and the recipe's, each with where it comes
 * from, whether it is on and whether it runs, its settings, and why it
 * cannot be built now when it cannot; an added lens with its last cleaning
 * and whether its source changed since.
 * @param {{ project: string, base: string, values: import('./settings.mjs').Values }} given
 */
export async function describeLenses({ project, base, values }) {
  const ref = await findRecipe({ project, base, settings: values.recipe })
  const file = ref.from === 'project' ? `${ref.base}:${ref.file}` : ref.file
  /** @type {LensSpec[]} */
  let recipe = []
  let problem
  try {
    recipe = (await readRecipe(ref)).lenses
  } catch (error) {
    if (!(error instanceof RecipeRefusal)) throw error
    problem = `${file}: ${error.message}`
  }
  const set = await lensSet({
    project,
    recipe,
    disabled: new Set(values.disabledLenses),
    models: values.lensModels,
  })
  const recipeWhere = { origin: originOf(ref), folder: folderOf(ref), project }
  const lenses = await Promise.all(
    set.map(async (one) => {
      const spec = one.spec
      const lens = one.listed && 'lens' in one.listed ? one.listed.lens : undefined
      const row = {
        name: one.name,
        scope: one.scope,
        on: one.on,
        runs: one.runs,
        ...(one.replaces && { replaces: true }),
        source: spec ? sourceLabel(spec) : '',
        paths: spec?.paths ?? [],
        ...(spec?.otherwise && { otherwise: true }),
        ...(spec?.topics && { topics: spec.topics }),
        ...(spec?.model && { model: spec.model }),
        ...(lens && {
          ...(lens.reviewer && { reviewer: lens.reviewer }),
          rules: lens.rules,
          ...(lens.rulesEdited && { rulesEdited: true }),
          cleaned: lens.cleaned,
          ...(lens.failedCleaning && { failedCleaning: lens.failedCleaning }),
        }),
      }
      if (!spec) return { ...row, problem: one.problem ?? 'it cannot be read' }
      try {
        const built = await buildLens(spec, spec.added ? whereOf(project) : recipeWhere)
        const standing = lens ? staleness(lens, await hashesOf(lens, project)) : undefined
        const shown = shownFrontmatter(built.frontmatter.fields)
        return {
          ...row,
          ...(spec.added && originOfSource(row.source, built.file)),
          ...(built.record.version && { version: built.record.version }),
          // What Auto-detect finds, whatever the lens's model: the page says it before it is chosen.
          detected: { file: path.basename(built.file), ...autoModel(built.frontmatter) },
          ...(shown && { frontmatter: shown }),
          ...(standing && standing !== 'clean' && { stale: standing }),
        }
      } catch (error) {
        return {
          ...row,
          ...(spec.added && originOfSource(row.source)),
          problem: reasonOf(error),
          ...(error instanceof LensRefusal && { fix: error.fix }),
        }
      }
    }),
  )
  return {
    base: { from: ref.from, file, ...(problem && { problem }) },
    dirs: { global: scopeDir('global', project), local: scopeDir('local', project) },
    lenses,
  }
}

/**
 * Where an added lens comes from: `picked` up from an agent, a skill or a
 * command (`sourceKind`, what its path says it is), or `custom`, a file of
 * none (a checklist). A plugin's source is always picked up.
 * @param {string} label
 * @param {string} [file] Its file, once found; absent, its label is read as a path.
 * @returns {{ origin: 'picked' | 'custom', sourceKind?: import('./inside.mjs').Kind }}
 */
function originOfSource(label, file) {
  const plugin = isPluginName(label)
  const named = file ?? expandHome(label)
  let kind = kindOfPath(named)
  // A skill added by its folder, its source gone: the folder is all there is to read.
  if (!kind && !plugin && !file && path.basename(path.dirname(named)) === 'skills')
    kind = 'skill'
  // A plugin's agent in a folder of its agents (plugin:folder:agent).
  if (!kind && plugin && file && named.split(path.sep).includes('agents')) kind = 'agent'
  if (kind) return { origin: 'picked', sourceKind: kind }
  return { origin: plugin ? 'picked' : 'custom' }
}

/**
 * What Settings › Lenses shows of a source's frontmatter beside its source,
 * its name, tools and model (Auto-detect reads the model alone), each cut
 * short; undefined when it names none of them.
 * @param {Record<string, string>} fields
 */
function shownFrontmatter(fields) {
  const shown = Object.fromEntries(
    ['name', 'tools', 'model'].flatMap((key) =>
      fields[key] ? [[key, fields[key].slice(0, 120)]] : [],
    ),
  )
  return Object.keys(shown).length ? shown : undefined
}

/** How a lens names its source. @param {LensSpec} lens */
const sourceLabel = (lens) =>
  lens.prompt ?? lens.source ?? `${lens.use ?? ''}+${lens.add ?? ''}`

/**
 * The prompt a lens's reviewer reads, built as a review builds it: the
 * Settings' What the reviewer reads.
 * @param {{ project: string, base: string, values: import('./settings.mjs').Values, scope: string, name: string }} given
 */
export async function lensPrompt({ project, base, values, scope, name }) {
  const ref = await findRecipe({ project, base, settings: values.recipe })
  // A recipe that cannot be read hides only its own lenses: its refusal says why.
  const recipe = await readRecipe(ref).then(
    (read) => read.lenses,
    (error) => {
      if (scope === 'recipe' && error instanceof RecipeRefusal) throw error
      return []
    },
  )
  const set = await lensSet({
    project,
    recipe,
    disabled: new Set(values.disabledLenses),
    models: values.lensModels,
  })
  const one = set.find(
    (candidate) => candidate.scope === scope && candidate.name === name,
  )
  if (!one?.spec) throw new LensFileRefusal(`no lens ${name} here`)
  const where = one.spec.added
    ? whereOf(project)
    : { origin: originOf(ref), folder: folderOf(ref), project }
  return (await buildLens(one.spec, where)).text
}
