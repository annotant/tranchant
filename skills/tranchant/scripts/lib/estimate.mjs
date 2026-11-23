// What a review waiting to start should spend, from the project's past
// reviews (Ready to start the review's Tokens fact and its rows' `~`). Per
// lens: the median of its reviewer's tokens per changed file it read over its
// last runs, times the files it reads now, plus its verifications' median
// times its median findings; plus the summary's median. No history file: the
// review folders the state keeps are the history, read bounded. A past
// folder is data a fix's agent could have written: one that cannot be read
// is left out, said once on stderr, never a failure of the page. The same
// scan gives Settings › Lenses each lens's average over its last reviews.
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { LENS_NAME, sumUsage, tokensOf } from './format.mjs'
import { pastAgents } from './usage.mjs'

/** @typedef {import('./format.mjs').Usage} Usage */
/**
 * What one past review spent on one lens: `reviewer` its reviewer's tokens,
 * none when one of its reviewer's runs reported no whole figure;
 * `verifications` one per finding whose verifiers all reported one;
 * `findings` the findings it sent to verification, whole or not;
 * `confirmed` those of its findings that stand confirmed (all that stand, in
 * a review not verified).
 * @typedef {{ hash: string, files?: number, reviewer?: number, verifications: number[], findings: number, confirmed: number }} PastLens
 */
/**
 * `complete`: its status says so; a review cut or still under way says
 * little of what a lens costs.
 * @typedef {{ id: string, createdAt: number, complete: boolean, recorded: boolean, summary?: number, lenses: Map<string, PastLens> }} PastReview
 */
/**
 * What `/api/review` answers as `estimate` while a review waits: `recorded`
 * whether a past review of the project recorded its tokens; `summary` the
 * summary agent's median, null with none; `lenses` only those with a past
 * run, `tokens` for the files they read now. `reviews`: the past reviews
 * (folder names) a figure comes from, so the page counts those of the
 * lenses on.
 * @typedef {{ tokens: number, reviews: string[] }} Part
 * @typedef {{ recorded: boolean, summary: Part | null, lenses: (Part & { name: string, perFile: number, runs: number })[] }} Estimate
 */

/**
 * A lens's average over its last reviews, as Settings › Lenses says it:
 * `tokens` its reviewer's and its verifications', `confirmed` its findings
 * that stood confirmed, a review; `runs` the reviews averaged.
 * @typedef {{ tokens: number, confirmed: number, runs: number }} LensHistory
 */

/** The most past reviews read: the last written. */
const SCANNED = 20
/** The runs of a lens its medians are taken over. */
const RUNS = 5
/** The reviews a lens's average in Settings is taken over. */
const AVERAGED = 10
/** The most findings of a past review read: a review lands a few dozen. */
const MAX_FINDINGS = 1000
/** A file past this size is not read: no review's file is that large. */
const MAX_FILE = 16 * 1024 * 1024
/** The most an estimate says, as readUsage caps a count. */
const MAX_TOKENS = 1e12

/** A past review's sums, by folder, kept while its review.json and run files stay the same. @type {Map<string, { stamp: string, past: PastReview | undefined }>} */
const cache = new Map()
/** What was said of unreadable folders: once each, not at every poll. */
const said = new Set()

/** Why a read failed, in a few words. @param {unknown} error */
const why = (error) => {
  const code = errorCode(error)
  if (typeof code === 'string') return code
  return error instanceof Error ? error.message : String(error)
}

/** @param {string} line */
function say(line) {
  if (said.has(line)) return
  said.add(line)
  console.error(`tranchant estimate: ${line}`)
}

/** The middle value, or the mean of the two middle ones; none of nothing. */
export function median(/** @type {number[]} */ values) {
  if (!values.length) return undefined
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/**
 * Agents' tokens summed, when every one of them reported a whole figure.
 * @param {{ usage?: Usage }[]} agents
 */
function whole(agents) {
  if (!agents.length || agents.some((one) => !one.usage || one.usage.partial))
    return undefined
  return tokensOf(sumUsage(agents.map((one) => one.usage)))
}

/**
 * A file's time and size, when it is a file small enough to read: a FIFO or a
 * device would hold the server's answer.
 * @param {string} file
 */
async function sizeOf(file) {
  const info = await stat(file)
  if (!info.isFile() || info.size > MAX_FILE)
    throw new Error('not a file, or larger than 16 MiB')
  return { at: info.mtimeMs, stamp: `${info.mtimeMs}:${info.size}` }
}

/** The files of a past review's folder `sub`, sorted; none when it has no such folder. */
async function filesOf(
  /** @type {string} */ dir,
  /** @type {string} */ sub,
  /** @type {string} */ ext,
) {
  const names = await readdir(path.join(dir, sub)).catch((error) => {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  })
  return names.filter((name) => name.endsWith(ext)).toSorted()
}

/**
 * The lens a finding came from: its own `lens`, else the longest lens name
 * its id starts with, as the page reads it.
 * @param {any} finding
 * @param {string[]} names
 */
function lensOfFinding(finding, names) {
  if (typeof finding.lens === 'string') return finding.lens
  let found
  for (const name of names)
    if (finding.id.startsWith(`${name}-`) && name.length > (found?.length ?? -1))
      found = name
  return found
}

/**
 * By lens, the findings of a past review that stand confirmed: a removed one
 * has no file left. One that cannot be read counts for none.
 * @param {string} dir
 * @param {string[]} names The review's lenses.
 * @param {boolean} verify Whether its findings were verified.
 */
async function confirmedOf(dir, names, verify) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  const files = (await filesOf(dir, 'findings', '.json')).slice(0, MAX_FINDINGS)
  for (const name of files) {
    const file = path.join(dir, 'findings', name)
    /** @type {any} */
    const finding = await sizeOf(file)
      .then(() => readFile(file, 'utf8'))
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    if (!finding || typeof finding !== 'object' || typeof finding.id !== 'string')
      continue
    if (verify && finding.verified !== true) continue
    const lens = lensOfFinding(finding, names)
    if (lens && names.includes(lens)) counts.set(lens, (counts.get(lens) ?? 0) + 1)
  }
  return counts
}

/**
 * One past review's sums, read from review.json, its run files' `end`
 * steps and its findings; undefined when it ran no lens, or its review.json is unsound.
 * @param {string} dir
 * @returns {Promise<PastReview | undefined>}
 */
async function readPast(dir) {
  /** @type {any} */
  const review = JSON.parse(await readFile(path.join(dir, 'review.json'), 'utf8'))
  const createdAt = Date.parse(review?.createdAt)
  if (
    !Number.isFinite(createdAt) ||
    !Array.isArray(review.lenses) ||
    !review.lenses.length
  )
    return undefined
  const agents = await pastAgents(dir)
  const names = review.lenses.flatMap((/** @type {any} */ one) =>
    typeof one?.name === 'string' && LENS_NAME.test(one.name) ? [one.name] : [],
  )
  const confirmed = await confirmedOf(dir, names, review.verify === true)
  const of = (/** @type {string} */ kind, /** @type {string} */ lens) =>
    agents.filter((one) => one.kind === kind && one.lens === lens)
  /** @type {Map<string, PastLens>} */
  const lenses = new Map()
  for (const lens of review.lenses) {
    if (
      typeof lens?.name !== 'string' ||
      !LENS_NAME.test(lens.name) ||
      typeof lens.hash !== 'string'
    )
      continue
    /** @type {Map<string, { usage?: Usage }[]>} */
    const byFinding = new Map()
    for (const one of of('verifiers', lens.name))
      if (one.finding)
        byFinding.set(one.finding, [...(byFinding.get(one.finding) ?? []), one])
    const reviewer = whole(of('reviewers', lens.name))
    lenses.set(lens.name, {
      hash: lens.hash,
      ...(Number.isSafeInteger(lens.files) && { files: lens.files }),
      ...(reviewer !== undefined && { reviewer }),
      verifications: [...byFinding.values()].flatMap((runs) => {
        const tokens = whole(runs)
        return tokens === undefined ? [] : [tokens]
      }),
      findings: byFinding.size,
      confirmed: confirmed.get(lens.name) ?? 0,
    })
  }
  const summary = whole(agents.filter((one) => one.kind === 'summary'))
  return {
    id: path.basename(dir),
    createdAt,
    complete: review.status === undefined || review.status === 'complete',
    recorded: agents.some((one) => one.usage),
    ...(summary !== undefined && { summary }),
    lenses,
  }
}

/**
 * One past review, from the cache while its files stay the same: a completed
 * review is read once.
 * @param {string} dir
 * @param {string} head review.json's stamp.
 */
async function pastReview(dir, head) {
  const runs = path.join(dir, 'reviewers')
  const files = await Promise.all(
    (await filesOf(dir, 'reviewers', '.jsonl')).map(
      async (name) => `${name}=${(await sizeOf(path.join(runs, name))).stamp}`,
    ),
  )
  // A verifier confirms a finding, or removes it, in its file: the sums change with it.
  const found = await Promise.all(
    (await filesOf(dir, 'findings', '.json')).slice(0, MAX_FINDINGS).map((name) =>
      sizeOf(path.join(dir, 'findings', name)).then(
        (info) => `findings/${name}=${info.stamp}`,
        () => `findings/${name}=?`,
      ),
    ),
  )
  const stamp = [head, ...files, ...found].join('\n')
  const kept = cache.get(dir)
  if (kept?.stamp === stamp) return kept.past
  try {
    const past = await readPast(dir)
    cache.set(dir, { stamp, past })
    return past
  } catch (error) {
    // Unsound as it stands: not read again until it changes.
    cache.set(dir, { stamp, past: undefined })
    throw error
  }
}

/**
 * The project's past reviews that ran lenses before `before`, the newest
 * first: at most SCANNED read, the last written.
 * @param {string} dir A review of the project, the one waiting to start for an estimate.
 * @param {number} before In ms: a past review was created before.
 * @param {boolean} [mine] Whether `dir` is one of them: never for its own estimate.
 */
async function pastReviews(dir, before, mine = false) {
  const root = path.dirname(dir)
  const names = await readdir(root).catch((error) => {
    say(`${root}: ${why(error)}, no past review read`)
    return []
  })
  const stamped = await Promise.all(
    names
      .map((name) => path.join(root, name))
      .filter((one) => mine || one !== dir)
      .map((one) =>
        sizeOf(path.join(one, 'review.json')).then(
          (info) => ({ dir: one, ...info }),
          (error) => {
            const code = errorCode(error)
            if (code !== 'ENOENT' && code !== 'ENOTDIR')
              say(`${one}: ${why(error)}, left out`)
            return undefined
          },
        ),
      ),
  )
  const newest = stamped
    .flatMap((one) => (one ? [one] : []))
    .toSorted((a, b) => b.at - a.at)
    .slice(0, SCANNED)
  const kept = new Set(newest.map((one) => one.dir))
  for (const one of cache.keys())
    if (path.dirname(one) === root && !kept.has(one)) cache.delete(one)
  const read = await Promise.all(
    newest.map((one) =>
      pastReview(one.dir, one.stamp).catch((error) => {
        say(`${one.dir}: ${why(error)}, left out`)
        return undefined
      }),
    ),
  )
  return read
    .flatMap((one) => (one && one.createdAt < before ? [one] : []))
    .toSorted((a, b) => b.createdAt - a.createdAt)
}

/**
 * A lens's last runs that count, the newest first: the same prompt as now
 * (its hash; unknown, its last run's), its reviewer whole, and on at least one
 * file.
 * @param {PastReview[]} past
 * @param {string} name
 * @param {string | undefined} hash
 */
function runsOf(past, name, hash) {
  /** @type {{ review: PastReview, lens: PastLens & { files: number, reviewer: number } }[]} */
  const runs = []
  let prompt = hash
  for (const review of past) {
    const lens = review.lenses.get(name)
    if (!lens) continue
    prompt ??= lens.hash
    // Its prompt changed: what ran before says nothing of what runs now, back to it or not.
    if (lens.hash !== prompt) break
    const { files, reviewer } = lens
    if (!files || files < 1 || reviewer === undefined) continue
    runs.push({ review, lens: { ...lens, files, reviewer } })
    if (runs.length === RUNS) break
  }
  return runs
}

const capped = (/** @type {number} */ tokens) => Math.min(Math.round(tokens), MAX_TOKENS)

/**
 * The estimate of a review waiting to start, for each of its lenses that
 * reads a changed file, on or off: the page sums those its switches turn on.
 * @param {string} dir The review's folder.
 * @param {{ name: string, files?: number, hash?: string }[]} rows lenses.json's rows.
 * @param {string} createdAt The review's: what was created after is not its past.
 * @returns {Promise<Estimate>}
 */
export async function estimateOf(dir, rows, createdAt) {
  const before = Date.parse(createdAt)
  const past = await pastReviews(dir, Number.isFinite(before) ? before : Infinity)
  if (!past.some((one) => one.recorded))
    return { recorded: false, summary: null, lenses: [] }
  const summaries = past.filter((one) => one.summary !== undefined).slice(0, RUNS)
  const summary = median(summaries.map((one) => one.summary ?? 0))
  /** @type {Estimate['lenses']} */
  const lenses = []
  for (const row of rows) {
    const files = row.files ?? 0
    if (!Number.isSafeInteger(files) || files < 1 || !LENS_NAME.test(row.name)) continue
    const runs = runsOf(past, row.name, row.hash)
    if (!runs.length) continue
    const perFile = median(runs.map((run) => run.lens.reviewer / run.lens.files)) ?? 0
    const verification = median(runs.flatMap((run) => run.lens.verifications)) ?? 0
    const findings = median(runs.map((run) => run.lens.findings)) ?? 0
    lenses.push({
      name: row.name,
      tokens: capped(perFile * files + verification * findings),
      perFile: capped(perFile),
      runs: runs.length,
      reviews: runs.map((run) => run.review.id),
    })
  }
  return {
    recorded: true,
    summary:
      summary === undefined
        ? null
        : { tokens: capped(summary), reviews: summaries.map((one) => one.id) },
    lenses,
  }
}

/**
 * A lens's average over its last AVERAGED complete reviews with the same
 * prompt (its hash; unknown, its last run's), its reviewer and every
 * verification whole; null with none.
 * @param {PastReview[]} past
 * @param {string} name
 * @param {string | undefined} hash
 * @returns {LensHistory | null}
 */
function averageOf(past, name, hash) {
  /** @type {{ tokens: number, confirmed: number }[]} */
  const runs = []
  let prompt = hash
  for (const review of past) {
    const lens = review.lenses.get(name)
    if (!lens || !review.complete) continue
    prompt ??= lens.hash
    // The same rule as the estimate's: a prompt changed starts its history over.
    if (lens.hash !== prompt) break
    if (lens.reviewer === undefined || lens.verifications.length !== lens.findings)
      continue
    runs.push({
      tokens: lens.reviewer + lens.verifications.reduce((sum, one) => sum + one, 0),
      confirmed: lens.confirmed,
    })
    if (runs.length === AVERAGED) break
  }
  if (!runs.length) return null
  const mean = (/** @type {'tokens' | 'confirmed'} */ key) =>
    runs.reduce((sum, one) => sum + one[key], 0) / runs.length
  return {
    tokens: capped(mean('tokens')),
    confirmed: Math.round(mean('confirmed') * 10) / 10,
    runs: runs.length,
  }
}

/**
 * Each lens's average in the project's reviews, in `lenses`' order: Settings
 * › Lenses. The review the page serves counts once it is complete.
 * @param {string} dir A review of the project: its folder's siblings are the others.
 * @param {{ name: string, hash?: string }[]} lenses
 * @returns {Promise<(LensHistory | null)[]>}
 */
export async function lensHistories(dir, lenses) {
  const past = await pastReviews(dir, Infinity, true)
  return lenses.map((one) =>
    LENS_NAME.test(one.name) ? averageOf(past, one.name, one.hash) : null,
  )
}
