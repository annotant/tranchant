import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import App from '../src/App'
import type {
  Discussion,
  Finding,
  FindingUsage,
  ReviewAgent,
  ReviewPayload,
  ReviewUsage,
  Usage,
} from '../src/domain'
import { applyTheme } from '../src/theme'
import {
  chipOf,
  findingCostOf,
  formatTokens,
  kindRows,
  type LensInput,
  lensRows,
  notesOf,
  totalNote,
  whoOf,
} from '../src/tokens'
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
    findings: [],
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

test("by lens: in the server's order, what each found, per confirmed, and nothing confirmed marked", async () => {
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

/** The lens rows of the fixture's review, with `change` applied. */
const rowsOf = (change: Partial<LensInput> = {}) => {
  const data = reviewPayload()
  return lensRows({
    usage: data.usage!,
    review: data.review,
    records: data.findings,
    reviewers: REVIEWERS,
    lenses: undefined,
    ...change,
  })
}

const lensRow = (rows: ReturnType<typeof lensRows>, lens: string) => {
  const found = rows.find((one) => one.lens === lens)
  if (!found) throw new Error(`no lens ${lens}`)
  return found
}

test('by agent kind: a fix, a discussion and a cleaning at work move their rows; nothing does once the server counts nothing live', () => {
  const spent = usage({
    running: true,
    kinds: [
      { kind: 'fixes', agents: 1, usage: figure(204) },
      { kind: 'discussions', agents: 1, usage: figure(20) },
      { kind: 'cleanings', agents: 1, usage: null },
    ],
  })
  const at = {
    reviewers: [],
    records: { 'correctness-1': record('working') },
    discussions: {
      'tests-1': {
        messages: [],
        step: { at: 1, kind: 'read', label: 'a.ts', state: 'running' as const },
      },
    },
    lenses: {
      state: 'ready' as const,
      lenses: [
        {
          name: 'docs',
          source: 'x',
          state: 'ready' as const,
          cleaning: 'running' as const,
        },
      ],
    },
  }
  const rows = kindRows(spent, at)
  expect(rows.map((one) => [one.name, one.tokens, one.running, one.share])).toEqual([
    ['Fixes', '204k so far', true, 12],
    ['Discussions', '20k so far', true, 1],
    ['Cleanings', 'so far', true, null],
    ['Before the reset', '200k', false, 12],
  ])
  expect(kindRows({ ...spent, running: false }, at).some((one) => one.running)).toBe(
    false,
  )
})

test('by agent kind: a kind not reported has no share, and a partial one running reads at least so far', () => {
  const rows = kindRows(
    usage({
      running: true,
      kinds: [
        { kind: 'reviewers', agents: 2, usage: figure(400, { partial: true }) },
        { kind: 'cleanings', agents: 1, usage: null },
      ],
    }),
    {
      reviewers: [agent('rv-tests', { running: true })],
      records: {},
      discussions: undefined,
      lenses: undefined,
    },
  )
  expect(rows[0]?.tokens).toBe('at least 400k so far')
  expect(rows[1]).toMatchObject({ tokens: '—', share: null })
})

test('by lens: a reviewer the stop or a failure ended, one interrupted, and lenses that never started say so', () => {
  const stopped = { stopped: { at: '2026-11-23T10:00:00Z' } }
  const failed = REVIEWERS.map((one) =>
    one.name === 'rv-security' ? { ...one, outcome: 'failed' as const } : one,
  )
  const base = reviewPayload().review
  const rows = (review: Partial<LensInput['review']>, reviewers = failed) =>
    rowsOf({
      review: {
        ...base,
        ...review,
        lenses: [...base.lenses!, { name: 'docs', source: 'x', hash: 'd' }],
      },
      reviewers,
    })
  expect(lensRow(rows(stopped), 'security').note).toBe('stopped · last request estimated')
  expect(lensRow(rows(stopped), 'docs').note).toBe('not covered')
  expect(lensRow(rows({}), 'security')).toMatchObject({
    note: 'failed · not covered',
    nothingConfirmed: false,
  })
  expect(
    lensRow(rows({ status: 'reviewing', paused: { at: '2026-11-23T10:00:00Z' } }), 'docs')
      .note,
  ).toBe('paused · not started')
  const interrupted = REVIEWERS.map((one) =>
    one.name === 'rv-tests' ? { ...one, outcome: 'interrupted' as const } : one,
  )
  expect(lensRow(rows({}, interrupted), 'tests')).toMatchObject({
    note: 'interrupted · runs again on Resume',
    nothingConfirmed: false,
  })
})

test('by lens: nothing confirmed waits for every verifier, queued ones included', () => {
  // tests-1's verifier has not started: no run file yet.
  const queued = REVIEWERS.filter((one) => one.name !== 'vf-tests-1')
  expect(lensRow(rowsOf({ reviewers: queued }), 'tests').nothingConfirmed).toBe(false)
  expect(lensRow(rowsOf(), 'tests').nothingConfirmed).toBe(true)
})

test('by lens: a review without verifiers counts every finding confirmed, and a finding with no lens goes by its id', () => {
  const data = reviewPayload()
  const rows = rowsOf({
    review: {
      ...data.review,
      verify: false,
      findings: FOUND.map(({ lens: _lens, ...one }) => ({ ...one, verified: false })),
    },
    reviewers: REVIEWERS.filter((one) => !one.name.startsWith('vf-')),
  })
  expect(lensRow(rows, 'correctness')).toMatchObject({
    landed: '2',
    confirmed: '2',
    perConfirmed: '275k',
  })
  expect(lensRow(rows, 'tests')).toMatchObject({
    landed: '1',
    confirmed: '1',
    nothingConfirmed: false,
  })
})

test('by lens: a dead reviewer of a past session does not move when another agent runs', () => {
  const dead = REVIEWERS.map((one) =>
    one.name === 'rv-tests' ? { name: one.name, running: true, steps: one.steps } : one,
  )
  const tests = lensRow(
    rowsOf({ usage: usage({ running: true, partial: ['rv-tests'] }), reviewers: dead }),
    'tests',
  )
  expect(tests).toMatchObject({ running: false, review: '250k' })
  expect(tests.note).toBeUndefined()
})

test('by lens: per confirmed is a floor when a part is, and rounds', () => {
  const spent = usage({
    lenses: [
      { lens: 'correctness', reviewer: null, verifiers: figure(1), tokens: 1000 },
      { lens: 'security', reviewer: figure(350), verifiers: null, tokens: 350_000 },
    ],
  })
  const data = reviewPayload()
  const three = [...FOUND.slice(0, 2), finding('correctness-4', 'correctness', true, 3)]
  expect(
    lensRow(
      rowsOf({ usage: spent, review: { ...data.review, findings: three } }),
      'correctness',
    ).perConfirmed,
  ).toBe('at least 333')
})

test('a model that is no string is none: the screen does not break on it', () => {
  // As a run file a fix's agent wrote could hold it, read from JSON as the server serves it.
  const steps: ReviewAgent['steps'] = JSON.parse(
    '[{"at":1,"kind":"start","label":"Started","state":"done","model":{"x":1}}]',
  )
  const odd = REVIEWERS.map((one) => (one.name === 'rv-tests' ? { ...one, steps } : one))
  expect(lensRow(rowsOf({ reviewers: odd }), 'tests').model).toBe('')
})

test('the line beside the total, and the note Pause now leaves', () => {
  const review = { status: 'reviewing' as const }
  expect(totalNote(usage({ running: true }), review)).toBe(
    'tokens so far · moves as the agents work',
  )
  expect(totalNote(usage(), { ...review, paused: { at: 'x' } })).toBe(
    'tokens · paused: nothing runs until Resume',
  )
  expect(totalNote(usage(), { ...review, stopped: { at: 'x' } })).toBe(
    'tokens · the review stopped',
  )
  expect(totalNote(usage(), { status: 'complete' })).toBe(
    'tokens · the review, its fixes, discussions and cleanings',
  )
  expect(notesOf(usage(), { paused: { at: 'x', now: true } })[0]).toMatch(
    /^Pause now ended agents mid-request/,
  )
})

test('#tokens with no usage block says it cannot be read; with no figure, that none is reported', async () => {
  location.hash = '#tokens'
  await renderPage(reviewPayload(null))
  expect(await screen.findByText(/tokens cannot be read/)).toBeDefined()
})

test('#tokens with no figure yet says none is reported', async () => {
  location.hash = '#tokens'
  await renderPage(reviewPayload(usage({ total: null, kinds: [], lenses: [] })))
  expect(
    await screen.findByText('No agent of this review has reported its tokens yet.'),
  ).toBeDefined()
})

test("a lens's report is scrolled to, and the chip back reopens the tab left", async () => {
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
  location.hash = '#tokens'
  await renderPage()
  fireEvent.click(await screen.findByRole('tab', { name: /^By lens/ }))
  go('#report/tests')
  await waitFor(() => expect(report('tests')?.getAttribute('aria-expanded')).toBe('true'))
  expect(
    scroll.mock.contexts.some(
      (element) => element instanceof Element && element.id === 'tr-report-tests',
    ),
  ).toBe(true)
  go('#tokens')
  expect(
    await screen.findByRole('tab', { name: /^By lens/, selected: true }),
  ).toBeDefined()
})

/** The page, correctness-1 open. */
async function openFirst(data: ReviewPayload) {
  await renderPage(data)
  await screen.findByRole('navigation', { name: 'Findings' })
  const first = FOUND[0]!
  fireEvent.click(screen.getByText(first.title, { selector: '.tr-item-title' }))
  await screen.findByRole('heading', { level: 2, name: first.title })
}

/** A run of a finding's record. */
const ran = (id: string, outcome?: 'fixed' | 'stopped', summary?: string) => ({
  id,
  model: 'claude-opus-5-5',
  startedAt: '2026-11-23T10:00:00Z',
  ...(outcome && { outcome }),
  ...(summary && { summary }),
})

/** correctness-1: verified, discussed once, a run stopped and one that fixed it. */
function spentOn(fields: Partial<FindingUsage> = {}): FindingUsage {
  return {
    id: 'correctness-1',
    fixes: figure(246),
    verifier: { usage: figure(38) },
    discussion: { usage: figure(22) },
    runs: [
      { id: 'run-1', usage: figure(64) },
      { id: 'run-2', usage: figure(182) },
    ],
    unclaimed: null,
    usage: figure(306),
    ...fields,
  }
}

const DISCUSSED: Discussion = {
  messages: [
    { by: 'reviewer', text: 'Why not a default tenant?', at: '2026-11-23T09:00:00Z' },
    { by: 'agent', text: 'It would hide the bug.', at: '2026-11-23T09:01:00Z' },
  ],
}

const RAN = { runs: [ran('run-1', 'stopped'), ran('run-2', 'fixed')] }

test("a finding's cost: its verification, its discussion, a stopped run and a fixed one, and their sum", () => {
  const cost = findingCostOf(
    usage({ findings: [spentOn()] }),
    { id: 'correctness-1', verified: true },
    RAN,
    DISCUSSED,
  )
  expect(cost?.rows).toEqual([
    {
      key: 'verification',
      name: 'verified',
      model: SONNET,
      chip: { text: 'Confirmed', tone: 'confirmed' },
      cost: { text: '38k tokens' },
    },
    {
      key: 'discussion',
      name: 'discussed',
      model: SONNET,
      chip: { text: '1 answer', tone: 'still' },
      cost: { text: '22k tokens' },
    },
  ])
  expect([...(cost?.runs ?? [])]).toEqual([
    [
      'run-1',
      { text: '64k tokens', title: 'Its last request was cut: its output is estimated' },
    ],
    ['run-2', { text: '182k tokens' }],
  ])
  expect(cost?.foot).toBe(
    '306k tokens on this finding: its verification, its discussion and its two runs.',
  )
})

test("a finding's cost: a run not reported makes the sum a floor, and says which", () => {
  const cost = findingCostOf(
    usage({
      findings: [
        spentOn({
          runs: [
            { id: 'run-1', usage: figure(64) },
            { id: 'run-2', usage: null },
          ],
          usage: figure(124, { partial: true }),
        }),
      ],
    }),
    { id: 'correctness-1', verified: true },
    RAN,
    DISCUSSED,
  )
  expect(cost?.runs.get('run-2')).toEqual({
    text: 'not reported',
    title: 'Its agent reported no tokens: its Claude Code session may have closed first',
    dim: true,
  })
  expect(cost?.foot).toBe(
    'At least 124k tokens on this finding: run-2 did not report its tokens.',
  )
})

test("a finding's cost: at work, a last reading, an unconfirmed verification, and nothing to say", () => {
  const working = findingCostOf(
    usage({
      findings: [
        spentOn({
          verifier: { usage: figure(10, { partial: true }) },
          discussion: { usage: null, running: true },
          runs: [{ id: 'run-1', usage: figure(20), running: true }],
          usage: figure(30, { partial: true }),
          running: true,
        }),
      ],
    }),
    { id: 'correctness-1', verified: false },
    { runs: [ran('run-1')] },
    undefined,
  )
  expect(working?.rows).toEqual([
    {
      key: 'verification',
      name: 'verification',
      model: SONNET,
      cost: {
        text: 'at least 10k tokens',
        title: 'At least this much: a part of it is a last reading or not reported',
      },
    },
    {
      key: 'discussion',
      name: 'discussing',
      chip: { text: 'In progress', tone: 'running' },
    },
  ])
  expect(working?.runs.get('run-1')).toEqual({ text: '20k tokens so far' })
  // A floor and at work at once: both said.
  expect(working?.foot).toBe(
    'At least 30k tokens on this finding so far: the verification reported only part of its tokens.',
  )

  const read = findingCostOf(
    usage({
      findings: [
        spentOn({
          verifier: { usage: figure(10, { partial: true }) },
          discussion: null,
          runs: [],
          usage: figure(10, { partial: true }),
        }),
      ],
    }),
    { id: 'correctness-1', verified: true },
    undefined,
    undefined,
  )
  expect(read?.foot).toBe(
    'At least 10k tokens on this finding: the verification reported only part of its tokens.',
  )
  // No usage in the review and nothing at work, or none counted for this finding: nothing said.
  const spent = usage({ findings: [spentOn()] })
  expect(
    findingCostOf(usage({ total: null }), { id: 'correctness-1' }, RAN, undefined),
  ).toBeUndefined()
  expect(findingCostOf(spent, { id: 'tests-1' }, RAN, undefined)).toBeUndefined()
})

test("a finding's cost: a verifier at work before any figure of the review, and two that did not report", () => {
  const verifying = findingCostOf(
    usage({
      total: null,
      running: true,
      findings: [
        spentOn({
          fixes: null,
          verifier: { usage: null, running: true },
          discussion: null,
          runs: [],
          usage: null,
          running: true,
        }),
      ],
    }),
    { id: 'correctness-1', verified: false },
    undefined,
    undefined,
  )
  expect(verifying).toEqual({
    rows: [
      {
        key: 'verification',
        name: 'verifying',
        chip: { text: 'In progress', tone: 'running' },
      },
    ],
    runs: new Map(),
  })
  const none = findingCostOf(
    usage({
      findings: [
        spentOn({
          verifier: { usage: null },
          runs: [
            { id: 'run-1', usage: figure(64) },
            { id: 'run-2', usage: null },
          ],
          usage: figure(86, { partial: true }),
        }),
      ],
    }),
    { id: 'correctness-1', verified: true },
    RAN,
    DISCUSSED,
  )
  expect(none?.rows[0]?.name).toBe('verified')
  expect(none?.foot).toBe(
    'At least 86k tokens on this finding: the verification and run-2 did not report their tokens.',
  )
})

test("a finding's cost: a fix's agent on no run is named, a run the record lacks is left out, the main model shown", () => {
  const twoModels: Usage = {
    models: [
      { model: 'claude-haiku-5-5', input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
      { model: 'claude-opus-5-5', input: 9, output: 9, cacheRead: 9, cacheWrite: 9 },
    ],
    tokens: 40,
  }
  const cost = findingCostOf(
    usage({
      findings: [
        spentOn({
          verifier: null,
          discussion: { usage: twoModels },
          runs: [
            { id: 'run-1', usage: figure(64) },
            { id: 'run-9', usage: null },
          ],
          unclaimed: { usage: figure(50) },
          usage: figure(114),
        }),
      ],
    }),
    { id: 'correctness-1', verified: true },
    { runs: [ran('run-1', 'fixed')] },
    {
      messages: [
        ...DISCUSSED.messages,
        { by: 'agent', text: 'Stopped.', at: '2026-11-23T09:02:00Z', failed: true },
      ],
    },
  )
  expect(cost?.rows).toEqual([
    {
      key: 'discussion',
      name: 'discussed',
      model: 'claude-opus-5-5',
      chip: { text: '1 answer', tone: 'still' },
      cost: { text: '40 tokens' },
    },
  ])
  expect([...(cost?.runs.keys() ?? [])]).toEqual(['run-1'])
  expect(cost?.foot).toBe(
    "114k tokens on this finding: its discussion, its run and a fix's agent before its claim.",
  )
})

test("the finding's Run section shows each part's tokens and its sum; its header shows none", async () => {
  const data = reviewPayload(usage({ findings: [spentOn()] }))
  data.findings['correctness-1'] = record('fixed', RAN)
  data.discussions = { 'correctness-1': DISCUSSED }
  await openFirst(data)
  const run = within(screen.getByRole('region', { name: 'Run' }))
  expect(
    run
      .getAllByRole('listitem')
      .map((item) => item.querySelector('.tr-tk-runcost')?.textContent),
  ).toEqual(['38k tokens', '22k tokens', '64k tokens', '182k tokens'])
  expect(run.getByText('verified')).toBeDefined()
  expect(run.getByText('Confirmed').className).toBe('tr-chip tr-chip--done')
  expect(run.getByText('1 answer')).toBeDefined()
  expect(
    run.getByText(
      '306k tokens on this finding: its verification, its discussion and its two runs.',
    ),
  ).toBeDefined()
  expect(document.querySelector('.tr-detail-head')?.textContent).not.toMatch(/tokens/)
})

test('the Run section dims a run not reported and says why', async () => {
  const data = reviewPayload(
    usage({
      findings: [
        spentOn({
          runs: [
            { id: 'run-1', usage: figure(64) },
            { id: 'run-2', usage: null },
          ],
          usage: figure(124, { partial: true }),
        }),
      ],
    }),
  )
  data.findings['correctness-1'] = record('fixed', RAN)
  await openFirst(data)
  const run = within(screen.getByRole('region', { name: 'Run' }))
  const missing = run.getByText('not reported')
  expect(missing.className).toBe('tr-tk-runcost tr-tk-dim')
  expect(missing.getAttribute('title')).toMatch(/reported no tokens/)
  expect(
    run.getByText(
      'At least 124k tokens on this finding: run-2 did not report its tokens.',
    ),
  ).toBeDefined()
})

test('a finding only verified still has its Run section, with no history to show', async () => {
  const data = reviewPayload(
    usage({
      findings: [spentOn({ fixes: null, discussion: null, runs: [], usage: figure(38) })],
    }),
  )
  delete data.findings['correctness-1']
  await openFirst(data)
  const run = within(screen.getByRole('region', { name: 'Run' }))
  expect(run.queryByRole('button', { name: 'Show history' })).toBeNull()
  expect(run.getByText('38k tokens on this finding: its verification.')).toBeDefined()
})
