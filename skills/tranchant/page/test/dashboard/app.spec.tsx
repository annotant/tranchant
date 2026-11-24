import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from '../../dashboard/App'
import type { Listing } from '../../dashboard/domain'
import { listed, listing } from './fixture'

/** The page's one EventSource: the test opens it and pushes the server's events. */
class FakeEvents {
  static last: FakeEvents | undefined
  listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>()
  constructor(readonly url: string) {
    FakeEvents.last = this
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close() {}
  emit(type: string, data = '') {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new MessageEvent(type, { data }))
  }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEvents)
})
afterEach(() => {
  FakeEvents.last = undefined
})

/** The page, once the server pushed its first list: it does on every connection. */
async function opened(answer: Listing) {
  render(<App />)
  await act(async () => {
    FakeEvents.last?.emit('reviews', JSON.stringify(answer))
  })
}

test('no review yet: says how to start one', async () => {
  await opened(listing([]))
  expect(screen.getByRole('heading', { name: 'No review yet' })).toBeTruthy()
  expect(screen.getByText('/tranchant review')).toBeTruthy()
})

test('the reviews by group, Done folded; Open only on a live review; the list follows the server with no reload', async () => {
  await opened(
    listing([
      listed({
        id: 'r2',
        dir: '/d/r2',
        title: 'Add the people drawer',
        state: 'needs',
        ownership: 'theirs',
        mr: {
          url: 'https://gitlab.example/x/-/merge_requests/482',
          label: '!482',
          author: 'sgagnon',
        },
        findings: { open: 8 },
        live: { url: 'http://127.0.0.1:4599', cwd: '/home/me/work/web-app' },
      }),
      listed({ id: 'r7', dir: '/d/r7', title: 'Generated ids used as anchors' }),
    ]),
  )
  const needs = screen.getByRole('region', { name: 'Needs you' })
  expect(within(needs).getByText('Add the people drawer')).toBeTruthy()
  expect(within(needs).getByText('sgagnon’s branch')).toBeTruthy()
  expect(within(needs).getByText('8 findings to settle')).toBeTruthy()
  expect(within(needs).getByText('~/work/web-app')).toBeTruthy()
  const open = within(needs).getByRole('link', {
    name: /Open the review of Add the people drawer/,
  })
  expect(open.getAttribute('href')).toBe('http://127.0.0.1:4599')
  expect(open.getAttribute('target')).toBe('_blank')

  const done = screen.getByRole('region', { name: 'Done' })
  expect(within(done).queryByText('Generated ids used as anchors')).toBeNull()
  fireEvent.click(within(done).getByRole('button', { name: 'Show 1 done review' }))
  expect(within(done).getByText('Generated ids used as anchors')).toBeTruthy()
  expect(within(done).queryByRole('link', { name: /Open/ })).toBeNull()

  // Its last finding settled elsewhere: the server pushes the new list.
  await act(async () => {
    FakeEvents.last?.emit(
      'reviews',
      JSON.stringify(
        listing([
          listed({
            id: 'r2',
            dir: '/d/r2',
            title: 'Add the people drawer',
            findings: { posted: 8 },
          }),
          listed({ id: 'r7', dir: '/d/r7', title: 'Generated ids used as anchors' }),
        ]),
      ),
    )
  })
  expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull()
  expect(document.querySelector('.db-livestat')?.textContent).toBe(
    'Live · from ~/.cache/tranchant',
  )
})

test('the project filter: several projects checked, a search, and Show all projects', async () => {
  await opened(
    listing([
      listed({ id: 'a', dir: '/d/a', title: 'Annotant review', state: 'needs' }),
      listed({
        id: 'k',
        dir: '/d/k',
        title: 'Kifkif review',
        state: 'needs',
        repo: { key: '/home/me/dev/kifkif', name: 'kifkif' },
      }),
    ]),
  )
  fireEvent.click(screen.getByRole('button', { name: /Projects: All/ }))
  const pop = screen.getByRole('group', { name: 'Projects to show' })
  expect(within(pop).getAllByRole('checkbox')).toHaveLength(2)
  fireEvent.click(within(pop).getByRole('checkbox', { name: /kifkif/ }))
  expect(screen.queryByText('Annotant review')).toBeNull()
  expect(screen.getByText('Kifkif review')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Projects: kifkif/ })).toBeTruthy()

  fireEvent.change(within(pop).getByPlaceholderText('Find a project'), {
    target: { value: 'zz' },
  })
  expect(within(pop).getByText('No project matches.')).toBeTruthy()

  fireEvent.click(within(pop).getByRole('button', { name: 'Show all projects' }))
  expect(screen.getByText('Annotant review')).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('group', { name: 'Projects to show' })).toBeNull()
})

test('a lost connection says so, and the list stands', async () => {
  await opened(listing([listed({ state: 'needs', findings: { open: 1 } })]))
  await act(async () => {
    FakeEvents.last?.emit('error')
  })
  expect(document.querySelector('.db-livestat')?.textContent).toMatch(/^Reconnecting/)
  expect(screen.getByText('1 finding to settle')).toBeTruthy()
})

test('a list the server could not read: the last one stands, no longer live; back once it pushes', async () => {
  const shown = listing([listed({ state: 'needs', findings: { open: 1 } })])
  await opened(shown)
  await act(async () => {
    FakeEvents.last?.emit('stale')
  })
  expect(document.querySelector('.db-livestat')?.textContent).toMatch(/^Reconnecting/)
  await act(async () => {
    FakeEvents.last?.emit('reviews', JSON.stringify(shown))
  })
  expect(document.querySelector('.db-livestat')?.textContent).toMatch(/^Live/)
})

test('a server that never answers says so; a row the page cannot read is left out', async () => {
  render(<App />)
  await act(async () => {
    FakeEvents.last?.emit('error')
  })
  expect(screen.getByText(/does not answer/)).toBeTruthy()
  await act(async () => {
    FakeEvents.last?.emit(
      'reviews',
      JSON.stringify({
        ...listing([
          listed({ title: 'Readable', state: 'needs', findings: { open: 1 } }),
        ]),
        reviews: [
          listed({ title: 'Readable', state: 'needs', findings: { open: 1 } }),
          { ...listed({ dir: '/d/x', title: 'From a newer server' }), state: 'queued' },
        ],
      }),
    )
  })
  expect(screen.getByText('Readable')).toBeTruthy()
  expect(screen.queryByText('From a newer server')).toBeNull()
})
