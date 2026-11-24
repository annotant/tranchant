// The dashboard's list: what /api/reviews answers (scripts/lib/catalog.mjs is
// the reference), its groups, and the words a row says. Pure, so it is tested alone.
import { formatTokens } from '../kit/format'

type ReviewState = 'preparing' | 'ready' | 'running' | 'stopped' | 'needs' | 'settled'

export interface ListedReview {
  id: string
  dir: string
  project: string
  repo: { key: string; name: string }
  title: string
  createdAt: string
  activeAt: number
  branch?: string
  base?: string
  ownership: 'ours' | 'theirs'
  mr?: { url: string; label: string; author?: string }
  status: 'preparing' | 'reviewing' | 'complete' | 'refused'
  state: ReviewState
  waiting?: true
  paused?: true
  refusal?: string
  lenses?: { done: number; total: number }
  verified?: { done: number; total: number }
  findings: Record<string, number>
  tokens?: { count: number; partial?: true }
  live?: { url: string; cwd?: string }
}

export interface Listing {
  /** The state folder, as the page names it. */
  state: string
  /** The home folder: a path under it reads with `~`. */
  home: string
  reviews: ListedReview[]
}

export type GroupId = 'needs' | 'running' | 'ready' | 'done'

const GROUPS: readonly { id: GroupId; label: string; help: string }[] = [
  {
    id: 'needs',
    label: 'Needs you',
    help: 'An agent asks you, or findings wait to be settled',
  },
  { id: 'running', label: 'Running', help: 'Reviewing or verifying' },
  { id: 'ready', label: 'Ready to start', help: 'Prepared, waiting for you to start' },
  { id: 'done', label: 'Done', help: 'Every finding settled' },
]

const GROUP_OF: Record<ReviewState, GroupId> = {
  needs: 'needs',
  stopped: 'needs',
  running: 'running',
  preparing: 'running',
  ready: 'ready',
  settled: 'done',
}

const groupOf = (review: Pick<ListedReview, 'state'>): GroupId => GROUP_OF[review.state]

/** Whether `value` is a state this page groups: a newer server's may not be. */
export const isGroupState = (value: unknown): value is ReviewState =>
  typeof value === 'string' && Object.hasOwn(GROUP_OF, value)

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

/** The findings a reviewer settled: nothing waits on them any more. */
const SETTLED = ['fixed', 'posted', 'moved', 'dropped', 'skipped'] as const
const SETTLED_WORDS: Record<(typeof SETTLED)[number], string> = {
  fixed: 'fixed',
  posted: 'posted',
  moved: 'moved to an issue',
  dropped: 'dropped',
  skipped: 'skipped',
}

const count = (review: ListedReview, ...states: string[]) =>
  states.reduce((sum, state) => sum + (review.findings[state] ?? 0), 0)
const totalOf = (review: ListedReview) =>
  Object.values(review.findings).reduce((sum, one) => sum + one, 0)

/** What a row says of where the review stands, its bar's share when it runs, and its tone. */
export function progressOf(review: ListedReview): {
  text: string
  percent?: number
  tone: 'needs' | 'stopped' | 'plain'
} {
  const lenses = review.lenses
  if (review.state === 'stopped') {
    const where =
      review.status === 'preparing'
        ? ' while it built its lenses'
        : lenses
          ? ` after ${lenses.done} of ${plural(lenses.total, 'lens', 'lenses')}`
          : ''
    return { text: `Stopped · its session ended${where}`, tone: 'stopped' }
  }
  if (review.state === 'needs' && review.status === 'refused')
    return {
      text: `Refused · ${review.refusal ?? 'a lens could not be built'}`,
      tone: 'stopped',
    }
  if (review.state === 'needs') {
    const left = totalOf(review) - count(review, ...SETTLED)
    const parts = [`${plural(left, 'finding')} to settle`]
    if (count(review, 'asking')) parts.push('an agent asks you')
    const fixing = count(review, 'queued', 'working')
    if (fixing) parts.push(`${fixing} fixing`)
    const failed = count(review, 'failed')
    if (failed) parts.push(`${failed} failed`)
    const posted = count(review, 'posted')
    if (posted) parts.push(`${posted} posted`)
    return { text: parts.join(' · '), tone: 'needs' }
  }
  if (review.state === 'preparing')
    return { text: 'Preparing · building the lenses', tone: 'plain' }
  if (review.state === 'running') {
    const found = plural(totalOf(review), 'finding')
    const verified = review.verified
    const verifying =
      verified && lenses && lenses.done >= lenses.total && verified.total > 0
    const verb = review.paused ? 'Paused' : verifying ? 'Verifying' : 'Reviewing'
    if (verifying)
      return {
        text: `${verb} · ${verified.done} of ${plural(verified.total, 'finding')}`,
        percent: Math.round((verified.done / verified.total) * 100),
        tone: 'plain',
      }
    if (lenses)
      return {
        text: `${verb} · ${lenses.done} of ${plural(lenses.total, 'lens', 'lenses')} · ${found}`,
        percent: lenses.total ? Math.round((lenses.done / lenses.total) * 100) : 0,
        tone: 'plain',
      }
    return { text: `${verb} · ${found}`, percent: 0, tone: 'plain' }
  }
  if (review.state === 'ready')
    return {
      text: lenses ? plural(lenses.total, 'lens', 'lenses') : 'Lenses built',
      tone: 'plain',
    }
  const settled = SETTLED.flatMap((state) => {
    const n = count(review, state)
    return n ? [`${n} ${SETTLED_WORDS[state]}`] : []
  })
  return { text: settled.length ? settled.join(', ') : 'No finding', tone: 'plain' }
}

/** Whose branch it is: yours, or its author's by name, as the review page says of an MR. */
export const ownerOf = (review: Pick<ListedReview, 'ownership' | 'mr'>) =>
  review.ownership === 'ours'
    ? 'your branch'
    : review.mr?.author
      ? `${review.mr.author}’s branch`
      : 'their branch'

/** `branch → base`, or what of it the review names. */
export const refOf = (review: Pick<ListedReview, 'branch' | 'base'>) =>
  review.branch && review.base
    ? `${review.branch} → ${review.base}`
    : (review.branch ?? review.base ?? '')

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** `just now`, `12 min ago`, `3 h ago`, `yesterday`, `Nov 22`. */
export function agoOf(at: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const day = new Date(at)
  const today = new Date(now)
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime()
  if (at >= startOfToday) return `${Math.floor(minutes / 60)} h ago`
  if (at >= startOfToday - 86_400_000) return 'yesterday'
  const date = `${MONTHS[day.getMonth()]} ${day.getDate()}`
  return day.getFullYear() === today.getFullYear()
    ? date
    : `${date}, ${day.getFullYear()}`
}

/** When, as a row says it: since it started while it runs, since it was prepared, else its last change. */
export function whenOf(review: ListedReview, now: number) {
  if (review.state === 'running' || review.state === 'preparing')
    return `started ${agoOf(Date.parse(review.createdAt), now)}`
  if (review.state === 'ready') return `prepared ${agoOf(review.activeAt, now)}`
  return agoOf(review.activeAt, now)
}

export const tokensOf = (review: Pick<ListedReview, 'tokens'>) =>
  review.tokens
    ? `${review.tokens.partial ? 'at least ' : ''}${formatTokens(review.tokens.count)} tokens`
    : '—'

/** A path under the home folder with `~`. */
const shortPath = (file: string, home: string) =>
  home && (file === home || file.startsWith(`${home}/`))
    ? `~${file.slice(home.length)}`
    : file

/** Where it runs: the folder of the session serving it; one no server serves, its project's. */
export const whereOf = (review: Pick<ListedReview, 'live' | 'project'>, home: string) =>
  shortPath(review.live?.cwd ?? review.project, home)

/** Open goes to the review's own page: only while a server serves it, and not once it is done. */
export const openUrlOf = (review: ListedReview) =>
  review.live && groupOf(review) !== 'done' ? review.live.url : undefined

/** A project of the filter: its name, its key, its reviews not done. */
export interface ProjectCount {
  key: string
  name: string
  open: number
}

/** The projects the reviews belong to, by name, each with its reviews not done. */
export function projectsOf(reviews: readonly ListedReview[]): ProjectCount[] {
  const byKey = new Map<string, ProjectCount>()
  for (const review of reviews) {
    const known = byKey.get(review.repo.key) ?? { ...review.repo, open: 0 }
    if (groupOf(review) !== 'done') known.open += 1
    byKey.set(review.repo.key, known)
  }
  return [...byKey.values()].toSorted(
    (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
  )
}

/** The reviews of the projects checked; none checked shows them all. */
export const filtered = (
  reviews: readonly ListedReview[],
  checked: ReadonlySet<string>,
) =>
  checked.size ? reviews.filter((review) => checked.has(review.repo.key)) : [...reviews]

/** The filter's button: `All`, the one project checked, or how many. */
export function summaryOf(
  projects: readonly ProjectCount[],
  checked: ReadonlySet<string>,
) {
  const shown = projects.filter((one) => checked.has(one.key))
  if (!shown.length) return 'All'
  return shown.length === 1 ? (shown[0]?.name ?? 'All') : `${shown.length} projects`
}

/** Each group's reviews, in the groups' order, the empty ones left out. */
export function grouped(reviews: readonly ListedReview[]) {
  return GROUPS.map((group) => ({
    ...group,
    reviews: reviews.filter((review) => groupOf(review) === group.id),
  })).filter((group) => group.reviews.length > 0)
}
