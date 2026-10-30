import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'
import {
  AGENT_ENDED_REASON,
  DECISIONS_VERSION,
  FormatError,
  MOVES,
  canMove,
  currentRun,
  nextRunId,
  parseDecisions,
  parseReview,
  stateWords,
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
const MAX_TEXT = 4000
/** A model id is short (`claude-opus-5-5`): the hooks' value, kept bounded. */
const MAX_MODEL = 100
const WRITE_KINDS = new Set(['edit', 'write', 'multiedit'])
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

/**
 * The finding's steps, oldest first: those of its run in progress, or with
 * `history`, of every run that ended. A tool writes one line when it starts
 * and one when it ends or fails, both with its tool_use_id: they merge into
 * one step, where it started. Sorted by time.
 * @param {string} dir The review folder.
 * @param {string} id
 * @param {number} [limit] The last ones.
 * @param {{ history?: boolean }} [options]
 * @returns {Promise<Step[]>}
 */
export async function readProgress(dir, id, limit, { history = false } = {}) {
  let lines
  try {
    const file = history ? historyPath(dir, id) : progressPath(dir, id)
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
  /** @type {Review | undefined} */
  let review

  /** The review, read once: its producer never rewrites it. */
  async function readReview() {
    if (review) return review
    let text
    try {
      text = await readFile(reviewFile, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT')
        throw new StoreRefusal(`no review.json in ${dir}`)
      throw error
    }
    try {
      review = parseReview(text)
    } catch (error) {
      if (error instanceof FormatError) throw new StoreRefusal(error.message)
      throw error
    }
    return review
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

  return {
    readReview,
    readDecisions,

    /** The review and its decisions, as the page reads them. */
    async readAll() {
      return { review: await readReview(), decisions: await readDecisions() }
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
     * agent follows), a post (with the `comment` as they edited it), a drop
     * (with their `reason`) or a skip. A post needs `theirs` and the MR's
     * `diffRefs`; a question is answered with `answer`, not decided again.
     * @param {string} id
     * @param {{ action: 'fix' | 'post' | 'drop' | 'skip', context?: string, comment?: string, reason?: string }} decision
     * @returns {Promise<Entry>}
     */
    decide(id, { action, context, comment, reason }) {
      return changeOne(id, (entry, finding, known) => {
        if (action === 'post') {
          if (known.ownership !== 'theirs') {
            throw new StoreRefusal(
              `post refused: the review is ours, there is no MR to post on`,
            )
          }
          if (!known.mr?.diffRefs) {
            throw new StoreRefusal(`post refused: the review has no mr.diffRefs`)
          }
          if (!comment?.trim() && !finding.comment) {
            throw new StoreRefusal(`post refused: finding ${id} has no comment`)
          }
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
        if (entry.state === 'queued' && entry.decision?.action === 'post') {
          throw new StoreRefusal(`claim refused: finding ${id} is queued for a post`)
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
     * The fix or the post failed: `reason` says why, and the run, if any, ends.
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
