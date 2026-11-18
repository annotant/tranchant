// A question the reviewer asks about lines of the diff, and the asking
// agent's answers: questions/<id>.json next to decisions.json. An answer may
// propose a finding; added, the question's thread becomes that finding's
// discussion. Described in docs/review-file.md.
import { randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { changeJsonFile, readOptional, seedDiscussion } from './discussion.mjs'
import { TOPICS, forgeOf, validateFinding } from './format.mjs'
import { StoreRefusal, createStore } from './store.mjs'

/** @typedef {import('./format.mjs').Finding} Finding */
/** @typedef {import('./format.mjs').Topic} Topic */
/**
 * The lines asked about, on the new side, at the head the diff was computed at.
 * @typedef {{ path: string, startLine: number, lines: string[] }} Anchor
 */
/**
 * The finding the agent proposes, anchored on `line`, one of the anchor's.
 * @typedef {{ title: string, topic: Topic, bucket: 'review' | 'auto', tag?: 'concern' | 'question' | 'suggestion', line: number, problem: string, why: string, fix: string, comment?: string }} Proposed
 */
/**
 * `failed`: the agent ended without answering. `declined`: the reviewer said
 * no to its proposal.
 * @typedef {{ by: 'reviewer' | 'agent', text: string, at: string, proposal?: { finding: Proposed }, failed?: true, declined?: true }} Message
 */
/**
 * `finding`: the id of the finding it became, once added.
 * @typedef {{ version: 1, anchor: Anchor, messages: Message[], finding?: string }} Question
 */

const QUESTION_VERSION = /** @type {const} */ (1)
/** As many lines as a finding's excerpt holds. */
export const MAX_ASKED_LINES = 80
const MAX_MESSAGES = 60
const MAX_QUESTION = 4000
const MAX_ANSWER = 8000
const MAX_FIELD = 4000
const UNANSWERED = 'The agent ended without answering: ask again.'
const QUESTION_FILE = /^([\w-]{1,64})\.json$/
// The topics a person decides on; the others an assistant fixes from the text alone.
const REVIEW_TOPICS = new Set(['Bugs', 'Security & Permissions', 'Breaking Changes'])
const TAGS = new Set(['concern', 'question', 'suggestion'])
/** What a finding's excerpt line may hold: 400 characters, no control character but tabs. */
const MAX_LINE = 400
const CONTROL = /[^\P{Cc}\t]/gu

/** @param {unknown} value @returns {value is string} */
const isText = (value) => typeof value === 'string' && value.trim().length > 0
/** @param {unknown} value @returns {value is number} */
const isLine = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

const questionPath = (/** @type {string} */ dir, /** @type {string} */ id) =>
  path.join(dir, 'questions', `${id}.json`)

/** The anchor's last line. @param {Anchor} anchor */
const endLineOf = (anchor) => anchor.startLine + anchor.lines.length - 1

/** @param {any} anchor @returns {anchor is Anchor} */
const isAnchor = (anchor) =>
  !!anchor &&
  isText(anchor.path) &&
  isLine(anchor.startLine) &&
  Array.isArray(anchor.lines) &&
  anchor.lines.length >= 1 &&
  anchor.lines.length <= MAX_ASKED_LINES &&
  anchor.lines.every((/** @type {unknown} */ line) => typeof line === 'string')

/**
 * A file the server and the agents wrote: one of another version, or not
 * one, reads as no question.
 * @param {string} text
 * @returns {Question | undefined}
 */
function parse(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return undefined
  }
  if (data?.version !== QUESTION_VERSION || !isAnchor(data.anchor)) return undefined
  if (!Array.isArray(data.messages)) return undefined
  /** @type {Message[]} */
  const messages = data.messages.filter(
    (/** @type {any} */ one) =>
      one &&
      (one.by === 'reviewer' || one.by === 'agent') &&
      isText(one.text) &&
      typeof one.at === 'string',
  )
  return {
    version: QUESTION_VERSION,
    anchor: data.anchor,
    messages,
    ...(isText(data.finding) && { finding: data.finding }),
  }
}

/** @param {string} dir @param {string} id */
export async function readQuestion(dir, id) {
  const text = await readOptional(questionPath(dir, id))
  return text === undefined ? undefined : parse(text)
}

/**
 * Every question of the review, by id.
 * @param {string} dir
 * @returns {Promise<Record<string, Question>>}
 */
export async function readQuestions(dir) {
  const names = await readdir(path.join(dir, 'questions')).catch(() => [])
  /** @type {Record<string, Question>} */
  const all = {}
  for (const name of names) {
    const id = QUESTION_FILE.exec(name)?.[1]
    if (!id) continue
    // One file it cannot read leaves the others, and the page, as they are.
    const question = await readQuestion(dir, id).catch((error) => {
      console.error(`tranchant: questions/${name}: ${String(error)}; left out`)
      return undefined
    })
    if (question) all[id] = question
  }
  return all
}

/** Whether the reviewer's last message waits for the agent's answer. @param {Question | undefined} question */
export const waitsForAnswer = (question) =>
  !question?.finding && question?.messages.at(-1)?.by === 'reviewer'

/**
 * Runs `change` on question `id` under its file lock, and writes it; a
 * question that is not there is refused.
 * @template T
 * @param {string} dir
 * @param {string} id
 * @param {(question: Question) => T | Promise<T>} change
 * @returns {Promise<T>}
 */
const changeQuestion = (dir, id, change) =>
  changeJsonFile(
    questionPath(dir, id),
    'question',
    parse,
    () => {
      throw new StoreRefusal(`no question ${id} in the review`)
    },
    change,
  )

/** @param {unknown} text */
function questionText(text) {
  const question = typeof text === 'string' ? text.trim().slice(0, MAX_QUESTION) : ''
  if (!question) throw new StoreRefusal('the question is empty')
  return question
}

/**
 * The reviewer asks about `anchor`, lines the server read at the head: a new
 * question, its id `q-` and 8 hex digits.
 * @param {string} dir
 * @param {Anchor} anchor
 * @param {unknown} text
 * @returns {Promise<{ id: string, question: Question }>}
 */
export async function ask(dir, anchor, text) {
  const question = questionText(text)
  if (!isAnchor(anchor))
    throw new StoreRefusal(`a question is on 1 to ${MAX_ASKED_LINES} lines of a file`)
  // As a finding's excerpt holds them: the proposal is then never refused for the code.
  const lines = anchor.lines.map((line) =>
    line.slice(0, MAX_LINE).replace(CONTROL, '\uFFFD'),
  )
  const kept = { path: anchor.path, startLine: anchor.startLine, lines }
  for (;;) {
    const id = `q-${randomBytes(4).toString('hex')}`
    // Under the new file's lock: two questions never take the same id.
    const made = await changeJsonFile(
      questionPath(dir, id),
      'question',
      parse,
      () => ({ version: QUESTION_VERSION, anchor: kept, messages: [] }),
      (/** @type {Question} */ data) => {
        if (data.messages.length) return undefined
        data.messages.push({ by: 'reviewer', text: question, at: now() })
        return data
      },
    )
    if (made) return { id, question: made }
  }
}

/**
 * The reviewer asks again in question `id`: refused while the last message
 * waits, once the question became a finding (its discussion goes on there),
 * and when the agent's answer would not fit in its 60 messages.
 * @param {string} dir
 * @param {string} id
 * @param {unknown} text
 * @returns {Promise<Question>}
 */
export function askAgain(dir, id, text) {
  const question = questionText(text)
  return changeQuestion(dir, id, (data) => {
    if (data.finding)
      throw new StoreRefusal(
        `the question became finding ${data.finding}: ask in its discussion`,
      )
    if (waitsForAnswer(data))
      throw new StoreRefusal('the agent is still answering the last message')
    // Room for the answer too: the thread may become a finding's discussion, as whole.
    if (data.messages.length >= MAX_MESSAGES - 1)
      throw new StoreRefusal(`a question holds ${MAX_MESSAGES} messages at most`)
    data.messages.push({ by: 'reviewer', text: question, at: now() })
    return data
  })
}

/**
 * The proposed finding `given`, checked against the anchor: its fields, and
 * its line among the lines asked about. `bucket` defaults from the topic,
 * `line` to the anchor's last.
 * @param {any} given
 * @param {Anchor} anchor
 * @returns {Proposed}
 */
function proposalOf(given, anchor) {
  if (!given || typeof given !== 'object' || Array.isArray(given))
    throw new StoreRefusal('finding: an object is required')
  for (const key of ['title', 'problem', 'why', 'fix']) {
    if (!isText(given[key])) throw new StoreRefusal(`finding.${key}: a text is required`)
    if (given[key].trim().length > MAX_FIELD)
      throw new StoreRefusal(`finding.${key}: up to ${MAX_FIELD} characters`)
  }
  if (!TOPICS.includes(given.topic))
    throw new StoreRefusal(`finding.topic: one of ${TOPICS.join(', ')}`)
  const bucket = given.bucket ?? (REVIEW_TOPICS.has(given.topic) ? 'review' : 'auto')
  if (bucket !== 'review' && bucket !== 'auto')
    throw new StoreRefusal('finding.bucket: review or auto')
  if (given.tag !== undefined && !TAGS.has(given.tag))
    throw new StoreRefusal('finding.tag: concern, question or suggestion')
  const end = endLineOf(anchor)
  const line = given.line ?? end
  if (!isLine(line) || line < anchor.startLine || line > end)
    throw new StoreRefusal(
      `finding.line: ${String(line)} is outside the lines asked about, ${anchor.startLine} to ${end}`,
    )
  if (given.comment !== undefined && given.comment !== null && !isText(given.comment))
    throw new StoreRefusal('finding.comment: a text')
  const comment = isText(given.comment) ? given.comment.trim() : undefined
  if (comment !== undefined && comment.length > MAX_FIELD)
    throw new StoreRefusal(`finding.comment: up to ${MAX_FIELD} characters`)
  return {
    title: given.title.trim(),
    topic: given.topic,
    bucket,
    ...(given.tag !== undefined && { tag: given.tag }),
    line,
    problem: given.problem.trim(),
    why: given.why.trim(),
    fix: given.fix.trim(),
    ...(comment !== undefined && { comment }),
  }
}

/**
 * The finding question `id` proposes, as the review would hold it.
 * @param {string} id
 * @param {Anchor} anchor
 * @param {Proposed} proposed
 * @returns {Finding}
 */
const findingOf = (id, anchor, proposed) => {
  const { line, ...rest } = proposed
  return {
    id,
    ...rest,
    path: anchor.path,
    line,
    excerpt: { startLine: anchor.startLine, lines: anchor.lines },
    asked: true,
  }
}

/**
 * The proposal `given` for question `id`, checked as any finding of the
 * review is: refused when the review would refuse it, or with `unique` when
 * a finding has its id.
 * @param {string} dir
 * @param {string} id
 * @param {Anchor} anchor
 * @param {unknown} given
 * @param {boolean} unique
 */
async function checkedProposal(dir, id, anchor, given, unique) {
  const proposed = proposalOf(given, anchor)
  const review = await createStore(dir).readReview()
  const problems = validateFinding(findingOf(id, anchor, proposed), {
    theirs: review.ownership === 'theirs',
    forge: forgeOf(review),
  })
  if (problems.length) throw new StoreRefusal(problems.join('; '))
  if (unique && review.findings.some((one) => one.id === id))
    throw new StoreRefusal(`finding ${id} exists already`)
  return proposed
}

/**
 * The agent's answer to the question that waits, with the finding it
 * proposes, if any; refused, nothing is written.
 * @param {string} dir
 * @param {string} id
 * @param {{ text?: unknown, finding?: unknown }} answer
 * @returns {Promise<Question>}
 */
export async function reply(dir, id, answer) {
  const { text } = answer
  if (!isText(text)) throw new StoreRefusal('the answer needs a text')
  const anchor = (await readQuestion(dir, id))?.anchor
  if (!anchor) throw new StoreRefusal(`no question ${id} in the review`)
  const proposed =
    answer.finding === undefined || answer.finding === null
      ? undefined
      : await checkedProposal(dir, id, anchor, answer.finding, true)
  return changeQuestion(dir, id, (data) => {
    if (!waitsForAnswer(data))
      throw new StoreRefusal(`no question ${id} waits for an answer`)
    data.messages.push({
      by: 'agent',
      text: text.trim().slice(0, MAX_ANSWER),
      at: now(),
      ...(proposed && { proposal: { finding: proposed } }),
    })
    return data
  })
}

/**
 * The agent ended: a question it left waiting gets a failed answer, so the
 * reviewer may ask again. Whether there was one.
 * @param {string} dir
 * @param {string} id
 */
export async function endUnanswered(dir, id) {
  if (!waitsForAnswer(await readQuestion(dir, id))) return false
  return changeQuestion(dir, id, (data) => {
    if (!waitsForAnswer(data)) return false
    data.messages.push({ by: 'agent', text: UNANSWERED, at: now(), failed: true })
    return true
  })
}

/**
 * The proposal of the agent's message `at`, the last one: what the reviewer
 * may still add or decline.
 * @param {Question} data
 * @param {string} at
 */
function openProposal(data, at) {
  if (data.finding) throw new StoreRefusal(`the question became finding ${data.finding}`)
  const last = data.messages.at(-1)
  if (!last || last.by !== 'agent' || last.at !== at || !last.proposal)
    throw new StoreRefusal('only the last answer’s proposal can be taken')
  if (last.declined) throw new StoreRefusal('the proposal was declined')
  return last
}

/**
 * No, thanks: the reviewer declines the proposal of the answer `at`.
 * @param {string} dir
 * @param {string} id
 * @param {string} at
 * @returns {Promise<Question>}
 */
export function decline(dir, id, at) {
  return changeQuestion(dir, id, async (data) => {
    if (data.finding)
      throw new StoreRefusal(`the question became finding ${data.finding}`)
    // An add that stopped halfway is finished, never declined.
    if (await addedAlready(dir, id)) return becameFinding(dir, id, data)
    openProposal(data, at).declined = true
    return data
  })
}

/** Whether the review holds finding `id`: an add that stopped before the question said so. @param {string} dir @param {string} id */
const addedAlready = async (dir, id) =>
  (await createStore(dir).readReview()).findings.some((one) => one.id === id)

/**
 * Question `id` became finding `id`: its thread becomes the finding's
 * discussion, its proposals left out, and the question says so.
 * @param {string} dir
 * @param {string} id
 * @param {Question} data
 */
async function becameFinding(dir, id, data) {
  await seedDiscussion(
    dir,
    id,
    data.messages.map(({ by, text, at, failed }) => ({
      by,
      text,
      at,
      ...(failed && { failed }),
    })),
  )
  data.finding = id
  return data
}

/**
 * Add as a finding: the proposal of the answer `at`, as the reviewer edited
 * it (`given`), joins the review as finding `id`, whatever the review's
 * status, and the question's thread becomes its discussion.
 * @param {string} dir
 * @param {string} id
 * @param {string} at
 * @param {unknown} given
 * @returns {Promise<Question>}
 */
export function addAsked(dir, id, at, given) {
  return changeQuestion(dir, id, async (data) => {
    if (data.finding)
      throw new StoreRefusal(`the question became finding ${data.finding}`)
    // An add that stopped halfway (its discussion unwritten) is finished as it was.
    if (await addedAlready(dir, id)) return becameFinding(dir, id, data)
    openProposal(data, at)
    const proposed = await checkedProposal(dir, id, data.anchor, given, true)
    await createStore(dir).addFinding(findingOf(id, data.anchor, proposed), {
      asked: true,
    })
    return becameFinding(dir, id, data)
  })
}

const now = () => new Date().toISOString()
