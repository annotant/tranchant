// What a review's agents spent, as the header's chip and the Tokens screen say
// it. The server sums the figures (`/api/review`'s `usage`); this only words
// them and counts what each lens found. Pure, so it is tested alone.
import {
  type Discussion,
  type Finding,
  type LensesProgress,
  plural,
  type Records,
  type Review,
  type ReviewAgent,
  type ReviewUsage,
  type State,
  stateOf,
  type Usage,
  type UsageKind,
} from './domain'
import { lensOf } from './progress'

/** `2.90M`, `412k`, `950`. */
export function formatTokens(count: number) {
  if (count >= 999_500) {
    const millions = count / 1_000_000
    return `${millions.toFixed(millions >= 10 ? 1 : 2)}M`
  }
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}

/** Paused from the page, and nothing it counts runs any more. */
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
function cellOf(usage: Usage | null | undefined, running = false) {
  if (!usage) return running ? 'so far' : '—'
  const amount = formatTokens(usage.tokens)
  if (running) return `${amount} so far`
  return usage.partial ? `at least ${amount}` : amount
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

/** A run name as a reader says it: `the verifier of tests-3`, `the fix of f-03 (run r1)`. */
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
  /** Its share of the review's total, in percent. */
  share: number
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
  for (const agent of at.reviewers) {
    const kind = agent.running ? kindOf(agent.name) : undefined
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
      share: share(one.usage?.tokens ?? 0),
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
  return agent?.steps.find((step) => step.kind === 'start' && step.model)?.model ?? row
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

/** One row per lens the review ran, the most tokens first; those not started last. */
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
    const verifying = own.some((finding) => agents.get(`vf-${finding.id}`)?.running)
    const reviewing = !!agent?.running && usage.running
    const started = !!figure || !!agent
    const blank = (text: string) => (started ? text : '—')
    const tokens = (figure?.reviewer?.tokens ?? 0) + (figure?.verifiers?.tokens ?? 0)
    const ended =
      !!agent &&
      !agent.running &&
      agent.outcome !== 'failed' &&
      agent.outcome !== 'interrupted'
    const note = noteOf(agent, review, usage.running)
    return {
      lens,
      model: modelOf(agent, lenses?.lenses.find((row) => row.name === lens)?.model) ?? '',
      review: started ? cellOf(figure?.reviewer, reviewing) : '—',
      verify:
        figure?.verifiers || (verifying && usage.running)
          ? cellOf(figure?.verifiers, verifying && usage.running)
          : '—',
      landed: blank(String(own.length + gone)),
      confirmed: blank(String(confirmed.length)),
      dropped: blank(String(gone + byYou)),
      settled: blank(String(settled)),
      perConfirmed:
        confirmed.length && tokens ? formatTokens(tokens / confirmed.length) : '—',
      running: reviewing,
      nothingConfirmed: ended && !verifying && confirmed.length === 0,
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
