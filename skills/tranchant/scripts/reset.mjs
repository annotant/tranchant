#!/usr/bin/env node
// reset.mjs --review <dir>
// The page's Reset the review, on a `/tranchant review` stopped, once the
// hooks ended its agents: the review goes back to `preparing`, its summary,
// findings, decisions, discussions and review agents' run files all gone, and
// its plan (<state>/inbox/<id>.plan.json) waits to start (`wait: "reset"`),
// the lenses it ran on unless the page's choices already say. Prints
// `RESET <plan file>`: the hooks run `lenses.mjs --check --replan` on it, and
// the page shows Ready to start the review. `RESET_REFUSED <reason>`, exit 2,
// nothing removed: not stopped, a fix, a post, an issue or an answer still
// under way, or no sound plan (a review opened from a file).
import { existsSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { oneLine } from './lib/format.mjs'
import { STATE_ROOT, findReview } from './lib/project.mjs'
import { StoreRefusal, busyText, createStore } from './lib/store.mjs'

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`RESET_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

/**
 * `value` as JSON over `file`, whole: lenses.mjs and the server may be reading it.
 * @param {string} file
 * @param {unknown} value
 */
async function writeWhole(file, value) {
  const temp = `${file}.${process.pid}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

const dir = findReview()
if (!dir) {
  console.error('usage: reset.mjs --review <dir>')
  process.exit(2)
}
const store = createStore(dir)

try {
  const review = await store.readReview()
  if (!review.stopped) refuse('the review is not stopped')
  // Read before anything goes: a review with no plan to start again from keeps its findings.
  const planFile = path.join(STATE_ROOT, 'inbox', `${review.id}.plan.json`)
  /** @type {any} */
  let plan
  try {
    plan = JSON.parse(await readFile(planFile, 'utf8'))
  } catch (error) {
    refuse(
      `no plan to start it again from (${planFile}: ${error instanceof Error ? error.message : String(error)}): only a /tranchant review resets`,
    )
  }
  if (!plan?.recipe?.file || !Array.isArray(plan.lenses))
    refuse(`the plan ${planFile} has no recipe and lenses`)
  const busy = await store.underWay()
  if (busy.length) refuse(busyText(busy))
  // The plan and the choices first: a write that fails then leaves the findings where they are.
  await writeWhole(planFile, { ...plan, wait: 'reset' })
  const choices = path.join(dir, 'choices.json')
  // The page's choices, when it sent some, else the lenses the review ran: on again.
  const chose = !existsSync(choices) && !!review.lenses?.length
  if (chose)
    await writeWhole(choices, {
      lenses: Object.fromEntries((review.lenses ?? []).map((lens) => [lens.name, true])),
      remember: false,
    })
  try {
    await store.reset()
  } catch (error) {
    // Refused (a fix or a question since the check), nothing removed: plan and choices back; another error keeps them for a retry.
    if (error instanceof StoreRefusal) {
      await writeWhole(planFile, plan)
      if (chose) await rm(choices, { force: true })
    }
    throw error
  }
  console.log(`RESET ${planFile}`)
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  refuse(error.message)
}
