import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from '../src/App'
import type { AccountPayload } from '../src/api'
import { decisionsOf, fakeServer, payload, record } from './fixture'

const button = (name: string | RegExp) => screen.getByRole('button', { name })

async function renderApp(
  data = payload(),
  account: AccountPayload | undefined = { username: null },
) {
  const server = fakeServer(data)
  server.answerAccount(account)
  render(<App />)
  await screen.findByRole('heading', { name: 'Classification overview page' })
  // The list view, once the page learnt there is no diff.
  await screen.findByRole('navigation', { name: 'Findings' })
  return server
}

test('"Fix all safe to auto-fix" sends one POST with exactly the open auto findings', async () => {
  const server = await renderApp(
    payload({ records: { 'f-04': record('fixed'), 'f-01': record('skipped') } }),
  )
  fireEvent.click(button(/^Fix all safe to auto-fix/))
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
  expect(button(/^Fix all safe to auto-fix/)).toHaveProperty('disabled', true)
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
  expect(screen.getByRole('alertdialog').textContent).toContain('Post 4 comments')
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

test('confirming a post names the merge request, the account and each finding', async () => {
  await renderApp(
    payload({ ownership: 'theirs', records: { 'f-01': record('posted') } }),
    { username: 'reviewer-bot' },
  )
  fireEvent.click(button(/^Post all/))
  const dialog = screen.getByRole('alertdialog')
  await waitFor(() =>
    expect(dialog.textContent).toContain('Post 4 comments on !5746 as reviewer-bot?'),
  )
  const titles = within(within(dialog).getByRole('list', { name: 'Comments to post' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent)
  expect(titles).toEqual([
    'Admins skip the tenant check',
    'Off-by-one in the page count',
    'Is the empty state covered?',
    'Use the design tokens',
  ])
})

const askedAccount = (server: ReturnType<typeof fakeServer>) =>
  server.fetch.mock.calls.some(([url]) => url === '/api/account')

for (const [what, account] of [
  ['glab cannot read', { username: null }],
  ['a server without the route', undefined],
] as const) {
  test(`${what}: the confirmation says "your glab account"`, async () => {
    const server = await renderApp(payload({ ownership: 'theirs' }), account)
    await waitFor(() => expect(askedAccount(server)).toBe(true))
    fireEvent.click(button(/^Post all/))
    expect(screen.getByRole('alertdialog').textContent).toContain(
      'Post 5 comments on !5746 as your glab account?',
    )
  })
}

test('ours has no Post, and never asks for the account', async () => {
  const server = await renderApp()
  expect(screen.queryByRole('button', { name: /^Post/ })).toBeNull()
  expect(askedAccount(server)).toBe(false)
})

test('"select to do" and "select safe to auto-fix" fill the selection', async () => {
  await renderApp(payload({ records: { 'f-03': record('fixed') } }))
  fireEvent.click(button('to do'))
  expect(screen.getByText('4 findings selected')).toBeDefined()
  fireEvent.click(button('safe to auto-fix'))
  expect(screen.getByText('3 findings selected')).toBeDefined()
  fireEvent.click(button('none'))
  expect(screen.queryByText(/findings selected/)).toBeNull()
})
