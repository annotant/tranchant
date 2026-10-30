import { act } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type {
  DecisionInput,
  Finding,
  FindingRecord,
  Ownership,
  Records,
  Review,
  ReviewPayload,
  State,
  Step,
} from '../src/domain'

const HEAD = '3552e3ef0c5d4b1a9f0e8c7d6b5a4f3e2d1c0b9a'

/** A diagram with everything the sanitizer must drop, and a local reference it must keep. */
export const SVG_WITH_SCRIPT = [
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 80">',
  '<script>alert(1)</script>',
  '<rect id="box" x="2" y="2" width="60" height="30" onclick="steal()" fill="#ccc"/>',
  '<a href="https://evil.example/x"><text x="10" y="20">drawer</text></a>',
  '<a xlink:href="#box"><text x="10" y="60">query</text></a>',
  '<foreignObject width="10" height="10"><div>html</div></foreignObject>',
  '<image href="https://evil.example/i.png" width="1" height="1"/>',
  '<use href="https://evil.example/s.svg#p"/>',
  '<use href="#box"/>',
  '</svg>',
].join('')

export const HUNK = [
  '@@ -15,6 +18,8 @@ export function guard(user: User) {',
  '   if (!user) {',
  '-    return false',
  "+    return deny('anonymous')",
  '+  }',
  "+  if (user.role === 'admin') {",
  '+    return allow()',
  '   }',
  '   return check(user)',
].join('\n')

/**
 * Five findings: two to review (Bugs, by `path:line`), three auto-addressable
 * (one of them a Bugs override, so buckets sort before topics); a column mark
 * with a note, a whole-line mark, a related excerpt, a hunk, an SVG and a
 * text diagram, a question and a suggestion.
 */
export const FINDINGS: Finding[] = [
  {
    id: 'f-01',
    topic: 'Bugs',
    bucket: 'review',
    title: 'Null tenantId crashes the loop',
    path: 'src/people/usePeople.ts',
    line: 42,
    excerpt: {
      startLine: 36,
      lines: [
        'export function usePeople(tenantId?: string) {',
        '  const query = useQuery({',
        "    queryKey: ['people', tenantId],",
        '    queryFn: () => fetchPeople(tenantId),',
        '  })',
        '  const people = query.data ?? []',
        '  const rows = people.filter((p) => p.tenantId === tenantId)',
        '  if (!rows.length) {',
        "    throw new Error('no people')",
        '  }',
        '  return rows',
      ],
    },
    marks: [
      {
        line: 42,
        from: 15,
        to: 21,
        note: 'undefined when the drawer opens before the query settles',
      },
      { line: 44 },
    ],
    problem: 'This crashes when the drawer opens before the tenant query settles.',
    why: 'The person page then shows the error boundary instead of a skeleton.',
    fix: 'Return early while `tenantId` is undefined, as `useFiles` does.',
    comment: 'This crashes when the drawer opens before the tenant query settles.',
    related: [
      {
        path: 'src/people/useFiles.ts',
        line: 11,
        excerpt: {
          startLine: 10,
          lines: [
            'export function useFiles(tenantId?: string) {',
            '  if (!tenantId) return []',
            '  return query(tenantId)',
          ],
        },
        marks: [{ line: 11 }],
      },
    ],
  },
  {
    id: 'f-02',
    topic: 'Bugs',
    bucket: 'review',
    title: 'Admins skip the tenant check',
    path: 'src/api/guard.ts',
    line: 21,
    excerpt: {
      startLine: 18,
      lines: [
        '  if (!user) {',
        "    return deny('anonymous')",
        '  }',
        "  if (user.role === 'admin') {",
        '    return allow()',
        '  }',
        '  return check(user)',
      ],
    },
    hunk: HUNK,
    marks: [{ line: 21, from: 6, to: 27, note: 'admins of another tenant pass too' }],
    problem: 'An admin of any tenant is allowed through.',
    why: 'The check was meant for the tenant of the resource.',
    fix: 'Compare `user.tenantId` with the resource before allowing.',
    comment: 'An admin of any tenant is allowed through here.',
    diagram: {
      kind: 'svg',
      source: SVG_WITH_SCRIPT,
      caption: 'The admin branch bypasses the tenant check.',
    },
  },
  {
    id: 'f-03',
    topic: 'Tests',
    bucket: 'auto',
    tag: 'question',
    title: 'Is the empty state covered?',
    path: 'src/people/__tests__/usePeople.test.ts',
    line: 8,
    excerpt: { startLine: 7, lines: ["test('lists people', () => {", '  // …', '})'] },
    problem: 'No test opens the drawer with no tenant.',
    why: 'The crash above would have been caught.',
    fix: 'Add a test rendering the drawer before the query settles.',
    comment: 'Is the empty state covered by a test?',
    diagram: {
      kind: 'text',
      source: 'drawer opens → query pending → usePeople(undefined) → throw',
      caption: 'The sequence the missing test would cover.',
    },
  },
  {
    id: 'f-04',
    topic: 'Conventions',
    bucket: 'auto',
    tag: 'suggestion',
    title: 'Use the design tokens',
    path: 'src/people/Drawer.tsx',
    line: 30,
    excerpt: {
      startLine: 29,
      lines: ['const Box = styled.div`', '  padding: 12px;', '`'],
    },
    marks: [{ line: 30, from: 11, to: 15 }],
    problem: 'A raw pixel value where the kit has a token.',
    why: 'Spacing drifts from the rest of the app.',
    fix: 'Use `Metrics.normal`.',
    comment: 'Could use `Metrics.normal` here.',
  },
  {
    id: 'f-05',
    topic: 'Bugs',
    bucket: 'auto',
    title: 'Off-by-one in the page count',
    path: 'src/people/pager.ts',
    line: 5,
    excerpt: {
      startLine: 4,
      lines: [
        'export const pages = (total: number, size: number) =>',
        '  Math.floor(total / size)',
      ],
    },
    marks: [{ line: 5 }],
    problem: 'The last partial page is lost.',
    why: 'Users cannot reach the last rows.',
    fix: 'Use `Math.ceil`.',
    comment: 'Should be `Math.ceil`.',
  },
]

/** The list's order of FINDINGS: review (Bugs, by path) then auto (Bugs, Tests, Conventions). */
export const ORDER = ['f-02', 'f-01', 'f-05', 'f-03', 'f-04']

export function review(
  ownership: Ownership = 'ours',
  fields: Partial<Review> = {},
): Review {
  return {
    version: 1,
    id: 'b96fae58-5cc3-426b-9632-77f3a7f8f866',
    createdAt: '2026-10-30T15:44:37.597Z',
    project: '/Users/me/dev/dashboard-ui',
    branch: 'feature/QO-9678/classification-overview',
    base: 'origin/master',
    headSha: HEAD,
    ownership,
    title: 'Classification overview page',
    ...(ownership === 'theirs'
      ? {
          mr: {
            project: 'qohash/dashboard-ui',
            iid: 5746,
            url: 'https://gitlab.example/qohash/dashboard-ui/-/merge_requests/5746',
            author: 'jfdoe',
            diffRefs: {
              baseSha: 'b'.repeat(40),
              headSha: HEAD,
              startSha: 'b'.repeat(40),
            },
          },
        }
      : {}),
    jira: { key: 'QO-9678', url: 'https://jira.example/browse/QO-9678' },
    summary: [
      '## Change Map',
      '',
      '- **Pages**: one new route',
      '- `usePeople` hook',
      '',
      'Some `inline` text with [a link](https://example.com/doc).',
      '',
      '```ts',
      'const a = 1',
      '```',
    ].join('\n'),
    strengths: ['Tests cover the empty state.', 'Names are clear.'],
    findings: FINDINGS,
    ...fields,
  }
}

export const record = (
  state: State,
  fields: Partial<FindingRecord> = {},
): FindingRecord => ({
  state,
  runs: [],
  events: [],
  ...fields,
})

interface PayloadOptions {
  ownership?: Ownership
  records?: Records
  runs?: Record<string, Step[]>
  /** `git rev-parse HEAD` as the server saw it; the reviewed one by default. */
  current?: string | null
  review?: Partial<Review>
}

export function payload({
  ownership = 'ours',
  records = {},
  runs = {},
  current = HEAD,
  review: fields = {},
}: PayloadOptions = {}): ReviewPayload {
  return {
    review: review(ownership, fields),
    findings: records,
    runs,
    head: { reviewed: HEAD, current },
  }
}

export interface Post {
  url: string
  body: unknown
}

const isDecision = (value: unknown): value is DecisionInput =>
  !!value && typeof value === 'object' && 'id' in value && 'action' in value

/** The decisions a POST to /api/decisions carried. */
export function decisionsOf(post: Post | undefined): DecisionInput[] {
  const body = post?.body
  if (!body || typeof body !== 'object' || !('decisions' in body)) return []
  return Array.isArray(body.decisions) ? body.decisions.filter(isDecision) : []
}

/**
 * Stands in for the server: serves `payload`, records each POST, answers
 * `applied` for every decision. `down()` makes every request fail, as when
 * the session ended; `up()` brings it back.
 */
export function fakeServer(
  initial: ReviewPayload,
  histories: Record<string, Step[]> = {},
) {
  let current = initial
  let down = false
  const posts: Post[] = []
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (down) throw new TypeError('Failed to fetch')
    const url = new URL(input, 'http://127.0.0.1')
    if (init?.method === 'POST') {
      const body: unknown =
        typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      posts.push({ url: url.pathname, body })
      if (url.pathname === '/api/decisions') {
        const decisions =
          body &&
          typeof body === 'object' &&
          'decisions' in body &&
          Array.isArray(body.decisions)
            ? body.decisions
            : []
        const applied = decisions.map((decision: unknown) =>
          decision && typeof decision === 'object' && 'id' in decision ? decision.id : '',
        )
        return Response.json({ applied, refused: [] })
      }
      return Response.json({ ok: true })
    }
    if (url.pathname.startsWith('/api/runs/')) {
      return Response.json(histories[decodeURIComponent(url.pathname.slice(10))] ?? [])
    }
    return Response.json(current)
  })
  vi.stubGlobal('fetch', fetch)
  return {
    posts,
    fetch,
    set(next: ReviewPayload) {
      current = next
    },
    down() {
      down = true
    },
    up() {
      down = false
    },
  }
}

/** Stands in for the server's event stream: the test sends its events. */
export function fakeEvents() {
  const streams: FakeEventSource[] = []
  class FakeEventSource extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSED = 2
    readyState = 0
    closed = false
    constructor(readonly url: string) {
      super()
      streams.push(this)
    }
    close() {
      this.closed = true
      this.readyState = 2
    }
  }
  vi.stubGlobal('EventSource', FakeEventSource)
  return {
    streams,
    /** Sends `type` on the stream the page listens to. */
    send(type: string) {
      const open = streams.filter((stream) => !stream.closed)
      expect(open).toHaveLength(1)
      act(() => {
        open[0]?.dispatchEvent(new Event(type))
      })
    },
  }
}
