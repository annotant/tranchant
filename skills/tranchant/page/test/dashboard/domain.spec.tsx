import { expect, test } from 'vitest'
import {
  agoOf,
  filtered,
  grouped,
  openUrlOf,
  ownerOf,
  progressOf,
  projectsOf,
  summaryOf,
  whenOf,
  whereOf,
} from '../../dashboard/domain'
import { NOW, listed } from './fixture'

test('the groups come in their order, the empty ones left out; stopped is under Needs you', () => {
  const reviews = [
    listed({ id: 'done' }),
    listed({ id: 'ready', state: 'ready', status: 'preparing', waiting: true }),
    listed({ id: 'stopped', state: 'stopped', status: 'reviewing' }),
    listed({ id: 'running', state: 'running', status: 'reviewing' }),
  ]
  expect(
    grouped(reviews).map((group) => [group.id, group.reviews.map((one) => one.id)]),
  ).toEqual([
    ['needs', ['stopped']],
    ['running', ['running']],
    ['ready', ['ready']],
    ['done', ['done']],
  ])
  expect(grouped([listed()]).map((group) => group.id)).toEqual(['done'])
})

test('a row says where the review stands', () => {
  expect(progressOf(listed()).text).toBe('4 fixed, 2 dropped')
  expect(progressOf(listed({ findings: { moved: 1 } })).text).toBe('1 moved to an issue')
  expect(progressOf(listed({ findings: {} })).text).toBe('No finding')
  expect(
    progressOf(
      listed({ state: 'needs', findings: { open: 3, asking: 1, posted: 3, fixed: 1 } }),
    ),
  ).toEqual({
    text: '4 findings to settle · an agent asks you · 3 posted',
    tone: 'needs',
  })
  expect(
    progressOf(
      listed({ state: 'stopped', status: 'reviewing', lenses: { done: 4, total: 7 } }),
    ),
  ).toEqual({ text: 'Stopped · its session ended after 4 of 7 lenses', tone: 'stopped' })
  expect(
    progressOf(
      listed({
        state: 'running',
        status: 'reviewing',
        lenses: { done: 6, total: 9 },
        findings: { open: 4 },
      }),
    ),
  ).toEqual({
    text: 'Reviewing · 6 of 9 lenses · 4 findings',
    percent: 67,
    tone: 'plain',
  })
  expect(
    progressOf(
      listed({
        state: 'running',
        status: 'reviewing',
        lenses: { done: 7, total: 7 },
        verified: { done: 5, total: 7 },
        findings: { open: 7 },
      }),
    ).text,
  ).toBe('Verifying · 5 of 7 findings')
  expect(
    progressOf(
      listed({ state: 'ready', status: 'preparing', lenses: { done: 0, total: 9 } }),
    ).text,
  ).toBe('9 lenses')
  expect(
    progressOf(listed({ state: 'needs', status: 'refused', refusal: 'bugs: gone' })).text,
  ).toBe('Refused · bugs: gone')
})

test('whose branch, where it runs, and Open only while a server serves it and it is not done', () => {
  expect(ownerOf(listed())).toBe('your branch')
  expect(
    ownerOf(
      listed({ ownership: 'theirs', mr: { url: 'u', label: '!4', author: 'sgagnon' } }),
    ),
  ).toBe('sgagnon’s branch')
  expect(ownerOf(listed({ ownership: 'theirs' }))).toBe('their branch')
  expect(whereOf(listed(), '/home/me')).toBe('~/dev/annotant')
  expect(
    whereOf(
      listed({ live: { url: 'http://127.0.0.1:1', cwd: '/home/me/orca/wt' } }),
      '/home/me',
    ),
  ).toBe('~/orca/wt')
  const live = { url: 'http://127.0.0.1:4599' }
  expect(openUrlOf(listed({ state: 'needs', live }))).toBe(live.url)
  expect(openUrlOf(listed({ live }))).toBeUndefined()
  expect(openUrlOf(listed({ state: 'needs' }))).toBeUndefined()
})

test('when: since it started while it runs, else its last change', () => {
  expect(agoOf(NOW - 30_000, NOW)).toBe('just now')
  expect(agoOf(NOW - 12 * 60_000, NOW)).toBe('12 min ago')
  expect(agoOf(NOW - 26 * 3_600_000, NOW)).toBe('yesterday')
  expect(agoOf(Date.parse('2026-11-02T12:00:00'), NOW)).toBe('Nov 2')
  expect(agoOf(Date.parse('2025-11-02T12:00:00'), NOW)).toBe('Nov 2, 2025')
  expect(
    whenOf(
      listed({ state: 'running', createdAt: new Date(NOW - 8 * 60_000).toISOString() }),
      NOW,
    ),
  ).toBe('started 8 min ago')
  expect(whenOf(listed(), NOW)).toBe('12 min ago')
})

test('the project filter: by name, each with its reviews not done; none checked shows them all', () => {
  const reviews = [
    listed({ id: 'a', repo: { key: '/w/web-app', name: 'web-app' }, state: 'needs' }),
    listed({ id: 'b' }),
    listed({ id: 'c', state: 'running' }),
  ]
  const projects = projectsOf(reviews)
  expect(projects).toEqual([
    { key: '/home/me/dev/annotant', name: 'annotant', open: 1 },
    { key: '/w/web-app', name: 'web-app', open: 1 },
  ])
  expect(filtered(reviews, new Set()).map((one) => one.id)).toEqual(['a', 'b', 'c'])
  expect(filtered(reviews, new Set(['/w/web-app'])).map((one) => one.id)).toEqual(['a'])
  expect(summaryOf(projects, new Set())).toBe('All')
  expect(summaryOf(projects, new Set(['/w/web-app']))).toBe('web-app')
  expect(summaryOf(projects, new Set(['/w/web-app', '/home/me/dev/annotant']))).toBe(
    '2 projects',
  )
})
