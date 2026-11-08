import { act } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type { AccountPayload, ChangesPayload, DiffPayload } from '../src/api'
import type { SettingsPayload, SettingsValues, StoredSettings } from '../src/settings'
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
  Tracker,
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

/** A sixth finding on the line f-02 is on: the two stack. */
export const STACKED: Finding = {
  ...FINDINGS[2]!,
  id: 'f-06',
  title: 'Is the admin branch tested?',
  path: 'src/api/guard.ts',
  line: 21,
  excerpt: FINDINGS[1]!.excerpt,
}

/**
 * The change's diff, as `/api/diff` hands it: usePeople.ts shows f-01's line
 * with its excerpt text, guard.ts f-02's (and STACKED's), pager.ts f-05's;
 * Drawer.tsx is touched far from f-04's line; usePeople.test.ts (f-03) is not
 * in it at all. Then a rename, a binary and a deleted file. Its first file
 * holds f-01, not the list's first finding (f-02): the two views open on
 * different findings.
 */
export const DIFF = `${[
  'diff --git a/src/people/usePeople.ts b/src/people/usePeople.ts',
  'index 3333333..4444444 100644',
  '--- a/src/people/usePeople.ts',
  '+++ b/src/people/usePeople.ts',
  '@@ -36,3 +36,11 @@ import { useQuery } from "@tanstack/react-query"',
  '-export function usePeople() {',
  '-  return []',
  '-}',
  ...FINDINGS[0]!.excerpt.lines.map((line) => `+${line}`),
  'diff --git a/src/api/guard.ts b/src/api/guard.ts',
  'index 1111111..2222222 100644',
  '--- a/src/api/guard.ts',
  '+++ b/src/api/guard.ts',
  HUNK,
  'diff --git a/src/people/pager.ts b/src/people/pager.ts',
  'index 5555555..6666666 100644',
  '--- a/src/people/pager.ts',
  '+++ b/src/people/pager.ts',
  '@@ -4,2 +4,2 @@',
  ' export const pages = (total: number, size: number) =>',
  '-  Math.floor(total / size) + 1',
  '+  Math.floor(total / size)',
  'diff --git a/src/people/Drawer.tsx b/src/people/Drawer.tsx',
  'index 7777777..8888888 100644',
  '--- a/src/people/Drawer.tsx',
  '+++ b/src/people/Drawer.tsx',
  '@@ -10,3 +10,3 @@',
  ' import { Box } from "./Box"',
  '-import { Table } from "./Table"',
  '+import { Table } from "../table/Table"',
  ' import { useDrawer } from "./useDrawer"',
  'diff --git a/src/people/old-name.ts b/src/people/new-name.ts',
  'similarity index 80%',
  'rename from src/people/old-name.ts',
  'rename to src/people/new-name.ts',
  'index 9999999..aaaaaaa 100644',
  '--- a/src/people/old-name.ts',
  '+++ b/src/people/new-name.ts',
  '@@ -1,2 +1,2 @@',
  '-export const name = "old"',
  '+export const name = "new"',
  ' export default name',
  'diff --git a/assets/logo.png b/assets/logo.png',
  'index bbbbbbb..ccccccc 100644',
  'Binary files a/assets/logo.png and b/assets/logo.png differ',
  'diff --git a/src/people/legacy.ts b/src/people/legacy.ts',
  'deleted file mode 100644',
  'index ddddddd..0000000',
  '--- a/src/people/legacy.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-export {}',
].join('\n')}\n`

export const DIFF_FILES: DiffPayload['files'] = [
  { path: 'src/people/usePeople.ts', additions: 11, deletions: 3, binary: false },
  { path: 'src/api/guard.ts', additions: 4, deletions: 1, binary: false },
  { path: 'src/people/pager.ts', additions: 1, deletions: 1, binary: false },
  { path: 'src/people/Drawer.tsx', additions: 1, deletions: 1, binary: false },
  {
    path: 'src/people/new-name.ts',
    oldPath: 'src/people/old-name.ts',
    additions: 1,
    deletions: 1,
    binary: false,
  },
  { path: 'assets/logo.png', additions: 0, deletions: 0, binary: true },
  { path: 'src/people/legacy.ts', additions: 0, deletions: 1, binary: false },
]

export const diffPayload = (): DiffPayload => ({
  base: 'origin/master',
  head: HEAD,
  files: DIFF_FILES,
  diff: DIFF,
})

/** `finding` as a lens writes it on an `ours` review: no comment to post. */
export function withoutComment(finding: Finding): Finding {
  const copy = { ...finding }
  delete copy.comment
  return copy
}

/** The MR of the review, its diff refs at `headSha`. */
export const mergeRequest = (headSha = HEAD): NonNullable<Review['mr']> => ({
  project: 'qohash/dashboard-ui',
  iid: 5746,
  url: 'https://gitlab.example/qohash/dashboard-ui/-/merge_requests/5746',
  author: 'jfdoe',
  diffRefs: {
    baseSha: 'b'.repeat(40),
    headSha,
    startSha: 'b'.repeat(40),
  },
})

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
    ...(ownership === 'theirs' ? { mr: mergeRequest() } : {}),
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
  /** `PUT` for the settings; absent, a POST. */
  method?: string
}

const SETTINGS_DEFAULTS: SettingsValues = {
  theme: 'system',
  view: 'diff',
  summary: 'open',
  fixModel: null,
  reviewModel: null,
  verifyModel: null,
  maxFixAgents: 3,
  maxReviewAgents: 3,
  recipe: null,
  disabledLenses: [],
  postWith: 'auto',
}

export const LENSES = [
  'correctness',
  'types',
  'accessibility',
  'performance',
  'security',
  'tests',
  'conventions',
  'bugs',
]

const isStored = (value: unknown): value is StoredSettings =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** What `/api/settings` answers for the file `stored`, as the server computes it. */
export function settingsPayload(
  stored: StoredSettings = {},
  extra: Partial<SettingsPayload> = {},
): SettingsPayload {
  const locked = extra.locked ?? {}
  const values = { ...SETTINGS_DEFAULTS, ...stored }
  for (const key of Object.keys(locked)) {
    if (key === 'fixModel' || key === 'reviewModel' || key === 'verifyModel')
      values[key] = 'claude-sonnet-5-5'
  }
  return {
    path: '/Users/me/.config/tranchant/settings.json',
    settings: stored,
    values,
    defaults: SETTINGS_DEFAULTS,
    locked,
    recipe: '/plugin/agents/review/recipe.json',
    lenses: LENSES,
    ...extra,
  }
}

const isDecision = (value: unknown): value is DecisionInput =>
  !!value && typeof value === 'object' && 'id' in value && 'action' in value

/** The decisions a POST to /api/decisions carried. */
export function decisionsOf(post: Post | undefined): DecisionInput[] {
  const body = post?.body
  if (!body || typeof body !== 'object' || !('decisions' in body)) return []
  return Array.isArray(body.decisions) ? body.decisions.filter(isDecision) : []
}

/** What the fake server answers on `/api/diff`: a diff, or an error status and its words. */
type DiffAnswer = DiffPayload | { status: number; error: string }

const NOT_A_REPOSITORY: DiffAnswer = {
  status: 409,
  error: '/Users/me/dev/dashboard-ui is not a git repository',
}

/**
 * Stands in for the server: serves `payload`, records each POST, answers
 * `applied` for every decision, and on `/api/diff` the `diff` given, or a
 * 409 "not a git repository" when none is; `answerDiff` changes it. On
 * `/api/changes/<id>`, `changes[id]`, else no file.
 * `down()` makes every request fail, as when the session ended; `up()`
 * brings it back.
 */
export function fakeServer(
  initial: ReviewPayload,
  histories: Record<string, Step[]> = {},
  diff: DiffAnswer = NOT_A_REPOSITORY,
  changes: Record<string, ChangesPayload> = {},
) {
  let diffAnswer = diff
  let account: AccountPayload | undefined = { username: null }
  let tracker: Tracker = {
    kind: 'github',
    web: 'https://github.com/acme/app',
    prefix: '',
  }
  let current = initial
  let down = false
  /** What `/api/discuss` refuses with, as the server words it; undefined, it takes the message. */
  let discussRefusal: string | undefined
  /** The settings file as the server holds it; a PUT replaces it, as the server does. */
  let settings: SettingsPayload | undefined = settingsPayload()
  /** What a PUT of the settings is refused with (400); undefined, it is applied. */
  let settingsRefusal: string | undefined
  const posts: Post[] = []
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (down) throw new TypeError('Failed to fetch')
    const url = new URL(input, 'http://127.0.0.1')
    if (init?.method === 'PUT' && url.pathname === '/api/settings') {
      const body: unknown =
        typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      posts.push({ url: url.pathname, body, method: 'PUT' })
      if (settingsRefusal !== undefined)
        return Response.json({ error: settingsRefusal }, { status: 400 })
      // The body is the whole file: what the test sends is what the server keeps.
      const stored: StoredSettings = isStored(body) ? body : {}
      settings = settingsPayload(stored, {
        ...(settings?.locked && { locked: settings.locked }),
        ...(settings?.lenses && { lenses: settings.lenses }),
      })
      return Response.json(settings)
    }
    if (url.pathname === '/api/settings') {
      return settings
        ? Response.json(settings)
        : Response.json({ error: 'not found' }, { status: 404 })
    }
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
      if (url.pathname === '/api/discuss' && discussRefusal !== undefined)
        return Response.json({ error: discussRefusal }, { status: 409 })
      return Response.json({ ok: true })
    }
    if (url.pathname.startsWith('/api/runs/')) {
      return Response.json(histories[decodeURIComponent(url.pathname.slice(10))] ?? [])
    }
    if (url.pathname.startsWith('/api/changes/')) {
      const id = decodeURIComponent(url.pathname.slice(13))
      return Response.json(changes[id] ?? { files: [], diff: '' })
    }
    if (url.pathname === '/api/account') {
      return account
        ? Response.json(account)
        : Response.json({ error: 'not found' }, { status: 404 })
    }
    if (url.pathname === '/api/tracker') return Response.json(tracker)
    if (url.pathname === '/api/diff') {
      return 'diff' in diffAnswer
        ? Response.json(diffAnswer)
        : Response.json({ error: diffAnswer.error }, { status: diffAnswer.status })
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
    /** undefined: a server without the route, which answers 404. */
    answerAccount(next: AccountPayload | undefined) {
      account = next
    },
    answerTracker(next: Tracker) {
      tracker = next
    },
    answerDiff(next: DiffAnswer) {
      diffAnswer = next
    },
    refuseDiscuss(reason: string | undefined) {
      discussRefusal = reason
    },
    /** undefined: a server without the route, which answers 404. */
    answerSettings(next: SettingsPayload | undefined) {
      settings = next
    },
    refuseSettings(reason: string | undefined) {
      settingsRefusal = reason
    },
    /** The settings the last PUT carried. */
    settingsPut: () => posts.findLast((post) => post.method === 'PUT')?.body,
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
