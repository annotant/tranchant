// A battle review on the page: which group each finding counts for, the
// findings both groups found paired, the decisions a pair shares, and the
// scorecard that compares A and B. Pure, so it is tested alone.
import {
  type BattleRecord,
  type Finding,
  type LensSide,
  type Records,
  type Review,
  type ReviewAgent,
  type ReviewUsage,
  stateOf,
} from './domain'
import { lensOf } from './progress'
import { formatTokens } from './tokens'

/** One of the two groups of a battle. */
export type Side = 'a' | 'b'

export const SIDES: readonly Side[] = ['a', 'b']

/** How the page names a side: `A`, `B`. */
export const letterOf = (side: Side) => (side === 'a' ? 'A' : 'B')

export const otherOf = (side: Side): Side => (side === 'a' ? 'b' : 'a')

/** Whether a lens that runs for `lens` counts for `side`: its own, or a shared lens's. */
export const inSide = (lens: LensSide | undefined, side: Side) =>
  lens === side || lens === 'both'

/** A finding A found and one B found that say the same, by their ids. */
export interface Pair {
  a: string
  b: string
}

type Placed = Pick<Finding, 'id' | 'path' | 'line' | 'topic' | 'marks' | 'lens'>

/** The lenses of a battle, by name. */
const lensNames = (battle: BattleRecord) => Object.keys(battle.lenses)

/** The side a lens's agent or finding counts for, by the lens its name or its id starts with. */
const sideOfName = (battle: BattleRecord, name: string): LensSide | undefined => {
  const lens = lensOf(name, lensNames(battle))
  return lens === undefined ? undefined : battle.lenses[lens]
}

/** Each finding's side, by its lens (never read from its id when it names one). */
export function sidesOf(
  battle: BattleRecord,
  findings: readonly Pick<Finding, 'id' | 'lens'>[],
): Map<string, LensSide> {
  const sides = new Map<string, LensSide>()
  for (const finding of findings) {
    const side =
      finding.lens === undefined
        ? sideOfName(battle, finding.id)
        : battle.lenses[finding.lens]
    if (side) sides.set(finding.id, side)
  }
  return sides
}

/** How far apart two findings' lines are: 0 when their lines overlap. */
const NEAR = 3

/** The lines a finding is about: its anchor and its marks'. */
function span(finding: Placed): [number, number] {
  const lines = [finding.line, ...(finding.marks ?? []).map((mark) => mark.line)]
  return [Math.min(...lines), Math.max(...lines)]
}

const gapOf = (x: Placed, y: Placed) => {
  const [from, to] = span(x)
  const [start, end] = span(y)
  return Math.max(0, start - to, from - end)
}

/** A pair's two ids, in one order whichever came first: how the server keeps a split. */
const pairKey = (x: string, y: string) => (x < y ? `${x}\n${y}` : `${y}\n${x}`)

/**
 * The findings found by both groups: one only A found and one only B found,
 * on the same file and topic, their lines within a few of each other; the
 * closest first, each finding in one pair at most, never a pair the
 * reviewer split. In A's order.
 */
export function pairsOf(
  findings: readonly Placed[],
  sides: ReadonlyMap<string, LensSide>,
  splits: readonly (readonly [string, string])[] = [],
): Pair[] {
  const split = new Set(splits.map(([x, y]) => pairKey(x, y)))
  const as = findings.filter((finding) => sides.get(finding.id) === 'a')
  const bs = findings.filter((finding) => sides.get(finding.id) === 'b')
  const candidates: { a: number; b: number; gap: number }[] = []
  for (const [i, x] of as.entries())
    for (const [j, y] of bs.entries()) {
      if (x.path !== y.path || x.topic !== y.topic || split.has(pairKey(x.id, y.id)))
        continue
      const gap = gapOf(x, y)
      if (gap <= NEAR) candidates.push({ a: i, b: j, gap })
    }
  candidates.sort((x, y) => x.gap - y.gap || x.a - y.a || x.b - y.b)
  const takenA = new Set<number>()
  const takenB = new Set<number>()
  const pairs: { at: number; pair: Pair }[] = []
  for (const one of candidates) {
    if (takenA.has(one.a) || takenB.has(one.b)) continue
    takenA.add(one.a)
    takenB.add(one.b)
    const a = as[one.a]
    const b = bs[one.b]
    if (a && b) pairs.push({ at: one.a, pair: { a: a.id, b: b.id } })
  }
  return pairs.toSorted((x, y) => x.at - y.at).map((one) => one.pair)
}

/** A battle as the page reads it: each finding's side, the pairs, and each paired finding's twin. */
export interface BattleView {
  battle: BattleRecord
  sides: Map<string, LensSide>
  pairs: Pair[]
  twins: Map<string, string>
}

export function battleView(
  review: Pick<Review, 'battle' | 'findings'>,
  splits: readonly (readonly [string, string])[] = [],
): BattleView | undefined {
  const { battle } = review
  if (!battle) return undefined
  const sides = sidesOf(battle, review.findings)
  const pairs = pairsOf(review.findings, sides, splits)
  const twins = new Map<string, string>()
  for (const { a, b } of pairs) {
    twins.set(a, b)
    twins.set(b, a)
  }
  return { battle, sides, pairs, twins }
}

/** The review as one side shows it: the findings that count for it. */
export const sideReview = <R extends Pick<Review, 'findings'>>(
  review: R,
  view: BattleView,
  side: Side,
): R => ({
  ...review,
  findings: review.findings.filter((finding) => inSide(view.sides.get(finding.id), side)),
})

/**
 * One finding to settle per pair: a finding still open whose twin is
 * settled reads as its twin, and a decision on it goes to the twin
 * (`target`). Both open, or both settled, each reads as its own.
 */
export function mirrorRecords(
  records: Records,
  twins: ReadonlyMap<string, string>,
): { records: Records; target: Map<string, string> } {
  const target = new Map<string, string>()
  const shown: Records = { ...records }
  for (const [id, twin] of twins) {
    const record = records[twin]
    if (stateOf(records, id) !== 'open' || stateOf(records, twin) === 'open' || !record)
      continue
    shown[id] = record
    target.set(id, twin)
  }
  return { records: shown, target }
}

/** What a finding's row says of who found it, in a side's list. */
export function whoOf(view: BattleView, id: string, side: Side) {
  const letter = letterOf(side)
  const other = letterOf(otherOf(side))
  if (view.sides.get(id) === 'both')
    return { label: 'A + B', both: true, title: 'A lens both groups share, run once' }
  const twin = view.twins.get(id)
  if (twin)
    return { label: `also ${other}`, both: true, title: `${other} found it too: ${twin}` }
  return { label: `only ${letter}`, both: false, title: `Only ${letter} found it` }
}

const KEPT = new Set(['fixed', 'posted', 'moved'])

/** A row of the scorecard: A's figure, B's, and the side that did better, when one did. */
export interface ScoreRow {
  label: string
  help?: string
  a: string
  b: string
  win?: Side
}

/** `6m 40s`, `52s`. */
export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

/** The agents that worked for a side: its lenses' reviewers and the verifiers of its findings. */
export function sideAgents(
  agents: readonly ReviewAgent[],
  battle: BattleRecord,
  side: Side | 'shared',
) {
  return agents.filter((agent) => {
    const name = agent.name.slice(3)
    // A reviewer is its lens's, by name; a verifier its finding's, by the lens its id starts with.
    const lens = agent.name.startsWith('rv-')
      ? battle.lenses[name]
      : agent.name.startsWith('vf-')
        ? sideOfName(battle, name)
        : undefined
    return side === 'shared' ? lens === 'both' : inSide(lens, side)
  })
}

/** From a side's first agent's start to its last one's latest step; undefined before any starts. */
export function timeOf(agents: readonly ReviewAgent[]) {
  const ats = agents.flatMap((agent) => agent.steps.map((step) => step.at))
  return ats.length ? Math.max(...ats) - Math.min(...ats) : undefined
}

/** The tokens a side's lenses spent, the shared ones counted for both; undefined with no figure. */
export function tokensOf(
  usage: ReviewUsage | undefined,
  battle: BattleRecord,
  side: Side,
) {
  const lenses = (usage?.lenses ?? []).filter((one) =>
    inSide(battle.lenses[one.lens], side),
  )
  return lenses.length ? lenses.reduce((sum, one) => sum + one.tokens, 0) : undefined
}

/** The verifiers whose finding is gone: they dropped it, by side. */
function droppedByVerifier(
  agents: readonly ReviewAgent[],
  battle: BattleRecord,
  findings: readonly Pick<Finding, 'id'>[],
  side: Side,
) {
  const ids = new Set(findings.map((finding) => finding.id))
  return agents.filter(
    (agent) =>
      agent.name.startsWith('vf-') &&
      !agent.running &&
      agent.outcome !== 'failed' &&
      agent.outcome !== 'interrupted' &&
      !ids.has(agent.name.slice(3)) &&
      inSide(sideOfName(battle, agent.name.slice(3)), side),
  ).length
}

/** The side that did better: more when `more`, else fewer; none on a tie or with a figure missing. */
function better(a: number | undefined, b: number | undefined, more: boolean) {
  if (a === undefined || b === undefined || a === b) return undefined
  return a > b === more ? ('a' as const) : ('b' as const)
}

/** The findings only one side found: not a shared lens's, and in no pair. */
export function onlyOf(
  view: BattleView,
  findings: readonly Pick<Finding, 'id'>[],
  side: Side,
) {
  return findings.filter(
    (finding) => view.sides.get(finding.id) === side && !view.twins.has(finding.id),
  )
}

/**
 * The scorecard, A and B as columns: what each found, what held up, what it
 * cost. `records` as the battle shows them, a pair's decision for both.
 */
export function scoreOf({
  review,
  view,
  records,
  agents,
  usage,
}: {
  review: Pick<Review, 'findings' | 'verify'>
  view: BattleView
  records: Records
  agents: readonly ReviewAgent[]
  usage: ReviewUsage | undefined
}): ScoreRow[] {
  const { battle } = view
  const of = (side: Side) =>
    review.findings.filter((finding) => inSide(view.sides.get(finding.id), side))
  const count = (side: Side, keep: (finding: Finding) => boolean) =>
    of(side).filter(keep).length
  const shared = review.findings.filter(
    (finding) => view.sides.get(finding.id) === 'both',
  )
  const both = shared.length + view.pairs.length
  const settled = review.findings.some(
    (finding) => stateOf(records, finding.id) !== 'open',
  )
  const kept = (side: Side) =>
    count(side, (finding) => KEPT.has(stateOf(records, finding.id)))
  const dropped = (side: Side) =>
    count(side, (finding) => stateOf(records, finding.id) === 'dropped')
  const reviewers = (side: Side) =>
    Object.values(battle.lenses).filter((lens) => inSide(lens, side)).length
  const sharedLenses = Object.entries(battle.lenses)
    .filter(([, side]) => side === 'both')
    .map(([name]) => name)
  const tokens = { a: tokensOf(usage, battle, 'a'), b: tokensOf(usage, battle, 'b') }
  const time = {
    a: timeOf(sideAgents(agents, battle, 'a')),
    b: timeOf(sideAgents(agents, battle, 'b')),
  }
  const only = {
    a: onlyOf(view, review.findings, 'a').length,
    b: onlyOf(view, review.findings, 'b').length,
  }
  const row = (
    label: string,
    a: number,
    b: number,
    more?: boolean,
    help?: string,
  ): ScoreRow => {
    const win = more === undefined ? undefined : better(a, b, more)
    return {
      label,
      a: String(a),
      b: String(b),
      ...(help && { help }),
      ...(win && { win }),
    }
  }
  const buckets = (side: Side) =>
    `${count(side, (finding) => finding.bucket === 'review')} · ${count(side, (finding) => finding.bucket === 'auto')}`
  const timeWin = better(time.a, time.b, false)
  const tokensWin = better(tokens.a, tokens.b, false)
  return [
    row(
      'Findings',
      of('a').length,
      of('b').length,
      undefined,
      review.verify ? 'kept by the verifier' : undefined,
    ),
    row('Found by both', both, both),
    row('Only this group', only.a, only.b, true),
    { label: 'Needs your review · safe to auto-fix', a: buckets('a'), b: buckets('b') },
    row(
      'Dropped by the verifier',
      droppedByVerifier(agents, battle, review.findings, 'a'),
      droppedByVerifier(agents, battle, review.findings, 'b'),
      undefined,
      'false findings caught before you saw them',
    ),
    row(
      'Kept by you',
      kept('a'),
      kept('b'),
      settled ? true : undefined,
      'fixed, posted or moved to an issue',
    ),
    row(
      'Dropped by you',
      dropped('a'),
      dropped('b'),
      settled ? false : undefined,
      'false findings that reached you',
    ),
    row(
      'Reviewers',
      reviewers('a'),
      reviewers('b'),
      undefined,
      sharedLenses.length
        ? `${sharedLenses.join(', ')} shared, run once`
        : battle.twice
          ? 'the shared lenses ran once per group'
          : undefined,
    ),
    {
      label: 'Tokens',
      help: sharedLenses.length
        ? 'the shared lenses’ counted in both'
        : 'its lenses’ reviewers and verifiers',
      a: tokens.a === undefined ? '—' : formatTokens(tokens.a),
      b: tokens.b === undefined ? '—' : formatTokens(tokens.b),
      ...(tokensWin && { win: tokensWin }),
    },
    {
      label: 'Time',
      help: 'from its first reviewer’s start to its last agent’s step',
      a: time.a === undefined ? '—' : formatDuration(time.a),
      b: time.b === undefined ? '—' : formatDuration(time.b),
      ...(timeWin && { win: timeWin }),
    },
  ]
}

const anchorOf = (finding: Pick<Finding, 'path' | 'line'>) =>
  `${finding.path}:${finding.line}`

/** A table cell's text: a pipe would end it. */
const cell = (text: string) => text.replaceAll('|', '\\|')

const item = (finding: Finding | undefined) =>
  finding ? `\`${finding.id}\` ${finding.title} (${anchorOf(finding)})` : ''

/** The comparison as Markdown, for Copy as Markdown. */
export function battleMarkdown({
  review,
  view,
  score,
}: {
  review: Pick<Review, 'findings' | 'branch' | 'base' | 'title'>
  view: BattleView
  score: readonly ScoreRow[]
}) {
  const { battle } = view
  const byId = new Map(review.findings.map((finding) => [finding.id, finding]))
  const shared = review.findings.filter(
    (finding) => view.sides.get(finding.id) === 'both',
  )
  const lines = [
    `# Battle review: ${battle.a} (A) against ${battle.b} (B)`,
    '',
    `${review.title} · \`${review.branch} → ${review.base}\``,
    '',
    '| | A | B |',
    '| --- | --- | --- |',
    ...score.map(
      (one) =>
        `| ${cell(one.label)} | ${cell(one.a)}${one.win === 'a' ? ' ▲' : ''} | ${cell(one.b)}${one.win === 'b' ? ' ▲' : ''} |`,
    ),
    '',
    `## Found by both (${shared.length + view.pairs.length})`,
    '',
    ...shared.map((finding) => `- ${item(finding)} · shared lens`),
    ...view.pairs.map(
      (pair) => `- A ${item(byId.get(pair.a))} · B ${item(byId.get(pair.b))}`,
    ),
  ]
  for (const side of SIDES) {
    const only = onlyOf(view, review.findings, side)
    lines.push('', `## Only ${letterOf(side)} found (${only.length})`, '')
    lines.push(...only.map((finding) => `- ${item(byId.get(finding.id))}`))
  }
  return `${lines.join('\n')}\n`
}
