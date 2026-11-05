import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { RETRY_MS } from '../src/api'
import App from '../src/App'
import {
  decisionsOf,
  diffPayload,
  mergeRequest,
  fakeEvents,
  fakeServer,
  FINDINGS,
  ORDER,
  payload,
  record,
  STACKED,
} from './fixture'

const TITLE = 'Classification overview page'

/** A promise the test settles itself. */
function deferred() {
  const settlers: (() => void)[] = []
  const promise = new Promise<void>((settle) => settlers.push(settle))
  return { promise, resolve: () => settlers.forEach((settle) => settle()) }
}

/** Renders the page on a server without a diff: the list view, once the page knows. */
async function renderApp(data = payload()) {
  const server = fakeServer(data)
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  await screen.findByRole('navigation', { name: 'Findings' })
  return server
}

/** Renders the page on a server that has the change's diff. */
async function renderDiffApp(data = payload()) {
  const server = fakeServer(data, {}, diffPayload())
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  // The file list appears once the diff is parsed and the findings placed.
  await screen.findByRole('list', { name: 'Files' })
  return server
}

const selectedOption = () =>
  screen.getByRole('option', { selected: true }).id.replace('tr-option-', '')

const focusedMarker = () => document.querySelector('.tr-marker--focused')?.id

/** The file the file list marks as being read. */
const reading = () =>
  screen
    .getAllByRole('button', { current: 'location' })
    .map((item) => item.getAttribute('title'))

/** The ids of the elements a `scrollIntoView` spy was called on. */
const scrolledTo = (spy: { mock: { contexts: unknown[] } }) =>
  spy.mock.contexts.map((element) => (element instanceof Element ? element.id : ''))

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
    'To do',
    'Done',
    'Set aside',
  ])
  expect([...tally.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
    '3',
    '1',
    '1',
  ])
  expect(screen.getByText('tranchant 0.0.0-test')).toBeDefined()
  expect(screen.queryByText('checkout moved')).toBeNull()
})

test('the header shows what needs you and what runs; Needs you opens each in turn', async () => {
  await renderApp(
    payload({
      records: {
        'f-03': record('failed', { reason: 'tests red' }),
        'f-01': record('asking'),
        'f-04': record('working'),
      },
    }),
  )
  expect(screen.getByRole('button', { name: 'Needs you 2' })).toBeDefined()
  expect(screen.getByTitle('Waiting for an agent, or being fixed').textContent).toBe(
    'In progress 1',
  )
  expect(document.querySelector('.tr-attention .tr-spinner')).not.toBeNull()
  // List order is f-02, f-01, f-05, f-03, f-04: f-01 first, then f-03, then f-01 again.
  fireEvent.click(screen.getByRole('button', { name: 'Needs you 2' }))
  await waitFor(() => expect(selectedOption()).toBe('f-01'))
  expect(screen.getByRole('option', { current: true }).id.replace('tr-option-', '')).toBe(
    'f-01',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Needs you 2' }))
  await waitFor(() => expect(selectedOption()).toBe('f-03'))
  fireEvent.click(screen.getByRole('button', { name: 'Needs you 2' }))
  await waitFor(() => expect(selectedOption()).toBe('f-01'))
})

test('Needs you starts at the first in list order when the cursor is off the set', async () => {
  await renderApp(
    payload({ records: { 'f-01': record('asking'), 'f-03': record('failed') } }),
  )
  fireEvent.click(screen.getByText('Off-by-one in the page count'))
  await waitFor(() => expect(selectedOption()).toBe('f-05'))
  fireEvent.click(screen.getByRole('button', { name: 'Needs you 2' }))
  await waitFor(() => expect(selectedOption()).toBe('f-01'))
})

test('the header counters follow a change', async () => {
  const events = fakeEvents()
  const server = await renderApp(payload({ records: { 'f-01': record('asking') } }))
  expect(screen.getByRole('button', { name: 'Needs you 1' })).toBeDefined()
  server.set(payload({ records: { 'f-01': record('working') } }))
  events.send('changed')
  const none = await screen.findByRole('button', { name: 'Needs you 0' })
  expect(none.hasAttribute('disabled')).toBe(true)
  expect(screen.getByTitle('Waiting for an agent, or being fixed').textContent).toBe(
    'In progress 1',
  )
})

test('Needs you 1 opens the asking finding; at zero it is muted', async () => {
  await renderApp(payload({ records: { 'f-05': record('asking') } }))
  fireEvent.click(screen.getByRole('button', { name: 'Needs you 1' }))
  await waitFor(() => expect(selectedOption()).toBe('f-05'))
  cleanup()
  await renderApp()
  const none = screen.getByRole('button', { name: 'Needs you 0' })
  expect(none.hasAttribute('disabled')).toBe(true)
  expect(document.querySelector('.tr-attention .tr-spinner')).toBeNull()
})

test("theirs names the author's MR and warns when the checkout moved", async () => {
  await renderApp(payload({ ownership: 'theirs', current: 'deadbeef' }))
  const mr = screen.getByRole('link', { name: "jfdoe's MR !5746" })
  expect(mr.getAttribute('href')).toContain('/merge_requests/5746')
  expect(screen.getByText('checkout moved')).toBeDefined()
})

test('ours with an MR names it next to your branch', async () => {
  await renderApp(payload({ review: { mr: mergeRequest() } }))
  expect(screen.getByText('your branch')).toBeDefined()
  const mr = screen.getByRole('link', { name: '!5746' })
  expect(mr.getAttribute('href')).toContain('/merge_requests/5746')
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

test('a decision on the finding shown opens the next open one in list order', async () => {
  // List order is f-02, f-01, f-05, f-03, f-04; f-01 is no longer open.
  const server = await renderApp(payload({ records: { 'f-01': record('fixed') } }))
  expect(selectedOption()).toBe('f-02')
  fireEvent.click(screen.getByRole('button', { name: 'Fix now' }))
  await waitFor(() => expect(selectedOption()).toBe('f-05'))
  expect(screen.getByRole('article').textContent).toContain(
    'Off-by-one in the page count',
  )
  fireEvent.keyDown(document, { key: 's' })
  await waitFor(() => expect(selectedOption()).toBe('f-03'))
  expect(decisionsOf(server.posts.at(-1))).toEqual([{ id: 'f-05', action: 'skip' }])
  expect(screen.queryByText('All findings settled')).toBeNull()
})

test('the next open finding wraps to the start of the list', async () => {
  await renderApp()
  fireEvent.click(screen.getByText('Use the design tokens'))
  await waitFor(() => expect(selectedOption()).toBe('f-04'))
  fireEvent.click(
    within(screen.getByRole('article')).getByRole('button', { name: 'Skip' }),
  )
  await waitFor(() => expect(selectedOption()).toBe('f-02'))
})

test('a decision on the last open finding stays on it and says all are settled', async () => {
  const records = {
    'f-01': record('fixed'),
    'f-03': record('dropped'),
    'f-04': record('skipped'),
    'f-05': record('posted'),
  }
  const server = await renderApp(payload({ records }))
  expect(selectedOption()).toBe('f-02')
  // What the page reloads once the decision applied.
  server.set(payload({ records: { ...records, 'f-02': record('skipped') } }))
  fireEvent.click(
    within(screen.getByRole('article')).getByRole('button', { name: 'Skip' }),
  )
  expect((await screen.findByText('All findings settled')).getAttribute('role')).toBe(
    'status',
  )
  expect(selectedOption()).toBe('f-02')
})

test('with fixes still running or asking, the last decision says what is left', async () => {
  const records = {
    'f-01': record('asking'),
    'f-03': record('dropped'),
    'f-04': record('skipped'),
    'f-05': record('working'),
  }
  const server = await renderApp(payload({ records }))
  server.set(payload({ records: { ...records, 'f-02': record('skipped') } }))
  fireEvent.click(
    within(screen.getByRole('article')).getByRole('button', { name: 'Skip' }),
  )
  await screen.findByText('Nothing left to do: 1 need you, 1 in progress')
  expect(screen.queryByText('All findings settled')).toBeNull()
})

test('a decision that did not apply leaves the finding shown', async () => {
  const server = await renderApp()
  server.down()
  fireEvent.click(screen.getByRole('button', { name: 'Fix now' }))
  await screen.findByText('Failed to fetch')
  expect(selectedOption()).toBe('f-02')
  expect(screen.queryByText('All findings settled')).toBeNull()
})

test('a decision that returns after the reviewer opened another does not move them', async () => {
  const server = await renderApp()
  const { promise: held, resolve: release } = deferred()
  const answer = server.fetch.getMockImplementation()
  server.fetch.mockImplementationOnce(async (input: string, init?: RequestInit) => {
    await held
    return answer ? answer(input, init) : Response.json({})
  })
  fireEvent.click(screen.getByRole('button', { name: 'Fix now' }))
  fireEvent.click(screen.getByText('Use the design tokens'))
  release()
  await waitFor(() => expect(server.posts).toHaveLength(1))
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(selectedOption()).toBe('f-04')
})

test('a batch decision does not move the finding shown', async () => {
  const server = await renderApp()
  fireEvent.keyDown(document, { key: 'x' })
  fireEvent.click(screen.getByRole('button', { name: /^Skip 1/ }))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(decisionsOf(server.posts[0])).toEqual([{ id: 'f-02', action: 'skip' }])
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(selectedOption()).toBe('f-02')
})

test('a fixed finding shows the files its fix wrote and their diff on demand', async () => {
  const data = payload({
    records: {
      'f-02': record('fixed', {
        runs: [{ id: 'r1', startedAt: 'a', endedAt: 'b', outcome: 'fixed' }],
      }),
    },
  })
  const server = fakeServer(data, {}, undefined, {
    'f-02': {
      files: [
        { path: 'src/api/guard.ts', since: ['f-05'] },
        { path: 'src/api/new.ts', since: [] },
      ],
      diff: [
        'diff --git a/src/api/guard.ts b/src/api/guard.ts',
        '--- a/src/api/guard.ts',
        '+++ b/src/api/guard.ts',
        '@@ -1 +1 @@',
        '-if (admin) return',
        '+if (admin && sameTenant) return',
        'diff --git a/src/api/new.ts b/src/api/new.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/src/api/new.ts',
        '@@ -0,0 +1 @@',
        '+export const fresh = 1',
        '',
      ].join('\n'),
    },
  })
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  fireEvent.click(await screen.findByRole('button', { name: 'View changes' }))
  const changes = await screen.findByRole('region', { name: 'Changes of the fix' })
  expect(server.fetch).toHaveBeenCalledWith('/api/changes/f-02', expect.anything())
  expect(within(changes).getByRole('note').textContent).toContain(
    'also changed since by f-05',
  )
  expect(
    within(changes).getByLabelText('Diff of src/api/guard.ts').textContent,
  ).toContain('if (admin && sameTenant) return')
  expect(within(changes).getByText('new file')).toBeDefined()
  expect(
    within(changes)
      .getByLabelText('Diff of src/api/new.ts')
      .querySelector('.tr-tok--keyword')?.textContent,
  ).toBe('export')
  fireEvent.click(within(changes).getByRole('button', { name: 'Hide changes' }))
  expect(screen.queryByRole('region', { name: 'Changes of the fix' })).toBeNull()
})

test('a fix that wrote no file says so', async () => {
  fakeServer(payload({ records: { 'f-02': record('fixed') } }))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'View changes' }))
  await screen.findByText('The fix wrote no file in the project.')
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

test('a review in progress shows its indicator with the count so far; complete, it does not', async () => {
  await renderApp(payload({ review: { status: 'reviewing' } }))
  expect(
    screen.getByRole('status', { name: 'Review in progress' }).textContent,
  ).toContain('5 findings so far')
  cleanup()
  fakeServer(payload({ review: { status: 'complete' } }))
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  expect(screen.queryByRole('status', { name: 'Review in progress' })).toBeNull()
})

test('a review opened before its findings shows an empty state, then the first one as it lands', async () => {
  const events = fakeEvents()
  const server = await renderApp(
    payload({ review: { status: 'reviewing', findings: [] } }),
  )
  expect(
    screen.getByText('The review is running: findings appear here as they land.'),
  ).toBeDefined()
  expect(screen.getByText('Waiting for the first finding…')).toBeDefined()
  expect(screen.queryAllByRole('option')).toHaveLength(0)
  expect(
    screen.getByRole('status', { name: 'Review in progress' }).textContent,
  ).toContain('0 findings so far')
  server.set(payload({ review: { status: 'reviewing', findings: [FINDINGS[0]!] } }))
  events.send('changed')
  await screen.findByRole('option')
  expect(screen.getByRole('article').textContent).toContain(
    'Null tenantId crashes the loop',
  )
  expect(
    screen.getByRole('status', { name: 'Review in progress' }).textContent,
  ).toContain('1 finding so far')
})

test('a finding landing keeps the open detail, its draft context and the selection', async () => {
  const events = fakeEvents()
  const two = [FINDINGS[0]!, FINDINGS[1]!]
  const server = await renderApp(
    payload({ review: { status: 'reviewing', findings: two } }),
  )
  fireEvent.click(screen.getByRole('button', { name: /Null tenantId crashes the loop/ }))
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Select Null tenantId crashes the loop' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add context for the fix' }))
  fireEvent.change(screen.getByLabelText('Context for the fix'), {
    target: { value: 'keep the early return' },
  })
  const three = [...two, FINDINGS[4]!]
  server.set(payload({ review: { status: 'reviewing', findings: three } }))
  events.send('changed')
  await screen.findByRole('button', { name: /Off-by-one in the page count/ })
  expect(screen.getAllByRole('option')).toHaveLength(3)
  expect(screen.getByRole('article').textContent).toContain(
    'Null tenantId crashes the loop',
  )
  expect(screen.getByLabelText('Context for the fix')).toHaveProperty(
    'value',
    'keep the early return',
  )
  expect(screen.getByText('1 finding selected')).toBeDefined()
  expect(
    screen.getByRole('status', { name: 'Review in progress' }).textContent,
  ).toContain('3 findings so far')
  // The batch counts follow: the one that landed is safe to auto-fix and to do.
  expect(
    screen.getByRole('button', { name: /^Fix all safe to auto-fix/ }).textContent,
  ).toContain('1')
  server.set(payload({ review: { status: 'complete', findings: three } }))
  events.send('changed')
  await waitFor(() =>
    expect(screen.queryByRole('status', { name: 'Review in progress' })).toBeNull(),
  )
  expect(screen.getAllByRole('option')).toHaveLength(3)
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

test('without a diff, the page falls back to the list and says why', async () => {
  await renderApp()
  expect(screen.getByRole('button', { name: 'Diff' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(screen.getByText(/Diff unavailable:/).textContent).toContain(
    'is not a git repository',
  )
  expect(screen.queryByRole('region', { name: 'Diff' })).toBeNull()
  expect(screen.getAllByRole('option')).toHaveLength(5)
})

test('the diff is the main view: the files, the markers in the diff, the detail beside', async () => {
  await renderDiffApp()
  expect(screen.getByRole('button', { name: 'Diff' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(screen.getByRole('list', { name: 'Files' }).querySelectorAll('li')).toHaveLength(
    8,
  )
  expect(
    screen.getByRole('region', { name: 'Diff' }).querySelectorAll('.tr-marker'),
  ).toHaveLength(5)
  expect(screen.queryByRole('option')).toBeNull()
  // The first finding of the diff opens; the detail keeps its own excerpt.
  const article = screen.getByRole('article')
  expect(article.textContent).toContain('Null tenantId crashes the loop')
  expect(article.querySelector('.tr-code')).not.toBeNull()
})

test('j/k walk the findings in the diff’s order, across files; a marker click opens', async () => {
  await renderDiffApp()
  for (let i = 0; i < 3; i++) fireEvent.keyDown(document, { key: 'j' })
  // The list would be on f-03 here: the diff shows Drawer.tsx before the untouched test file.
  expect(focusedMarker()).toBe('tr-marker-f-04')
  fireEvent.keyDown(document, { key: 'Enter' })
  expect(screen.getByRole('article').textContent).toContain('Use the design tokens')
  fireEvent.keyDown(document, { key: 'j' })
  expect(focusedMarker()).toBe('tr-marker-f-03')
  fireEvent.keyDown(document, { key: 'j' })
  expect(focusedMarker()).toBe('tr-marker-f-03')
  fireEvent.click(screen.getByRole('button', { name: /Off-by-one in the page count/ }))
  expect(screen.getByRole('article').textContent).toContain(
    'Off-by-one in the page count',
  )
  expect(document.querySelector('.tr-marker--open')?.id).toBe('tr-marker-f-05')
  expect(focusedMarker()).toBe('tr-marker-f-05')
  fireEvent.keyDown(document, { key: 'x' })
  expect(
    screen.getByRole('checkbox', { name: 'Select Off-by-one in the page count' }),
  ).toHaveProperty('checked', true)
})

test('the list view is a toggle, remembered across loads', async () => {
  await renderDiffApp()
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  expect(
    screen.getAllByRole('option').map((o) => o.id.replace('tr-option-', '')),
  ).toEqual(ORDER)
  // The finding shown stays, though the list would open on f-02 first.
  expect(screen.getByRole('article').textContent).toContain(
    'Null tenantId crashes the loop',
  )
  expect(screen.queryByRole('region', { name: 'Diff' })).toBeNull()
  expect(localStorage.getItem('tranchant:view')).toBe('list')
  cleanup()
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  expect(screen.getAllByRole('option')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }))
  await screen.findByRole('region', { name: 'Diff' })
})

test('a finding added while the diff is open lands in it', async () => {
  const events = fakeEvents()
  const server = await renderDiffApp()
  expect(document.getElementById('tr-marker-f-06')).toBeNull()
  server.set(payload({ review: { findings: [...FINDINGS, STACKED] } }))
  events.send('changed')
  await waitFor(() => expect(document.getElementById('tr-marker-f-06')).not.toBeNull())
  const row = document.querySelector('#tr-file-1 .tr-row[data-line="21"]')
  const stack = [...(row?.parentElement?.querySelectorAll('.tr-marker') ?? [])]
  expect(stack.map((marker) => marker.id)).toEqual(['tr-marker-f-02', 'tr-marker-f-06'])
})

test('a diff that failed is asked again: every few seconds, and once the server is back', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const server = fakeServer(payload(), {}, { status: 500, error: 'internal error' })
    render(<App />)
    await screen.findByText(/Diff unavailable: internal error/)
    expect(screen.getByText(/Retrying…/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'retry' })).toBeNull()
    server.down()
    await vi.advanceTimersByTimeAsync(30_000)
    await screen.findByRole('alert')
    server.answerDiff(diffPayload())
    server.up()
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    await screen.findByRole('list', { name: 'Files' })
    expect(screen.getByRole('button', { name: 'Diff' })).toHaveProperty('disabled', false)
  } finally {
    vi.useRealTimers()
  }
})

test('a refused diff waits for retry, then shows', async () => {
  const server = await renderApp()
  expect(screen.queryByText(/Retrying…/)).toBeNull()
  server.answerDiff(diffPayload())
  fireEvent.click(screen.getByRole('button', { name: 'retry' }))
  await screen.findByRole('list', { name: 'Files' })
  expect(screen.getByRole('region', { name: 'Diff' })).toBeDefined()
})

test('the diff view of a review opened before its findings waits, then shows the first', async () => {
  const events = fakeEvents()
  const server = await renderDiffApp(
    payload({ review: { status: 'reviewing', findings: [] } }),
  )
  expect(
    screen.getByText('The review is running: findings appear here as they land.'),
  ).toBeDefined()
  expect(screen.getByText('Waiting for the first finding…')).toBeDefined()
  expect(screen.queryByText('Loading the diff…')).toBeNull()
  server.set(payload({ review: { status: 'reviewing', findings: [FINDINGS[0]!] } }))
  events.send('changed')
  await waitFor(() => expect(document.getElementById('tr-marker-f-01')).not.toBeNull())
  expect(screen.getByRole('article').textContent).toContain(
    'Null tenantId crashes the loop',
  )
})

test('switching from the list to the diff keeps the open finding and its draft', async () => {
  await renderDiffApp()
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  fireEvent.click(screen.getByRole('button', { name: /Off-by-one in the page count/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Add context for the fix' }))
  fireEvent.change(screen.getByLabelText('Context for the fix'), {
    target: { value: 'use Math.ceil' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Diff' }))
  await screen.findByRole('region', { name: 'Diff' })
  expect(screen.getByRole('article').textContent).toContain(
    'Off-by-one in the page count',
  )
  expect(screen.getByLabelText('Context for the fix')).toHaveProperty(
    'value',
    'use Math.ceil',
  )
})

test('the file list follows the file the diff is scrolled to; a file or the cursor scrolls the diff', async () => {
  let scrolled = 0
  // happy-dom lays nothing out: the pane sits at 100, its files 500 px apart.
  const rects = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      const file = /^tr-file-(\d+)$/.exec(this.id)?.[1]
      if (this.classList.contains('tr-diff-pane')) return new DOMRect(0, 100, 800, 600)
      if (file !== undefined)
        return new DOMRect(0, 100 + Number(file) * 500 - scrolled, 800, 500)
      return new DOMRect()
    })
  const scrolls = vi.spyOn(Element.prototype, 'scrollIntoView')
  try {
    await renderDiffApp()
    await waitFor(() => expect(reading()).toEqual(['src/people/usePeople.ts']))
    scrolled = 600
    fireEvent.scroll(screen.getByRole('region', { name: 'Diff' }))
    await waitFor(() => expect(reading()).toEqual(['src/api/guard.ts']))
    scrolled = 1600
    fireEvent.scroll(screen.getByRole('region', { name: 'Diff' }))
    await waitFor(() => expect(reading()).toEqual(['src/people/Drawer.tsx']))
    scrolls.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /pager\.ts/ }))
    expect(scrolledTo(scrolls)).toEqual(['tr-file-2'])
    scrolls.mockClear()
    fireEvent.keyDown(document, { key: 'j' })
    expect(scrolledTo(scrolls)).toContain('tr-marker-f-02')
  } finally {
    rects.mockRestore()
    scrolls.mockRestore()
  }
})

test('a review that ended shows no agent at work, and says its unverified findings stay so', async () => {
  const [first] = FINDINGS
  await renderApp({
    ...payload({ review: { status: 'complete', verify: true, findings: [first!] } }),
    reviewers: [{ name: 'rv-bugs', running: true, steps: [] }],
  })
  const agents = screen.getByRole('region', { name: 'Review agents' })
  expect(within(agents).queryByLabelText('running')).toBeNull()
  expect(agents.textContent).toContain('Review done')
  expect(agents.textContent).toContain('1 lens · 1 finding, 0 verified')
  expect(screen.getByText(/the review ended before a verifier confirmed it/)).toBeTruthy()
})

test('a review done folds its agents into one line, unfolded on demand with each outcome', async () => {
  await renderApp({
    ...payload({
      review: {
        status: 'complete',
        verify: true,
        findings: [{ ...FINDINGS[0]!, id: 'bugs-1', verified: true }],
      },
    }),
    reviewers: [
      {
        name: 'rv-bugs',
        running: false,
        outcome: 'done',
        steps: [
          { at: 1, kind: 'tool', label: 'SubagentHandback', state: 'done' },
          { at: 2, kind: 'end', label: 'Ended', state: 'done' },
        ],
      },
      {
        name: 'rv-conventions',
        running: false,
        outcome: 'failed',
        steps: [
          { at: 3, kind: 'read', label: 'AGENTS.md', state: 'failed' },
          { at: 4, kind: 'end', label: 'Stopped', state: 'failed' },
        ],
      },
    ],
  })
  const agents = screen.getByRole('region', { name: 'Review agents' })
  expect(agents.textContent).toContain('2 lenses · 1 finding, 1 verified')
  expect(agents.textContent).toContain('conventions stopped: that lens is not covered')
  expect(agents.textContent).not.toContain('SubagentHandback')
  expect(within(agents).queryByRole('list', { name: 'Every review agent' })).toBeNull()
  fireEvent.click(within(agents).getByRole('button', { name: 'Show all agents' }))
  const all = within(agents).getByRole('list', { name: 'Every review agent' })
  expect(all.textContent).toContain('Reviewer · bugs1 finding')
  expect(all.textContent).toContain('stopped: Reading AGENTS.md failed')
  expect(all.textContent).not.toContain('SubagentHandback')
})

test('a verified review dims the findings no verifier confirmed, and shows its agents', async () => {
  const [first, second] = FINDINGS
  await renderApp({
    ...payload({
      review: {
        status: 'reviewing',
        verify: true,
        findings: [{ ...first!, verified: true }, second!],
      },
    }),
    reviewers: [
      {
        name: 'rv-bugs',
        running: true,
        steps: [{ at: 1, kind: 'read', label: 'src/cart.js', state: 'running' }],
      },
      {
        name: 'vf-f-01',
        running: false,
        outcome: 'done',
        steps: [{ at: 2, kind: 'end', label: 'Ended', state: 'done' }],
      },
    ],
  })
  const options = screen.getAllByRole('option')
  const dimmed = options.filter((option) => option.className.includes('tr-unverified'))
  expect(dimmed.map((option) => option.id)).toEqual([`tr-option-${second!.id}`])
  const agents = screen.getByRole('region', { name: 'Review agents' })
  expect(agents.textContent).toContain('Reviewing the change')
  expect(agents.textContent).toContain('1 of 2 agents done')
  const lenses = within(agents).getByRole('list', { name: 'Reviewers, one per lens' })
  expect(within(lenses).getByText('bugs')).toBeTruthy()
  expect(within(lenses).getByLabelText('running')).toBeTruthy()
  const now = within(agents).getByRole('list', { name: 'Agents at work' })
  expect(now.textContent).toBe('bugsReading src/cart.js')
  const verifying = within(agents).getByRole('list', { name: 'Verifiers, by lens' })
  expect(verifying.textContent).toContain('1/1')
  expect(agents.textContent).not.toContain('Ended')
})
