// The files of docs/review-file.md, as the page reads them, and the pure rules
// it applies to them: grouping, the moves a finding allows, selections.

export type Ownership = 'ours' | 'theirs'
export type Bucket = 'review' | 'auto'
export type Tag = 'concern' | 'question' | 'suggestion'
/** `reviewing` while the producer still adds findings; `complete` once done. */
type Status = 'reviewing' | 'complete'

/** The seven topics, in the order the page lists them within a bucket. */
const TOPICS = [
  'Bugs',
  'Security & Permissions',
  'Breaking Changes',
  'Tests',
  'Conventions',
  'Code Quality',
  'Deprecation & Feature Flags',
] as const

export interface Excerpt {
  /** The number of `lines[0]`, new side, 1-based. */
  startLine: number
  lines: string[]
}

export interface Mark {
  /** Within the excerpt, or the hunk's new side. */
  line: number
  /** Columns, 0-based, `from` inclusive and `to` exclusive; absent, the whole line. */
  from?: number
  to?: number
  note?: string
}

export interface Diagram {
  kind: 'svg' | 'text' | 'mermaid'
  source: string
  caption?: string
}

interface Related {
  path: string
  line: number
  excerpt: Excerpt
  marks?: Mark[]
}

export interface Finding {
  id: string
  topic: string
  bucket: Bucket
  /** `concern` when absent. */
  tag?: Tag
  title: string
  path: string
  /** The anchor line, new side, 1-based. */
  line: number
  excerpt: Excerpt
  /** A unified-diff hunk, shown in place of the excerpt when present. */
  hunk?: string
  marks?: Mark[]
  problem: string
  why: string
  fix: string
  /** The text to post, whole; required when the review is `theirs`, optional on `ours` with an `mr`. */
  comment?: string
  diagram?: Diagram
  related?: Related[]
  /** When it joined the review: set by the import, or by add.mjs. */
  addedAt?: string
  /** A verifier confirmed it; read only when the review's `verify` is true. */
  verified?: boolean
}

interface DiffRefs {
  baseSha: string
  headSha: string
  startSha: string
}

interface MergeRequest {
  project: string | number
  iid: number
  url: string
  author?: string
  /** Required to post: a positioned comment needs all three. */
  diffRefs?: DiffRefs
}

export interface Review {
  version: 1
  id: string
  createdAt: string
  project: string
  branch: string
  base: string
  headSha: string
  ownership: Ownership
  /** `complete` when absent: the producer wrote the review whole. */
  status?: Status
  title: string
  mr?: MergeRequest
  jira?: { key: string; url: string }
  /** Markdown. */
  summary: string
  strengths?: string[]
  sources?: { codeReview?: number; reviewPr?: number; both?: number }
  /** Findings land unverified and a verifier confirms each: `/tranchant review` sets it. */
  verify?: boolean
  findings: Finding[]
}

export type State =
  | 'open'
  | 'queued'
  | 'working'
  | 'asking'
  | 'fixed'
  | 'posted'
  | 'dropped'
  | 'skipped'
  | 'failed'
  | 'stopped'

/** What the reviewer asks of a finding, as `POST /api/decisions` takes it. */
export type Action = 'fix' | 'post' | 'drop' | 'skip'

export interface DecisionInput {
  id: string
  action: Action
  /** `fix`: what the agent should know. */
  context?: string
  /** `post`: the comment as the reviewer rewrote it. */
  comment?: string
  /** `drop`: why. */
  reason?: string
}

export interface DecisionsResult {
  applied: string[]
  refused: { id: string; reason: string }[]
}

interface Run {
  id: string
  agent?: string
  model?: string
  startedAt: string
  endedAt?: string
  /** Absent while running. */
  outcome?: 'fixed' | 'asking' | 'failed' | 'stopped'
  summary?: string
  changed?: string[]
}

interface Event {
  at: string
  state: State
  by: 'reviewer' | 'agent' | 'server'
  run?: string
  agent?: string
}

interface Option {
  label: string
  description?: string
}

interface Question {
  text: string
  options?: Option[]
  multiple?: boolean
  at: string
}

/** A finding's entry in decisions.json; a finding without one is `open`. */
export interface FindingRecord {
  state: State
  decision?: { action: Action; context?: string; at: string }
  comment?: string
  question?: Question
  answer?: { text: string; choices?: string[]; at: string }
  /** `dropped`: the reviewer's words; `failed`: the error. */
  reason?: string
  posted?: { discussionId: string; url: string; at: string }
  runs: Run[]
  events: Event[]
  cancellation?: { at: string; changed: string[]; steps: number; run?: string }
}

/** One line of a run file: a tool the agent's hooks recorded. */
export interface Step {
  at: number
  /** `start`, `read`, `edit`, `write`, `bash`, `search`, `note` or `tool`; a review agent's last is `end`. */
  kind: string
  label: string
  state: 'running' | 'done' | 'failed'
  detail?: string
  /** `start` only. */
  model?: string
}

/** An agent of `/tranchant review`: a lens's reviewer (`rv-…`) or a finding's verifier (`vf-…`). */
export interface ReviewAgent {
  name: string
  running: boolean
  outcome?: 'done' | 'failed'
  /** Its last 50 steps. */
  steps: Step[]
}

/** What `GET /api/review` answers. */
export interface ReviewPayload {
  review: Review
  findings: Record<string, FindingRecord>
  /** By finding id: the last 50 steps of its run in progress. */
  runs: Record<string, Step[]>
  /** The review's agents, in the order they started; absent from older servers. */
  reviewers?: ReviewAgent[]
  head: { reviewed: string; current: string | null }
}

export type Records = Record<string, FindingRecord>

export const stateOf = (records: Records, id: string): State =>
  records[id]?.state ?? 'open'

export const BUCKET_LABELS: Record<Bucket, string> = {
  review: 'Needs your review',
  auto: 'Safe to auto-fix',
}

/** What a state means to the reviewer; the page shows GROUP_LABELS, never a state's name. */
type Group = 'toDo' | 'inProgress' | 'needsYou' | 'done' | 'setAside'

// Exhaustive so a new state cannot drop out of the header unnoticed at compile time.
const GROUP_OF: Record<State, Group> = {
  open: 'toDo',
  queued: 'inProgress',
  working: 'inProgress',
  asking: 'needsYou',
  failed: 'needsYou',
  fixed: 'done',
  posted: 'done',
  dropped: 'setAside',
  skipped: 'setAside',
  stopped: 'setAside',
}

export const GROUP_LABELS: Record<Group, string> = {
  toDo: 'To do',
  inProgress: 'In progress',
  needsYou: 'Needs you',
  done: 'Done',
  setAside: 'Set aside',
}

export const stateLabel = (state: State) => GROUP_LABELS[GROUP_OF[state]]

// One class per group, so states that mean the same look the same.
export const GROUP_CLASSES: Record<Group, string> = {
  toDo: 'tr-chip tr-chip--to-do',
  inProgress: 'tr-chip tr-chip--in-progress',
  needsYou: 'tr-chip tr-chip--needs-you',
  done: 'tr-chip tr-chip--done',
  setAside: 'tr-chip tr-chip--set-aside',
}

// decisions.json is not checked state by state: an unknown one keeps the chip's shape.
export const groupClass = (group: Group) =>
  Object.hasOwn(GROUP_CLASSES, group) ? GROUP_CLASSES[group] : 'tr-chip'

export const stateClass = (state: State) => groupClass(GROUP_OF[state])

/** What the chip's group hides: which of its states the finding is in. */
export const STATE_DETAILS: Record<State, string> = {
  open: 'Nothing decided yet',
  queued: 'Waiting for its agent to start',
  working: 'An agent is fixing it',
  asking: 'The agent asks you a question',
  failed: 'The fix did not land',
  fixed: 'Fixed on the working tree',
  posted: 'Posted on the merge request',
  dropped: 'You chose not to act on it',
  skipped: 'Skipped for now',
  stopped: 'You stopped its agent: it may have left changes',
}

export const tagOf = (finding: Pick<Finding, 'tag'>): Tag => finding.tag ?? 'concern'

/** The findings no verifier confirmed yet, in a review whose findings are verified. */
export const unverifiedIds = (review: Pick<Review, 'verify' | 'findings'>) =>
  new Set(
    review.verify
      ? review.findings.filter((one) => one.verified !== true).map((one) => one.id)
      : [],
  )

/** Whether findings may still land: the page then shows the review in progress. */
export const isReviewing = (review: Pick<Review, 'status'>) =>
  review.status === 'reviewing'

export const plural = (count: number, noun: string, many = `${noun}s`) =>
  `${count} ${count === 1 ? noun : many}`

/** What decides posting: the MR and the commit reviewed. */
export type PostScope = Pick<Review, 'ownership' | 'mr' | 'headSha'>

/**
 * Why a review with an MR cannot post, as the store words it; undefined when
 * it can, or has no MR to post on at all (no reason worth showing then).
 */
export function staleMrReason(review: PostScope): string | undefined {
  const head = review.mr?.diffRefs?.headSha
  if (!head || head.startsWith(review.headSha) || review.headSha.startsWith(head))
    return undefined
  return review.ownership === 'theirs'
    ? 'the MR moved past the commit reviewed: review it again'
    : "push your branch first: the MR's head is not the one reviewed"
}

/** Posting needs an MR, whoever's, and its diff at the commit reviewed. */
export const canPost = (review: PostScope) =>
  !!review.mr?.diffRefs && !staleMrReason(review)

/** A finding a batch or a shortcut may post as is: it has its text. */
export const hasComment = (finding: Pick<Finding, 'comment'> | undefined) =>
  !!finding?.comment?.trim()

type Draftable = Pick<Finding, 'comment' | 'problem' | 'fix'>

/** The text a post sends: as last rewritten, else the finding's, else drafted from its problem and fix. */
export const draftComment = (
  finding: Draftable,
  record?: Pick<FindingRecord, 'comment'>,
) => record?.comment ?? finding.comment ?? `${finding.problem}\n\n${finding.fix}`

/** A post as a batch sends it: the finding's own comment goes as is, anything else with its text. */
export function postInput(
  finding: Draftable & Pick<Finding, 'id'>,
  record?: Pick<FindingRecord, 'comment'>,
): DecisionInput {
  const text =
    record?.comment ?? (hasComment(finding) ? undefined : draftComment(finding))
  return text?.trim()
    ? { id: finding.id, action: 'post', comment: text.trim() }
    : { id: finding.id, action: 'post' }
}

/**
 * The findings to mark as having a comment: only on your own MR, where a
 * finding may have none; someone else's review has one on every finding.
 */
export const commentedIds = (review: PostScope & Pick<Review, 'findings'>) =>
  new Set(
    review.ownership === 'ours' && canPost(review)
      ? review.findings.filter(hasComment).map((finding) => finding.id)
      : [],
  )

const FIX_FROM = new Set<State>(['open', 'dropped', 'skipped', 'failed', 'stopped'])
const POST_FROM = new Set<State>(['open', 'dropped', 'skipped', 'failed'])
// Nothing has landed in these states: a reviewer may still drop or skip.
const UNDECIDED: readonly State[] = ['open', 'queued', 'asking', 'failed', 'stopped']
const DROP_FROM = new Set<State>([...UNDECIDED, 'skipped'])
const SKIP_FROM = new Set<State>([...UNDECIDED, 'dropped'])

/** Whether a post may leave `state`, the review aside. */
export const postsFrom = (state: State) => POST_FROM.has(state)

/** A move the page offers: the store's, `answer` being sent by the asking form. */
export type Move = Action | 'stop' | 'answer'

type Rule = (state: State, review: PostScope) => boolean

/** The store's moves table: a `fixed` or `posted` finding is final. */
const MOVES: Record<Move, Rule> = {
  fix: (state) => FIX_FROM.has(state),
  post: (state, review) => canPost(review) && POST_FROM.has(state),
  drop: (state) => DROP_FROM.has(state),
  skip: (state) => SKIP_FROM.has(state),
  stop: (state) => state === 'queued' || state === 'working',
  answer: (state) => state === 'asking',
}

/** Whether the store accepts `move` on a finding in `state`. */
export const allows = (move: Move, state: State, review: PostScope): boolean =>
  MOVES[move](state, review)

interface TopicGroup {
  topic: string
  findings: Finding[]
}

export interface BucketGroup {
  bucket: Bucket
  label: string
  topics: TopicGroup[]
}

const topicRank = (topic: string) => {
  const index = (TOPICS as readonly string[]).indexOf(topic)
  return index === -1 ? TOPICS.length : index
}

const byAnchor = (a: Finding, b: Finding) =>
  a.path.localeCompare(b.path) || a.line - b.line || a.id.localeCompare(b.id)

/** By bucket (review first), then topic (the seven in order, unknown last), then `path:line`. */
export function groupFindings(findings: readonly Finding[]): BucketGroup[] {
  const groups: BucketGroup[] = []
  for (const bucket of ['review', 'auto'] as const) {
    const inBucket = findings.filter((finding) => finding.bucket === bucket)
    if (!inBucket.length) continue
    const topics = [...new Set(inBucket.map((finding) => finding.topic))].toSorted(
      (a, b) => topicRank(a) - topicRank(b) || a.localeCompare(b),
    )
    groups.push({
      bucket,
      label: BUCKET_LABELS[bucket],
      topics: topics.map((topic) => ({
        topic,
        findings: inBucket
          .filter((finding) => finding.topic === topic)
          .toSorted(byAnchor),
      })),
    })
  }
  return groups
}

/** The findings in the order the list shows them. */
export const orderedFindings = (findings: readonly Finding[]): Finding[] =>
  groupFindings(findings).flatMap((group) =>
    group.topics.flatMap((topic) => topic.findings),
  )

/** An agent waits for an answer, or a fix did not land: the reviewer must act. */
export const needsYou = (state: State) => GROUP_OF[state] === 'needsYou'

/** The header's counts, by what each finding's state means to the reviewer. */
export function counts(review: Pick<Review, 'findings'>, records: Records) {
  const tally: Record<Group, number> = {
    toDo: 0,
    inProgress: 0,
    needsYou: 0,
    done: 0,
    setAside: 0,
  }
  for (const finding of review.findings) tally[GROUP_OF[stateOf(records, finding.id)]]++
  return tally
}

/** Of `ids`, the findings `action` can move now; a batch applies only to those. */
export const applicable = (
  ids: Iterable<string>,
  action: Action,
  records: Records,
  review: PostScope,
): string[] => [...ids].filter((id) => allows(action, stateOf(records, id), review))

/** Ids of the findings in `bucket`. */
export const idsInBucket = (review: Pick<Review, 'findings'>, bucket: Bucket) =>
  review.findings.filter((finding) => finding.bucket === bucket).map((f) => f.id)

/**
 * The first `open` finding after `id` in `ordered`, wrapping once; `id`
 * itself never: `records` may predate the decision on it.
 */
export function nextOpen(
  ordered: readonly Pick<Finding, 'id'>[],
  records: Records,
  id: string,
): string | undefined {
  const index = ordered.findIndex((finding) => finding.id === id)
  for (let step = 1; step <= ordered.length; step++) {
    const next = ordered[(index + step) % ordered.length]
    if (next && next.id !== id && stateOf(records, next.id) === 'open') return next.id
  }
  return undefined
}

/** Ids of the findings nothing was decided on. */
export const openIds = (review: Pick<Review, 'findings'>, records: Records) =>
  review.findings
    .filter((finding) => stateOf(records, finding.id) === 'open')
    .map((finding) => finding.id)

/** The model of a run, named as the reviewer knows it: its family, else the id. */
export const modelName = (model: string) =>
  /opus|sonnet|haiku|fable/i.exec(model)?.[0].toLowerCase() ?? model
