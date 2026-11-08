import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'
import {
  AGENT_ENDED_REASON,
  DECISIONS_VERSION,
  FormatError,
  MOVES,
  canMove,
  contentOf,
  currentRun,
  nextRunId,
  oneLine,
  parseDecisions,
  postBlocker,
  problemsText,
  stateWords,
  statusOf,
  validateEnvelope,
  validateFinding,
} from './format.mjs'

/** @typedef {import('./format.mjs').Actor} Actor */
/** @typedef {import('./format.mjs').Decisions} Decisions */
/** @typedef {import('./format.mjs').Entry} Entry */
/** @typedef {import('./format.mjs').Finding} Finding */
/** @typedef {import('./format.mjs').Move} Move */
/** @typedef {import('./format.mjs').Option} Option */
/** @typedef {import('./format.mjs').Review} Review */
/** @typedef {import('./format.mjs').Run} Run */
/** @typedef {import('./format.mjs').State} State */
/** @typedef {import('./format.mjs').Step} Step */

/** The most options a question may offer the reviewer. */
export const MAX_OPTIONS = 6
/** The most steps of a run in progress the review lists. */
const PROGRESS_SHOWN = 50
const MAX_SUMMARY = 2000
/** What summarize.mjs takes: a Change Map and a few sentences, a few strengths. */
const MAX_REVIEW_SUMMARY = 12_000
const MAX_STRENGTHS = 10
const MAX_STRENGTH = 500
const MAX_TEXT = 4000
/** An issue's title and body: GitLab caps a title at 255 characters, GitHub a body at 65,536. */
export const MAX_ISSUE_TITLE = 255
export const MAX_ISSUE_BODY = 60_000
/** A model id is short (`claude-opus-5-5`): the hooks' value, kept bounded. */
const MAX_MODEL = 100
export const WRITE_KINDS = new Set(['edit', 'write', 'multiedit'])
// What the agent says and thinks accompanies its steps; it is not one.
const NARRATION_KINDS = new Set(['note', 'thinking', 'message'])

/** A refusal a script reports and exits on, with nothing written. */
export class StoreRefusal extends Error {}

/** @param {State} state */
const isWorking = (state) => state === 'working'

/** The step file of finding `id`'s run in progress. */
export const progressPath = (/** @type {string} */ dir, /** @type {string} */ id) =>
  path.join(dir, 'runs', `${id}.jsonl`)
/** Every step of the runs of finding `id` that ended. */
export const historyPath = (/** @type {string} */ dir, /** @type {string} */ id) =>
  path.join(dir, 'runs', `${id}.history.jsonl`)
/** The file of finding `id`: one per finding, under `findings/`. */
export const findingPath = (/** @type {string} */ dir, /** @type {string} */ id) =>
  path.join(dir, 'findings', `${id}.json`)

/** The files of `findings/` that hold a finding: `<id>.json`, nothing else. */
const FINDING_FILE = /^([\w-]{1,64})\.json$/
/** The run file of a review agent: `reviewers/<name>.jsonl`. */
const AGENT_FILE = /^([\w-]{1,80})\.jsonl$/

/** The run file of review agent `name`. */
export const reviewAgentPath = (/** @type {string} */ dir, /** @type {string} */ name) =>
  path.join(dir, 'reviewers', `${name}.jsonl`)

/** Oldest first; two added the same millisecond by id. @type {(a: Finding, b: Finding) => number} */
const byArrival = (a, b) =>
  (a.addedAt ?? '').localeCompare(b.addedAt ?? '') || a.id.localeCompare(b.id)

/**
 * The steps of a run file, oldest first. A tool writes one line when it
 * starts and one when it ends or fails, both with its tool_use_id: they merge
 * into one step, where it started. Sorted by time.
 * @param {string} file
 * @param {number} [limit] The last ones.
 * @returns {Promise<Step[]>}
 */
async function readSteps(file, limit) {
  let lines
  try {
    lines = (await readFile(file, 'utf8')).trim().split('\n')
  } catch {
    return []
  }
  /** @type {Step[]} */
  const steps = []
  const byTool = new Map()
  for (const line of lines) {
    let step
    try {
      step = JSON.parse(line)
    } catch {
      continue
    }
    const started = step.id ? byTool.get(step.id) : undefined
    if (started) {
      Object.assign(started, step, { at: started.at })
    } else {
      steps.push(step)
      if (step.id) byTool.set(step.id, step)
    }
  }
  // By time: the hooks module writes what the agent says while hook.mjs
  // writes its tools, and either may land first.
  steps.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  return limit ? steps.slice(-limit) : steps
}

/**
 * The finding's steps, oldest first: those of its run in progress, or with
 * `history`, of every run that ended.
 * @param {string} dir The review folder.
 * @param {string} id
 * @param {number} [limit] The last ones.
 * @param {{ history?: boolean }} [options]
 * @returns {Promise<Step[]>}
 */
export const readProgress = (dir, id, limit, { history = false } = {}) =>
  readSteps(history ? historyPath(dir, id) : progressPath(dir, id), limit)

/**
 * One review agent, the summary agent (`sm-summary`), a lens's reviewer
 * (`rv-<lens>`) or a finding's verifier (`vf-<id>`), as its run file tells it: running until its `end` step.
 * @typedef {{ name: string, running: boolean, outcome?: 'done' | 'failed', steps: Step[] }} ReviewAgent
 */

/**
 * The review agents of the review, in the order they started.
 * @param {string} dir The review folder.
 * @param {number} [limit] The last steps of each.
 * @returns {Promise<ReviewAgent[]>}
 */
export async function readReviewAgents(dir, limit = PROGRESS_SHOWN) {
  const names = await readdir(path.join(dir, 'reviewers')).catch(() => [])
  /** @type {(ReviewAgent & { since: number })[]} */
  const agents = []
  for (const file of names) {
    const name = AGENT_FILE.exec(file)?.[1]
    if (!name) continue
    const all = await readSteps(reviewAgentPath(dir, name))
    const end = all.findLast((step) => step.kind === 'end')
    agents.push({
      name,
      since: all[0]?.at ?? 0,
      running: !end,
      ...(end && { outcome: end.state === 'failed' ? 'failed' : 'done' }),
      steps: all.slice(-limit),
    })
  }
  return agents
    .toSorted((a, b) => a.since - b.since || a.name.localeCompare(b.name))
    .map(({ since: _since, ...agent }) => agent)
}

/**
 * The files the steps wrote: a failed write changed nothing; one cut short
 * by a stop may have.
 * @param {Step[]} steps
 */
const changedFiles = (steps) => [
  ...new Set(
    steps
      .filter((step) => WRITE_KINDS.has(step.kind) && step.state !== 'failed')
      .map((step) => step.label),
  ),
]

/**
 * Moves `entry` by `move`, or refuses a move the table of format.mjs
 * forbids: logs the event. Every state change goes through it.
 * @param {string} id
 * @param {Entry} entry
 * @param {Move} move
 * @param {{ by: Actor, run?: string, agent?: string }} how
 * @returns {string} When it moved.
 */
function apply(id, entry, move, { by, run, agent }) {
  if (!canMove(move, entry.state)) {
    throw new StoreRefusal(`${move} refused: finding ${id} is ${stateWords(entry.state)}`)
  }
  const at = new Date().toISOString()
  const { to } = MOVES[move]
  entry.events.push({
    at,
    state: to,
    by,
    ...(run ? { run } : {}),
    ...(agent ? { agent } : {}),
  })
  entry.state = to
  return at
}

/**
 * The store of one review's decisions: `decisions.json` and the run files
 * next to it. Every move of a finding goes through it; a refused one writes
 * nothing.
 * @param {string} dir The review folder, as open.mjs printed it.
 */
export function createStore(dir) {
  const reviewFile = path.join(dir, 'review.json')
  const decisionsFile = path.join(dir, 'decisions.json')
  const runsDir = path.join(dir, 'runs')
  const findingsDir = path.join(dir, 'findings')
  /** The finding files found unsound, each said once on stderr. @type {Set<string>} */
  const warned = new Set()

  /**
   * The review's envelope, as review.json holds it: its findings, if any
   * are still inline, left as they are.
   * @returns {Promise<Review>}
   */
  async function readEnvelope() {
    let text
    try {
      text = await readFile(reviewFile, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT')
        throw new StoreRefusal(`no review.json in ${dir}`)
      throw error
    }
    let envelope
    try {
      envelope = JSON.parse(text)
    } catch {
      throw new StoreRefusal(`${reviewFile} is not JSON`)
    }
    const problems = validateEnvelope(envelope)
    if (problems.length) throw new StoreRefusal(problemsText(problems))
    return envelope
  }

  /**
   * `value` when it is a sound finding, named `id` when its file names one;
   * else undefined, said once on stderr: one unsound file never takes the
   * page down.
   * @param {any} value
   * @param {boolean} theirs
   * @param {string} where
   * @param {string} [id]
   * @returns {Finding | undefined}
   */
  function soundFinding(value, theirs, where, id) {
    const problems = validateFinding(value, { theirs, where })
    const sound = problems.length === 0 ? value : undefined
    if (sound && (id === undefined || sound.id === id)) return sound
    const why = sound
      ? `${where}: its id is ${sound.id}, not ${id}`
      : problemsText(problems)
    if (!warned.has(why)) {
      warned.add(why)
      console.error(`tranchant: ${why}; the finding is left out`)
    }
    return undefined
  }

  /**
   * The findings of `findings/`, oldest first; those still inline in
   * review.json when the folder holds none (imported before it existed).
   * @param {Review} envelope
   * @returns {Promise<Finding[]>}
   */
  async function readFindings(envelope) {
    const theirs = envelope.ownership === 'theirs'
    const names = await readdir(findingsDir).catch(() => [])
    /** @type {Finding[]} */
    const found = []
    for (const name of names) {
      const id = FINDING_FILE.exec(name)?.[1]
      if (!id) continue
      const file = path.join(findingsDir, name)
      let value
      try {
        value = JSON.parse(await readFile(file, 'utf8'))
      } catch (error) {
        const why = `findings/${name}: ${error instanceof Error ? error.message : String(error)}`
        if (!warned.has(why)) {
          warned.add(why)
          console.error(`tranchant: ${why}; the finding is left out`)
        }
        continue
      }
      const finding = soundFinding(value, theirs, `findings/${name}`, id)
      if (finding) found.push(finding)
    }
    if (found.length || !Array.isArray(envelope.findings))
      return found.toSorted(byArrival)
    return envelope.findings.flatMap((finding, i) => {
      const sound = soundFinding(finding, theirs, `review.json findings[${i}]`)
      return sound ? [sound] : []
    })
  }

  /**
   * The review as it stands: its envelope, and its findings in the order they
   * were added. Read anew each time: a review grows while its producer runs.
   * @returns {Promise<Review>}
   */
  async function readReview() {
    const envelope = await readEnvelope()
    return { ...envelope, findings: await readFindings(envelope) }
  }

  // Written to a temp file first, like the decisions: the server reads the folder on every change.
  /** @param {Finding} finding */
  async function writeFinding(finding) {
    await mkdir(findingsDir, { recursive: true })
    const target = findingPath(dir, finding.id)
    const temp = path.join(findingsDir, `.${finding.id}.${process.pid}.tmp`)
    await writeFile(temp, `${JSON.stringify(finding, null, 2)}\n`)
    await rename(temp, target)
  }

  /** @param {Review} envelope */
  async function writeEnvelope(envelope) {
    const temp = `${reviewFile}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(envelope, null, 2)}\n`)
    await rename(temp, reviewFile)
  }

  /**
   * The decisions; none yet is an empty file. One in another format is
   * refused, and left untouched.
   * @returns {Promise<Decisions>}
   */
  async function readDecisions() {
    let text
    try {
      text = await readFile(decisionsFile, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT')
        return { version: DECISIONS_VERSION, findings: {} }
      throw error
    }
    try {
      return parseDecisions(text, decisionsFile)
    } catch (error) {
      if (error instanceof FormatError) throw new StoreRefusal(error.message)
      throw error
    }
  }

  // Written to a temp file first: the server and the agents' scripts read it concurrently.
  /** @param {Decisions} decisions */
  async function writeDecisions(decisions) {
    await mkdir(dir, { recursive: true })
    const temp = `${decisionsFile}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(decisions, null, 2)}\n`)
    await rename(temp, decisionsFile)
  }

  /** @type {Promise<unknown>} */
  let queue = Promise.resolve()

  /**
   * Runs `task` after the previous one, so reads and writes never interleave.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  const serialise = (task) => {
    const next = queue.then(task, task)
    queue = next.catch(() => undefined)
    return next
  }

  /**
   * A read-modify-write: in order within this process, and under the file
   * lock against the others.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  const exclusive = (task) => serialise(() => withFileLock(decisionsFile, task))

  /**
   * Runs `change` on finding `id`'s entry, under the lock, and writes the
   * result. Throwing a StoreRefusal from it writes nothing.
   * @template T
   * @param {string} id
   * @param {(entry: Entry, finding: Finding, review: Review) => Promise<T> | T} change
   * @returns {Promise<T>}
   */
  const changeOne = (id, change) =>
    exclusive(async () => {
      const known = await readReview()
      const finding = known.findings.find((one) => one.id === id)
      if (!finding) throw new StoreRefusal(`no finding ${id} in the review`)
      const decisions = await readDecisions()
      const entry = (decisions.findings[id] ??= { state: 'open', runs: [], events: [] })
      const result = await change(entry, finding, known)
      await writeDecisions(decisions)
      return result
    })

  /**
   * Moves the run's steps to the finding's history, each tagged with `run`
   * when the hooks did not tag it, and drops the run file.
   * @param {string} id
   * @param {string} [run]
   */
  async function endRun(id, run) {
    const lines = (await readFile(progressPath(dir, id), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const step = JSON.parse(line)
          return [`${JSON.stringify(run && !step.run ? { ...step, run } : step)}\n`]
        } catch {
          return []
        }
      })
    if (lines.length) {
      await mkdir(runsDir, { recursive: true })
      await appendFile(historyPath(dir, id), lines.join(''))
    }
    await rm(progressPath(dir, id), { force: true })
  }

  /**
   * Ends the run in progress of `entry` with `outcome`, and files its steps.
   * @param {string} id
   * @param {Entry} entry
   * @param {Run | undefined} run
   * @param {Run['outcome']} outcome
   * @param {string} at
   * @param {Partial<Run>} [more]
   */
  async function finishRun(id, entry, run, outcome, at, more = {}) {
    if (run) Object.assign(run, { endedAt: at, outcome }, more)
    await endRun(id, run?.id)
  }

  /**
   * @param {string} id
   * @param {string} at When the reviewer stopped it: the `stopped` event's time.
   * @param {string} [run]
   * @returns {Promise<import('./format.mjs').Cancellation>}
   */
  async function cancellationOf(id, at, run) {
    const steps = await readProgress(dir, id)
    return {
      at,
      changed: changedFiles(steps),
      steps: steps.filter((step) => !NARRATION_KINDS.has(step.kind)).length,
      ...(run ? { run } : {}),
    }
  }

  /**
   * Refuses `what` on finding `id` once the person moved it from `open`.
   * @param {string} id
   * @param {string} what
   */
  async function refuseDecided(id, what) {
    const state = (await readDecisions()).findings[id]?.state ?? 'open'
    if (state !== 'open') {
      throw new StoreRefusal(`${what} refused: finding ${id} is ${stateWords(state)}`)
    }
  }

  return {
    readReview,
    readDecisions,
    writeFinding,

    /** The review and its decisions, as the page reads them. */
    async readAll() {
      return { review: await readReview(), decisions: await readDecisions() }
    },

    /**
     * A producer adds a finding to the review: `findings/<id>.json`, stamped
     * with the time it landed. The same finding again changes nothing;
     * another one under the same id is refused, as is any finding once the
     * review is complete. Under review.json's lock: producers run in parallel.
     * @param {any} finding
     * @returns {Promise<{ id: string, added: boolean }>} `added`: false when it was there already.
     */
    addFinding(finding) {
      return withFileLock(reviewFile, async () => {
        const review = await readReview()
        const problems = validateFinding(finding, {
          theirs: review.ownership === 'theirs',
        })
        if (problems.length) throw new StoreRefusal(problemsText(problems))
        const known = review.findings.find((one) => one.id === finding.id)
        if (known) {
          if (contentOf(known) !== contentOf(finding)) {
            throw new StoreRefusal(`finding ${finding.id} exists with other content`)
          }
          return { id: finding.id, added: false }
        }
        if (statusOf(review) === 'complete') {
          throw new StoreRefusal('the review is complete: nothing can be added')
        }
        // Only a verifier verifies: a finding lands unverified, whatever it says.
        const { verified: _verified, ...landed } = finding
        await writeFinding({ ...landed, addedAt: new Date().toISOString() })
        return { id: finding.id, added: true }
      })
    },

    /**
     * The review's summary and strengths, replacing the previous ones, while
     * the review is `reviewing`: the page shows them as soon as they land.
     * @param {any} given `{ summary, strengths }`
     * @returns {Promise<void>}
     */
    summarize(given) {
      const summary = typeof given?.summary === 'string' ? given.summary.trim() : ''
      if (!summary) throw new StoreRefusal('summary: a Markdown text is required')
      if (summary.length > MAX_REVIEW_SUMMARY)
        throw new StoreRefusal(`summary: ${MAX_REVIEW_SUMMARY} characters at most`)
      const strengths = given.strengths ?? []
      if (
        !Array.isArray(strengths) ||
        strengths.some((one) => typeof one !== 'string' || !one.trim())
      )
        throw new StoreRefusal('strengths: an array of texts is required')
      if (strengths.length > MAX_STRENGTHS)
        throw new StoreRefusal(`strengths: ${MAX_STRENGTHS} at most`)
      if (strengths.some((one) => one.trim().length > MAX_STRENGTH))
        throw new StoreRefusal(`strengths: ${MAX_STRENGTH} characters each at most`)
      return withFileLock(reviewFile, async () => {
        const envelope = await readEnvelope()
        if (statusOf(envelope) === 'complete') {
          throw new StoreRefusal('the review is complete: its summary stays')
        }
        await writeEnvelope({
          ...envelope,
          summary,
          strengths: strengths.map((one) => one.trim()),
        })
      })
    },

    /**
     * The producer is done: `status` becomes `complete`, and the page's
     * in-progress indicator goes. Refused once it is.
     * @returns {Promise<void>}
     */
    complete() {
      return withFileLock(reviewFile, async () => {
        const envelope = await readEnvelope()
        if (statusOf(envelope) === 'complete') {
          throw new StoreRefusal('the review is complete already')
        }
        await writeEnvelope({ ...envelope, status: 'complete' })
      })
    },

    /**
     * A verifier confirms finding `id` (`verified: true`), or replaces it with
     * `amended`, the same id, confirmed. Amending is refused once the person
     * decided on it.
     * @param {string} id
     * @param {any} [amended]
     * @returns {Promise<void>}
     */
    verify(id, amended) {
      return withFileLock(reviewFile, async () => {
        const review = await readReview()
        const known = review.findings.find((one) => one.id === id)
        if (!known) throw new StoreRefusal(`no finding ${id} in the review`)
        if (amended === undefined) {
          await writeFinding({ ...known, verified: true })
          return
        }
        if (amended?.id !== id) {
          throw new StoreRefusal(`the amended finding's id is not ${id}`)
        }
        const problems = validateFinding(amended, {
          theirs: review.ownership === 'theirs',
        })
        if (problems.length) throw new StoreRefusal(problemsText(problems))
        // Under the decisions' lock: no decision lands between the check and the write.
        await exclusive(async () => {
          await refuseDecided(id, 'amend')
          await writeFinding({ ...amended, addedAt: known.addedAt, verified: true })
        })
      })
    },

    /**
     * A verifier removes finding `id`: wrong, or a duplicate of one that landed
     * before it. Refused once the person decided on it, or while it is inline
     * in review.json.
     * @param {string} id
     * @returns {Promise<void>}
     */
    remove(id) {
      return withFileLock(reviewFile, async () => {
        const review = await readReview()
        if (!review.findings.some((one) => one.id === id)) {
          throw new StoreRefusal(`no finding ${id} in the review`)
        }
        if (!existsSync(findingPath(dir, id))) {
          throw new StoreRefusal(`finding ${id} is inline in review.json: it stays`)
        }
        await exclusive(async () => {
          await refuseDecided(id, 'remove')
          await rm(findingPath(dir, id), { force: true })
        })
      })
    },

    /**
     * The last `limit` steps of each run in progress, by finding id.
     * @param {number} [limit]
     * @returns {Promise<Record<string, Step[]>>}
     */
    async runs(limit = PROGRESS_SHOWN) {
      const decisions = await readDecisions()
      /** @type {Record<string, Step[]>} */
      const runs = {}
      for (const [id, entry] of Object.entries(decisions.findings)) {
        if (!isWorking(entry.state)) continue
        const steps = await readProgress(dir, id, limit)
        if (steps.length) runs[id] = steps
      }
      return runs
    },

    /**
     * The reviewer's decision on a finding: a fix (with the `context` the
     * agent follows), a post (with the `comment` as they edited it), an issue
     * (with its `title` and `body`), a drop (with their `reason`) or a skip. A
     * post needs the MR's `diffRefs` at the commit reviewed, whatever the
     * ownership; a question is answered with `answer`, not decided again.
     * @param {string} id
     * @param {{ action: 'fix' | 'post' | 'issue' | 'drop' | 'skip', context?: string, comment?: string, reason?: string, title?: string, body?: string }} decision
     * @returns {Promise<Entry>}
     */
    decide(id, { action, context, comment, reason, title, body }) {
      return changeOne(id, (entry, finding, known) => {
        if (action === 'post') {
          const blocker = postBlocker(known)
          if (blocker) throw new StoreRefusal(`post refused: ${blocker}`)
          if (!comment?.trim() && !finding.comment) {
            throw new StoreRefusal(`post refused: finding ${id} has no comment`)
          }
        }
        if (action === 'issue' && (!title?.trim() || !body?.trim())) {
          throw new StoreRefusal(`issue refused: finding ${id} needs a title and a body`)
        }
        const at = apply(id, entry, action, { by: 'reviewer' })
        entry.decision = {
          action,
          ...(action === 'fix' && context?.trim()
            ? { context: context.trim().slice(0, MAX_TEXT) }
            : {}),
          at,
        }
        delete entry.reason
        if (action === 'post') {
          if (comment?.trim()) entry.comment = comment.trim().slice(0, MAX_TEXT)
          else delete entry.comment
        }
        if (action === 'issue') {
          entry.issue = {
            title: oneLine(title?.trim() ?? '').slice(0, MAX_ISSUE_TITLE),
            body: (body?.trim() ?? '').slice(0, MAX_ISSUE_BODY),
          }
        } else delete entry.issue
        if (action === 'drop' && reason?.trim())
          entry.reason = reason.trim().slice(0, MAX_TEXT)
        return entry
      })
    },

    /**
     * The reviewer's answer to the agent's question: the options they chose,
     * from the ones it offered, and their own words. The finding queues again
     * for a new run, which reads the answer.
     * @param {string} id
     * @param {{ text?: string, choices?: string[] }} answer
     * @returns {Promise<Entry>}
     */
    answer(id, { text = '', choices = [] }) {
      return changeOne(id, (entry) => {
        if (entry.state !== 'asking') {
          throw new StoreRefusal(
            `answer refused: finding ${id} is ${stateWords(entry.state)}`,
          )
        }
        const offered = entry.question?.options?.map((option) => option.label) ?? []
        const valid = offered.filter((label) => choices.includes(label))
        const chosen = entry.question?.multiple ? valid : valid.slice(0, 1)
        const words = text.trim().slice(0, MAX_TEXT)
        if (!words && !chosen.length)
          throw new StoreRefusal('answer refused: it is empty')
        const at = apply(id, entry, 'answer', { by: 'reviewer' })
        entry.answer = { text: words, ...(chosen.length ? { choices: chosen } : {}), at }
        delete entry.reason
        return entry
      })
    },

    /**
     * The reviewer stops the finding: its agent ends, and `cancellation`
     * lists what the run left changed.
     * @param {string} id
     * @returns {Promise<Entry>}
     */
    stop(id) {
      return changeOne(id, async (entry) => {
        const run = currentRun(entry)
        const at = apply(id, entry, 'stop', { by: 'reviewer', run: run?.id })
        entry.cancellation = await cancellationOf(id, at, run?.id)
        await finishRun(id, entry, run, 'stopped', at)
        return entry
      })
    },

    /**
     * An agent starts working on the finding: a new run, which records the
     * agent's id and the model it runs on when the hooks gave them. Claimed
     * again by the same agent while working, it stays in the run it is in.
     * @param {string} id
     * @param {{ agent?: string, model?: string }} [options]
     * @returns {Promise<{ entry: Entry, finding: Finding, run: Run }>}
     */
    claim(id, { agent, model } = {}) {
      return changeOne(id, (entry, finding) => {
        const working = currentRun(entry)
        const action = entry.decision?.action
        if (entry.state === 'queued' && (action === 'post' || action === 'issue')) {
          throw new StoreRefusal(
            `claim refused: finding ${id} is queued for ${action === 'post' ? 'a post' : 'an issue'}`,
          )
        }
        if (working && (!agent || !working.agent || working.agent === agent)) {
          return { entry, finding, run: working }
        }
        const at = apply(id, entry, 'claim', {
          by: 'agent',
          run: nextRunId(entry),
          agent,
        })
        /** @type {Run} */
        const run = {
          id: nextRunId(entry),
          ...(agent ? { agent } : {}),
          ...(model ? { model: model.slice(0, MAX_MODEL) } : {}),
          startedAt: at,
        }
        entry.runs.push(run)
        return { entry, finding, run }
      })
    },

    /**
     * The agent finished: the working tree holds the fix. The run records the
     * agent's summary and the files its steps wrote.
     * @param {string} id
     * @param {string} summary
     * @returns {Promise<Entry>}
     */
    done(id, summary) {
      return changeOne(id, async (entry) => {
        const run = currentRun(entry)
        const at = apply(id, entry, 'done', {
          by: 'agent',
          run: run?.id,
          agent: run?.agent,
        })
        const changed = changedFiles(await readProgress(dir, id))
        await finishRun(id, entry, run, 'fixed', at, {
          summary: summary.trim().slice(0, MAX_SUMMARY),
          changed,
        })
        return entry
      })
    },

    /**
     * The agent asks the reviewer something and stops; their answer starts a
     * new run. A question may offer `options`, the reviewer picking one, or
     * several when `multiple`; they can always answer in their own words.
     * @param {string} id
     * @param {{ text: string, options?: Option[], multiple?: boolean }} question
     * @returns {Promise<Entry>}
     */
    ask(id, { text, options, multiple = false }) {
      return changeOne(id, async (entry) => {
        const run = currentRun(entry)
        const at = apply(id, entry, 'ask', {
          by: 'agent',
          run: run?.id,
          agent: run?.agent,
        })
        entry.question = {
          text: text.trim().slice(0, MAX_TEXT),
          ...(options?.length ? { options: options.slice(0, MAX_OPTIONS) } : {}),
          ...(options?.length && multiple ? { multiple: true } : {}),
          at,
        }
        delete entry.answer
        await finishRun(id, entry, run, 'asking', at)
        return entry
      })
    },

    /**
     * The comment is on the MR.
     * @param {string} id
     * @param {{ discussionId: string, url: string }} where
     * @returns {Promise<Entry>}
     */
    posted(id, { discussionId, url }) {
      return changeOne(id, (entry) => {
        const at = apply(id, entry, 'posted', { by: 'server' })
        entry.posted = { discussionId, url, at }
        delete entry.reason
        return entry
      })
    },

    /**
     * The issue is created: the finding is settled there.
     * @param {string} id
     * @param {{ url: string, ref?: string }} where
     * @returns {Promise<Entry>}
     */
    moved(id, { url, ref }) {
      return changeOne(id, (entry) => {
        const issue = entry.issue
        if (!issue) throw new StoreRefusal(`moved refused: finding ${id} has no issue`)
        const at = apply(id, entry, 'moved', { by: 'server' })
        entry.issue = { ...issue, url, ...(ref ? { ref } : {}), at }
        delete entry.reason
        return entry
      })
    },

    /**
     * The fix, the post or the issue failed: `reason` says why, and the run, if any, ends.
     * @param {string} id
     * @param {string} reason
     * @param {{ by?: Actor }} [options]
     * @returns {Promise<Entry>}
     */
    fail(id, reason, { by = 'server' } = {}) {
      return changeOne(id, async (entry) => {
        const run = currentRun(entry)
        const at = apply(id, entry, 'fail', { by, run: run?.id, agent: run?.agent })
        entry.reason = reason.trim().slice(0, MAX_TEXT)
        await finishRun(id, entry, run, 'failed', at)
        return entry
      })
    },

    /**
     * The finding's agent ended its turn with the finding still `working`,
     * neither done nor asked about: it fails, so the reviewer can send it
     * again. Only the run `agent` claimed, or one that names no agent.
     * @param {string} id
     * @param {string} agent
     * @returns {Promise<Entry | undefined>} The entry, when it failed.
     */
    abandon(id, agent) {
      return changeOne(id, async (entry) => {
        const run = currentRun(entry)
        if (!run || (run.agent && agent && run.agent !== agent)) return undefined
        const at = apply(id, entry, 'fail', {
          by: 'agent',
          run: run.id,
          agent: run.agent,
        })
        entry.reason = AGENT_ENDED_REASON
        await finishRun(id, entry, run, 'failed', at)
        return entry
      })
    },
  }
}
