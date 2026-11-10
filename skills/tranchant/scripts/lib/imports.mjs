// The imports of a review process (`/tranchant import`): each in
// <state>/<project hash>/imports/<id>/, its import.json (the source, the
// location the user chose, where it stands) and recipe.json, the recipe the
// import agent writes, of references only. The page shows a recipe before
// it is used; Use this recipe copies it to its location: the project's
// .tranchant/recipe.json, or the local recipe outside the repository.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  LensRefusal,
  PROJECT_RECIPE,
  RecipeRefusal,
  buildLens,
  checkRecipe,
  expandRecipe,
  isPluginName,
  localRecipe,
  resolveSource,
} from './lens.mjs'
import { expandHome } from './settings.mjs'
import { STATE_ROOT, hashOf } from './project.mjs'

const MAX_LEFT_OUT = 20
const MAX_TEXT = 500

/** @param {string} value @returns {value is 'project' | 'local'} */
const isLocation = (value) => value === 'project' || value === 'local'

/** An import this Tranchant refuses, and why. */
export class ImportRefusal extends Error {}

/**
 * @typedef {object} Import
 * @property {string} id
 * @property {string} createdAt
 * @property {string} project
 * @property {string} source The source as the user named it.
 * @property {string} file The source's file, found.
 * @property {string} folder Its folder: where the agent looks for what it starts.
 * @property {string} [version]
 * @property {'project' | 'local'} to
 * @property {string} target The recipe file Use this recipe writes.
 * @property {'importing' | 'ready' | 'failed' | 'used'} state
 * @property {string} [reason] With `failed`.
 * @property {string} [usedAt]
 */

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error)

/** The imports of the project at `root`. */
export const importsDir = (/** @type {string} */ root) =>
  path.join(STATE_ROOT, hashOf(root), 'imports')

/** Where an import's recipe goes, for `to`. @param {string} project @param {'project' | 'local'} to */
const targetOf = (project, to) =>
  to === 'project' ? path.join(project, PROJECT_RECIPE) : localRecipe(project)

/** `value` as JSON, whole: a temp file renamed over `file`. */
async function writeJson(/** @type {string} */ file, /** @type {unknown} */ value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** An import's folder, from its id: a name, never a path. */
function importDir(/** @type {string} */ project, /** @type {string} */ id) {
  if (!/^[\w-]{1,64}$/.test(id)) throw new ImportRefusal(`no import ${id}`)
  return path.join(importsDir(project), id)
}

/** @returns {Promise<Import>} */
async function readImport(/** @type {string} */ dir) {
  return JSON.parse(await readFile(path.join(dir, 'import.json'), 'utf8'))
}

/**
 * A new import of `source` for the project at `project`, to `to`: the
 * source found first, so a name that does not resolve starts no agent.
 * @param {{ project: string, source: string, to: string }} given
 * @returns {Promise<Import & { dir: string, recipe: string }>}
 */
export async function createImport({ project, source, to }) {
  if (!isLocation(to))
    throw new ImportRefusal(`the location is project or local, not ${to}`)
  const where = {
    origin: /** @type {const} */ ({ kind: 'fs' }),
    folder: project,
    project,
  }
  let found
  try {
    found = await resolveSource(source, where)
  } catch (error) {
    if (error instanceof LensRefusal) throw new ImportRefusal(error.message)
    throw error
  }
  const id = randomUUID()
  const dir = importDir(project, id)
  /** @type {Import} */
  const record = {
    id,
    createdAt: new Date().toISOString(),
    project,
    source,
    file: found.file,
    folder: found.folder,
    ...(found.version && { version: found.version }),
    to,
    target: targetOf(project, to),
    state: 'importing',
  }
  await writeJson(path.join(dir, 'import.json'), record)
  return { ...record, dir, recipe: path.join(dir, 'recipe.json') }
}

/**
 * What cannot become a lens, as the agent listed it: `{ what, why }` each.
 * @param {unknown} imported
 */
function leftOutOf(imported) {
  const list =
    imported && typeof imported === 'object' && 'leftOut' in imported
      ? imported.leftOut
      : undefined
  if (list === undefined) return []
  if (!Array.isArray(list) || list.length > MAX_LEFT_OUT)
    throw new RecipeRefusal(`imported.leftOut: up to ${MAX_LEFT_OUT} { what, why }`)
  return list.map((one, i) => {
    const what = typeof one?.what === 'string' ? one.what.trim() : ''
    const why = typeof one?.why === 'string' ? one.why.trim() : ''
    if (!what || !why || what.length > MAX_TEXT || why.length > MAX_TEXT)
      throw new RecipeRefusal(`imported.leftOut[${i}]: { what, why }, two short texts`)
    return { what, why }
  })
}

/**
 * Why a project recipe's path `label`, from `folder`, would be refused at
 * BASE: absolute, or outside the repository at `project`.
 * @param {string} label
 * @param {string} folder
 * @param {string} project
 */
function outsideRefusal(label, folder, project) {
  if (isPluginName(label)) return undefined
  if (path.isAbsolute(expandHome(label)))
    return `${label}: a project recipe names its sources inside the repository`
  if (path.relative(project, path.resolve(folder, label)).startsWith('..'))
    return `${label} lies outside the repository`
  return undefined
}

/**
 * The import agent ended: its recipe checked as a review reads one (its
 * lenses with Tranchant's when it extends them, a project recipe's paths
 * inside the repository), with no whole `prompt`, each lens built from where
 * the recipe goes. `ready`, or `failed` with why; one in use already stays so.
 * @param {string} dir
 * @returns {Promise<Import>}
 */
export async function checkImport(dir) {
  const record = await readImport(dir)
  if (record.state === 'used') return record
  /** @type {Import} */
  let next
  try {
    let raw
    try {
      raw = JSON.parse(await readFile(path.join(dir, 'recipe.json'), 'utf8'))
    } catch (error) {
      throw new RecipeRefusal(`the agent wrote no recipe that reads: ${message(error)}`)
    }
    // A whole prompt runs without the contract: an import references sources only.
    for (const [i, lens] of (Array.isArray(raw?.lenses) ? raw.lenses : []).entries())
      if (lens?.prompt !== undefined)
        throw new RecipeRefusal(
          `lenses[${i}].prompt: an import names a source, not a prompt`,
        )
    const lenses = await expandRecipe(raw)
    leftOutOf(raw.imported)
    const folder = path.dirname(record.target)
    const where = {
      origin: /** @type {const} */ ({ kind: 'fs' }),
      folder,
      project: record.project,
    }
    for (const lens of lenses) {
      if (record.to === 'project')
        for (const label of [lens.source, lens.add, ...(lens.skills ?? [])]) {
          const outside = label && outsideRefusal(label, folder, record.project)
          if (outside) throw new RecipeRefusal(`lens ${lens.name}: ${outside}`)
        }
      try {
        await buildLens(lens, where)
      } catch (error) {
        throw new RecipeRefusal(`lens ${lens.name}: ${message(error)}`)
      }
    }
    const { reason: _reason, ...rest } = record
    next = { ...rest, state: 'ready' }
  } catch (error) {
    if (!(error instanceof RecipeRefusal)) throw error
    next = { ...record, state: 'failed', reason: error.message }
  }
  await writeJson(path.join(dir, 'import.json'), next)
  return next
}

/**
 * The imports of the project at `project` not used yet, newest first, each
 * with its recipe's lenses and what it left out, as the page shows them.
 * @param {string} project
 */
export async function listImports(project) {
  const root = importsDir(project)
  const all = []
  for (const id of await readdir(root).catch(() => [])) {
    const dir = path.join(root, id)
    const record = await readImport(dir).catch(() => undefined)
    if (!record || record.state === 'used') continue
    const raw = await readFile(path.join(dir, 'recipe.json'), 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    let lenses = []
    let leftOut = []
    // Unreadable once found ready: said, rather than shown as a recipe of no lens.
    let broken =
      raw === undefined && record.state === 'ready'
        ? 'its recipe.json cannot be read'
        : undefined
    try {
      lenses = raw ? checkRecipe(raw) : []
      leftOut = raw ? leftOutOf(raw.imported) : []
    } catch (error) {
      broken = message(error)
    }
    all.push({
      id: record.id,
      createdAt: record.createdAt,
      source: record.source,
      ...(record.version && { version: record.version }),
      to: record.to,
      target: record.target,
      state: broken ? 'failed' : record.state,
      ...((broken ?? record.reason) && { reason: broken ?? record.reason }),
      extends: raw?.extends === 'tranchant',
      lenses: lenses.map((lens) => ({
        name: lens.name,
        source: lens.source ?? lens.prompt ?? `${lens.use}+${lens.add}`,
        ...(lens.skills && { skills: lens.skills }),
        paths: lens.paths,
      })),
      leftOut,
    })
  }
  return all.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Use this recipe: import `id`'s recipe, checked again, written to its
 * location; the import is `used` from then on.
 * @param {string} project
 * @param {string} id
 * @returns {Promise<{ target: string, to: 'project' | 'local' }>}
 */
export async function useImport(project, id) {
  const dir = importDir(project, id)
  const record = await readImport(dir).catch(() => {
    throw new ImportRefusal(`no import ${id}`)
  })
  // A failed one is checked again: what failed it (a plugin off, a file locked) may be gone.
  if (record.state === 'used') throw new ImportRefusal('this recipe is in use already')
  if (record.state === 'importing')
    throw new ImportRefusal('the import agent is still writing it')
  const checked = await checkImport(dir)
  if (checked.state !== 'ready')
    throw new ImportRefusal(`this recipe cannot be used: ${checked.reason ?? ''}`)
  const recipe = JSON.parse(await readFile(path.join(dir, 'recipe.json'), 'utf8'))
  await writeJson(record.target, recipe)
  await writeJson(path.join(dir, 'import.json'), {
    ...checked,
    state: 'used',
    usedAt: new Date().toISOString(),
  })
  return { target: record.target, to: record.to }
}
