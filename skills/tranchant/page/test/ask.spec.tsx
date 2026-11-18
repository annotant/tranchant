import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { nextPick } from '../src/DiffView'
import { DiffView } from '../src/DiffView'
import App from '../src/App'
import { parseDiff, placeFindings } from '../src/diff'
import type { Finding, LineQuestion, Message, ProposedFinding } from '../src/domain'
import { diffPayload, fakeServer, FINDINGS, payload } from './fixture'

const TITLE = 'Classification overview page'
const PATH = 'src/people/usePeople.ts'
const LINES = FINDINGS[0]!.excerpt.lines.slice(6, 9)
const ASKED_AT = '2026-11-18T10:00:00.000Z'
const ANSWERED_AT = '2026-11-18T10:01:00.000Z'

const asked: Message = { by: 'reviewer', text: 'Can rows be empty here?', at: ASKED_AT }

const PROPOSED: ProposedFinding = {
  title: 'An empty tenant throws',
  topic: 'Bugs',
  bucket: 'review',
  line: 44,
  problem: 'No people for the tenant throws instead of showing the empty state.',
  why: 'A new tenant sees the error page.',
  fix: 'Return the empty list.',
}

const answered: Message = {
  by: 'agent',
  text: 'Yes: `rows` is empty for a new tenant, and line 44 throws.',
  at: ANSWERED_AT,
  proposal: { finding: PROPOSED },
}

const question = (messages: Message[], fields: Partial<LineQuestion> = {}) => ({
  'q-1a2b3c4d': {
    anchor: { path: PATH, startLine: 42, lines: LINES },
    messages,
    ...fields,
  },
})

async function renderDiffApp(data = payload()) {
  const server = fakeServer(data, {}, diffPayload())
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  await screen.findByRole('list', { name: 'Files' })
  return server
}

const line = (number: number) => screen.getByRole('button', { name: `Line ${number}` })
const pressed = (number: number) => line(number).getAttribute('aria-pressed')

test('selecting a range and asking opens a thread anchored on those lines', async () => {
  const server = await renderDiffApp()
  fireEvent.click(line(42))
  fireEvent.click(line(44), { shiftKey: true })
  expect([41, 42, 43, 44, 45].map(pressed)).toEqual([
    'false',
    'true',
    'true',
    'true',
    'false',
  ])
  const bar = screen.getByRole('group', { name: 'Lines 42–44 selected' })
  fireEvent.click(within(bar).getByRole('button', { name: 'Ask Tranchant' }))
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Your question about these lines' }),
    {
      target: { value: asked.text },
    },
  )
  server.set({ ...payload(), questions: question([asked]) })
  fireEvent.click(within(bar).getByRole('button', { name: 'Send' }))

  const thread = await screen.findByRole('region', { name: 'Ask Tranchant' })
  expect(server.posts.find((post) => post.url === '/api/ask')?.body).toEqual({
    path: PATH,
    from: 42,
    to: 44,
    text: asked.text,
  })
  expect(screen.queryByRole('group', { name: /selected$/ })).toBeNull()
  expect(within(thread).getByText(asked.text)).toBeTruthy()
  expect(within(thread).getByRole('status').textContent).toBe('An agent is starting…')
  // The lines it is about, quoted at its top.
  const quote = screen.getByRole('figure', { name: `${PATH}, lines 42–44` })
  expect(quote.textContent).toContain(LINES[0])
  // Under the last line asked about, in its file.
  const row = document.querySelector(`[data-line="44"]`)
  expect(row?.parentElement?.contains(thread)).toBe(true)
})

test('a proposed finding is added once edited, on those lines, the thread its discussion', async () => {
  const server = await renderDiffApp({
    ...payload(),
    questions: question([asked, answered]),
  })
  const thread = screen.getByRole('region', { name: 'Ask Tranchant' })
  expect(
    within(thread).getByText('Proposed finding: An empty tenant throws'),
  ).toBeTruthy()
  fireEvent.click(within(thread).getByRole('button', { name: 'Add as a finding' }))
  const form = screen.getByRole('form', { name: 'The finding to add' })
  fireEvent.change(within(form).getByRole('textbox', { name: 'Title' }), {
    target: { value: 'A new tenant crashes the page' },
  })
  const finding: Finding = {
    ...PROPOSED,
    id: 'q-1a2b3c4d',
    title: 'A new tenant crashes the page',
    path: PATH,
    excerpt: { startLine: 42, lines: LINES },
    asked: true,
  }
  server.set({
    ...payload({ review: { findings: [...FINDINGS, finding] } }),
    questions: question([asked, answered], { finding: 'q-1a2b3c4d' }),
    discussions: { 'q-1a2b3c4d': { messages: [asked, answered] } },
  })
  fireEvent.click(within(form).getByRole('button', { name: 'Add' }))

  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Ask Tranchant' })).toBeNull(),
  )
  const added = server.posts.find((post) => post.url === '/api/ask/add')
  expect(added?.body).toEqual({
    id: 'q-1a2b3c4d',
    at: ANSWERED_AT,
    finding: { ...PROPOSED, title: 'A new tenant crashes the page' },
  })
  // Its marker sits on line 44, from the reviewer's question; the detail opens it.
  const marker = document.getElementById('tr-marker-q-1a2b3c4d')
  expect(marker?.textContent).toContain('from your question')
  expect(
    document.querySelector('[data-line="44"]')?.parentElement?.contains(marker),
  ).toBe(true)
  const detail = await screen.findByRole('heading', {
    level: 2,
    name: 'A new tenant crashes the page',
  })
  const discussion = within(detail.closest('article')!).getByRole('region', {
    name: 'Discussion',
  })
  expect(within(discussion).getByText(asked.text)).toBeTruthy()
})

test('No, thanks declines the proposal; nothing is added', async () => {
  const server = await renderDiffApp({
    ...payload(),
    questions: question([asked, answered]),
  })
  fireEvent.click(screen.getByRole('button', { name: 'No, thanks' }))
  await waitFor(() =>
    expect(server.posts.find((post) => post.url === '/api/ask/decline')?.body).toEqual({
      id: 'q-1a2b3c4d',
      at: ANSWERED_AT,
    }),
  )
  expect(server.posts.some((post) => post.url === '/api/ask/add')).toBe(false)
})

test('a follow-up in the thread goes to /api/ask with its id', async () => {
  const server = await renderDiffApp({
    ...payload(),
    questions: question([asked, answered]),
  })
  const thread = screen.getByRole('region', { name: 'Ask Tranchant' })
  const box = within(thread).getByRole('textbox', { name: 'Your message to the agent' })
  fireEvent.change(box, { target: { value: 'And on line 45?' } })
  fireEvent.click(within(thread).getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(server.posts.find((post) => post.url === '/api/ask')?.body).toEqual({
      id: 'q-1a2b3c4d',
      text: 'And on line 45?',
    }),
  )
})

test('line numbers pick with Enter and extend with Shift+Enter', async () => {
  await renderDiffApp()
  line(43).focus()
  fireEvent.keyDown(line(43), { key: 'Enter' })
  expect(pressed(43)).toBe('true')
  fireEvent.keyDown(line(41), { key: 'Enter', shiftKey: true })
  expect([40, 41, 42, 43, 44].map(pressed)).toEqual([
    'false',
    'true',
    'true',
    'true',
    'false',
  ])
  expect(screen.getByRole('group', { name: 'Lines 41–43 selected' })).toBeTruthy()
  // Enter on a line number picks it, never opens the finding under the cursor.
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
    'Null tenantId crashes the loop',
  )
})

test('a pick stays within one file, and a lone line clicked again is let go', () => {
  const first = nextPick(undefined, 'a.ts', 10, false)
  expect(first).toEqual({ path: 'a.ts', anchor: 10, from: 10, to: 10 })
  expect(nextPick(first, 'a.ts', 4, true)).toEqual({
    path: 'a.ts',
    anchor: 10,
    from: 4,
    to: 10,
  })
  expect(nextPick(first, 'b.ts', 4, true)).toEqual({
    path: 'b.ts',
    anchor: 4,
    from: 4,
    to: 4,
  })
  expect(nextPick(first, 'a.ts', 10, false)).toBeUndefined()
})

test('offline, lines are picked but Ask Tranchant is disabled and says why', () => {
  const files = parseDiff(diffPayload().diff)
  const { sections } = placeFindings(files, [])
  render(
    <DiffView
      sections={sections}
      stats={new Map()}
      records={{}}
      cursor={undefined}
      open={undefined}
      selected={new Set()}
      onOpen={() => undefined}
      onToggle={() => undefined}
      offline
      ask={{
        onAsk: () => Promise.resolve(true),
        onFollowUp: () => Promise.resolve(true),
        onAdd: () => Promise.resolve(true),
        onDecline: () => undefined,
      }}
    />,
  )
  fireEvent.click(line(42))
  const button = screen.getByRole('button', { name: 'Ask Tranchant' })
  expect(button).toHaveProperty('disabled', true)
  expect(screen.getByRole('group', { name: 'Line 42 selected' }).textContent).toContain(
    'Offline',
  )
})
