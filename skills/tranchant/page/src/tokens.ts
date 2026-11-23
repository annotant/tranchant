// What a review's agents spent, as the header's chip and the Tokens screen say
// it. The server sums the figures (`/api/review`'s `usage`); this only words
// them and counts what each lens found. Pure, so it is tested alone.
import {
  type Discussion,
  type Finding,
  type FindingRecord,
  type FindingUsage,
  type LensesProgress,
  plural,
  type Records,
  type Review,
  type ReviewAgent,
  type ReviewUsage,
  type State,
  stateOf,
  type Usage,
  type UsagePart,
  type UsageKind,
} from './domain'
import { lensOf } from './progress'
import type { LensHistory } from './settings'

/** `2.90M`, `412k`, `950`. */
export function formatTokens(count: number) {
  if (count >= 999_500) {
    const millions = count / 1_000_000
    return `${millions.toFixed(millions >= 10 ? 1 : 2)}M`
  }
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}

/** Paused from the page, still reviewing: whether anything runs is the caller's to check. */
const pausedOf = (review: Pick<Review, 'paused' | 'stopped' | 'status'>) =>
  !!review.paused && !review.stopped && review.status === 'reviewing'

/** A floor: a figure partial, or an agent that reported none. */
const atLeastOf = (usage: ReviewUsage) =>
  !!usage.total?.partial || usage.notReported.length > 0

export interface Chip {
  text: string
  tone: 'live' | 'paused' | 'still'
}

/** The header's chip; none with no usage: never a zero. */
export function chipOf(
  usage: ReviewUsage | undefined,
  review: Pick<Review, 'paused' | 'stopped' | 'status'>,
): Chip | undefined {
  if (!usage?.total) return undefined
  const amount = `${atLeastOf(usage) ? 'at least ' : ''}${formatTokens(usage.total.tokens)} tokens`
  // A fix or a discussion under way runs whatever Pause or Stop said.
  if (usage.running) return { text: `${amount} so far`, tone: 'live' }
  if (pausedOf(review)) return { text: `${amount} · paused`, tone: 'paused' }
  return { text: amount, tone: 'still' }
}

/** A figure in a cell: `—` when not reported, `so far` while it runs, `at least` when partial. */
export function cellOf(usage: Usage | null | undefined, running = false) {
  if (!usage) return running ? 'so far' : '—'
  const amount = `${usage.partial ? 'at least ' : ''}${formatTokens(usage.tokens)}`
  return running ? `${amount} so far` : amount
}

/**
 * Whether an agent the page lists works now: its run file has no end step, the
 * server counts something live, and not this agent's figure as a past session's.
 */
function liveOf(usage: ReviewUsage) {
  const stale = new Set([...usage.partial, ...usage.notReported])
  return (agent: Pick<ReviewAgent, 'name' | 'running'> | undefined) =>
    !!agent?.running && usage.running && !stale.has(agent.name)
}

/** The four counts summed over the models, and the models: one line under a row. */
function breakdownOf(usage: Usage | null | undefined) {
  if (!usage) return ''
  const sum = (key: 'input' | 'output' | 'cacheRead' | 'cacheWrite') =>
    formatTokens(usage.models.reduce((total, one) => total + one[key], 0))
  return [
    `in ${sum('input')}`,
    `out ${sum('output')}`,
    `cache read ${sum('cacheRead')}`,
    `cache write ${sum('cacheWrite')}`,
    ...usage.models.map((one) => one.model),
  ].join(' · ')
}

const KIND_LABELS: Record<UsageKind, string> = {
  summary: 'Summary',
  reviewers: 'Reviewers',
  verifiers: 'Verifiers',
  fixes: 'Fixes',
  discussions: 'Discussions',
  cleanings: 'Cleanings',
}

/** A run name's kind, as the server names its agents. */
function kindOf(label: string): UsageKind | undefined {
  if (label.startsWith('fix:')) return 'fixes'
  const prefix = label.slice(0, 3)
  return (
    {
      'sm-': 'summary' as const,
      'rv-': 'reviewers' as const,
      'vf-': 'verifiers' as const,
      'ds-': 'discussions' as const,
      'cl-': 'cleanings' as const,
    } as Record<string, UsageKind>
  )[prefix]
}

/** A run name as a reader says it: `the verifier of tests-3`, `the fix of f-03 (r1)`, `the reviewer of bugs (run 2)`. */
export function whoOf(label: string) {
  const [name = label, again] = label.split('#')
  const run = again ? ` (run ${again})` : ''
  if (name.startsWith('fix:')) {
    const [, id, fix] = name.split(':')
    return `the fix of ${id}${fix ? ` (${fix})` : ''}`
  }
  const rest = name.slice(3)
  const kind = kindOf(name)
  const who =
    kind === 'summary'
      ? 'the summary agent'
      : kind === 'reviewers'
        ? `the reviewer of ${rest}`
        : kind === 'verifiers'
          ? `the verifier of ${rest}`
          : kind === 'discussions'
            ? `the discussion of ${rest}`
            : kind === 'cleanings'
              ? `the cleaning ${name}`
              : name
  return `${who}${run}`
}

/** "a", "a and b", "a, b and c". */
const listed = (names: readonly string[]) =>
  names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

export interface KindRow {
  key: string
  name: string
  agents: string
  tokens: string
  /** Its share of the review's total, in percent; null when not reported. */
  share: number | null
  detail: string
  running: boolean
}

/** What is at work now, by kind: the server says only whether anything is. */
export interface AtWork {
  reviewers: readonly Pick<ReviewAgent, 'name' | 'running'>[]
  records: Records
  discussions: Record<string, Discussion> | undefined
  lenses: LensesProgress | undefined
}

function runningKinds(usage: ReviewUsage, at: AtWork) {
  const kinds = new Set<UsageKind>()
  // A live figure older than the serving session is no longer live: neither is its row.
  if (!usage.running) return kinds
  const live = liveOf(usage)
  for (const agent of at.reviewers) {
    const kind = live(agent) ? kindOf(agent.name) : undefined
    if (kind) kinds.add(kind)
  }
  if (Object.values(at.records).some((record) => record.state === 'working'))
    kinds.add('fixes')
  if (Object.values(at.discussions ?? {}).some((one) => one.step))
    kinds.add('discussions')
  if (at.lenses?.lenses.some((row) => row.cleaning === 'running')) kinds.add('cleanings')
  return kinds
}

/** One row per kind that ran an agent, then what resets removed. */
export function kindRows(usage: ReviewUsage, at: AtWork): KindRow[] {
  const whole = usage.total?.tokens ?? 0
  const share = (tokens: number) => (whole ? Math.round((tokens / whole) * 100) : 0)
  const running = runningKinds(usage, at)
  const rows = usage.kinds.map((one): KindRow => {
    const missing = usage.notReported.filter((label) => kindOf(label) === one.kind).length
    const live = running.has(one.kind)
    return {
      key: one.kind,
      name: KIND_LABELS[one.kind],
      agents: missing ? `${one.agents} · ${missing} not reported` : String(one.agents),
      tokens: cellOf(one.usage, live),
      share: one.usage ? share(one.usage.tokens) : null,
      detail: breakdownOf(one.usage),
      running: live,
    }
  })
  const reset = usage.reset
  if (reset?.usage)
    rows.push({
      key: 'reset',
      name: 'Before the reset',
      agents: String(reset.kinds.reduce((total, one) => total + one.agents, 0)),
      tokens: cellOf(reset.usage),
      share: share(reset.usage.tokens),
      detail: breakdownOf(reset.usage),
      running: false,
    })
  return rows
}

const SETTLED: ReadonlySet<State> = new Set(['fixed', 'posted', 'moved'])

export interface LensRowView {
  lens: string
  model: string
  review: string
  verify: string
  landed: string
  confirmed: string
  dropped: string
  settled: string
  perConfirmed: string
  running: boolean
  /** Its reviewer ended and its verifiers too, and none of its findings stands confirmed. */
  nothingConfirmed: boolean
  /** Where its reviewer stands, when not done: running, stopped, queued… */
  note?: string
  /** Its reviewer's report is in the reviewers section: the name links to it. */
  report: boolean
}

export interface LensInput {
  usage: ReviewUsage
  review: Pick<Review, 'findings' | 'verify' | 'lenses' | 'paused' | 'stopped' | 'status'>
  records: Records
  reviewers: readonly ReviewAgent[]
  lenses: LensesProgress | undefined
}

/** The model a lens's reviewer ran on: its own start step, else the Lenses step's row. */
function modelOf(agent: ReviewAgent | undefined, row: string | undefined) {
  // The server passes run files' steps through unchecked: a model that is no string is none.
  const model: unknown = agent?.steps.find((step) => step.kind === 'start')?.model
  return typeof model === 'string' && model ? model : row
}

function noteOf(
  agent: ReviewAgent | undefined,
  review: LensInput['review'],
  live: boolean,
) {
  if (!agent)
    return review.stopped
      ? 'not covered'
      : pausedOf(review)
        ? 'paused · not started'
        : 'queued'
  // Its end step never written: the stop ended it, or its session closed.
  if (agent.running && live) return 'running · so far'
  if (agent.running)
    return review.stopped ? 'stopped · last request estimated' : undefined
  if (agent.outcome === 'interrupted') return 'interrupted · runs again on Resume'
  if (agent.outcome === 'failed')
    return review.stopped ? 'stopped · last request estimated' : 'failed · not covered'
  return undefined
}

/** One row per lens the review ran, in the server's order (the most tokens first); those it has no figure of last. */
export function lensRows({ usage, review, records, reviewers, lenses }: LensInput) {
  const agents = new Map(reviewers.map((agent) => [agent.name, agent]))
  const planned = review.lenses?.map((one) => one.name) ?? []
  const names = [...new Set([...usage.lenses.map((one) => one.lens), ...planned])]
  const standing = new Set(review.findings.map((finding) => finding.id))
  const lensOfFinding = (finding: Pick<Finding, 'id' | 'lens'>) =>
    finding.lens ?? lensOf(finding.id, names)
  // A finding its verifier removed is gone from the review; its verifier's run stays.
  const removed = reviewers
    .filter((agent) => agent.name.startsWith('vf-') && !agent.running)
    .map((agent) => agent.name.slice(3))
    .filter((id) => !standing.has(id))
  const figures = new Map(usage.lenses.map((one) => [one.lens, one]))
  const live = liveOf(usage)
  return names.map((lens): LensRowView => {
    const figure = figures.get(lens)
    const agent = agents.get(`rv-${lens}`)
    const own = review.findings.filter((finding) => lensOfFinding(finding) === lens)
    const gone = removed.filter((id) => lensOf(id, names) === lens).length
    const confirmed = own.filter((finding) => !review.verify || finding.verified === true)
    const byYou = own.filter(
      (finding) => stateOf(records, finding.id) === 'dropped',
    ).length
    const settled = own.filter((finding) =>
      SETTLED.has(stateOf(records, finding.id)),
    ).length
    const verifying = own.some((finding) => live(agents.get(`vf-${finding.id}`)))
    // A verifier queued has no run file yet: its finding is unsettled all the same.
    const unverified =
      !!review.verify &&
      own.some((finding) => {
        const verifier = agents.get(`vf-${finding.id}`)
        return finding.verified !== true && (!verifier || verifier.running)
      })
    const reviewing = live(agent)
    const started = !!figure || !!agent
    const blank = (text: string) => (started ? text : '—')
    const tokens = (figure?.reviewer?.tokens ?? 0) + (figure?.verifiers?.tokens ?? 0)
    // A part not reported, or partial: the cost per finding is a floor too.
    const floor =
      !figure?.reviewer ||
      !!figure.reviewer.partial ||
      !!figure.verifiers?.partial ||
      (!!review.verify && gone + own.length > 0 && !figure.verifiers)
    const ended =
      !!agent &&
      !agent.running &&
      agent.outcome !== 'failed' &&
      agent.outcome !== 'interrupted'
    const note = noteOf(agent, review, reviewing)
    return {
      lens,
      model: modelOf(agent, lenses?.lenses.find((row) => row.name === lens)?.model) ?? '',
      review: started ? cellOf(figure?.reviewer, reviewing) : '—',
      verify: figure?.verifiers || verifying ? cellOf(figure?.verifiers, verifying) : '—',
      landed: blank(String(own.length + gone)),
      confirmed: blank(String(confirmed.length)),
      dropped: blank(String(gone + byYou)),
      settled: blank(String(settled)),
      perConfirmed:
        confirmed.length && tokens
          ? `${floor ? 'at least ' : ''}${formatTokens(Math.round(tokens / confirmed.length))}`
          : '—',
      running: reviewing,
      nothingConfirmed: ended && !unverified && confirmed.length === 0,
      ...(note && { note }),
      report: !!agent,
    }
  })
}

/** What the screen says once, above the tables: agents a stop cut, and those not reported. */
export function notesOf(
  usage: ReviewUsage,
  review: Pick<Review, 'paused' | 'stopped'>,
): string[] {
  const notes: string[] = []
  const cut = review.stopped ? 'The stop' : review.paused?.now ? 'Pause now' : undefined
  if (cut)
    notes.push(
      `${cut} ended agents mid-request: what they spent counts, the output of their last request estimated from what had streamed.`,
    )
  const missing = usage.notReported
  if (missing.length)
    notes.push(
      `${plural(missing.length, 'agent')} did not report ${missing.length > 1 ? 'their' : 'its'} tokens: ${listed(missing.map(whoOf))}. The total is at least what is shown.`,
    )
  const partial = usage.partial
  if (partial.length)
    notes.push(
      `${listed(partial.map(whoOf))} reported only ${partial.length > 1 ? 'their' : 'its'} last reading: at least that much.`,
    )
  return notes
}

/** The line beside the total. */
export function totalNote(
  usage: ReviewUsage,
  review: Pick<Review, 'paused' | 'stopped' | 'status'>,
) {
  if (usage.running) return 'tokens so far · moves as the agents work'
  if (pausedOf(review)) return 'tokens · paused: nothing runs until Resume'
  if (review.stopped) return 'tokens · the review stopped'
  return 'tokens · the review, its fixes, discussions and cleanings'
}

/** A figure on a line of a finding's Run section; none while its agent works with nothing read yet. */
export interface RunCost {
  text: string
  title?: string
  /** Not reported. */
  dim?: true
}

/** The line of a finding's verification or discussion, above its runs. */
interface CostRow {
  key: 'verification' | 'discussion'
  name: string
  model?: string
  chip?: { text: string; tone: 'confirmed' | 'running' | 'still' }
  cost?: RunCost
}

export interface FindingCost {
  rows: CostRow[]
  /** By run id. */
  runs: Map<string, RunCost>
  /** The finding's sum; none when nothing of it reported. */
  foot?: string
}

const NUMBERS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
]

/** The id of the model that spent the most of a figure. */
function mainModel(usage: Usage | null) {
  const top = usage?.models.toSorted(
    (a, b) =>
      b.input +
      b.output +
      b.cacheRead +
      b.cacheWrite -
      (a.input + a.output + a.cacheRead + a.cacheWrite),
  )[0]
  return top?.model
}

function costOf(part: UsagePart, stopped = false): RunCost | undefined {
  const { usage, running } = part
  if (!usage) {
    if (running) return undefined
    return {
      text: 'not reported',
      title:
        'Its agent reported no tokens: its Claude Code session may have closed first',
      dim: true,
    }
  }
  const text = `${usage.partial ? 'at least ' : ''}${formatTokens(usage.tokens)} tokens${running ? ' so far' : ''}`
  // Partial: a last reading, or an agent of several that reported nothing.
  if (usage.partial)
    return {
      text,
      title: 'At least this much: a part of it is a last reading or not reported',
    }
  if (stopped) return { text, title: 'Its last request was cut: its output is estimated' }
  return { text }
}

const their = (names: readonly string[]) => (names.length > 1 ? 'their' : 'its')

/** "its run", "its two runs", "its 12 runs". */
const runsWord = (count: number) =>
  count === 1 ? 'its run' : `its ${NUMBERS[count] ?? count} runs`

/**
 * What a finding's verification, discussion and runs spent, as its Run
 * section says it; none when the review has no usage, or none of the finding's
 * agents was counted.
 */
export function findingCostOf(
  usage: ReviewUsage | undefined,
  finding: Pick<Finding, 'id' | 'verified'>,
  record: Pick<FindingRecord, 'runs'> | undefined,
  discussion: Discussion | undefined,
): FindingCost | undefined {
  // No figure in the whole review and nothing at work: old or a producer's, it says nothing.
  if (!usage || (!usage.total && !usage.running)) return undefined
  const spent: FindingUsage | undefined = usage.findings.find(
    (one) => one.id === finding.id,
  )
  if (!spent) return undefined
  const rows: CostRow[] = []
  /** What did not report, as the foot names it. */
  const missing: string[] = []
  const partial: string[] = []
  const note = (part: UsagePart, name: string) => {
    if (!part.usage && !part.running) missing.push(name)
    else if (part.usage?.partial) partial.push(name)
  }
  const { verifier, discussion: discussed } = spent
  if (verifier) {
    note(verifier, 'the verification')
    const model = mainModel(verifier.usage)
    const cost = costOf(verifier)
    rows.push({
      key: 'verification',
      name: verifier.running
        ? 'verifying'
        : finding.verified === true
          ? 'verified'
          : 'verification',
      ...(model && { model }),
      ...(verifier.running
        ? { chip: { text: 'In progress', tone: 'running' as const } }
        : finding.verified === true && {
            chip: { text: 'Confirmed', tone: 'confirmed' as const },
          }),
      ...(cost && { cost }),
    })
  }
  if (discussed) {
    note(discussed, 'the discussion')
    const model = mainModel(discussed.usage)
    const answers =
      discussion?.messages.filter((one) => one.by === 'agent' && !one.failed).length ?? 0
    const cost = costOf(discussed)
    rows.push({
      key: 'discussion',
      name: discussed.running ? 'discussing' : 'discussed',
      ...(model && { model }),
      ...(discussed.running
        ? { chip: { text: 'In progress', tone: 'running' as const } }
        : answers > 0 && {
            chip: { text: plural(answers, 'answer'), tone: 'still' as const },
          }),
      ...(cost && { cost }),
    })
  }
  const outcomes = new Map((record?.runs ?? []).map((run) => [run.id, run.outcome]))
  const runs = new Map<string, RunCost>()
  let shownRuns = 0
  for (const run of spent.runs) {
    if (!outcomes.has(run.id)) continue
    shownRuns += 1
    note(run, run.id)
    const cost = costOf(run, outcomes.get(run.id) === 'stopped')
    if (cost) runs.set(run.id, cost)
  }
  const { unclaimed } = spent
  if (unclaimed) note(unclaimed, "a fix's agent before its claim")
  const sum = spent.usage
  if (!sum) return { rows, runs }
  const head = `${sum.partial || missing.length ? 'At least ' : ''}${formatTokens(sum.tokens)} tokens on this finding${spent.running ? ' so far' : ''}`
  let foot: string
  if (missing.length)
    foot = `${head}: ${listed(missing)} did not report ${their(missing)} tokens.`
  else if (partial.length)
    foot = `${head}: ${listed(partial)} reported only part of ${their(partial)} tokens.`
  else if (spent.running || sum.partial) foot = `${head}.`
  else {
    const parts = [
      ...(verifier ? ['its verification'] : []),
      ...(discussed ? ['its discussion'] : []),
      ...(shownRuns ? [runsWord(shownRuns)] : []),
      ...(unclaimed ? ["a fix's agent before its claim"] : []),
    ]
    foot = parts.length ? `${head}: ${listed(parts)}.` : `${head}.`
  }
  return { rows, runs, foot }
}

/** `0.8`, `2`: a count a review, to one decimal. */
const perReview = (count: number) => String(Math.round(count * 10) / 10)

/** What a lens's or a group's line under its row says, and its tooltip. */
export interface HistoryLine {
  text: string
  title: string
}

/** A lens's line in Settings › Lenses; none with no history. */
export function lensHistoryOf(history: LensHistory | undefined): HistoryLine | undefined {
  if (!history) return undefined
  return {
    text: `~${formatTokens(history.tokens)} tokens a review · ${perReview(history.confirmed)} confirmed`,
    title: `Its reviewer's and its verifications' tokens, and its findings that stood confirmed: the average of its last ${plural(history.runs, 'complete review')} in this project with its prompt as it is now`,
  }
}

/**
 * A group's line in Settings › Lenses › Groups: its lenses' averages summed,
 * those with none said; none when none of them has one.
 */
export function groupHistoryOf(
  members: readonly (LensHistory | undefined)[],
): HistoryLine | undefined {
  const known = members.flatMap((one) => (one ? [one] : []))
  if (!known.length) return undefined
  const tokens = known.reduce((sum, one) => sum + one.tokens, 0)
  const confirmed = known.reduce((sum, one) => sum + one.confirmed, 0)
  const missing = members.length - known.length
  return {
    text: `~${formatTokens(tokens)} tokens a review · ${perReview(confirmed)} confirmed${missing ? ` · ${plural(missing, 'lens', 'lenses')} with no history, not counted` : ''}`,
    title:
      "Its lenses' averages summed, each over its last complete reviews in this project: what a review of this group should spend and find",
  }
}
