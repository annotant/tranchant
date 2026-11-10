// The review, decisions and run files' format: what every part that reads them
// agrees on. The producer writes the review, the store the decisions, the
// hooks the run files. Described in docs/review-file.md; the page mirrors it
// in page/src/domain.ts.
import path from 'node:path'

/** The review version this code reads; any other is refused. */
export const REVIEW_VERSION = 1
/** The decisions version this code reads and writes; any other is refused. */
export const DECISIONS_VERSION = 1

/**
 * Where a review stands: `preparing` while `/tranchant review` builds its
 * lenses, `reviewing` while its producer still adds findings, `complete`
 * once it is done, `refused` when a lens could not be built and no reviewer
 * started. Absent from the envelope, it is `complete`.
 * @typedef {'preparing' | 'reviewing' | 'complete' | 'refused'} Status
 */

/** @type {ReadonlySet<string>} */
const STATUSES = new Set(['preparing', 'reviewing', 'complete', 'refused'])

/** @param {unknown} value @returns {value is Status} */
const isStatus = (value) => typeof value === 'string' && STATUSES.has(value)

/** A review's status; absent means `complete`. @param {{ status?: unknown }} review */
export const statusOf = (review) => (isStatus(review.status) ? review.status : 'complete')

/** Whether a review is over: complete, or refused before any reviewer started. */
export const isSettled = (/** @type {{ status?: unknown }} */ review) => {
  const status = statusOf(review)
  return status === 'complete' || status === 'refused'
}

/**
 * Where a finding stands. Absent from the decisions file, it is `open`.
 * @typedef {'open' | 'queued' | 'working' | 'asking' | 'fixed' | 'posted' | 'moved' | 'dropped' | 'skipped' | 'failed' | 'stopped'} State
 */

/** @type {readonly State[]} */
export const STATES = [
  'open',
  'queued',
  'working',
  'asking',
  'fixed',
  'posted',
  'moved',
  'dropped',
  'skipped',
  'failed',
  'stopped',
]

/** @typedef {'reviewer' | 'agent' | 'server'} Actor */

/**
 * The moves of a finding: a reviewer's decision (`fix`, `post`, `issue`,
 * `drop`, `skip`, `answer`, `stop`), an agent's (`claim`, `done`, `ask`) or
 * the server's (`posted`, `moved`, `fail`).
 * @typedef {'fix' | 'post' | 'issue' | 'drop' | 'skip' | 'answer' | 'stop' | 'claim' | 'done' | 'ask' | 'posted' | 'moved' | 'fail'} Move
 */

/** The states a reviewer may still drop or skip from: nothing has landed yet. */
const UNDECIDED = /** @type {readonly State[]} */ ([
  'open',
  'queued',
  'asking',
  'failed',
  'stopped',
])

/**
 * Each move, the states it leaves and the one it reaches. A `fixed`,
 * `posted` or `moved` finding is final: no move leaves it (a reply on its
 * thread is no move: see `Reply`). A question is answered with `answer`,
 * never with another `fix`.
 * @type {Readonly<Record<Move, { from: readonly State[], to: State }>>}
 */
export const MOVES = {
  fix: { from: ['open', 'dropped', 'skipped', 'failed', 'stopped'], to: 'queued' },
  post: { from: ['open', 'dropped', 'skipped', 'failed'], to: 'queued' },
  issue: { from: ['open', 'dropped', 'skipped', 'failed'], to: 'queued' },
  drop: { from: [...UNDECIDED, 'skipped'], to: 'dropped' },
  skip: { from: [...UNDECIDED, 'dropped'], to: 'skipped' },
  answer: { from: ['asking'], to: 'queued' },
  stop: { from: ['queued', 'working'], to: 'stopped' },
  claim: { from: ['queued'], to: 'working' },
  done: { from: ['working'], to: 'fixed' },
  ask: { from: ['working'], to: 'asking' },
  posted: { from: ['queued'], to: 'posted' },
  moved: { from: ['queued'], to: 'moved' },
  fail: { from: ['queued', 'working'], to: 'failed' },
}

/**
 * @param {Move} move
 * @param {State} from
 */
export const canMove = (move, from) => MOVES[move]?.from.includes(from) ?? false

/** @type {Record<State, string>} */
const STATE_WORDS = {
  open: 'open',
  queued: 'queued',
  working: 'being worked on',
  asking: 'waiting on your answer',
  fixed: 'fixed already',
  posted: 'posted already',
  moved: 'moved to an issue already',
  dropped: 'dropped',
  skipped: 'skipped',
  failed: 'failed',
  stopped: 'stopped',
}

/** Where a finding in `state` stands, in the words the scripts print. */
export const stateWords = (/** @type {State} */ state) => STATE_WORDS[state] ?? state

/** The reason a run ended without `done.mjs` or `ask.mjs`. */
export const AGENT_ENDED_REASON = 'the agent ended without done.mjs or ask.mjs'

/** @typedef {'Bugs' | 'Security & Permissions' | 'Breaking Changes' | 'Tests' | 'Conventions' | 'Code Quality' | 'Deprecation & Feature Flags'} Topic */

/** @type {readonly Topic[]} */
const TOPICS = [
  'Bugs',
  'Security & Permissions',
  'Breaking Changes',
  'Tests',
  'Conventions',
  'Code Quality',
  'Deprecation & Feature Flags',
]

/** @typedef {'review' | 'auto'} Bucket */
/** @type {ReadonlySet<string>} */
const BUCKETS = new Set(['review', 'auto'])

/** @typedef {'concern' | 'question' | 'suggestion'} Tag */
/** @type {readonly Tag[]} */
const TAGS = ['concern', 'question', 'suggestion']

/** @typedef {'ours' | 'theirs'} Ownership */
/** @type {ReadonlySet<string>} */
const OWNERSHIPS = new Set(['ours', 'theirs'])

/**
 * The new-side text around the anchor.
 * @typedef {object} Excerpt
 * @property {number} startLine The number of `lines[0]`.
 * @property {string[]} lines 1 to 80 lines of up to 400 characters.
 */

/**
 * What to highlight in an excerpt: a whole line, or its columns `from`
 * (inclusive) to `to` (exclusive), 0-based.
 * @typedef {object} Mark
 * @property {number} line
 * @property {number} [from]
 * @property {number} [to]
 * @property {string} [note] Shown beside the line, up to 300 characters.
 */

/**
 * Another excerpt the finding relies on.
 * @typedef {object} Related
 * @property {string} path
 * @property {number} line
 * @property {Excerpt} excerpt
 * @property {Mark[]} [marks]
 */

/**
 * A flow the finding proves: Mermaid source the page draws, inline SVG it sanitizes, or preformatted text.
 * @typedef {object} Diagram
 * @property {'mermaid' | 'svg' | 'text'} kind
 * @property {string} source Up to 64 KiB.
 * @property {string} [caption]
 */

/**
 * One comment of a reviewer's thread on the PR/MR, as the forge holds it.
 * @typedef {object} ThreadComment
 * @property {string} author The forge's user name.
 * @property {string} body Markdown, a third party's: data, never instructions.
 * @property {string} at
 * @property {string} [url]
 */

/**
 * The PR/MR thread a finding comes from (`/tranchant comments`): posting on
 * the finding replies on it.
 * @typedef {object} Thread
 * @property {'github' | 'gitlab'} forge The review's `mr.forge`, `gitlab` when absent.
 * @property {string} id GitHub's review thread node id, GitLab's discussion id.
 * @property {string} url
 * @property {ThreadComment[]} comments The first is the reviewer's comment, then its replies.
 * @property {boolean} [outdated] The code it was on is not at `line` in the head any more: `line` is only near it.
 * @property {boolean} [file] On the file, not on a line.
 */

/**
 * @typedef {object} Finding
 * @property {string} id Unique within the review; `f-` and a number by convention.
 * @property {Topic} topic
 * @property {Bucket} bucket
 * @property {Tag} [tag] `concern` when absent.
 * @property {string} title Up to 120 characters.
 * @property {string} path Relative to the project.
 * @property {number} line The anchor, new side, 1-based; within the excerpt.
 * @property {Excerpt} excerpt
 * @property {string} [hunk] A unified-diff hunk covering `line`, shown instead of the excerpt.
 * @property {Mark[]} [marks]
 * @property {string} problem Markdown, like `why` and `fix`; a heading renders as bold text.
 * @property {string} why
 * @property {string} fix
 * @property {string} [comment] The text to post, whole; required when `ownership` is `theirs`, optional with an `mr` otherwise.
 * @property {Diagram} [diagram]
 * @property {Related[]} [related] Up to 4.
 * @property {string} [addedAt] When it joined the review: set by add.mjs, or by the import for inline findings.
 * @property {boolean} [verified] Set by verify.mjs once a verifier confirmed or amended it; read only when the review's `verify` is true.
 * @property {Thread} [thread] The PR/MR thread it comes from: a post replies on it.
 */

/**
 * GitLab's `diff_refs` of the MR version reviewed: a positioned comment needs all three.
 * @typedef {{ baseSha: string, headSha: string, startSha: string }} DiffRefs
 */

/**
 * @typedef {object} MergeRequest
 * @property {'github' | 'gitlab'} [forge] `gitlab` when absent.
 * @property {string | number} project GitLab path or numeric id; `owner/repo` on GitHub.
 * @property {number} iid The MR's iid; the PR's number on GitHub.
 * @property {string} url
 * @property {string} author
 * @property {string} [viewer] Who imported its threads (`/tranchant comments`): the page marks their comments as theirs.
 * @property {DiffRefs} [diffRefs]
 */

/**
 * @typedef {object} Review
 * @property {typeof REVIEW_VERSION} version
 * @property {string} id A UUID the producer mints: one folder per id.
 * @property {string} createdAt
 * @property {string} project The checkout the fixes land in, absolute.
 * @property {string} branch
 * @property {string} base
 * @property {string} headSha What was reviewed.
 * @property {Ownership} ownership The default action: `ours` fix first, `theirs` post first.
 * @property {Status} [status] `complete` when absent: every producer that wrote a whole review keeps working.
 * @property {string} title
 * @property {MergeRequest} [mr] Required to post, with its `diffRefs` at `headSha`.
 * @property {{ key: string, url: string }} [jira]
 * @property {string} summary Markdown, shown above the findings; may be blank.
 * @property {string[]} strengths
 * @property {Record<string, number>} [sources]
 * @property {boolean} [verify] Findings land unverified and a verifier confirms each: only `/tranchant review` sets it, open.mjs drops it from any other file.
 * @property {LensRecord[]} [lenses] The lenses `/tranchant review` ran, as the Lenses step built them.
 * @property {Refusal} [refusal] With `refused`: the lens that could not be built, and why.
 * @property {Finding[]} findings At least one, unless the review is not `complete`.
 */

/**
 * A lens a review ran: its name, its source, the source's version when a
 * plugin gives one, and the hash of the prompt built from it.
 * @typedef {{ name: string, source: string, version?: string, hash: string }} LensRecord
 */

/**
 * Why a review was refused: the lens, its source, the reason, and what fixes it.
 * @typedef {{ lens: string, source: string, reason: string, fix?: string }} Refusal
 */

/**
 * @typedef {object} Decision
 * @property {'fix' | 'post' | 'issue' | 'drop' | 'skip'} action
 * @property {string} [context] `fix`: the reviewer's constraint or choice.
 * @property {boolean} [resolve] `post` on a thread: resolve it once replied.
 * @property {string} at
 */

/**
 * @typedef {object} Option
 * @property {string} label
 * @property {string} [description]
 */

/**
 * What an agent asked the reviewer.
 * @typedef {object} Question
 * @property {string} text
 * @property {Option[]} [options]
 * @property {boolean} [multiple]
 * @property {string} at
 */

/**
 * The reviewer's answer: the options they picked, then their own words.
 * @typedef {object} Answer
 * @property {string} text
 * @property {string[]} [choices]
 * @property {string} at
 */

/**
 * @typedef {object} Posted
 * @property {string} discussionId
 * @property {string} url The MR's url with `#note_<id>`, or the reply's on a thread.
 * @property {string} at
 * @property {boolean} [resolved] The thread was resolved after the reply.
 * @property {string} [unresolved] Why resolving the thread failed, the reply posted.
 */

/**
 * A reply on the thread of a finding settled already (`fixed`, or `posted`
 * and answered back): no move, the state stays; `posted` records it once on
 * the thread, `failed` says why it is not.
 * @typedef {object} Reply
 * @property {string} text
 * @property {boolean} [resolve]
 * @property {string} at
 * @property {string} [failed]
 */

/**
 * A reply posted on a finding's thread from the page, kept for the page to
 * show in the thread until the thread is imported again with it.
 * @typedef {object} SentReply
 * @property {string} text
 * @property {string} url
 * @property {string} at
 * @property {boolean} [resolved]
 */

/**
 * The issue a finding moves to: what the reviewer wrote, then where it landed.
 * @typedef {object} Issue
 * @property {string} title
 * @property {string} body Markdown.
 * @property {string} [url] Once created: the issue's page.
 * @property {string} [ref] Once created: `#<number>` on GitHub, `#<iid>` on GitLab.
 * @property {string} [at] Once created.
 */

/**
 * One agent's work on the finding: started by `claim.mjs`, ended by
 * `done.mjs`, `ask.mjs`, a stop or a failure.
 * @typedef {object} Run
 * @property {string} id `r1`, `r2`… within the finding.
 * @property {string} [agent] The Claude Code agent that claimed it.
 * @property {string} [model] The model it runs on.
 * @property {string} startedAt
 * @property {string} [endedAt]
 * @property {'fixed' | 'asking' | 'failed' | 'stopped'} [outcome] Absent while running.
 * @property {string} [summary] `fixed`: what changed, in the agent's words.
 * @property {string[]} [changed] `fixed`: the files the run wrote, relative to the project.
 */

/**
 * One move of the finding, never rewritten.
 * @typedef {object} Event
 * @property {string} at
 * @property {State} state The state it moved to.
 * @property {Actor} by
 * @property {string} [run]
 * @property {string} [agent]
 */

/**
 * What a stopped run had done.
 * @typedef {object} Cancellation
 * @property {string} at
 * @property {string[]} changed Files it had written, relative to the project.
 * @property {number} steps
 * @property {string} [run]
 */

/**
 * The decisions on one finding. Every field but `state`, `runs` and `events`
 * is optional.
 * @typedef {object} Entry
 * @property {State} state
 * @property {Decision} [decision]
 * @property {string} [comment] A post: the text as posted, when the reviewer edited it.
 * @property {Question} [question]
 * @property {Answer} [answer]
 * @property {string} [reason] `dropped`: the reviewer's words; `failed`: the error.
 * @property {Posted} [posted]
 * @property {Reply} [reply] A reply on a settled finding's thread, on its way or failed.
 * @property {SentReply[]} [replies] The replies posted on its thread, oldest first.
 * @property {Issue} [issue] An issue decision: its title and body, then its `url` once created.
 * @property {Run[]} runs
 * @property {Event[]} events
 * @property {Cancellation} [cancellation]
 */

/**
 * @typedef {object} Decisions
 * @property {typeof DECISIONS_VERSION} version
 * @property {Record<string, Entry>} findings By finding id; absent is `open`.
 */

/**
 * One line of a finding's run files (`runs/<id>.jsonl`,
 * `runs/<id>.history.jsonl`), never in the decisions file. A tool writes one
 * line when it starts and one when it ends or fails, with the same `id`:
 * readers merge them into one step.
 * @typedef {object} Step
 * @property {number} at Milliseconds since the epoch.
 * @property {string} kind `start`, `read`, `edit`, `write`, `bash`, `search`, `note` or `tool`; a review agent's last step is `end`.
 * @property {string} label
 * @property {string} [file] `edit` and `write`: the path from the project, `../` when outside it.
 * @property {string} [id] Tools only: Claude Code's tool_use_id.
 * @property {'running' | 'done' | 'failed'} [state]
 * @property {string} [detail] Why it failed, or what a note adds.
 * @property {string} [run]
 * @property {string} [agent]
 * @property {string} [model] `start` only.
 */

/**
 * Why the review's comments cannot be posted, or undefined when they can:
 * a positioned comment needs the MR's diff refs at the commit reviewed.
 * @param {{ headSha: string, ownership?: string, mr?: { forge?: string, diffRefs?: { headSha: string } } }} review
 * @returns {string | undefined}
 */
export function postBlocker(review) {
  if (review.mr?.forge === 'github')
    return 'on GitHub, a finding is only replied on, on its own thread'
  const head = review.mr?.diffRefs?.headSha
  if (!head) return 'the review has no mr.diffRefs'
  if (!head.startsWith(review.headSha) && !review.headSha.startsWith(head))
    return review.ownership === 'theirs'
      ? 'the MR moved past the commit reviewed: review it again'
      : "push your branch first: the MR's head is not the one reviewed"
  return undefined
}

/** Whether posting on `finding` replies on its PR/MR thread: no position, no diff refs needed. */
export const repliesOn = (/** @type {{ thread?: unknown }} */ finding) =>
  finding.thread !== undefined

/** The states a thread is replied on without moving: settled already, the reply a record of its own. */
export const REPLY_IN = /** @type {readonly State[]} */ (['fixed', 'posted'])

/** A reply on a settled finding's thread, on its way: not posted, not failed. */
export const replyPending = (/** @type {Pick<Entry, 'state' | 'reply'>} */ entry) =>
  REPLY_IN.includes(entry.state) && !!entry.reply && !entry.reply.failed

/**
 * `text` on one line: the hooks read one event per line, and a line break in
 * what a reviewer or a producer wrote would forge another.
 * @param {string} text
 */
export const oneLine = (text) => text.replace(/[\r\n\p{Zl}\p{Zp}]/gu, ' ')

/** A file this code does not read: nothing in it is touched. */
export class FormatError extends Error {}

const ID = /^[\w-]{1,64}$/
/** An id safe in a file name and on a protocol line. @param {unknown} value */
const isId = (value) => typeof value === 'string' && ID.test(value)
const SHA = /^[0-9a-f]{7,64}$/
// A tab is the only control character a line of code may hold.
const CONTROL = /[^\P{Cc}\t]/u
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
const MAX_TITLE = 120
const MAX_LINE = 400
const MAX_LINES = 80
const MAX_NOTE = 300
const MAX_COMMENT = 4000
const MAX_DIAGRAM = 64 * 1024
const MAX_RELATED = 4
const MAX_THREAD_COMMENTS = 100
const MAX_THREAD_BODY = 65_536
const FORGES = new Set(['github', 'gitlab'])

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isObject = (value) => typeof value === 'object' && value !== null

/**
 * A positive integer, or `min` and up.
 * @param {unknown} value
 * @param {number} [min]
 */
const isInt = (value, min = 1) => Number.isInteger(value) && Number(value) >= min

/**
 * @param {unknown} value
 * @param {number} [max]
 */
const isText = (value, max = Infinity) =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max

/** A path relative to the project, with no step out of it. */
const isRelativePath = (/** @type {unknown} */ value) =>
  typeof value === 'string' &&
  value !== '' &&
  value.length <= 1000 &&
  !path.posix.isAbsolute(value) &&
  !path.win32.isAbsolute(value) &&
  !value.split(/[\\/]/).includes('..')

/**
 * The problems of an excerpt, and the new-side lines it covers.
 * @param {any} excerpt
 * @param {string} where
 * @param {string[]} problems
 * @returns {{ first: number, last: number } | undefined}
 */
function checkExcerpt(excerpt, where, problems) {
  if (!isObject(excerpt)) {
    problems.push(`${where}: an object with startLine and lines is required`)
    return undefined
  }
  if (!isInt(excerpt.startLine))
    problems.push(`${where}.startLine: an integer ≥ 1 is required`)
  const { lines } = excerpt
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_LINES) {
    problems.push(`${where}.lines: 1 to ${MAX_LINES} lines are required`)
    return undefined
  }
  lines.forEach((line, i) => {
    if (typeof line !== 'string' || line.length > MAX_LINE) {
      problems.push(
        `${where}.lines[${i}]: a string of up to ${MAX_LINE} characters is required`,
      )
    } else if (CONTROL.test(line)) {
      problems.push(
        `${where}.lines[${i}]: control characters other than tabs are not allowed`,
      )
    }
  })
  return isInt(excerpt.startLine)
    ? { first: excerpt.startLine, last: excerpt.startLine + lines.length - 1 }
    : undefined
}

/**
 * The new-side lines a hunk covers, or the problem with it.
 * @param {unknown} hunk
 * @param {string} where
 * @param {string[]} problems
 */
function checkHunk(hunk, where, problems) {
  if (typeof hunk !== 'string' || hunk.length > MAX_DIAGRAM) {
    problems.push(`${where}: a unified-diff hunk is required`)
    return undefined
  }
  const [header = '', ...body] = hunk.split('\n')
  const match = HUNK_HEADER.exec(header)
  if (!match) {
    problems.push(`${where}: must start with a hunk header (@@ -a,b +c,d @@)`)
    return undefined
  }
  if (body.some((line) => line !== '' && !/^[ +\-\\]/.test(line))) {
    problems.push(
      `${where}: each line after the header starts with " ", "+", "-" or "\\"`,
    )
  }
  const first = Number(match[1])
  const count = match[2] === undefined ? 1 : Number(match[2])
  return { first, last: first + Math.max(count, 1) - 1 }
}

/**
 * @param {unknown} marks
 * @param {string} where
 * @param {{ first: number, last: number } | undefined} range
 * @param {string[]} problems
 */
function checkMarks(marks, where, range, problems) {
  if (marks === undefined) return
  if (!Array.isArray(marks)) {
    problems.push(`${where}: an array is required`)
    return
  }
  marks.forEach((mark, i) => {
    const at = `${where}[${i}]`
    if (!isObject(mark) || !isInt(mark.line)) {
      problems.push(`${at}.line: an integer ≥ 1 is required`)
      return
    }
    if (range && (mark.line < range.first || mark.line > range.last)) {
      problems.push(`${at}.line: ${mark.line} is outside the excerpt`)
    }
    const { from, to } = mark
    if (from !== undefined && !isInt(from, 0))
      problems.push(`${at}.from: an integer ≥ 0 is required`)
    if (to !== undefined && !isInt(to, 0))
      problems.push(`${at}.to: an integer ≥ 0 is required`)
    if (isInt(from, 0) && isInt(to, 0) && to <= from)
      problems.push(`${at}: to must be after from`)
    if (mark.note !== undefined && !isText(mark.note, MAX_NOTE)) {
      problems.push(`${at}.note: up to ${MAX_NOTE} characters`)
    }
  })
}

/**
 * The problems of an anchor: its path, line, excerpt and marks (a finding's, or a related one's).
 * @param {any} anchor
 * @param {string} where
 * @param {string[]} problems
 */
function checkAnchor(anchor, where, problems) {
  if (!isRelativePath(anchor.path))
    problems.push(`${where}.path: a path relative to the project is required`)
  if (!isInt(anchor.line)) problems.push(`${where}.line: an integer ≥ 1 is required`)
  const excerpt = checkExcerpt(anchor.excerpt, `${where}.excerpt`, problems)
  const hunk =
    anchor.hunk === undefined
      ? undefined
      : checkHunk(anchor.hunk, `${where}.hunk`, problems)
  const range = hunk ?? excerpt
  if (
    range &&
    isInt(anchor.line) &&
    (anchor.line < range.first || anchor.line > range.last)
  ) {
    problems.push(
      `${where}.line: ${anchor.line} is outside the ${hunk ? 'hunk' : 'excerpt'}`,
    )
  }
  checkMarks(anchor.marks, `${where}.marks`, range, problems)
}

/**
 * @param {any} finding
 * @param {string} where
 * @param {boolean} theirs
 * @param {string[]} problems
 * @param {string | undefined} forge The review's PR/MR forge: a thread is one of its; none, no thread.
 */
function checkFinding(finding, where, theirs, problems, forge) {
  if (!isObject(finding)) {
    problems.push(`${where}: an object is required`)
    return
  }
  if (!isId(finding.id)) problems.push(`${where}.id: letters, digits, - and _ only`)
  if (!TOPICS.includes(finding.topic))
    problems.push(`${where}.topic: one of ${TOPICS.join(', ')}`)
  if (!BUCKETS.has(finding.bucket)) problems.push(`${where}.bucket: review or auto`)
  if (finding.tag !== undefined && !TAGS.includes(finding.tag)) {
    problems.push(`${where}.tag: ${TAGS.join(', ')}`)
  }
  if (!isText(finding.title, MAX_TITLE)) {
    problems.push(`${where}.title: up to ${MAX_TITLE} characters are required`)
  }
  checkAnchor(finding, where, problems)
  for (const key of ['problem', 'why', 'fix']) {
    if (!isText(finding[key])) problems.push(`${where}.${key}: a text is required`)
  }
  if (finding.comment !== undefined && !isText(finding.comment, MAX_COMMENT)) {
    problems.push(`${where}.comment: up to ${MAX_COMMENT} characters`)
  } else if (theirs && finding.comment === undefined) {
    problems.push(`${where}.comment: required when ownership is theirs`)
  }
  const { diagram, related } = finding
  if (diagram !== undefined) {
    if (!isObject(diagram) || !['mermaid', 'svg', 'text'].includes(diagram.kind)) {
      problems.push(`${where}.diagram.kind: mermaid, svg or text`)
    } else if (!isText(diagram.source, MAX_DIAGRAM)) {
      problems.push(`${where}.diagram.source: up to 64 KiB are required`)
    } else if (diagram.caption !== undefined && !isText(diagram.caption, MAX_NOTE)) {
      problems.push(`${where}.diagram.caption: up to ${MAX_NOTE} characters`)
    }
  }
  if (related !== undefined) {
    if (!Array.isArray(related) || related.length > MAX_RELATED) {
      problems.push(`${where}.related: up to ${MAX_RELATED} excerpts`)
    } else {
      related.forEach((one, i) => {
        if (isObject(one)) checkAnchor(one, `${where}.related[${i}]`, problems)
        else problems.push(`${where}.related[${i}]: an object is required`)
      })
    }
  }
  if (finding.addedAt !== undefined && !isText(finding.addedAt, 100)) {
    problems.push(`${where}.addedAt: a date is required`)
  }
  if (finding.verified !== undefined && typeof finding.verified !== 'boolean') {
    problems.push(`${where}.verified: true or false`)
  }
  if (finding.thread !== undefined) {
    checkThread(finding.thread, `${where}.thread`, problems)
    if (isObject(finding.thread) && finding.thread.forge !== forge)
      problems.push(
        forge
          ? `${where}.thread.forge: ${forge}, the review's PR/MR's`
          : `${where}.thread: the review has no PR/MR to hold it`,
      )
  }
}

/** @param {unknown} value */
const isUrl = (value) => isText(value, 2000) && /^https?:\/\//.test(String(value))

/** A url naming a user or a password before its host: what host it reaches is not what it reads. */
const hasUserInfo = (/** @type {string} */ value) => {
  try {
    const url = new URL(value)
    return url.username !== '' || url.password !== ''
  } catch {
    return true
  }
}

/**
 * @param {any} thread
 * @param {string} where
 * @param {string[]} problems
 */
function checkThread(thread, where, problems) {
  if (!isObject(thread)) {
    problems.push(`${where}: an object is required`)
    return
  }
  if (!FORGES.has(thread.forge)) problems.push(`${where}.forge: github or gitlab`)
  if (!isText(thread.id, 200)) problems.push(`${where}.id: the thread's id is required`)
  if (!isUrl(thread.url)) problems.push(`${where}.url: an http(s) url is required`)
  for (const key of ['outdated', 'file']) {
    if (thread[key] !== undefined && typeof thread[key] !== 'boolean')
      problems.push(`${where}.${key}: true or false`)
  }
  const { comments } = thread
  if (
    !Array.isArray(comments) ||
    comments.length < 1 ||
    comments.length > MAX_THREAD_COMMENTS
  ) {
    problems.push(`${where}.comments: 1 to ${MAX_THREAD_COMMENTS} comments are required`)
    return
  }
  comments.forEach((comment, i) => {
    const at = `${where}.comments[${i}]`
    if (!isObject(comment)) {
      problems.push(`${at}: an object is required`)
      return
    }
    if (!isText(comment.author, 300))
      problems.push(`${at}.author: a user name is required`)
    if (typeof comment.body !== 'string' || comment.body.length > MAX_THREAD_BODY)
      problems.push(
        `${at}.body: a text of up to ${MAX_THREAD_BODY} characters is required`,
      )
    if (!isText(comment.at, 100)) problems.push(`${at}.at: a date is required`)
    if (comment.url !== undefined && !isUrl(comment.url))
      problems.push(`${at}.url: an http(s) url`)
  })
}

/**
 * What is wrong with one finding, as a producer wrote it: empty when it is
 * sound. `theirs`: a comment is then required. `forge`: the review's PR/MR's
 * (`forgeOf`), which a `thread` must be on.
 * @param {unknown} finding
 * @param {{ theirs?: boolean, where?: string, forge?: string | undefined }} [options]
 * @returns {string[]}
 */
export function validateFinding(
  finding,
  { theirs = false, where = 'finding', forge } = {},
) {
  /** @type {string[]} */
  const problems = []
  checkFinding(finding, where, theirs, problems, forge)
  return problems
}

/** The forge of a review's PR/MR, `gitlab` when it names none; undefined with none. */
export const forgeOf = (/** @type {{ mr?: { forge?: string } }} */ review) =>
  review.mr ? (review.mr.forge ?? 'gitlab') : undefined

/**
 * @param {any} mr
 * @param {string[]} problems
 */
function checkMr(mr, problems) {
  if (!isObject(mr)) {
    problems.push('mr: an object is required')
    return
  }
  if (mr.forge !== undefined && !FORGES.has(mr.forge))
    problems.push('mr.forge: github or gitlab')
  if (!isText(mr.project, 300) && !isInt(mr.project)) {
    problems.push('mr.project: a GitLab path or numeric id is required')
  }
  if (!isInt(mr.iid)) problems.push('mr.iid: an integer ≥ 1 is required')
  if (!isUrl(mr.url) || hasUserInfo(mr.url))
    problems.push('mr.url: an http(s) url, with no user or password, is required')
  if (!isText(mr.author, 300)) problems.push('mr.author: a user name is required')
  if (mr.viewer !== undefined && !isText(mr.viewer, 300))
    problems.push('mr.viewer: a user name')
  if (mr.diffRefs !== undefined && mr.forge === 'github') {
    problems.push('mr.diffRefs: GitLab only')
  } else if (mr.diffRefs !== undefined) {
    const refs = isObject(mr.diffRefs) ? mr.diffRefs : {}
    for (const key of ['baseSha', 'headSha', 'startSha']) {
      if (!SHA.test(String(refs[key])))
        problems.push(`mr.diffRefs.${key}: a sha is required`)
    }
  }
}

/**
 * What is wrong with a review's envelope, its findings left aside: empty when
 * it is sound. `version` is checked first: another version has nothing else
 * to say.
 * @param {any} review
 * @returns {string[]}
 */
export function validateEnvelope(review) {
  if (!isObject(review)) return ['a JSON object is required']
  if (review.version !== REVIEW_VERSION) {
    return [
      `unknown review format (version ${JSON.stringify(review.version)}): ` +
        `this Tranchant reads version ${REVIEW_VERSION}`,
    ]
  }
  /** @type {string[]} */
  const problems = []
  if (!isId(review.id)) problems.push('id: letters, digits, - and _ only')
  if (!isText(review.createdAt, 100)) problems.push('createdAt: a date is required')
  if (typeof review.project !== 'string' || !path.isAbsolute(review.project)) {
    problems.push('project: an absolute path is required')
  }
  for (const key of ['branch', 'base']) {
    if (!isText(review[key], 500)) problems.push(`${key}: a text is required`)
  }
  if (!SHA.test(String(review.headSha))) problems.push('headSha: a sha is required')
  if (!OWNERSHIPS.has(review.ownership)) problems.push('ownership: ours or theirs')
  if (review.status !== undefined && !STATUSES.has(review.status)) {
    problems.push('status: preparing, reviewing, complete or refused')
  }
  if (
    review.lenses !== undefined &&
    (!Array.isArray(review.lenses) ||
      !review.lenses.every(
        (/** @type {any} */ lens) =>
          isObject(lens) &&
          isText(lens.name, 40) &&
          isText(lens.source, 1000) &&
          /^[0-9a-f]{64}$/.test(String(lens.hash)) &&
          (lens.version === undefined || isText(lens.version, 100)),
      ))
  ) {
    problems.push('lenses: an array of { name, source, version?, hash }')
  }
  if (
    review.refusal !== undefined &&
    (!isObject(review.refusal) ||
      !isText(review.refusal.lens, 100) ||
      typeof review.refusal.source !== 'string' ||
      !isText(review.refusal.reason, 2000))
  ) {
    problems.push('refusal: { lens, source, reason, fix? }')
  }
  if (!isText(review.title, 300)) problems.push('title: a text is required')
  if (typeof review.summary !== 'string')
    problems.push('summary: a Markdown text is required')
  if (
    !Array.isArray(review.strengths) ||
    review.strengths.some((s) => typeof s !== 'string')
  ) {
    problems.push('strengths: an array of texts is required')
  }
  if (review.mr !== undefined) checkMr(review.mr, problems)
  if (
    review.jira !== undefined &&
    (!isObject(review.jira) || !isText(review.jira.key, 50))
  ) {
    problems.push('jira.key: a text is required')
  }
  if (review.sources !== undefined && !isObject(review.sources)) {
    problems.push('sources: an object is required')
  }
  if (review.verify !== undefined && typeof review.verify !== 'boolean') {
    problems.push('verify: true or false')
  }
  return problems
}

/**
 * What is wrong with a review, as its producer wrote it: empty when it is
 * sound. The findings may be empty only while the review is not `complete`.
 * @param {any} review
 * @returns {string[]}
 */
export function validateReview(review) {
  const problems = validateEnvelope(review)
  if (!isObject(review) || review.version !== REVIEW_VERSION) return problems
  const { findings } = review
  const reviewing = statusOf(review) !== 'complete'
  if (!Array.isArray(findings) || (findings.length === 0 && !reviewing)) {
    problems.push(
      reviewing ? 'findings: an array is required' : 'findings: at least one is required',
    )
    return problems
  }
  const theirs = review.ownership === 'theirs'
  const ids = new Set()
  findings.forEach((finding, i) => {
    checkFinding(finding, `findings[${i}]`, theirs, problems, forgeOf(review))
    const id = isObject(finding) ? String(finding.id) : ''
    if (ids.has(id)) problems.push(`findings[${i}].id: ${id} is used twice`)
    ids.add(id)
  })
  return problems
}

/**
 * The review file's content, or a FormatError naming what is wrong.
 * @param {string} text
 * @returns {Review}
 */
export function parseReview(text) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new FormatError('the review is not JSON')
  }
  const problems = validateReview(json)
  if (problems.length) throw new FormatError(problemsText(problems))
  return json
}

/**
 * The first problems of a list as one message.
 * @param {readonly string[]} problems
 */
export function problemsText(problems) {
  const shown = problems.slice(0, 3).join('; ')
  const more = problems.length > 3 ? ` (and ${problems.length - 3} more)` : ''
  return `${shown}${more}`
}

/**
 * `value` with its objects' keys sorted, at every depth: two layouts of the
 * same content stringify alike.
 * @param {any} value
 * @returns {any}
 */
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : isObject(value)
      ? Object.fromEntries(
          Object.keys(value)
            .toSorted()
            .map((key) => [key, canonical(value[key])]),
        )
      : value

/**
 * A review's envelope: everything but its findings, as review.json holds it.
 * @template {{ findings?: unknown }} T
 * @param {T} review
 * @returns {Omit<T, 'findings'>}
 */
export function envelopeOf(review) {
  const { findings: _findings, ...envelope } = review
  return envelope
}

/**
 * What tells a review from another with the same id, as JSON: its envelope,
 * status and `verify` left out. A review that grew, or completed, is still the
 * same one, opened again without `--verify` too.
 * @param {{ findings?: unknown, status?: unknown, verify?: unknown }} review
 */
export function identityOf(review) {
  const { status: _status, verify: _verify, ...identity } = envelopeOf(review)
  return JSON.stringify(canonical(identity))
}

/**
 * A finding's content as JSON, `addedAt` and `verified` left out: the same
 * finding added again agrees with its file, verified or not.
 * @param {{ addedAt?: unknown, verified?: unknown }} finding
 */
export function contentOf(finding) {
  const { addedAt: _addedAt, verified: _verified, ...content } = finding
  return JSON.stringify(canonical(content))
}

/**
 * The decisions file's content, or a FormatError saying what to do.
 * @param {string} text
 * @param {string} [file] Named in the message.
 * @returns {Decisions}
 */
export function parseDecisions(text, file = 'decisions.json') {
  const data = JSON.parse(text)
  if (data?.version !== DECISIONS_VERSION || !isObject(data.findings)) {
    throw new FormatError(
      `unknown decisions format (version ${JSON.stringify(data?.version)}) in ${file}: ` +
        `this Tranchant reads version ${DECISIONS_VERSION}`,
    )
  }
  return data
}

/** A new run starts with each claim. @param {Pick<Entry, 'runs'>} entry */
export function nextRunId(entry) {
  const used = entry.runs.map((run) => Number(run.id.replace(/^r/, '')) || 0)
  return `r${Math.max(0, ...used) + 1}`
}

/**
 * The run in progress: the one that has not ended, while working.
 * @param {Pick<Entry, 'state' | 'runs'>} entry
 */
export const currentRun = (entry) =>
  entry.state === 'working' ? entry.runs.findLast((run) => !run.endedAt) : undefined
