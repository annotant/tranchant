#!/usr/bin/env node
// lenses.mjs --review <dir> --plan <file>
// The Lenses step of `/tranchant review`, run once the page is open: for each
// lens of the plan prepare.mjs wrote, resolves its source, builds the prompt
// its reviewer runs and stores it under <state>/lenses/<sha256>.md
// (lib/lens.mjs), writing its progress to <review>/lenses.json, which the
// page shows. No model: the same sources give the same prompts.
// Every lens built: the review becomes `reviewing`, the lenses it runs
// recorded in review.json, and one `LENS <json>` is printed per lens,
// `{ name, prompt, paths, model?, topics? }`, `prompt` the built file. One
// lens that cannot be built refuses the review: it becomes `refused`, with
// the lens, its source and why; `REVIEW_REFUSED <reason>` is printed, no
// LENS line, and it exits 2.
import { randomBytes } from 'node:crypto'
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { oneLine } from './lib/format.mjs'
import { LensRefusal, buildLens, folderOf, originOf, storeLens } from './lib/lens.mjs'
import { findReview } from './lib/project.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'

/** @typedef {import('./lib/lens.mjs').LensSpec} LensSpec */
/** @typedef {import('./lib/lens.mjs').RecipeRef} RecipeRef */
/** @typedef {import('./lib/format.mjs').LensRecord} LensRecord */
/**
 * One row of the Lenses step, as the page shows it.
 * @typedef {object} Row
 * @property {string} name
 * @property {string} source
 * @property {'resolving' | 'ready' | 'failed'} state
 * @property {'unchanged' | 'updated' | 'new'} [change] With `ready`: against the project's previous review.
 * @property {string} [version]
 * @property {string} [reason] With `failed`.
 * @property {string} [fix] With `failed`: what makes it build.
 */

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`REVIEW_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error)

const flag = (/** @type {string} */ name) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** How the recipe names a lens's source. @param {LensSpec} lens */
const sourceOf = (lens) =>
  lens.prompt ?? lens.source ?? `${lens.use ?? ''}+${lens.add ?? ''}`

const found = findReview()
const planFile = flag('--plan')
if (!found || !planFile) {
  console.error('usage: lenses.mjs --review <dir> --plan <file>')
  process.exit(2)
}
const dir = found
const store = createStore(dir)
const review = await store.readReview().catch((error) => refuse(message(error)))
/** @type {{ recipe: RecipeRef, lenses: LensSpec[] }} */
const plan = await readFile(planFile, 'utf8')
  .then((text) => JSON.parse(text))
  .catch((error) => refuse(`plan ${planFile}: ${message(error)}`))
if (!plan?.recipe?.file || !Array.isArray(plan.lenses) || !plan.lenses.length)
  refuse(`plan ${planFile}: a recipe and its lenses are required`)

const progressFile = path.join(dir, 'lenses.json')

/**
 * lenses.json, whole: a temp file renamed over it, so the page never reads
 * half. One that cannot be written is said, and the step goes on: the
 * review's status still tells the page where it stands.
 * @param {'resolving' | 'ready' | 'refused'} state
 * @param {Row[]} rows
 */
async function writeProgress(state, rows) {
  const temp = `${progressFile}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify({ state, lenses: rows }, null, 2)}\n`)
    await rename(temp, progressFile)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    console.error(`lenses.json not written: ${oneLine(message(error))}`)
  }
}

/**
 * The lenses the project's previous review ran, by name: the latest review
 * of the same project, created before this one, that recorded its lenses.
 * @returns {Promise<Map<string, string> | undefined>}
 */
async function previousLenses() {
  const reviews = path.dirname(dir)
  let latest
  for (const name of await readdir(reviews).catch(() => [])) {
    if (path.join(reviews, name) === dir) continue
    const other = await readFile(path.join(reviews, name, 'review.json'), 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    if (
      !Array.isArray(other?.lenses) ||
      typeof other.createdAt !== 'string' ||
      other.createdAt >= review.createdAt ||
      (latest && other.createdAt <= latest.createdAt)
    )
      continue
    latest = other
  }
  if (!latest) return undefined
  return new Map(
    latest.lenses.map((/** @type {LensRecord} */ lens) => [lens.name, lens.hash]),
  )
}

/** @type {Row[]} */
const rows = plan.lenses.map((lens) => ({
  name: lens.name,
  source: sourceOf(lens),
  state: 'resolving',
}))
await writeProgress('resolving', rows)

const previous = await previousLenses()
const where = {
  origin: originOf(plan.recipe),
  folder: folderOf(plan.recipe),
  project: review.project,
}
/** @type {LensRecord[]} */
const records = []
/** @type {{ name: string, prompt: string, paths: string[], model?: string, topics?: string[] }[]} */
const built = []
for (const [i, lens] of plan.lenses.entries()) {
  const row = rows[i]
  try {
    const { text, hash, record } = await buildLens(lens, where)
    const { file } = await storeLens(text, hash)
    const before = previous?.get(lens.name)
    Object.assign(row, {
      state: 'ready',
      source: record.source,
      change: before === undefined ? 'new' : before === hash ? 'unchanged' : 'updated',
      ...(record.version && { version: record.version }),
    })
    records.push(record)
    built.push({
      name: lens.name,
      prompt: file,
      paths: lens.paths,
      ...(lens.model && { model: lens.model }),
      ...(lens.topics && { topics: lens.topics }),
    })
  } catch (error) {
    Object.assign(row, {
      state: 'failed',
      reason: message(error),
      fix: error instanceof LensRefusal ? error.fix : 'edit the recipe',
    })
  }
  await writeProgress('resolving', rows)
}

const failed = rows.find((row) => row.state === 'failed')
if (failed) {
  await writeProgress('refused', rows)
  try {
    await store.refuse({
      lens: failed.name,
      source: failed.source,
      reason: failed.reason ?? 'it cannot be built',
      ...(failed.fix && { fix: failed.fix }),
    })
  } catch (error) {
    if (!(error instanceof StoreRefusal)) throw error
    refuse(error.message)
  }
  refuse(`lens ${failed.name} (${failed.source}): ${failed.reason}; ${failed.fix ?? ''}`)
}
try {
  await store.prepared(records)
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  refuse(error.message)
}
await writeProgress('ready', rows)
for (const lens of built) console.log(`LENS ${JSON.stringify(lens)}`)
