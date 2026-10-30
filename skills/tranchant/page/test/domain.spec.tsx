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
  type State,
} from '../src/domain'
import { FINDINGS, ORDER, record, review } from './fixture'

test('findings group by bucket, then topic, then path:line', () => {
  const groups = groupFindings(FINDINGS)
  expect(groups.map((group) => group.label)).toEqual([
    'Needs your review',
    'Auto-addressable',
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

test('post needs theirs with diff refs, from open, dropped, skipped or failed', () => {
  expect(from('post', 'ours')).toEqual([])
  expect(from('post', 'theirs')).toEqual(['open', 'dropped', 'skipped', 'failed'])
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

test('the header counts open, fixed, posted and dropped', () => {
  const records = {
    'f-01': record('fixed'),
    'f-02': record('posted'),
    'f-03': record('dropped'),
    'f-04': record('working'),
  }
  expect(counts(review(), records)).toEqual({ open: 1, fixed: 1, posted: 1, dropped: 1 })
})
