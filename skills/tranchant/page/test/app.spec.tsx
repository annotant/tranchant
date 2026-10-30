import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { RETRY_MS } from '../src/api'
import App from '../src/App'
import { fakeEvents, fakeServer, ORDER, payload, record } from './fixture'

const TITLE = 'Classification overview page'

async function renderApp(data = payload()) {
  const server = fakeServer(data)
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  return server
}

const selectedOption = () =>
  screen.getByRole('option', { selected: true }).id.replace('tr-option-', '')

test('the header shows the branch, the ownership, Jira, the counts and the version', async () => {
  await renderApp(
    payload({ records: { 'f-01': record('fixed'), 'f-03': record('dropped') } }),
  )
  expect(
    screen.getByText('feature/QO-9678/classification-overview → origin/master'),
  ).toBeDefined()
  expect(screen.getByText('your branch')).toBeDefined()
  expect(screen.getByRole('link', { name: 'QO-9678' }).getAttribute('href')).toBe(
    'https://jira.example/browse/QO-9678',
  )
  const tally = screen.getByLabelText('Findings by state')
  expect([...tally.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
    'open',
    'fixed',
    'posted',
    'dropped',
  ])
  expect([...tally.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
    '3',
    '1',
    '0',
    '1',
  ])
  expect(screen.getByText('tranchant 0.0.0-test')).toBeDefined()
  expect(screen.queryByText('checkout moved')).toBeNull()
})

test("theirs names the author's MR and warns when the checkout moved", async () => {
  await renderApp(payload({ ownership: 'theirs', current: 'deadbeef' }))
  const mr = screen.getByRole('link', { name: "jfdoe's MR !5746" })
  expect(mr.getAttribute('href')).toContain('/merge_requests/5746')
  expect(screen.getByText('checkout moved')).toBeDefined()
})

test('the list is grouped in order and the first finding opens itself', async () => {
  await renderApp()
  const options = screen.getAllByRole('option')
  expect(options.map((option) => option.id.replace('tr-option-', ''))).toEqual(ORDER)
  expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toContain(
    'Needs your review',
  )
  expect(selectedOption()).toBe('f-02')
  expect(screen.getByRole('article').textContent).toContain(
    'Admins skip the tenant check',
  )
  // Tags show as chips; a concern needs none.
  expect(screen.getAllByText('question')).toHaveLength(1)
  expect(screen.getAllByText('suggestion')).toHaveLength(1)
})

test('j/k move the cursor, Enter opens, x selects, f fixes the focused finding', async () => {
  const server = await renderApp()
  fireEvent.keyDown(document, { key: 'j' })
  fireEvent.keyDown(document, { key: 'j' })
  expect(selectedOption()).toBe('f-05')
  expect(screen.getByRole('article').textContent).toContain(
    'Admins skip the tenant check',
  )
  fireEvent.keyDown(document, { key: 'Enter' })
  expect(screen.getByRole('article').textContent).toContain(
    'Off-by-one in the page count',
  )
  fireEvent.keyDown(document, { key: 'k' })
  expect(selectedOption()).toBe('f-01')
  fireEvent.keyDown(document, { key: 'x' })
  expect(
    screen.getByRole('checkbox', { name: 'Select Null tenantId crashes the loop' }),
  ).toHaveProperty('checked', true)
  fireEvent.keyDown(document, { key: 'f' })
  await waitFor(() =>
    expect(server.posts).toEqual([
      { url: '/api/decisions', body: { decisions: [{ id: 'f-01', action: 'fix' }] } },
    ]),
  )
  // The cursor does not run past the ends.
  for (let i = 0; i < 10; i++) fireEvent.keyDown(document, { key: 'k' })
  expect(selectedOption()).toBe('f-02')
})

test('shortcuts do nothing while typing, and p does nothing on ours', async () => {
  const server = await renderApp()
  fireEvent.click(screen.getByRole('button', { name: 'Add context for the fix' }))
  const box = screen.getByLabelText('Context for the fix')
  fireEvent.keyDown(box, { key: 'f' })
  fireEvent.keyDown(document, { key: 'p' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(server.posts).toEqual([])
})

test('clicking a row opens it; the detail shows the excerpt, related and the diagram', async () => {
  await renderApp()
  fireEvent.click(screen.getByRole('button', { name: /Null tenantId crashes the loop/ }))
  const article = screen.getByRole('article')
  expect(article.textContent).toContain('src/people/usePeople.ts:42')
  expect(screen.getByRole('note').textContent).toContain(
    'undefined when the drawer opens',
  )
  expect(screen.getByText('Related (1)')).toBeDefined()
  expect(article.textContent).toContain('src/people/useFiles.ts:11')
  fireEvent.click(screen.getByRole('button', { name: /Admins skip the tenant check/ }))
  expect(screen.getByRole('article').querySelector('svg')).not.toBeNull()
  expect(screen.getByRole('article').querySelector('script')).toBeNull()
  expect(screen.getByText('The admin branch bypasses the tenant check.')).toBeDefined()
})

test('the summary renders the Markdown and the strengths, and remembers being closed', async () => {
  await renderApp()
  const summary = screen.getByText('Summary').closest('details')
  expect(summary?.open).toBe(true)
  expect(screen.getByRole('heading', { name: 'Change Map' }).tagName).toBe('H3')
  expect(screen.getByRole('link', { name: 'a link' })).toBeDefined()
  expect(screen.getByRole('heading', { name: 'What looks good' })).toBeDefined()
  expect(screen.getByText('Tests cover the empty state.')).toBeDefined()
  cleanup()
  localStorage.setItem('tranchant:summary', 'closed')
  render(<App />)
  const closed = (await screen.findByText('Summary')).closest('details')
  expect(closed?.open).toBe(false)
})

test('a changed event reloads the review; a run shows its steps', async () => {
  const events = fakeEvents()
  const server = await renderApp()
  server.set(
    payload({
      records: { 'f-02': record('working') },
      runs: {
        'f-02': [
          {
            at: 1,
            kind: 'start',
            label: 'Started',
            state: 'done',
            model: 'claude-opus-5-5',
          },
          { at: 2, kind: 'read', label: 'src/api/guard.ts', state: 'done' },
          { at: 3, kind: 'edit', label: 'src/api/guard.ts', state: 'running' },
        ],
      },
    }),
  )
  events.send('changed')
  await screen.findByText('Editing src/api/guard.ts')
  expect(screen.getByText('Started on opus')).toBeDefined()
  expect(
    screen.getByRole('img', { name: 'running' }).parentElement?.textContent,
  ).toContain('Editing src/api/guard.ts')
  expect(screen.getByRole('button', { name: 'Stop' })).toBeDefined()
})

test('Stop posts /api/stop', async () => {
  const server = await renderApp(payload({ records: { 'f-02': record('queued') } }))
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await waitFor(() =>
    expect(server.posts).toEqual([{ url: '/api/stop', body: { id: 'f-02' } }]),
  )
})

test('history is read from /api/runs/<id> on demand', async () => {
  const data = payload({
    records: {
      'f-02': record('fixed', {
        runs: [
          { id: 'r1', startedAt: 'a', endedAt: 'b', outcome: 'fixed', summary: 'Done.' },
        ],
      }),
    },
  })
  const server = fakeServer(data, {
    'f-02': [{ at: 1, kind: 'bash', label: 'pnpm test', state: 'done' }],
  })
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  fireEvent.click(screen.getByRole('button', { name: 'Show history' }))
  await screen.findByText('Ran pnpm test')
  expect(server.fetch).toHaveBeenCalledWith('/api/runs/f-02', expect.anything())
})

test('the page says when the server is gone, disables actions and retries', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const server = await renderApp()
    server.down()
    // The slow poll is what notices a silent death without a stream.
    await vi.advanceTimersByTimeAsync(30_000)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('stopped serving')
    expect(screen.queryByRole('button', { name: 'Fix now' })).toBeNull()
    server.up()
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: 'Fix now' })).toBeDefined()
  } finally {
    vi.useRealTimers()
  }
})

test('a refusal from the server is shown', async () => {
  const server = await renderApp()
  server.fetch.mockImplementationOnce(async () =>
    Response.json({ applied: [], refused: [{ id: 'f-02', reason: 'already fixed' }] }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Fix now' }))
  expect((await screen.findByRole('status')).textContent).toContain(
    'f-02 (already fixed)',
  )
})
