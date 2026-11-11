// A finding's discussion: the reviewer's questions and an agent's answers, in
// discussions/<id>.json next to decisions.json. Not a decision: only a change
// the reviewer asks for in it moves the finding, through the store's `change`.
// Described in docs/review-file.md.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'
import { REPLY_IN, canMove, stateWords } from './format.mjs'
import { StoreRefusal, createStore } from './store.mjs'

/** @typedef {import('./format.mjs').Entry} Entry */
/** @typedef {import('./format.mjs').State} State */
/**
 * What the agent proposes the reviewer carries over to a decision: the fix's
 * context, the comment to post, the reason to drop.
 * @typedef {{ fix?: string, comment?: string, drop?: string }} Proposal
 */
/**
 * `failed`: the agent ended without answering; the text says so. `change`:
 * the reviewer's message asks for a change to the code, or answers the
 * question its agent asked. `runs` and `outcome`: that change's result, the
 * runs it took and the state they left the finding in.
 * @typedef {{ by: 'reviewer' | 'agent', text: string, at: string, proposal?: Proposal, failed?: true, change?: true, runs?: string[], outcome?: State }} Message
 */
/** @typedef {{ version: 1, messages: Message[] }} Discussion */

const DISCUSSION_VERSION = 1
/**
 * The states a reviewer may discuss in: nothing settled, no agent on the finding.
 * @type {readonly State[]}
 */
const DISCUSS_IN = ['open', 'skipped', 'failed', 'stopped']
const DISCUSSABLE = new Set(DISCUSS_IN)
/** A PR/MR thread lives on once fixed or replied on: its reviewer may answer back. */
const THREAD_DISCUSSABLE = new Set([...DISCUSS_IN, ...REPLY_IN])
const MAX_MESSAGES = 60
const MAX_QUESTION = 4000
const MAX_ANSWER = 8000
const MAX_PROPOSAL = 4000
const PROPOSALS = /** @type {const} */ (['fix', 'comment', 'drop'])
const UNANSWERED = 'The agent ended without answering: ask again.'
/** The states a change asked for is still under way in: its result is not there yet. */
const CHANGING = new Set(['queued', 'working'])

/** The discussion file of finding `id`. */
const discussionPath = (/** @type {string} */ dir, /** @type {string} */ id) =>
  path.join(dir, 'discussions', `${id}.json`)

const DISCUSSION_FILE = /^([\w-]{1,64})\.json$/

/** Whether the reviewer's last message waits, for an answer or a change. @param {Discussion | undefined} discussion */
const isWaiting = (discussion) => discussion?.messages.at(-1)?.by === 'reviewer'

/** Whether the reviewer's last message is a question waiting for the discussing agent's answer. @param {Discussion | undefined} discussion */
export const waitsForAnswer = (discussion) =>
  isWaiting(discussion) && !discussion?.messages.at(-1)?.change

/** Whether the reviewer's last message waits for the change it asked for. @param {Discussion | undefined} discussion */
const waitsForChange = (discussion) =>
  isWaiting(discussion) && !!discussion?.messages.at(-1)?.change

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isText = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * The messages of a file the hooks and the server wrote: one of another
 * version, or not one, reads as no discussion.
 * @param {string} text
 * @returns {Discussion | undefined}
 */
function parse(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }
  if (data?.version !== DISCUSSION_VERSION || !Array.isArray(data.messages))
    return undefined
  /** @type {Message[]} */
  const messages = data.messages.filter(
    (/** @type {any} */ one) =>
      one &&
      (one.by === 'reviewer' || one.by === 'agent') &&
      isText(one.text) &&
      typeof one.at === 'string',
  )
  return { version: DISCUSSION_VERSION, messages }
}

/**
 * Finding `id`'s discussion, or undefined when it has none.
 * @param {string} dir
 * @param {string} id
 */
export async function readDiscussion(dir, id) {
  const text = await readText(dir, id)
  return text === undefined ? undefined : parse(text)
}

/** The file's text, or undefined when there is none. @param {string} dir @param {string} id */
async function readText(dir, id) {
  try {
    return await readFile(discussionPath(dir, id), 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Every discussion of the review, by finding id.
 * @param {string} dir
 * @returns {Promise<Record<string, Discussion>>}
 */
export async function readDiscussions(dir) {
  const names = await readdir(path.join(dir, 'discussions')).catch(() => [])
  /** @type {Record<string, Discussion>} */
  const all = {}
  for (const name of names) {
    const id = DISCUSSION_FILE.exec(name)?.[1]
    if (!id) continue
    const discussion = await readDiscussion(dir, id)
    if (discussion?.messages.length) all[id] = discussion
  }
  return all
}

/**
 * Runs `change` on finding `id`'s discussion under its file lock, and writes
 * it. Throwing a StoreRefusal writes nothing; a file it cannot read is
 * refused, never written over.
 * @template T
 * @param {string} dir
 * @param {string} id
 * @param {(discussion: Discussion) => T | Promise<T>} change
 * @returns {Promise<T>}
 */
async function changeDiscussion(dir, id, change) {
  const file = discussionPath(dir, id)
  await mkdir(path.dirname(file), { recursive: true })
  return withFileLock(file, async () => {
    const text = await readText(dir, id)
    const discussion =
      text === undefined
        ? { version: /** @type {const} */ (1), messages: [] }
        : parse(text)
    if (!discussion)
      throw new StoreRefusal(
        `discussions/${id}.json is not a discussion this Tranchant reads: left as it is`,
      )
    const before = JSON.stringify(discussion)
    const result = await change(discussion)
    // Unchanged, not written: the server would tell the pages for nothing.
    if (JSON.stringify(discussion) === before) return result
    // Written to a temp file first: the server reads it while the agent answers.
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(discussion, null, 2)}\n`)
    await rename(temp, file)
    return result
  })
}

/**
 * The reviewer asks something about finding `id`: refused once the finding is
 * settled or an agent works on it, and while the last message waits. With
 * `change`, they ask for a change to the code instead, on a finding from a
 * PR/MR thread: the finding queues for a fix whose agent reads the
 * discussion (the store's `change`), again once `fixed`.
 * @param {string} dir
 * @param {string} id
 * @param {string} text
 * @param {{ change?: boolean }} [options]
 * @returns {Promise<Discussion>}
 */
export async function say(dir, id, text, { change = false } = {}) {
  const question = text.trim().slice(0, MAX_QUESTION)
  if (!question) throw new StoreRefusal('the message is empty')
  const store = createStore(dir)
  const review = await store.readReview()
  const finding = review.findings.find((one) => one.id === id)
  if (!finding) throw new StoreRefusal(`no finding ${id} in the review`)
  if (change && !finding.thread)
    throw new StoreRefusal(
      `finding ${id} has no PR/MR thread: no change from its discussion`,
    )
  const discussable = finding.thread ? THREAD_DISCUSSABLE : DISCUSSABLE
  return changeDiscussion(dir, id, async (discussion) => {
    // Read under the discussion's lock: as close to the write as it gets.
    const entry = (await store.readDecisions()).findings[id]
    const state = entry?.state ?? 'open'
    // What a change left that could not land comes before this message, if it is taken.
    settle(discussion, entry)
    if (change ? !canMove('change', state) : !discussable.has(state))
      throw new StoreRefusal(
        `finding ${id} is ${stateWords(state)}: no ${change ? 'change from the discussion' : 'discussion'} now`,
      )
    if (isWaiting(discussion))
      throw new StoreRefusal('the agent is still answering the last message')
    if (discussion.messages.length >= MAX_MESSAGES)
      throw new StoreRefusal(`a discussion holds ${MAX_MESSAGES} messages at most`)
    const at = now()
    // Moved before the message lands: a refused move leaves the discussion as it was.
    if (change) await store.change(id, { text: question, message: at })
    discussion.messages.push({
      by: 'reviewer',
      text: question,
      at,
      ...(change ? { change: /** @type {const} */ (true) } : {}),
    })
    return discussion
  })
}

/**
 * The agent's answer to the question that waits, with what it proposes.
 * @param {string} dir
 * @param {string} id
 * @param {{ text?: unknown } & Partial<Record<keyof Proposal, unknown>>} answer
 * @returns {Promise<Discussion>}
 */
export function reply(dir, id, answer) {
  const { text } = answer
  if (!isText(text)) throw new StoreRefusal('the answer needs a text')
  /** @type {Proposal} */
  const proposal = {}
  for (const key of PROPOSALS) {
    const value = answer[key]
    if (value === undefined || value === null) continue
    if (!isText(value)) throw new StoreRefusal(`${key} must be a text`)
    proposal[key] = value.trim().slice(0, MAX_PROPOSAL)
  }
  return changeDiscussion(dir, id, (discussion) => {
    // A change asked for waits for its fix's agent: a discussing agent never answers it.
    if (!waitsForAnswer(discussion))
      throw new StoreRefusal(`no question on finding ${id} waits for an answer`)
    discussion.messages.push({
      by: 'agent',
      text: text.trim().slice(0, MAX_ANSWER),
      at: now(),
      ...(Object.keys(proposal).length ? { proposal } : {}),
    })
    return discussion
  })
}

/**
 * The agent ended: a question it left waiting gets a failed answer, so the
 * reviewer may ask again. Whether there was one.
 * @param {string} dir
 * @param {string} id
 */
export async function endUnanswered(dir, id) {
  if (!waitsForAnswer(await readDiscussion(dir, id))) return false
  return changeDiscussion(dir, id, (discussion) => {
    // A change asked for waits for its fix's agent, not for this one.
    if (!waitsForAnswer(discussion)) return false
    discussion.messages.push({ by: 'agent', text: UNANSWERED, at: now(), failed: true })
    return true
  })
}

/**
 * The `at` of the change the discussion waits for: the reviewer's last
 * request, never their answer to its agent's question.
 * @param {Discussion} discussion
 */
const requestOf = (discussion) =>
  discussion.messages.findLast(
    (message, i) => message.change && discussion.messages[i - 1]?.outcome !== 'asking',
  )?.at

/**
 * What the change asked at `request` left the finding with, as the agent's
 * message: its summary, its question, or why it went no further. Undefined
 * while the change is under way.
 * @param {Entry | undefined} entry
 * @param {string | undefined} request
 * @returns {Message | undefined}
 */
function resultOf(entry, request) {
  const state = entry?.state ?? 'open'
  const at = now()
  // Another decision took the change's place: its own run is no answer to the request.
  if (!request || entry?.decision?.change !== request)
    return {
      by: 'agent',
      text: 'The change was not made: you decided otherwise.',
      at,
      outcome: state,
      failed: true,
    }
  if (CHANGING.has(state)) return undefined
  const since = entry.decision.at
  const runs = entry.runs
    .filter((run) => run.endedAt && run.startedAt >= since)
    .map((run) => run.id)
  const ran = runs.length ? { runs } : {}
  const last = entry.runs.at(-1)
  if (state === 'fixed')
    return {
      by: 'agent',
      text: (runs.length && last?.summary?.trim()) || 'Changed on the working tree.',
      at,
      ...ran,
      outcome: state,
    }
  if (state === 'asking' && entry.question)
    return { by: 'agent', text: entry.question.text, at, ...ran, outcome: state }
  const why =
    state === 'failed'
      ? `The change failed: ${entry.reason ?? 'no reason given'}.`
      : state === 'stopped'
        ? 'You stopped the change.'
        : `The change was not made: the finding is ${stateWords(state)}.`
  return { by: 'agent', text: why, at, ...ran, outcome: state, failed: true }
}

/**
 * Brings the discussion in line with the finding's decision: the reviewer's
 * answer to a change's question, then the change's result once its runs
 * ended. Whether anything landed.
 * @param {Discussion} discussion
 * @param {Entry | undefined} entry
 */
function settle(discussion, entry) {
  const last = discussion.messages.at(-1)
  // An answer is dropped by the next question: one still there answers the last.
  const answer = entry?.decision?.change ? entry.answer : undefined
  let landed = false
  if (last?.outcome === 'asking' && answer && entry?.state !== 'asking') {
    const text = [answer.choices?.join(', '), answer.text].filter(Boolean).join(': ')
    discussion.messages.push({
      by: 'reviewer',
      text: text.slice(0, MAX_QUESTION),
      at: answer.at,
      change: true,
    })
    landed = true
  }
  if (!waitsForChange(discussion)) return landed
  const result = resultOf(entry, requestOf(discussion))
  if (result) discussion.messages.push(result)
  return landed || !!result
}

/**
 * Brings finding `id`'s discussion in line with a change asked there, once
 * the store moved it: the reviewer's answer, the run's result, or why there
 * is none. Called by the scripts that end a run, by the server on each move
 * the reviewer makes and at start, and before the next message; one call
 * that failed is mended by the next. Whether anything landed.
 * @param {string} dir
 * @param {string} id
 */
export async function syncChange(dir, id) {
  if (!(await readDiscussion(dir, id))?.messages.length) return false
  const store = createStore(dir)
  return changeDiscussion(dir, id, async (discussion) =>
    settle(discussion, (await store.readDecisions()).findings[id]),
  )
}

const now = () => new Date().toISOString()
