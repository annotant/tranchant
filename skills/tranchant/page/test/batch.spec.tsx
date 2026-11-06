import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from '../src/App'
import type { AccountPayload } from '../src/api'
import {
  decisionsOf,
  fakeServer,
  FINDINGS,
  mergeRequest,
  payload,
  record,
  withoutComment,
} from './fixture'

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const master = () =>
  screen.getByRole('checkbox', { name: /^(Select every finding|Clear the selection)$/ })
const chip = (name: RegExp, pressed = false) =>
  screen.getByRole('button', { name, pressed })
const selectionActions = () =>
  screen.queryByRole('group', { name: 'Actions on the selection' })

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

test('the "Safe to auto-fix" chip then Fix sends one POST with exactly the open auto findings', async () => {
  const server = await renderApp(
    payload({ records: { 'f-04': record('fixed'), 'f-01': record('skipped') } }),
  )
  fireEvent.click(chip(/^Safe to auto-fix/))
  expect(chip(/^Safe to auto-fix/, true).textContent).toBe('Safe to auto-fix 2')
  expect(screen.getByText('2 of 5 findings selected')).toBeDefined()
  fireEvent.click(button(/^Fix \d+$/))
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
  // After an action, the selection clears.
  await waitFor(() => expect(screen.getByText('Select among 5 findings')).toBeDefined())
  expect(selectionActions()).toBeNull()
})

test('no selection: no selection actions, and the master checkbox unchecked', async () => {
  await renderApp()
  expect(master().getAttribute('aria-checked')).toBe('false')
  expect(master().getAttribute('aria-label')).toBe('Select every finding')
  expect(screen.getByText('Select among 5 findings')).toBeDefined()
  expect(selectionActions()).toBeNull()
  expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  expect(screen.queryByRole('button', { name: /^Fix all/ })).toBeNull()
})

test('the master checkbox is mixed with some selected, checked with all, and toggles all or none', async () => {
  await renderApp()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Use the design tokens' }))
  expect(master().getAttribute('aria-checked')).toBe('mixed')
  expect(screen.getByText('1 of 5 findings selected')).toBeDefined()
  expect(selectionActions()).not.toBeNull()
  fireEvent.click(master())
  expect(master().getAttribute('aria-checked')).toBe('true')
  expect(master().getAttribute('aria-label')).toBe('Clear the selection')
  expect(screen.getByText('5 of 5 findings selected')).toBeDefined()
  fireEvent.click(master())
  expect(master().getAttribute('aria-checked')).toBe('false')
  expect(selectionActions()).toBeNull()
})

test('a selection action that applies to none of the selection is disabled, and says why', async () => {
  await renderApp(payload({ records: { 'f-04': record('fixed') } }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Use the design tokens' }))
  const skip = within(selectionActions()!).getByRole('button', { name: /^Skip/ })
  expect(skip).toHaveProperty('disabled', true)
  expect(skip.getAttribute('title')).toBe('None of the selection can be skipped')
})

test('a batch on the selection applies only to the findings the action can move', async () => {
  const server = await renderApp(payload({ records: { 'f-02': record('working') } }))
  fireEvent.click(master())
  expect(screen.getByText('5 of 5 findings selected')).toBeDefined()
  // f-02 is working: Skip cannot move it.
  fireEvent.click(button(/^Skip/))
  expect(screen.getByRole('alertdialog').textContent).toContain('Skip 4 findings?')
  fireEvent.click(button('Cancel'))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(server.posts).toEqual([])
  expect(screen.getByText('5 of 5 findings selected')).toBeDefined()
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
  fireEvent.click(button(/^Fix \d+$/))
  await waitFor(() =>
    expect(server.posts).toEqual([
      { url: '/api/decisions', body: { decisions: [{ id: 'f-04', action: 'fix' }] } },
    ]),
  )
  await waitFor(() => expect(selectionActions()).toBeNull())
})

test('a request that fails keeps the selection', async () => {
  const server = await renderApp()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Use the design tokens' }))
  server.down()
  fireEvent.click(button(/^Fix \d+$/))
  await screen.findByText('Failed to fetch')
  expect(screen.getByText('1 of 5 findings selected')).toBeDefined()
})

test('Post and "Post all to do" exist for theirs only, and post the open findings', async () => {
  const server = await renderApp(
    payload({ ownership: 'theirs', records: { 'f-01': record('posted') } }),
  )
  fireEvent.click(button(/^Post all to do/))
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
  fireEvent.click(button(/^Post all to do/))
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
    fireEvent.click(button(/^Post all to do/))
    expect(screen.getByRole('alertdialog').textContent).toContain(
      'Post 5 comments on !5746 as your glab account?',
    )
  })
}

test('ours without an MR has no Post, and never asks for the account', async () => {
  const server = await renderApp()
  // Every finding is open: only the impossibility of posting hides the buttons.
  fireEvent.click(master())
  expect(selectionActions()).not.toBeNull()
  expect(screen.queryByRole('button', { name: /^Post/ })).toBeNull()
  expect(askedAccount(server)).toBe(false)
})

test('ours with an MR posts every open finding, one without a comment written from its problem and fix', async () => {
  const [first, ...rest] = FINDINGS
  const server = await renderApp(
    payload({
      review: {
        mr: mergeRequest(),
        findings: [withoutComment(first!), ...rest],
      },
    }),
    { username: 'me' },
  )
  fireEvent.click(button(/^Post all to do/))
  const dialog = screen.getByRole('alertdialog')
  await waitFor(() =>
    expect(dialog.textContent).toContain(
      `Post ${FINDINGS.length} comments on !5746 as me?`,
    ),
  )
  const drafted = within(dialog).getByText(first!.title).closest('li')
  expect(drafted?.textContent).toContain('written from its problem and fix')
  fireEvent.click(button('Confirm'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  const decisions = decisionsOf(server.posts[0])
  expect(decisions).toHaveLength(FINDINGS.length)
  expect(decisions.find((decision) => decision.id === first!.id)).toEqual({
    id: first!.id,
    action: 'post',
    comment: `${first!.problem}\n\n${first!.fix}`,
  })
  // A finding's own comment goes as is: the store posts it.
  expect(decisions.find((decision) => decision.id === rest[0]!.id)).toEqual({
    id: rest[0]!.id,
    action: 'post',
  })
})

test('Post counts every selected finding but the posted, and asks even for one', async () => {
  const [first, second] = FINDINGS
  const server = await renderApp(
    payload({
      review: {
        mr: mergeRequest(),
        findings: [withoutComment(first!), ...FINDINGS.slice(1)],
      },
      records: { [second!.id]: record('posted') },
    }),
    { username: 'me' },
  )
  for (const finding of [first!, second!]) {
    fireEvent.click(screen.getByRole('checkbox', { name: `Select ${finding.title}` }))
  }
  const post = button(/^Post\b(?! all)/)
  expect(post.textContent).toBe('Post 1')
  fireEvent.click(post)
  await waitFor(() =>
    expect(screen.getByRole('alertdialog').textContent).toContain(
      'Post 1 comment on !5746 as me?',
    ),
  )
  expect(server.posts).toEqual([])
  fireEvent.click(button('Confirm'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(decisionsOf(server.posts[0]).map((decision) => decision.id)).toEqual([first!.id])
})

test('ours with an MR marks the findings with a comment, in the list', async () => {
  const [first, ...rest] = FINDINGS
  await renderApp(
    payload({
      review: { mr: mergeRequest(), findings: [withoutComment(first!), ...rest] },
    }),
  )
  const list = screen.getByRole('listbox', { name: 'Findings' })
  expect(within(list).getAllByRole('img', { name: 'Has a comment' })).toHaveLength(
    FINDINGS.length - 1,
  )
  const row = within(list).getByRole('checkbox', {
    name: `Select ${first!.title}`,
  }).parentElement!
  expect(within(row).queryByRole('img', { name: 'Has a comment' })).toBeNull()
})

test('no comment mark without an MR, nor on theirs where every finding has one', async () => {
  await renderApp()
  expect(screen.queryByRole('img', { name: 'Has a comment' })).toBeNull()
})

test('ours with an MR at another head offers no Post', async () => {
  await renderApp(payload({ review: { mr: mergeRequest('f'.repeat(40)) } }))
  fireEvent.click(master())
  expect(selectionActions()).not.toBeNull()
  const bar = screen.getByRole('toolbar', { name: 'Batch actions' })
  expect(within(bar).queryByRole('button', { name: /^Post/ })).toBeNull()
})

test('a chip selects its group and shows pressed; clicked again, it clears the selection', async () => {
  await renderApp(payload({ records: { 'f-03': record('fixed') } }))
  fireEvent.click(chip(/^To do/))
  expect(screen.getByText('4 of 5 findings selected')).toBeDefined()
  expect(chip(/^To do/, true).textContent).toBe('To do 4')
  fireEvent.click(chip(/^Safe to auto-fix/))
  expect(screen.getByText('2 of 5 findings selected')).toBeDefined()
  expect(chip(/^To do/).getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(chip(/^Safe to auto-fix/, true))
  expect(screen.getByText('Select among 5 findings')).toBeDefined()
  fireEvent.click(chip(/^To do/))
  fireEvent.click(button('Clear'))
  expect(screen.getByText('Select among 5 findings')).toBeDefined()
})

test('"Post all to do" only when something is left to post', async () => {
  await renderApp(
    payload({
      ownership: 'theirs',
      records: Object.fromEntries(
        FINDINGS.map((finding) => [finding.id, record('posted')]),
      ),
    }),
  )
  expect(screen.queryByRole('button', { name: /^Post all/ })).toBeNull()
})

test('Issue opens one issue per selected finding, drafted, after a confirmation even for one', async () => {
  const server = await renderApp()
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${FINDINGS[0]!.title}` }))
  fireEvent.click(button(/^Issue 1$/))
  expect(server.posts).toEqual([])
  const confirm = screen.getByRole('alertdialog')
  expect(confirm.textContent).toContain('Open 1 issue on https://github.com/acme/app')
  expect(
    within(screen.getByRole('list', { name: 'Issues to open' })).getByText(
      FINDINGS[0]!.title,
    ),
  ).toBeDefined()
  fireEvent.click(button('Confirm'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  const [decision] = decisionsOf(server.posts[0])
  expect(decision).toMatchObject({
    id: 'f-01',
    action: 'issue',
    title: FINDINGS[0]!.title,
  })
  expect(decision?.body).toContain(FINDINGS[0]!.problem)
  expect(decision?.body).toContain('https://github.com/acme/app/blob/')
})

test('with no tracker, Issue is off and says why', async () => {
  const server = fakeServer(payload())
  server.answerTracker({ kind: null, reason: 'the project has no origin remote' })
  render(<App />)
  await screen.findByRole('navigation', { name: 'Findings' })
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${FINDINGS[0]!.title}` }))
  await waitFor(() => expect(button(/^Issue 0$/)).toHaveProperty('disabled', true))
  expect(button(/^Issue 0$/).getAttribute('title')).toContain('no origin remote')
})
