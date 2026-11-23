import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import App from '../src/App'
import type {
  Finding,
  ReviewAgent,
  ReviewPayload,
  ReviewUsage,
  Usage,
} from '../src/domain'
import { applyTheme } from '../src/theme'
import { chipOf, formatTokens, whoOf } from '../src/tokens'
import { fakeServer, FINDINGS, payload, record, settingsPayload } from './fixture'

const TITLE = 'Classification overview page'
const SONNET = 'claude-sonnet-5-5'

afterEach(() => {
  location.hash = ''
  applyTheme('system')
})

/** A figure as `/api/review` answers it, its counts in thousands, a tenth each but cache reads. */
function figure(thousands: number, extra: Partial<Usage> = {}): Usage {
  const tokens = thousands * 1000
  return {
    models: [
      {
        model: SONNET,
        input: tokens / 10,
        output: tokens / 10,
        cacheRead: (tokens * 7) / 10,
        cacheWrite: tokens / 10,
      },
    ],
    tokens,
    ...extra,
  }
}

/** A reviewer, verifier or summary agent, ended unless `running`. */
const agent = (name: string, fields: Partial<ReviewAgent> = {}): ReviewAgent => ({
  name,
  running: false,
  outcome: 'done',
  steps: [{ at: 1, kind: 'start', label: 'Started', state: 'done', model: SONNET }],
  ...fields,
})

const finding = (id: string, lens: string, verified: boolean, base = 0): Finding => ({
  ...FINDINGS[base]!,
  id,
  lens,
  verified,
})

/**
 * A `/tranchant review` review of three lenses: correctness found three, one
 * its verifier removed; security found none; tests found one its verifier
 * did not confirm. One fix ran, and a reset came before.
 */
const FOUND = [
  finding('correctness-1', 'correctness', true, 0),
  finding('correctness-2', 'correctness', true, 1),
  finding('tests-1', 'tests', false, 2),
]

const REVIEWERS = [
  agent('sm-summary'),
  agent('rv-correctness'),
  agent('rv-security'),
  agent('rv-tests'),
  agent('vf-correctness-1'),
  agent('vf-correctness-2'),
  agent('vf-correctness-3'),
  agent('vf-tests-1'),
]

function usage(fields: Partial<ReviewUsage> = {}): ReviewUsage {
  return {
    total: figure(1700),
    kinds: [
      { kind: 'summary', agents: 1, usage: figure(96) },
      { kind: 'reviewers', agents: 3, usage: figure(1000) },
      { kind: 'verifiers', agents: 4, usage: figure(200) },
      { kind: 'fixes', agents: 1, usage: figure(204) },
    ],
    lenses: [
      {
        lens: 'correctness',
        reviewer: figure(400),
        verifiers: figure(150),
        tokens: 550_000,
      },
      { lens: 'security', reviewer: figure(350), verifiers: null, tokens: 350_000 },
      { lens: 'tests', reviewer: figure(250), verifiers: figure(50), tokens: 300_000 },
    ],
    reset: {
      usage: figure(200),
      kinds: [{ kind: 'reviewers', agents: 2, usage: figure(200) }],
      lenses: [],
    },
    notReported: [],
    partial: [],
    running: false,
    ...fields,
  }
}

function reviewPayload(
  spent: ReviewUsage | null = usage(),
  fields: Partial<ReviewPayload['review']> = {},
  reviewers = REVIEWERS,
): ReviewPayload {
  const base = payload({
    review: {
      status: 'complete',
      verify: true,
      lenses: ['correctness', 'security', 'tests'].map((name) => ({
        name,
        source: `recipe:${name}`,
        hash: name,
      })),
      findings: FOUND,
      ...fields,
    },
    records: { 'correctness-1': record('fixed'), 'tests-1': record('dropped') },
  })
  return { ...base, reviewers, ...(spent && { usage: spent }) }
}

async function renderPage(data = reviewPayload()) {
  const server = fakeServer(data)
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  return server
}

const chip = () => screen.queryByRole('link', { name: /tokens/ })

/** Moves the page to `hash`, as a link or the browser's back does. */
const go = (hash: string) =>
  act(() => {
    location.hash = hash
    window.dispatchEvent(new Event('hashchange'))
  })

/** The row of a table whose header cell's name is `name`. */
function row(name: string) {
  const found = screen
    .getAllByRole('row')
    .find((one) => one.querySelector('th[scope="row"] .tr-tk-name')?.textContent === name)
  if (!found) throw new Error(`no row ${name}`)
  return within(found)
}

const cells = (name: string) =>
  row(name)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)

test('tokens read in k and M, and a run name as a reader says it', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(412_300)).toBe('412k')
  expect(formatTokens(999_700)).toBe('1.00M')
  expect(formatTokens(2_904_000)).toBe('2.90M')
  expect(formatTokens(12_340_000)).toBe('12.3M')
  expect(whoOf('vf-tests-3')).toBe('the verifier of tests-3')
  expect(whoOf('rv-bugs#2')).toBe('the reviewer of bugs (run 2)')
  expect(whoOf('fix:f-03:r1')).toBe('the fix of f-03 (r1)')
  expect(whoOf('sm-summary')).toBe('the summary agent')
  expect(whoOf('ds-f-02')).toBe('the discussion of f-02')
})

test('the chip says so far while an agent runs, paused once nothing does, at least with an agent not reported', () => {
  const reviewing = { status: 'reviewing' as const }
  expect(chipOf(undefined, reviewing)).toBeUndefined()
  expect(chipOf(usage({ total: null }), reviewing)).toBeUndefined()
  expect(chipOf(usage(), reviewing)).toEqual({ text: '1.70M tokens', tone: 'still' })
  expect(chipOf(usage({ running: true }), reviewing)).toEqual({
    text: '1.70M tokens so far',
    tone: 'live',
  })
  const paused = { ...reviewing, paused: { at: '2026-11-23T10:00:00Z' } }
  // A fix under way runs whatever Pause says.
  expect(chipOf(usage({ running: true }), paused)?.tone).toBe('live')
  expect(chipOf(usage(), paused)).toEqual({
    text: '1.70M tokens · paused',
    tone: 'paused',
  })
  expect(chipOf(usage(), { ...paused, stopped: { at: '2026-11-23T10:01:00Z' } })).toEqual(
    { text: '1.70M tokens', tone: 'still' },
  )
  expect(chipOf(usage({ notReported: ['vf-tests-1'] }), reviewing)?.text).toBe(
    'at least 1.70M tokens',
  )
  expect(chipOf(usage({ total: figure(1700, { partial: true }) }), reviewing)?.text).toBe(
    'at least 1.70M tokens',
  )
})

test('a review with no usage shows no chip', async () => {
  await renderPage(reviewPayload(null))
  expect(chip()).toBeNull()
})

test('a review whose agents reported nothing shows no chip: never a zero', async () => {
  await renderPage(reviewPayload(usage({ total: null, kinds: [], lenses: [] })))
  expect(chip()).toBeNull()
})

test('the chip sits in the header, live while an agent runs', async () => {
  await renderPage(reviewPayload(usage({ running: true }), { status: 'reviewing' }))
  const link = await screen.findByRole('link', { name: '1.70M tokens so far' })
  expect(link.getAttribute('href')).toBe('#tokens')
  expect(link.closest('header')).not.toBeNull()
  expect(link.className).toContain('tr-tk-chip--live')
})

test('the chip says paused once nothing runs in a paused review', async () => {
  await renderPage(
    reviewPayload(usage(), {
      status: 'reviewing',
      paused: { at: '2026-11-23T10:00:00Z' },
    }),
  )
  const link = await screen.findByRole('link', { name: '1.70M tokens · paused' })
  expect(link.className).toContain('tr-tk-chip--paused')
})

test('the chip opens the Tokens screen, and Back to the review returns to the finding open', async () => {
  await renderPage()
  await screen.findByRole('navigation', { name: 'Findings' })
  const second = FOUND[1]!
  fireEvent.click(screen.getByText(second.title, { selector: '.tr-item-title' }))
  await screen.findByRole('heading', { level: 2, name: second.title })
  go('#tokens')
  await screen.findByRole('heading', { name: 'Tokens' })
  expect(chip()?.getAttribute('aria-current')).toBe('page')
  expect(chip()?.getAttribute('href')).toBe('#')
  expect(screen.getByText('1.70M')).toBeDefined()
  expect(
    screen.getByRole('link', { name: 'Back to the review' }).getAttribute('href'),
  ).toBe('#')
  go('')
  await screen.findByRole('heading', { level: 2, name: second.title })
  expect(chip()?.getAttribute('aria-current')).toBeNull()
})

test('by agent kind: one row per kind that ran, its agents, tokens, share and counts, then the reset', async () => {
  location.hash = '#tokens'
  await renderPage()
  await screen.findByRole('heading', { name: 'Tokens' })
  expect(screen.getByRole('tab', { name: 'By agent kind', selected: true })).toBeDefined()
  const names = screen
    .getAllByRole('rowheader')
    .map((cell) => cell.querySelector('.tr-tk-name')?.textContent)
  expect(names).toEqual([
    'Summary',
    'Reviewers',
    'Verifiers',
    'Fixes',
    'Before the reset',
  ])
  expect(cells('Reviewers')).toEqual(['3', '1.00M', '59 %'])
  expect(cells('Before the reset')).toEqual(['2', '200k', '12 %'])
  expect(
    row('Reviewers').getByText(
      `in 100k · out 100k · cache read 700k · cache write 100k · ${SONNET}`,
    ),
  ).toBeDefined()
})

test('by agent kind: an agent not reported is counted on its row and named once', async () => {
  location.hash = '#tokens'
  await renderPage(
    reviewPayload(
      usage({
        total: figure(1700, { partial: true }),
        notReported: ['vf-tests-1'],
        partial: ['rv-tests'],
      }),
    ),
  )
  await screen.findByRole('heading', { name: 'Tokens' })
  expect(screen.getByText('at least 1.70M')).toBeDefined()
  expect(cells('Verifiers')[0]).toBe('4 · 1 not reported')
  const notes = screen.getAllByRole('note').map((note) => note.textContent)
  expect(notes).toEqual([
    '1 agent did not report its tokens: the verifier of tests-1. The total is at least what is shown.',
    'the reviewer of tests reported only its last reading: at least that much.',
  ])
})

test('by agent kind: a stopped review says its agents count, their last request estimated', async () => {
  location.hash = '#tokens'
  await renderPage(reviewPayload(usage(), { stopped: { at: '2026-11-23T10:00:00Z' } }))
  await screen.findByRole('heading', { name: 'Tokens' })
  expect(screen.getByRole('note').textContent).toMatch(
    /^The stop ended agents mid-request: what they spent counts, the output of their last request estimated/,
  )
})

test('by lens: sorted by tokens, what each found, per confirmed, and nothing confirmed marked', async () => {
  location.hash = '#tokens'
  await renderPage()
  fireEvent.click(await screen.findByRole('tab', { name: /^By lens/ }))
  const names = screen
    .getAllByRole('rowheader')
    .map((cell) => cell.firstChild?.textContent)
  expect(names).toEqual(['correctness', 'security', 'tests'])
  // Review, verify, landed, confirmed, dropped, settled, per confirmed, note.
  expect(cells('correctness')).toEqual(['400k', '150k', '3', '2', '1', '1', '275k', ''])
  expect(cells('security')).toEqual([
    '350k',
    '—',
    '0',
    '0',
    '0',
    '0',
    '—',
    'nothing confirmed',
  ])
  // tests-1 its verifier did not confirm, and you dropped it.
  expect(cells('tests')).toEqual([
    '250k',
    '50k',
    '1',
    '0',
    '1',
    '0',
    '—',
    'nothing confirmed',
  ])
  expect(row('correctness').getByText(SONNET)).toBeDefined()
  expect(screen.getByText(/Before the reset: 200k tokens, in no row\./)).toBeDefined()
})

test('by lens: a lens at work moves, and one not started shows queued', async () => {
  location.hash = '#tokens'
  await renderPage(
    reviewPayload(
      usage({ running: true }),
      {
        status: 'reviewing',
        lenses: ['correctness', 'security', 'tests', 'docs'].map((name) => ({
          name,
          source: `recipe:${name}`,
          hash: name,
        })),
      },
      REVIEWERS.map((one) =>
        one.name === 'rv-tests'
          ? { name: one.name, running: true, steps: one.steps }
          : one,
      ),
    ),
  )
  fireEvent.click(await screen.findByRole('tab', { name: /^By lens/ }))
  expect(cells('tests')[0]).toBe('250k so far')
  expect(cells('tests').at(-1)).toBe('running · so far')
  expect(cells('docs')).toEqual(['—', '—', '—', '—', '—', '—', '—', 'queued'])
})

test("by lens: a lens's name opens its reviewer's report in the reviewers section", async () => {
  location.hash = '#tokens'
  await renderPage()
  fireEvent.click(await screen.findByRole('tab', { name: /^By lens/ }))
  const link = screen.getByRole('link', { name: 'security' })
  expect(link.getAttribute('href')).toBe('#report/security')
  go('#report/security')
  await waitFor(() =>
    expect(report('security')?.getAttribute('aria-expanded')).toBe('true'),
  )
  expect(report('correctness')?.getAttribute('aria-expanded')).toBe('false')
})

/** The row of a lens's report in the reviewers section. */
const report = (lens: string) =>
  document.getElementById(`tr-report-${lens}`)?.querySelector('.tr-report-row')

for (const theme of ['light', 'dark'] as const)
  test(`the chip and both tabs show in the ${theme} theme`, async () => {
    const server = fakeServer(reviewPayload())
    server.answerSettings(settingsPayload({ theme }))
    location.hash = '#tokens'
    render(<App />)
    await screen.findByRole('heading', { name: 'Tokens' })
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe(theme),
    )
    expect(chip()?.textContent).toBe('1.70M tokens')
    expect(cells('Fixes')).toEqual(['1', '204k', '12 %'])
    fireEvent.click(screen.getByRole('tab', { name: /^By lens/ }))
    expect(screen.getAllByText('nothing confirmed')).toHaveLength(2)
  })
