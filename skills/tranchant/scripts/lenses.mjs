#!/usr/bin/env node
// lenses.mjs --review <dir> --plan <file> [--check | --replan | --start]
// lenses.mjs --review <dir> --abandon <reason>
// The Lenses step of `/tranchant review`, run once the page is open: for each
// lens of the plan prepare.mjs wrote, resolves its source, builds the prompt
// its reviewer runs and stores it under <state>/lenses/<sha256>.md
// (lib/lens.mjs), writing its progress to <review>/lenses.json, which the
// page shows. No model: the same sources give the same prompts.
// Every lens built: the review becomes `reviewing`, the lenses it runs
// recorded in review.json, and one `LENS <json>` is printed per lens,
// `{ name, prompt, paths, model?, topics? }`, `prompt` the built file, `model`
// on Auto-detect the source's or `inherit` (the session's). One
// lens that cannot be built refuses the review: it becomes `refused`, with
// the lens, its source and why; `REVIEW_REFUSED <reason>` is printed, no
// LENS line, and it exits 2. So does any other failure of the step, and
// `--abandon`, which the hooks run when the step could not run: a review
// never stays `preparing` with nothing at work on it.
// --check, first: for each lens the user added, its source hashed again
// (lib/userlens.mjs); one that changed since its last cleaning prints
// `STALE <json>`, `{ name, scope }`, and its row says it is being
// cleaned again. The hooks clean those, then run the step without --check:
// a lens cleaned meanwhile says so, one whose cleaning failed runs its last
// version and says why.
// A plan that waits to start (`wait`, prepare.mjs) builds its lenses, then
// leaves the review `preparing` and lenses.json `waiting`, every lens the
// page can turn on in its rows (an `idle` one is not built), and prints
// `WAITING`: a lens that cannot be built refuses nothing there. --replan
// makes the plan again from the settings as they stand, the page's choices
// (<review>/choices.json) applied; --start does too, then builds the lenses
// on and goes on as above, or back to `waiting` when one cannot be built.
// The plan's group (prepare.mjs) is in lenses.json from the first write, and
// in review.json once it runs; a choice of another group (`group` in the
// choices, `null` for every lens that is on) makes the plan again with it.
// A battle's plan (prepare.mjs --battle, or `battle` in the choices: the
// page's Battle review tab; `null` back to one group) runs its two groups'
// lenses, each row with its `side`; the switches do not apply to it. Its
// groups and each lens's side are in lenses.json, and in review.json once it
// runs (`battle`).
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { errorCode } from './lib/errors.mjs'
import { LENS_NAME, oneLine } from './lib/format.mjs'
import {
  AUTO_MODEL,
  LensRefusal,
  RecipeRefusal,
  autoModel,
  buildLens,
  folderOf,
  originOf,
  readRecipe,
  storeLens,
} from './lib/lens.mjs'
import { BattleRefusal, battleOf, planBattle } from './lib/battle.mjs'
import { forgetRemoved, groupNotes, readGroups } from './lib/groups.mjs'
import { PlanRefusal, planLenses } from './lib/plan.mjs'
import { findReview } from './lib/project.mjs'
import { loadSettings } from './lib/settings.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'
import {
  LensFileRefusal,
  hashesOf,
  readUserLens,
  staleness,
  whereOf,
} from './lib/userlens.mjs'

/** @typedef {import('./lib/lens.mjs').LensSpec} LensSpec */
/** @typedef {import('./lib/plan.mjs').PlannedLens} PlannedLens */
/** @typedef {import('./lib/lens.mjs').RecipeRef} RecipeRef */
/** @typedef {import('./lib/format.mjs').LensRecord} LensRecord */
/**
 * One row of the Lenses step, as the page shows it.
 * @typedef {object} Row
 * @property {string} name
 * @property {string} source
 * @property {'resolving' | 'ready' | 'failed' | 'idle'} state `idle`: not built, a waiting review's lens that does not run.
 * @property {number} [files] In a waiting review: the changed files it reads.
 * @property {true} [off] In a waiting review: off in the settings; in a group's, not one of the group.
 * @property {true} [offInSettings] In a group's review: off in the settings, run by the group.
 * @property {import('./lib/battle.mjs').Side} [side] In a battle: the group it runs for, `both` for a shared lens run once.
 * @property {string} [of] In a battle: the lens's own name, when it runs under another (`<name>-a`).
 * @property {'unchanged' | 'updated' | 'new'} [change] With `ready`: against the project's previous review.
 * @property {string} [version]
 * @property {string} [hash] With `ready`: its built prompt's, as review.json records it: the estimate's history starts over where it changes.
 * @property {string} [reason] With `failed`; with `cleaning: 'failed'`, why its last version runs.
 * @property {string} [fix] With `failed`: what makes it build.
 * @property {'global' | 'local'} [scope] A lens the user added.
 * @property {'running' | 'again' | 'failed' | 'held'} [cleaning] An added lens whose source changed: being cleaned again, cleaned again, its cleaning failed, or held: the change under review is what changed it.
 * @property {string} [model] With `ready`: the model its reviewer runs on, an alias's id as it stands today; absent, the session's.
 * @property {'forced' | 'auto' | 'lens' | 'reviewers'} [modelFrom] With `ready`: what chose it: TRANCHANT_MODEL, Auto-detect, the lens's own, or Settings › Agents.
 * @property {'none' | 'inherit' | 'foreign' | 'unreadable' | 'held'} [autoWhy] On Auto-detect, why the session's: its source names no model, says `inherit`, names one that is not Claude's, has a frontmatter that cannot be read, or is changed by the change under review.
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

/** `text` cut to `max` characters: review.json takes a refusal's words that short. */
const clip = (/** @type {string} */ text, max = 1000) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/** What fixes a failure that is not the recipe's. */
const RETRY = 'not the recipe: run /tranchant review again, and report it if it persists'

const found = findReview()
const planFile = flag('--plan')
const abandoned = flag('--abandon')
if (!found || (!planFile && abandoned === undefined)) {
  console.error('usage: lenses.mjs --review <dir> --plan <file> | --abandon <reason>')
  process.exit(2)
}
const dir = found
const store = createStore(dir)

/**
 * Refuses the review, when it still prepares, then says so.
 * @param {{ lens: string, source: string, reason: string, fix: string }} refusal
 * @returns {Promise<never>}
 */
async function giveUp({ lens, source, reason, fix }) {
  await store
    .refuse({
      lens: clip(lens, 100),
      source: clip(source),
      reason: clip(reason),
      fix: clip(fix),
    })
    .catch((error) =>
      console.error(`the review was not marked refused: ${oneLine(message(error))}`),
    )
  return refuse(`lens ${lens} (${source}): ${reason}; ${fix}`)
}

/** The whole step's failure, not one lens's. */
const stepFailed = (/** @type {string} */ reason) =>
  giveUp({ lens: 'Lenses step', source: planFile ?? '-', reason, fix: RETRY })

if (abandoned !== undefined) await stepFailed(abandoned || 'the step did not run')
const review = await store.readReview().catch((error) => stepFailed(message(error)))
/**
 * @type {{ recipe: RecipeRef, lenses: PlannedLens[], own?: true, group?: string,
 *   battle?: import('./lib/battle.mjs').Battle,
 *   notes?: string[], removed?: import('./lib/groups.mjs').Member[],
 *   wait?: 'setting' | 'flag' | 'reset' | 'battle', changed?: number, others?: PlannedLens[] }}
 */
let plan = await readFile(String(planFile), 'utf8')
  .then((text) => JSON.parse(text))
  .catch((error) => stepFailed(`plan ${planFile}: ${message(error)}`))
if (
  !plan?.recipe?.file ||
  !Array.isArray(plan.lenses) ||
  (!plan.lenses.length && !plan.wait) ||
  (plan.others !== undefined && !Array.isArray(plan.others))
)
  await stepFailed(`plan ${planFile}: a recipe and its lenses are required`)
const starting = process.argv.includes('--start')
if ((starting || process.argv.includes('--replan')) && !plan.wait)
  await stepFailed(`plan ${planFile}: the review does not wait to start`)

const progressFile = path.join(dir, 'lenses.json')

/**
 * lenses.json, whole: a temp file renamed over it, so the page never reads
 * half. One that cannot be written is said, and the step goes on: the
 * review's status still tells the page where it stands.
 * @param {'resolving' | 'ready' | 'refused' | 'waiting'} state
 * @param {Row[]} rows
 * @returns {Promise<boolean>} Whether it was written.
 */
async function writeProgress(state, rows) {
  const temp = `${progressFile}.${randomBytes(6).toString('hex')}.tmp`
  // While it waits, why and what for: the page's ready screen.
  const waits = plan.wait &&
    state !== 'ready' && {
      wait: plan.wait,
      ...(plan.own && { own: true }),
      changed: plan.changed ?? 0,
      ...(choices && { choices }),
      ...(problem && { problem }),
    }
  const named = {
    ...(plan.group && { group: plan.group }),
    ...(plan.battle && { battle: plan.battle }),
    ...(plan.notes?.length && { notes: plan.notes }),
  }
  try {
    await writeFile(
      temp,
      `${JSON.stringify({ state, ...named, ...waits, lenses: rows }, null, 2)}\n`,
    )
    await rename(temp, progressFile)
    return true
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    console.error(`lenses.json not written: ${oneLine(message(error))}`)
    return false
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

const run = promisify(execFile)
/** The change's range, as prepare.mjs reads it: the MR's own refs, else what reached the head since the base. */
const range =
  review.ownership === 'theirs'
    ? `${review.base}..${review.headSha}`
    : `${review.base}...${review.headSha}`

/**
 * The page's choices for a waiting review, by lens name: on or off for this
 * review, whatever the settings say; whether Start saved them; and the group
 * picked, when one was (`null`: every lens that is on); the battle picked,
 * when one was (`null`: back to one group).
 * @type {{ lenses: Record<string, boolean>, remember: boolean, group?: string | null, battle?: import('./lib/battle.mjs').Battle | null } | undefined}
 */
let choices
/** Why a waiting review's plan could not be made again: the page says it, and nothing starts. */
let problem = ''
if (plan.wait) {
  const read = await readFile(path.join(dir, 'choices.json'), 'utf8')
    .then((text) => JSON.parse(text))
    .catch((error) => {
      // None yet is the page's defaults; any other failure is said, and they apply.
      if (errorCode(error) !== 'ENOENT')
        console.error(`choices.json not read: ${oneLine(message(error))}`)
      return undefined
    })
  const lenses = read?.lenses
  if (lenses && typeof lenses === 'object' && !Array.isArray(lenses))
    choices = {
      lenses: Object.fromEntries(
        Object.entries(lenses).filter(([, on]) => typeof on === 'boolean'),
      ),
      remember: read.remember === true,
      ...((read.group === null ||
        (typeof read.group === 'string' && LENS_NAME.test(read.group))) && {
        group: read.group,
      }),
      ...(read.battle === null
        ? { battle: null }
        : battleOf(read.battle) && { battle: battleOf(read.battle) }),
    }
}

// The settings may have changed since the plan was made: made again, as prepare.mjs makes it.
if (starting || process.argv.includes('--replan')) {
  // Not waiting any more: the server takes no second Start meanwhile.
  const before = await readFile(progressFile, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  if (Array.isArray(before?.lenses)) await writeProgress('resolving', before.lenses)
  problem = await replan().catch((error) => message(error))
  // Kept as it was: the page says why, and the review still waits.
  if (problem) console.error(`the lenses were not planned again: ${oneLine(problem)}`)
}

/**
 * The plan made again from the settings and the recipe as they stand, and
 * written over the plan file. Answers why it could not be, else ''.
 */
async function replan() {
  const { values, problem: unread } = await loadSettings()
  // Never the defaults in place of settings it cannot read: the lenses off would run.
  if (unread) return `the settings cannot be read: ${unread}`
  let recipeLenses
  try {
    recipeLenses = (await readRecipe(plan.recipe)).lenses
  } catch (error) {
    if (error instanceof RecipeRefusal) return `recipe: ${error.message}`
    throw error
  }
  // The battle picked on the page, else the plan's; a run's own recipe has none.
  const battle = plan.own
    ? undefined
    : choices && choices.battle !== undefined
      ? (choices.battle ?? undefined)
      : plan.battle
  if (battle) return replanBattle(values, recipeLenses, battle)
  // The group picked on the page, else the plan's; a run's own recipe has none.
  const name = plan.own
    ? undefined
    : choices && choices.group !== undefined
      ? (choices.group ?? undefined)
      : plan.group
  let group
  if (name) {
    const read = await readGroups(review.project)
    if (read.problem) return `group ${name}: ${read.problem}`
    group = read.groups.groups.find((one) => one.name === name)
    if (!group) return `no group ${name} in this project any more`
  }
  let planned
  try {
    planned = await planLenses({
      project: review.project,
      range,
      recipe: recipeLenses,
      own: plan.own === true,
      values,
      all: true,
      ...(group && { group: group.lenses }),
    })
  } catch (error) {
    if (error instanceof PlanRefusal) return error.message
    throw error
  }
  for (const one of planned.problems)
    console.error(`lens ${one.name} (${one.scope}) not run: ${oneLine(one.problem)}`)
  // Read again, never consumed: the removed lenses are forgotten once a review of the group runs.
  const notes = group ? groupNotes(group.name, group.removed ?? [], planned.missing) : []
  const {
    group: _group,
    notes: _notes,
    removed: _removed,
    battle: _battle,
    ...rest
  } = plan
  const next = {
    ...rest,
    ...(group && { group: group.name }),
    ...(notes.length && { notes }),
    ...(group?.removed && { removed: group.removed }),
    lenses: planned.applied,
    others: planned.others,
    changed: planned.changed.length,
  }
  await writeFile(String(planFile), `${JSON.stringify(next, null, 2)}\n`)
  plan = next
  return ''
}

/**
 * A battle's plan made again, both its groups as they stand. Answers why it
 * could not be, else ''.
 * @param {import('./lib/settings.mjs').Values} values
 * @param {LensSpec[]} recipeLenses
 * @param {import('./lib/battle.mjs').Battle} battle
 */
async function replanBattle(values, recipeLenses, battle) {
  const read = await readGroups(review.project)
  if (read.problem) return `groups: ${read.problem}`
  let planned
  try {
    planned = await planBattle({
      project: review.project,
      range,
      recipe: recipeLenses,
      values,
      groups: read.groups.groups,
      battle,
    })
  } catch (error) {
    if (error instanceof BattleRefusal || error instanceof PlanRefusal)
      return error.message
    throw error
  }
  for (const one of planned.problems)
    console.error(`lens ${one.name} (${one.scope}) not run: ${oneLine(one.problem)}`)
  const { group: _group, notes: _notes, removed: _removed, battle: _was, ...rest } = plan
  const next = {
    ...rest,
    battle,
    ...(planned.notes.length && { notes: planned.notes }),
    lenses: planned.lenses,
    others: [],
    changed: planned.changed.length,
  }
  await writeFile(String(planFile), `${JSON.stringify(next, null, 2)}\n`)
  plan = next
  return ''
}

/** A waiting review's lens is on unless the settings or the page's choices turn it off; a battle's always is. */
const isOn = (/** @type {PlannedLens} */ lens) =>
  plan.battle
    ? true
    : choices && Object.hasOwn(choices.lenses, lens.name)
      ? choices.lenses[lens.name]
      : !lens.off
/** The lenses this run builds, and those its rows show: every one the page can turn on, while it waits. */
const shown = plan.wait ? [...plan.lenses, ...(plan.others ?? [])] : plan.lenses
const runs = (/** @type {PlannedLens} */ lens) =>
  !plan.wait || (isOn(lens) && (lens.files ?? 0) > 0)

/** @type {Row[]} */
const rows = shown.map((lens) => ({
  name: lens.name,
  source: sourceOf(lens),
  state: runs(lens) ? 'resolving' : 'idle',
  ...(lens.added && { scope: lens.added.scope }),
  ...(plan.wait && { files: lens.files ?? 0 }),
  ...(plan.wait && lens.off && { off: true }),
  ...(lens.offInSettings && { offInSettings: true }),
  ...(lens.side && { side: lens.side }),
  ...(lens.of && { of: lens.of }),
}))

/**
 * Whether the change under review touches `file`, a file of the project: a
 * lens is then never cleaned from it, so a branch cannot rewrite the lens
 * that reviews it.
 * @param {string} file
 */
async function changedHere(file) {
  const inside = path.relative(review.project, file)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return false
  try {
    const { stdout } = await run('git', [
      '-C',
      review.project,
      'diff',
      '--name-only',
      range,
      '--',
      inside,
    ])
    return stdout.trim() !== ''
  } catch {
    // git cannot say: held, rather than cleaned from what the change may have written.
    return true
  }
}

/**
 * Where an added lens stands against its source: undefined when it cannot
 * say (the build says why). `held` when the change under review touches its
 * source.
 * @param {LensSpec} lens
 */
async function standing(lens) {
  if (!lens.added) return undefined
  try {
    const stored = await readUserLens(lens.added.dir)
    const hashes = await hashesOf(stored, review.project)
    const now = staleness(stored, hashes)
    const held = now !== 'clean' && (await changedHere(hashes.source.file))
    return { stored, now, held }
  } catch (error) {
    if (error instanceof LensFileRefusal || error instanceof LensRefusal) return undefined
    throw error
  }
}

/** What a lens's row says of a held lens. */
const HELD =
  'its source changes in this review: its last version runs until the change is merged'

if (process.argv.includes('--check')) {
  /** @type {{ name: string, scope: string }[]} */
  const stale = []
  // While it waits, the lenses the page turned on are cleaned again too.
  for (const [i, lens] of shown.entries()) {
    if (!runs(lens)) continue
    const now = await standing(lens).catch((error) => stepFailed(message(error)))
    if (now?.now !== 'stale' || now.held || !lens.added) continue
    Object.assign(rows[i] ?? {}, { cleaning: 'running' })
    stale.push({ name: lens.name, scope: lens.added.scope })
  }
  await writeProgress('resolving', rows)
  for (const one of stale) console.log(`STALE ${JSON.stringify(one)}`)
  process.exit(0)
}
await writeProgress('resolving', rows)

const previous = await previousLenses()
const { values: settings, locked } = await loadSettings()

/**
 * The model of a lens's reviewer: on its LENS line, the lens's own (on
 * Auto-detect, its source's, else `inherit`, the session's: the reviewers'
 * model is skipped), which the hooks put after TRANCHANT_MODEL and before
 * the reviewers'; on its row, the one it runs on (an alias's id as it stands
 * today), and what chose it.
 * @param {LensSpec} lens
 * @param {{ file: string, frontmatter: { fields: Record<string, string>, problem?: string } }} built
 */
async function modelOf(lens, built) {
  /** @type {import('./lib/lens.mjs').AutoModel | { why: 'held' } | undefined} */
  let auto = lens.model === AUTO_MODEL ? autoModel(built.frontmatter) : undefined
  // A branch never picks the model of the lens that reviews it.
  if (auto?.why === 'source' && lens.added && (await changedHere(built.file)))
    auto = { why: 'held' }
  const line = auto ? (auto.why === 'source' ? auto.model : 'inherit') : lens.model
  const forced = locked.reviewModel ? settings.reviewModel : null
  const row = forced
    ? { model: forced, modelFrom: 'forced' }
    : auto
      ? auto.why === 'source'
        ? { model: auto.id, modelFrom: 'auto' }
        : { modelFrom: 'auto', autoWhy: auto.why }
      : lens.model
        ? { model: lens.model, modelFrom: 'lens' }
        : {
            ...(settings.reviewModel && { model: settings.reviewModel }),
            modelFrom: 'reviewers',
          }
  return { line, row }
}

const where = {
  origin: originOf(plan.recipe),
  folder: folderOf(plan.recipe),
  project: review.project,
}
/** @type {LensRecord[]} */
const records = []
/** @type {{ name: string, prompt: string, paths: string[], model?: string, topics?: string[] }[]} */
const built = []
for (const [i, lens] of shown.entries()) {
  const row = rows[i]
  if (!row || !runs(lens)) continue
  try {
    // An added lens's paths are the project's, never the recipe's folder.
    const made = await buildLens(lens, lens.added ? whereOf(review.project) : where)
    const { text, hash, record } = made
    const { file } = await storeLens(text, hash)
    const model = await modelOf(lens, made)
    const before = previous?.get(lens.name)
    const against = await standing(lens)
    const cleanedNow = against && against.stored.cleaned.at >= review.createdAt
    Object.assign(row, {
      state: 'ready',
      source: record.source,
      hash,
      change: before === undefined ? 'new' : before === hash ? 'unchanged' : 'updated',
      ...(record.version && { version: record.version }),
      ...model.row,
      // Cleaned again for this review; or its source changed and its last version runs, said why.
      ...(cleanedNow
        ? { cleaning: 'again' }
        : against?.held
          ? { cleaning: 'held', reason: HELD }
          : against &&
            against.now !== 'clean' && {
              cleaning: 'failed',
              reason: clip(
                against.stored.failedCleaning?.reason ??
                  'its source changed since its last cleaning, which was not run again',
              ),
            }),
    })
    records.push({
      ...record,
      ...(Number.isSafeInteger(lens.files) && { files: lens.files }),
    })
    built.push({
      name: lens.name,
      prompt: file,
      paths: lens.paths,
      ...(model.line && { model: model.line }),
      ...(lens.topics && { topics: lens.topics }),
    })
  } catch (error) {
    Object.assign(row, {
      state: 'failed',
      reason: clip(message(error)),
      fix: error instanceof LensRefusal ? error.fix : RETRY,
    })
  }
  await writeProgress('resolving', rows)
}

// Waiting, or a start a lens refuses: the page says which, and waits for Start again.
if (
  plan.wait &&
  (!starting || problem || !built.length || rows.some((row) => row.state === 'failed'))
) {
  if (starting && !built.length) console.error('no lens is on: the review waits')
  // Unwritten, the page would show the lenses building for ever, with no Start.
  if (!(await writeProgress('waiting', rows)))
    await stepFailed('lenses.json could not be written: the review cannot wait')
  console.log('WAITING')
  process.exit(0)
}
const failed = rows.find((row) => row.state === 'failed')
if (failed) {
  await writeProgress('refused', rows)
  await giveUp({
    lens: failed.name,
    source: failed.source,
    reason: failed.reason ?? 'it cannot be built',
    fix: failed.fix ?? RETRY,
  })
}
// Each lens that runs, and the group it runs for: the page splits the findings by it.
const battle = plan.battle && {
  ...plan.battle,
  lenses: Object.fromEntries(
    shown.flatMap((lens) =>
      lens.side && built.some((one) => one.name === lens.name)
        ? [[lens.name, lens.side]]
        : [],
    ),
  ),
}
await store
  .prepared(records, plan.group, battle)
  .catch((error) =>
    error instanceof StoreRefusal ? refuse(error.message) : stepFailed(message(error)),
  )
// The group's review runs: the lenses removed from it it said are said.
if (plan.group && plan.removed?.length)
  await forgetRemoved(review.project, plan.group, plan.removed).catch((error) =>
    console.error(`group ${plan.group}: removed lenses kept: ${oneLine(message(error))}`),
  )
await writeProgress(
  'ready',
  rows.filter((row) => row.state === 'ready'),
)
for (const lens of built) console.log(`LENS ${JSON.stringify(lens)}`)
