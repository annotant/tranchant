// A battle review: two groups of lenses of the project on one change at the
// same time, in one review, so they share its queue and the page compares
// what each found. A lens in both groups (same scope, name and paths) runs
// once and counts for both, unless `twice`; a lens of A and one of B under
// the same name otherwise run each under its own, `<name>-a` and `<name>-b`.
// prepare.mjs (--battle A,B) and lenses.mjs (the page's Battle review tab)
// plan it. The pairs of findings the user split (Not the same) are kept in
// the review's battle.json. Described in docs/review-file.md.
import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'
import { LENS_NAME } from './format.mjs'
import { groupNotes } from './groups.mjs'
import { planLenses } from './plan.mjs'

/** @typedef {import('./plan.mjs').PlannedLens} PlannedLens */
/** Which group a lens of a battle runs for: `both` for a shared lens run once. @typedef {'a' | 'b' | 'both'} Side */
/** A lens of a battle's plan: its side always. @typedef {PlannedLens & { side: Side }} BattleLens */
/** The two groups a battle opposes, and whether the shared lenses run once per group. @typedef {{ a: string, b: string, twice?: true }} Battle */

/** A battle that cannot be planned, and why. */
export class BattleRefusal extends Error {}

/**
 * `A,B` as `--battle` takes it: two different group names.
 * @param {string} value
 * @returns {Battle}
 */
export function parseBattle(value) {
  const names = value.split(',').map((one) => one.trim())
  const [a, b] = names
  if (names.length !== 2 || !a || !b)
    throw new BattleRefusal(`--battle takes two groups, A,B: not ${value}`)
  for (const name of names)
    if (!LENS_NAME.test(name))
      throw new BattleRefusal(
        `${name} is not a group name: letters, digits, - and _ only`,
      )
  if (a === b)
    throw new BattleRefusal(`a battle opposes two different groups, not ${a} twice`)
  return { a, b }
}

/** A battle as choices.json and lenses.json hold it, checked; undefined when unsound. @param {any} value @returns {Battle | undefined} */
export function battleOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { a, b, twice } = value
  if (typeof a !== 'string' || typeof b !== 'string' || a === b) return undefined
  if (!LENS_NAME.test(a) || !LENS_NAME.test(b)) return undefined
  if (twice !== undefined && typeof twice !== 'boolean') return undefined
  return { a, b, ...(twice && { twice: true }) }
}

/** Whether two battles are the same one. @param {Battle | undefined} x @param {Battle | undefined} y */
export const sameBattle = (x, y) =>
  x === undefined || y === undefined
    ? x === y
    : x.a === y.a && x.b === y.b && !x.twice === !y.twice

/** Which lens it is: its scope, its name and the files it reads. @param {PlannedLens} lens */
const identity = (lens) =>
  JSON.stringify([lens.added?.scope ?? 'recipe', lens.name, lens.paths.toSorted()])

/** `name` with a side's suffix, cut to fit a lens name. @param {string} name @param {'a' | 'b'} side */
const suffixed = (name, side) => `${name.slice(0, 38)}-${side}`

/**
 * The lenses of a battle, from each group's: the shared ones first, then
 * A's and B's in turn, so the queue moves both reviews at once. Throws when
 * two lenses end up under one name.
 * @param {PlannedLens[]} a
 * @param {PlannedLens[]} b
 * @param {boolean} twice
 * @returns {BattleLens[]}
 */
export function mergeBattle(a, b, twice) {
  const inB = new Map(b.map((lens) => [identity(lens), lens]))
  const shared = twice ? [] : a.filter((lens) => inB.has(identity(lens)))
  const sharedKeys = new Set(shared.map(identity))
  const onlyA = a.filter((lens) => !sharedKeys.has(identity(lens)))
  const onlyB = b.filter((lens) => !sharedKeys.has(identity(lens)))
  const clash = new Set(
    onlyA
      .map((lens) => lens.name)
      .filter((name) => onlyB.some((one) => one.name === name)),
  )
  /** @param {PlannedLens} lens @param {'a' | 'b'} side @returns {BattleLens} */
  const sided = (lens, side) =>
    clash.has(lens.name)
      ? { ...lens, name: suffixed(lens.name, side), of: lens.name, side }
      : { ...lens, side }
  /** @type {BattleLens[]} */
  const merged = shared.map((lens) => ({ ...lens, side: 'both' }))
  for (let i = 0; i < Math.max(onlyA.length, onlyB.length); i += 1) {
    const one = onlyA[i]
    const other = onlyB[i]
    if (one) merged.push(sided(one, 'a'))
    if (other) merged.push(sided(other, 'b'))
  }
  const seen = new Set()
  for (const lens of merged) {
    if (seen.has(lens.name))
      throw new BattleRefusal(
        `two lenses of the battle run as ${lens.name}: rename one in Settings › Lenses`,
      )
    seen.add(lens.name)
  }
  return merged
}

/**
 * A battle's plan: each group's lenses planned on the change, then merged.
 * Refused when a group is not in the project, or has no lens that reads the
 * change.
 * @param {object} options
 * @param {string} options.project
 * @param {string} options.range
 * @param {import('./lens.mjs').LensSpec[]} options.recipe
 * @param {{ disabledLenses: string[], lensModels: Record<string, string> }} options.values
 * @param {import('./groups.mjs').Group[]} options.groups The project's.
 * @param {Battle} options.battle
 */
export async function planBattle({ project, range, recipe, values, groups, battle }) {
  /** @param {string} name */
  const groupOf = (name) => {
    const group = groups.find((one) => one.name === name)
    if (!group)
      throw new BattleRefusal(
        `no group ${name} in this project (Settings › Lenses › Groups): ${groups.map((one) => one.name).join(', ') || 'none yet'}`,
      )
    return group
  }
  const sides = [groupOf(battle.a), groupOf(battle.b)]
  const plans = []
  /** @type {string[]} */
  const notes = []
  for (const group of sides) {
    const planned = await planLenses({
      project,
      range,
      recipe,
      own: false,
      values,
      group: group.lenses,
    })
    if (!planned.applied.length)
      throw new BattleRefusal(
        planned.inForce
          ? `no lens of group ${group.name} applies to the change's files`
          : `group ${group.name} has no lens that can run (Settings › Lenses › Groups)`,
      )
    notes.push(...groupNotes(group.name, group.removed ?? [], planned.missing))
    plans.push(planned)
  }
  const [planA, planB] = plans
  if (!planA || !planB) throw new BattleRefusal('the battle could not be planned')
  return {
    lenses: mergeBattle(planA.applied, planB.applied, battle.twice === true),
    notes,
    changed: planA.changed,
    // An added lens both groups name is one lens: its problem said once.
    problems: [...planA.problems, ...planB.problems].filter(
      (one, i, all) =>
        all.findIndex((other) => other.name === one.name && other.scope === one.scope) ===
        i,
    ),
  }
}

/** The finding ids `[\w-]{1,64}`, as format.mjs takes them. */
const FINDING_ID = /^[\w-]{1,64}$/
const SPLITS_VERSION = 1
const MAX_SPLITS = 500

/** A battle's pairs the user split (Not the same), in `battle.json` beside its review.json. */
const splitsFile = (/** @type {string} */ dir) => path.join(dir, 'battle.json')

/**
 * The pairs the user split, each two finding ids in order. None when the
 * file is missing; none too, said on stderr, when it is not one this
 * Tranchant reads.
 * @param {string} dir The review's folder.
 * @returns {Promise<[string, string][]>}
 */
export async function readSplits(dir) {
  let raw
  try {
    raw = JSON.parse(await readFile(splitsFile(dir), 'utf8'))
  } catch (error) {
    if (errorCode(error) !== 'ENOENT')
      console.error(
        `battle.json not read: ${error instanceof Error ? error.message : String(error)}`,
      )
    return []
  }
  if (raw?.version !== SPLITS_VERSION || !Array.isArray(raw.splits)) return []
  return raw.splits.filter(
    (/** @type {unknown} */ pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      pair.every((id) => typeof id === 'string' && FINDING_ID.test(id)),
  )
}

/** The two ids of a pair, in one order whichever came first. @param {string} x @param {string} y @returns {[string, string]} */
const ordered = (x, y) => (x < y ? [x, y] : [y, x])

/**
 * Splits the pair `x`, `y` (`split`), or pairs it again; answers the splits.
 * Whole or not at all: a temp file renamed over it, one write at a time.
 * @param {string} dir
 * @param {string} x
 * @param {string} y
 * @param {boolean} split
 */
export function writeSplit(dir, x, y, split) {
  return withFileLock(splitsFile(dir), async () => {
    const [one, two] = ordered(x, y)
    const kept = (await readSplits(dir)).filter(([a, b]) => !(a === one && b === two))
    const splits = split ? [...kept, /** @type {[string, string]} */ ([one, two])] : kept
    if (splits.length > MAX_SPLITS)
      throw new BattleRefusal(`${MAX_SPLITS} pairs split at most`)
    const file = splitsFile(dir)
    const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
    try {
      await writeFile(
        temp,
        `${JSON.stringify({ version: SPLITS_VERSION, splits }, null, 2)}\n`,
      )
      await rename(temp, file)
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
    return splits
  })
}

/** Whether `value` is a finding id. @param {unknown} value @returns {value is string} */
export const isFindingId = (value) => typeof value === 'string' && FINDING_ID.test(value)
