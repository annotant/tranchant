// A finding's discussion: the reviewer's questions and an agent's answers, in
// discussions/<id>.json next to decisions.json. Not a decision: no move of the
// finding's state goes through it. Described in docs/review-file.md.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'
import { REPLY_IN, stateWords } from './format.mjs'
import { StoreRefusal, createStore } from './store.mjs'

/** @typedef {import('./format.mjs').State} State */
/**
 * What the agent proposes the reviewer carries over to a decision: the fix's
 * context, the comment to post, the reason to drop.
 * @typedef {{ fix?: string, comment?: string, drop?: string }} Proposal
 */
/**
 * `failed`: the agent ended without answering; the text says so.
 * @typedef {{ by: 'reviewer' | 'agent', text: string, at: string, proposal?: Proposal, failed?: true }} Message
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

/** The discussion file of finding `id`. */
const discussionPath = (/** @type {string} */ dir, /** @type {string} */ id) =>
  path.join(dir, 'discussions', `${id}.json`)

const DISCUSSION_FILE = /^([\w-]{1,64})\.json$/

/** Whether the reviewer's last message waits for the agent's answer. @param {Discussion | undefined} discussion */
export const isWaiting = (discussion) => discussion?.messages.at(-1)?.by === 'reviewer'

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
async function readDiscussion(dir, id) {
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
    const result = await change(discussion)
    // Written to a temp file first: the server reads it while the agent answers.
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(discussion, null, 2)}\n`)
    await rename(temp, file)
    return result
  })
}

/**
 * The reviewer asks something about finding `id`: refused once the finding is
 * settled or an agent works on it, and while the last question waits.
 * @param {string} dir
 * @param {string} id
 * @param {string} text
 * @returns {Promise<Discussion>}
 */
export async function say(dir, id, text) {
  const question = text.trim().slice(0, MAX_QUESTION)
  if (!question) throw new StoreRefusal('the message is empty')
  const store = createStore(dir)
  const review = await store.readReview()
  const finding = review.findings.find((one) => one.id === id)
  if (!finding) throw new StoreRefusal(`no finding ${id} in the review`)
  const discussable = finding.thread ? THREAD_DISCUSSABLE : DISCUSSABLE
  return changeDiscussion(dir, id, async (discussion) => {
    // Read under the discussion's lock: as close to the write as it gets.
    const state = (await store.readDecisions()).findings[id]?.state ?? 'open'
    if (!discussable.has(state))
      throw new StoreRefusal(`finding ${id} is ${stateWords(state)}: no discussion now`)
    if (isWaiting(discussion))
      throw new StoreRefusal('the agent is still answering the last message')
    if (discussion.messages.length >= MAX_MESSAGES)
      throw new StoreRefusal(`a discussion holds ${MAX_MESSAGES} messages at most`)
    discussion.messages.push({ by: 'reviewer', text: question, at: now() })
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
    if (!isWaiting(discussion))
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
  if (!isWaiting(await readDiscussion(dir, id))) return false
  return changeDiscussion(dir, id, (discussion) => {
    if (!isWaiting(discussion)) return false
    discussion.messages.push({ by: 'agent', text: UNANSWERED, at: now(), failed: true })
    return true
  })
}

const now = () => new Date().toISOString()
