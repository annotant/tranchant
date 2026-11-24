import type { ListedReview, Listing } from '../../dashboard/domain'

export const NOW = Date.parse('2026-11-24T15:00:00Z')

/** A review as /api/reviews lists it; settled unless told otherwise. */
export const listed = (fields: Partial<ListedReview> = {}): ListedReview => ({
  id: 'r1',
  dir: '/state/0123456789ab/reviews/r1',
  project: '/home/me/dev/annotant',
  repo: { key: '/home/me/dev/annotant', name: 'annotant' },
  title: 'The thread keeps its old state',
  createdAt: '2026-11-24T14:00:00Z',
  activeAt: NOW - 12 * 60_000,
  branch: 'fix/58-thread',
  base: 'main',
  ownership: 'ours',
  status: 'complete',
  state: 'settled',
  findings: { fixed: 4, dropped: 2 },
  tokens: { count: 92_000 },
  ...fields,
})

export const listing = (reviews: ListedReview[]): Listing => ({
  state: '~/.cache/tranchant',
  home: '/home/me',
  reviews,
})
