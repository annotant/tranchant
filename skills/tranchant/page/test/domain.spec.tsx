import { expect, test } from 'vitest'
import {
  type Action,
  allows,
  anchorUrl,
  applicable,
  commentedIds,
  counts,
  discussable,
  draftIssue,
  draftReply,
  groupFindings,
  idsInBucket,
  openIds,
  orderedFindings,
  replyPending,
  type State,
  stateLabel,
  staleMrReason,
  threadItems,
  threadResolved,
} from '../src/domain'
import {
  FINDINGS,
  mergeRequest,
  ORDER,
  pullRequest,
  record,
  review,
  THREADED,
} from './fixture'

test('findings group by bucket, then topic, then path:line', () => {
  const groups = groupFindings(FINDINGS)
  expect(groups.map((group) => group.label)).toEqual([
    'Needs your review',
    'Safe to auto-fix',
  ])
  expect(groups[0]?.topics.map((topic) => topic.topic)).toEqual(['Bugs'])
  expect(groups[0]?.topics[0]?.findings.map((finding) => finding.id)).toEqual([
    'f-02',
    'f-01',
  ])
  expect(groups[1]?.topics.map((topic) => topic.topic)).toEqual([
    'Bugs',
    'Tests',
    'Conventions',
  ])
  expect(orderedFindings(FINDINGS).map((finding) => finding.id)).toEqual(ORDER)
})

test('an unknown topic sorts after the seven', () => {
  const odd = { ...FINDINGS[4]!, id: 'f-09', topic: 'Performance' }
  const groups = groupFindings([odd, ...FINDINGS])
  expect(groups[1]?.topics.map((topic) => topic.topic)).toEqual([
    'Bugs',
    'Tests',
    'Conventions',
    'Performance',
  ])
})

const STATES: State[] = [
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

const from = (action: Action, ownership: 'ours' | 'theirs') =>
  STATES.filter((state) => allows(action, state, review(ownership)))

test('fix is allowed from open, dropped, skipped, failed and stopped; never again once fixed', () => {
  expect(from('fix', 'ours')).toEqual(['open', 'dropped', 'skipped', 'failed', 'stopped'])
  expect(from('fix', 'theirs')).toEqual(from('fix', 'ours'))
})

test('an issue opens from open, dropped, skipped or failed, ours or theirs; moved is final', () => {
  expect(from('issue', 'ours')).toEqual(['open', 'dropped', 'skipped', 'failed'])
  expect(from('issue', 'theirs')).toEqual(from('issue', 'ours'))
  for (const action of ['fix', 'post', 'drop', 'skip'] as const)
    expect(allows(action, 'moved', review('theirs'))).toBe(false)
})

test("an issue's anchor links the commit reviewed on the MR, else the branch, within the repository", () => {
  const finding = { path: 'src/a b.ts', line: 7 }
  const gitlab = {
    kind: 'gitlab',
    web: 'https://gitlab.com/g/p',
    prefix: 'web/',
  } as const
  const onMr = review('ours', { mr: mergeRequest() })
  expect(anchorUrl(finding, onMr, gitlab)).toBe(
    `https://gitlab.com/g/p/-/blob/${onMr.headSha}/web/src/a%20b.ts#L7`,
  )
  const branch = review('ours', { branch: 'feature/x#1' })
  expect(
    anchorUrl(finding, branch, {
      kind: 'github',
      web: 'https://github.com/o/r',
      prefix: '',
    }),
  ).toBe('https://github.com/o/r/blob/feature/x%231/src/a%20b.ts#L7')
  expect(anchorUrl(finding, branch, { kind: null, reason: 'none' })).toBeUndefined()
  expect(anchorUrl(finding, branch, undefined)).toBeUndefined()
})

test("an issue's draft holds the problem, why, fix, anchor and excerpt, fenced past its backticks", () => {
  const finding = {
    ...FINDINGS[0]!,
    excerpt: { startLine: 1, lines: ['const a = ```x```'] },
  }
  const { title, body } = draftIssue(finding, review('ours'), undefined)
  expect(title).toBe(finding.title)
  expect(body).toContain(`\`${finding.path}:${finding.line}\``)
  expect(body).toContain('````ts\nconst a = ```x```\n````')
  expect(body.indexOf(finding.problem)).toBeLessThan(body.indexOf(finding.why))
  expect(body.indexOf(finding.why)).toBeLessThan(body.indexOf(finding.fix))
})

test('post needs diff refs at the head reviewed, from open, dropped, skipped or failed', () => {
  expect(from('post', 'ours')).toEqual([])
  expect(from('post', 'theirs')).toEqual(['open', 'dropped', 'skipped', 'failed'])
  const ours = review('ours', { mr: mergeRequest() })
  expect(STATES.filter((state) => allows('post', state, ours))).toEqual(
    from('post', 'theirs'),
  )
  const ahead = review('ours', { mr: mergeRequest('f'.repeat(40)) })
  expect(allows('post', 'open', ahead)).toBe(false)
  expect(staleMrReason(ahead)).toBe(
    "push your branch first: the MR's head is not the one reviewed",
  )
  expect(staleMrReason(ours)).toBeUndefined()
  expect(staleMrReason(review('ours'))).toBeUndefined()
  expect(staleMrReason(review('theirs', { mr: mergeRequest('f'.repeat(40)) }))).toBe(
    'the MR moved past the commit reviewed: review it again',
  )
  const noRefs = { ...review('theirs'), mr: { project: 'x', iid: 1, url: 'https://x' } }
  expect(allows('post', 'open', noRefs)).toBe(false)
})

test('only ours with a postable MR marks the findings with a comment', () => {
  const ids = FINDINGS.map((finding) => finding.id)
  expect([...commentedIds(review('ours', { mr: mergeRequest() }))].toSorted()).toEqual(
    ids.toSorted(),
  )
  expect(commentedIds(review('ours')).size).toBe(0)
  expect(commentedIds(review('theirs')).size).toBe(0)
  expect(commentedIds(review('ours', { mr: mergeRequest('f'.repeat(40)) })).size).toBe(0)
})

test('drop and skip are refused while working, once fixed, posted or moved, and on a finding already there', () => {
  const final = new Set(['working', 'fixed', 'posted', 'moved'])
  expect(from('drop', 'ours')).toEqual(
    STATES.filter((s) => !final.has(s) && s !== 'dropped'),
  )
  expect(from('skip', 'ours')).toEqual(
    STATES.filter((s) => !final.has(s) && s !== 'skipped'),
  )
})

test('stop applies to queued and working; answer to asking', () => {
  expect(STATES.filter((state) => allows('stop', state, review()))).toEqual([
    'queued',
    'working',
  ])
  expect(STATES.filter((state) => allows('answer', state, review()))).toEqual(['asking'])
})

test('a batch applies to the selected findings the action can move', () => {
  const records = { 'f-04': record('fixed'), 'f-02': record('working') }
  expect(applicable(ORDER, 'fix', records, review())).toEqual(['f-01', 'f-05', 'f-03'])
  expect(applicable(ORDER, 'skip', records, review())).toEqual(['f-01', 'f-05', 'f-03'])
  expect(idsInBucket(review(), 'auto')).toEqual(['f-03', 'f-04', 'f-05'])
  expect(openIds(review(), records)).toEqual(['f-01', 'f-03', 'f-05'])
})

test('the header counts by what the state means: to do, done, set aside', () => {
  const records = {
    'f-01': record('fixed'),
    'f-02': record('posted'),
    'f-03': record('dropped'),
    'f-04': record('skipped'),
  }
  expect(counts(review(), records)).toEqual({
    toDo: 1,
    inProgress: 0,
    needsYou: 0,
    done: 2,
    setAside: 2,
  })
})

test.each([
  ['asking', 'needsYou'],
  ['failed', 'needsYou'],
  ['queued', 'inProgress'],
  ['working', 'inProgress'],
] as const)('a finding %s counts as %s', (state, bucket) => {
  const tally = counts(review(), { 'f-01': record(state) })
  expect(tally[bucket]).toBe(1)
  expect(tally.needsYou + tally.inProgress).toBe(1)
  expect(tally.toDo).toBe(4)
})

test('every state shows a human word, never its own name', () => {
  const states = [
    'open',
    'queued',
    'working',
    'asking',
    'fixed',
    'posted',
    'dropped',
    'skipped',
    'failed',
    'stopped',
  ] as const
  expect(Object.fromEntries(states.map((state) => [state, stateLabel(state)]))).toEqual({
    open: 'To do',
    queued: 'In progress',
    working: 'In progress',
    asking: 'Needs you',
    failed: 'Needs you',
    fixed: 'Done',
    posted: 'Done',
    dropped: 'Set aside',
    skipped: 'Set aside',
    stopped: 'Set aside',
  })
})

test('a thread is replied on with no diff refs, a fixed one too, never in a batch', () => {
  const comments = review('ours', {
    mr: pullRequest(),
    findings: [THREADED, FINDINGS[1]!],
  })
  expect(allows('post', 'open', comments, THREADED)).toBe(true)
  expect(allows('post', 'fixed', comments, THREADED)).toBe(true)
  // A finding of its own still needs the diff refs a positioned comment takes.
  expect(allows('post', 'open', comments, FINDINGS[1])).toBe(false)
  expect(allows('post', 'open', review('ours'), THREADED)).toBe(false)
  const records = { [THREADED.id]: record('fixed') }
  expect(applicable([THREADED.id], 'post', records, comments)).toEqual([])
  expect(applicable([THREADED.id], 'fix', {}, comments)).toEqual([THREADED.id])
})

test('a reply opens as last written, else after a fix with what changed, else empty', () => {
  expect(draftReply(undefined)).toBe('')
  expect(draftReply(record('failed', { comment: 'On it' }))).toBe('On it')
  const fixed = record('fixed', {
    runs: [{ id: 'r1', startedAt: '', outcome: 'fixed', summary: 'Skipped it.' }],
  })
  expect(draftReply(fixed)).toBe('Fixed: Skipped it.')
  // Answered back, a thread replied on already opens empty; a failed reply as written.
  expect(draftReply(record('posted', { comment: 'Done' }))).toBe('')
  const failed = { text: 'Done', at: '', failed: 'no right' }
  expect(draftReply(record('fixed', { reply: failed }))).toBe('Done')
})

test('a settled thread is replied on again, one reply at a time', () => {
  const comments = review('ours', { mr: pullRequest(), findings: [THREADED] })
  expect(allows('post', 'posted', comments, THREADED)).toBe(true)
  expect(replyPending(record('fixed', { reply: { text: 'x', at: '' } }))).toBe(true)
  expect(
    replyPending(record('fixed', { reply: { text: 'x', at: '', failed: 'no' } })),
  ).toBe(false)
  expect(replyPending(record('open', { reply: { text: 'x', at: '' } }))).toBe(false)
})

test("a thread's items: yours marked, a first reply on its way or failed after them", () => {
  const thread = THREADED.thread!
  const queued = {
    ...record('queued'),
    decision: { action: 'post' as const, at: '' },
    comment: 'On it',
  }
  expect(
    threadItems(thread, queued, 'me').map(({ author, mine, sent }) => [
      author,
      mine,
      sent,
    ]),
  ).toEqual([
    ['alice', false, undefined],
    ['me', true, undefined],
    ['me', true, 'sending'],
  ])
  const failed = { ...queued, state: 'failed' as const, reason: 'token expired' }
  expect(threadItems(thread, failed, undefined).at(-1)).toMatchObject({
    author: 'you',
    body: 'On it',
    sent: 'failed',
    failed: 'token expired',
  })
  // Nobody known as the viewer: nobody's comment reads as theirs.
  expect(threadItems(thread, undefined, undefined).some((one) => one.mine)).toBe(false)
  expect(
    threadResolved({
      ...record('posted'),
      replies: [{ text: 'x', url: 'u', at: '', resolved: true }],
    }),
  ).toBe(true)
  expect(threadResolved(record('posted'))).toBe(false)
})

test('a thread is discussed once fixed or replied on; another finding is not', () => {
  expect(discussable('posted', THREADED)).toBe(true)
  expect(discussable('fixed', THREADED)).toBe(true)
  expect(discussable('fixed', FINDINGS[0])).toBe(false)
  expect(discussable('queued', THREADED)).toBe(false)
})
