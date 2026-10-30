import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from '../src/App'
import { decisionsOf, fakeServer, payload, record } from './fixture'

const button = (name: string | RegExp) => screen.getByRole('button', { name })

async function renderApp(data = payload()) {
  const server = fakeServer(data)
  render(<App />)
  await screen.findByRole('heading', { name: 'Classification overview page' })
  // The list view, once the page learnt there is no diff.
  await screen.findByRole('listbox', { name: 'Findings' })
  return server
}

test('"Fix all auto-addressable" sends one POST with exactly the open auto findings', async () => {
  const server = await renderApp(
    payload({ records: { 'f-04': record('fixed'), 'f-01': record('skipped') } }),
  )
  fireEvent.click(button(/^Fix all auto-addressable/))
  // Two findings: a confirmation first, inline.
  expect(server.posts).toEqual([])
  expect(screen.getByRole('alertdialog').textContent).toContain('Fix 2 findings?')
  fireEvent.click(button('Confirm'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(server.posts[0]).toEqual({
    url: '/api/decisions',
    body: {
      decisions: [
        { id: 'f-05', action: 'fix' },
        { id: 'f-03', action: 'fix' },
      ],
    },
  })
})

test('the shortcut is disabled when no auto finding is open', async () => {
  await renderApp(
    payload({
      records: {
        'f-03': record('fixed'),
        'f-04': record('dropped'),
        'f-05': record('queued'),
      },
    }),
  )
  expect(button(/^Fix all auto-addressable/)).toHaveProperty('disabled', true)
})

test('a batch on the selection applies only to the findings the action can move', async () => {
  const server = await renderApp(payload({ records: { 'f-02': record('working') } }))
  fireEvent.click(button('all'))
  expect(screen.getByText('5 findings selected')).toBeDefined()
  // f-02 is working: Skip cannot move it.
  fireEvent.click(button(/^Skip/))
  expect(screen.getByRole('alertdialog').textContent).toContain('Skip 4 findings?')
  fireEvent.click(button('Cancel'))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(server.posts).toEqual([])
  fireEvent.click(button(/^Drop/))
  fireEvent.click(button('Confirm'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  const decisions = decisionsOf(server.posts[0])
  expect(decisions.map((decision) => decision.id)).toEqual([
    'f-01',
    'f-05',
    'f-03',
    'f-04',
  ])
  expect(decisions.every((decision) => decision.action === 'drop')).toBe(true)
})

test('a single selected finding needs no confirmation', async () => {
  const server = await renderApp()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Use the design tokens' }))
  fireEvent.click(button(/^Fix( \d+)?$/))
  await waitFor(() =>
    expect(server.posts).toEqual([
      { url: '/api/decisions', body: { decisions: [{ id: 'f-04', action: 'fix' }] } },
    ]),
  )
})

test('Post and "Post all" exist for theirs only, and post the open findings', async () => {
  const server = await renderApp(
    payload({ ownership: 'theirs', records: { 'f-01': record('posted') } }),
  )
  fireEvent.click(button(/^Post all/))
  expect(screen.getByRole('alertdialog').textContent).toContain('Post 4 comments?')
  fireEvent.click(button('Confirm'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  const decisions = decisionsOf(server.posts[0])
  expect(decisions.map((decision) => decision.id)).toEqual([
    'f-02',
    'f-05',
    'f-03',
    'f-04',
  ])
  expect(decisions.every((decision) => decision.action === 'post')).toBe(true)
})

test('ours has no Post', async () => {
  await renderApp()
  expect(screen.queryByRole('button', { name: /^Post/ })).toBeNull()
})

test('"select open" and "select auto-addressable" fill the selection', async () => {
  await renderApp(payload({ records: { 'f-03': record('fixed') } }))
  fireEvent.click(button('open'))
  expect(screen.getByText('4 findings selected')).toBeDefined()
  fireEvent.click(button('auto-addressable'))
  expect(screen.getByText('3 findings selected')).toBeDefined()
  fireEvent.click(button('none'))
  expect(screen.queryByText(/findings selected/)).toBeNull()
})
