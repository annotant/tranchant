// The plan of `/tranchant review`: the lenses in force whose paths the
// change touches, each with how many changed files it reads. prepare.mjs
// writes it first; lenses.mjs makes it again (--replan, --start) for a review
// waiting to start, from the settings as they then stand. Described in
// docs/review-file.md.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lensSet } from './userlens.mjs'

/** @typedef {import('./lens.mjs').LensSpec} LensSpec */
/**
 * A lens of the plan: its spec, the changed files it reads (`files`, their
 * count) and, among a waiting review's `others`, why it does not run: `off`
 * in the settings (in a group's review, not one of the group), or no changed
 * file in its paths (`files: 0`).
 * @typedef {LensSpec & { files?: number, off?: true }} PlannedLens
 */

/** git cannot say which files the change touches: the review cannot be planned. */
export class PlanRefusal extends Error {}

const run = promisify(execFile)

/** What a command said on stderr, its first line, else its message. @param {unknown} error */
function firstWords(error) {
  const stderr =
    error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
  return (
    stderr
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? (error instanceof Error ? error.message : String(error))
  ).replace(/^(?:fatal|error): /, '')
}

/**
 * The plan for `range` in `project`: `applied` the lenses that run, each
 * with its paths (the `otherwise` lens's, the changed files no other lens's
 * globs match); with `all`, `others` the lenses that could run on it but do
 * not, off in the settings or reading none of its files, for the page to
 * turn on. `own`: the run's own recipe, which runs whole, no lens added and
 * none turned off. `problems` are the added lenses that cannot be read.
 * `group`: a group's lenses, which run whatever their switches, and none
 * other; `missing`, those of them that are not among the lenses any more.
 * @param {object} options
 * @param {string} options.project
 * @param {string} options.range
 * @param {LensSpec[]} options.recipe The recipe's lenses.
 * @param {boolean} options.own
 * @param {{ disabledLenses: string[], lensModels: Record<string, string> }} options.values
 * @param {boolean} [options.all]
 * @param {import('./groups.mjs').Member[]} [options.group]
 */
export async function planLenses({
  project,
  range,
  recipe,
  own,
  values,
  all = false,
  group,
}) {
  /** The changed files that match `paths`, git's `:(glob)` pathspecs. @param {string[]} paths */
  const touched = async (paths) => {
    try {
      const { stdout } = await run(
        'git',
        [
          '-C',
          project,
          'diff',
          '--name-only',
          range,
          '--',
          ...paths.map((one) => `:(glob)${one}`),
        ],
        { maxBuffer: 16 * 1024 * 1024 },
      )
      return stdout.split('\n').filter(Boolean)
    } catch (error) {
      throw new PlanRefusal(`git diff ${range} failed: ${firstWords(error)}`)
    }
  }
  const set = own
    ? undefined
    : await lensSet({
        project,
        recipe,
        disabled: new Set(values.disabledLenses),
        models: values.lensModels,
        ...(group && { members: group }),
      })
  const missing =
    set && group
      ? group.filter(
          (one) =>
            !set.some(
              (candidate) => candidate.scope === one.scope && candidate.name === one.name,
            ),
        )
      : []
  const problems = (set ?? []).flatMap((one) =>
    one.problem ? [{ name: one.name, scope: one.scope, problem: one.problem }] : [],
  )
  /** @type {LensSpec[]} */
  const inForce = set
    ? set.flatMap((one) => (one.runs && one.spec ? [one.spec] : []))
    : recipe
  const changed = await touched(['**'])
  // A lens turned off still holds its files: none goes to the otherwise lens.
  const holding = set
    ? set.flatMap((one) => (one.spec && !one.spec.otherwise ? [one.spec] : []))
    : recipe.filter((lens) => !lens.otherwise)
  const covered = new Set()
  /** @type {Map<LensSpec, number>} */
  const counted = new Map()
  for (const lens of holding) {
    const files = await touched(lens.paths)
    for (const file of files) covered.add(file)
    counted.set(lens, files.length)
  }
  const uncovered = changed.filter((file) => !covered.has(file))
  // One otherwise lens at most, as in a recipe: the first in precedence.
  const otherwise = inForce.find((lens) => lens.otherwise)
  /** @type {PlannedLens[]} */
  const applied = []
  /** @type {PlannedLens[]} */
  const others = []
  for (const lens of inForce) {
    const files = lens.otherwise
      ? lens === otherwise
        ? uncovered.length
        : 0
      : (counted.get(lens) ?? 0)
    const planned = {
      ...lens,
      ...(lens.otherwise && { paths: lens === otherwise ? uncovered : [] }),
      files,
    }
    if (files) applied.push(planned)
    else if (all) others.push(planned)
  }
  if (all && set) {
    const runs = new Set(inForce.map((lens) => lens.name))
    const seen = new Set()
    // Under a name, the first lens off in precedence: the one turning it on would run.
    for (const one of set) {
      if (one.on || !one.spec || runs.has(one.name) || seen.has(one.name)) continue
      seen.add(one.name)
      const lens = one.spec
      const files = lens.otherwise
        ? otherwise
          ? 0
          : uncovered.length
        : (counted.get(lens) ?? 0)
      others.push({
        ...lens,
        ...(lens.otherwise && { paths: otherwise ? [] : uncovered }),
        files,
        off: true,
      })
    }
  }
  return { changed, applied, others, inForce: inForce.length, problems, missing }
}
