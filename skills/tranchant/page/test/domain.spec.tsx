import { expect, test } from 'vitest'
import {
  type Action,
  allows,
  applicable,
  counts,
  groupFindings,
  idsInBucket,
  openIds,
  orderedFindings,
  postBlocker,
  type State,
  stateLabel,
} from '../src/domain'
import { FINDINGS, mergeRequest, ORDER, record, review } from './fixture'

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

test('post needs diff refs at the head reviewed, from open, dropped, skipped or failed', () => {
  expect(from('post', 'ours')).toEqual([])
  expect(from('post', 'theirs')).toEqual(['open', 'dropped', 'skipped', 'failed'])
  const ours = review('ours', { mr: mergeRequest() })
  expect(STATES.filter((state) => allows('post', state, ours))).toEqual(
    from('post', 'theirs'),
  )
  const ahead = review('ours', { mr: mergeRequest('f'.repeat(40)) })
  expect(allows('post', 'open', ahead)).toBe(false)
  expect(postBlocker(ahead)).toBe(
    "push your branch first: the MR's head is not the one reviewed",
  )
  expect(postBlocker(ours)).toBeUndefined()
  const noRefs = { ...review('theirs'), mr: { project: 'x', iid: 1, url: 'https://x' } }
  expect(allows('post', 'open', noRefs)).toBe(false)
})

test('drop and skip are refused while working, once fixed or posted, and on a finding already there', () => {
  const final = new Set(['working', 'fixed', 'posted'])
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
