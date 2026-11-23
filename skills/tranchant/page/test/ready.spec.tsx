import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import App from '../src/App'
import type { Estimate, LensesProgress, LensRow, StartChoices } from '../src/domain'
import { LensesCenter, ReadyCenter } from '../src/LensesStep'
import { SettingsView } from '../src/SettingsView'
import type { StoredSettings } from '../src/settings'
import { fakeServer, payload, settingsPayload } from './fixture'

const waiting: LensesProgress = {
  state: 'waiting',
  wait: 'setting',
  changed: 14,
  lenses: [
    { name: 'bugs', source: 'tranchant:bugs', state: 'ready', files: 14 },
    {
      name: 'abac',
      source: 'workflow:code-reviewer-abac',
      state: 'ready',
      files: 9,
      scope: 'local',
      cleaning: 'again',
    },
    { name: 'sql', source: 'dba:sql-review', state: 'idle', files: 0, scope: 'global' },
    {
      name: 'performance',
      source: 'tranchant:performance',
      state: 'idle',
      files: 12,
      off: true,
    },
  ],
}

const REVIEW = {
  branch: 'feature/people',
  base: 'origin/master',
  ownership: 'ours' as const,
}

/** The ready screen, its switches held as the page holds them; `onStart` resolves. */
function renderReady(step: LensesProgress = waiting, cap = 3, estimate?: Estimate) {
  const onStart = vi.fn((_build: boolean) => Promise.resolve())
  function Held() {
    const [choices, setChoices] = useState<StartChoices>({ lenses: {}, remember: false })
    return (
      <ReadyCenter
        step={step}
        review={REVIEW}
        estimate={estimate}
        choices={choices}
        cap={cap}
        model="claude-sonnet-5-5"
        onChoices={setChoices}
        onStart={onStart}
      />
    )
  }
  render(<Held />)
  return { onStart }
}

const rowOf = (name: string) => {
  const list = screen.getByRole('list', {
    name: 'The lenses, one per row: turn one off for this review',
  })
  const found = within(list)
    .getAllByRole('listitem')
    .find((item) => item.querySelector('.tr-lens-row-name')?.textContent === name)
  if (!found) throw new Error(`no row ${name}`)
  return found
}

const switchOf = (name: string) => within(rowOf(name)).getByRole('switch')
const fact = (term: string) => screen.getByText(term).nextElementSibling?.textContent

test('the ready screen says why it waits, what runs, and each lens with its switch', () => {
  renderReady()
  expect(screen.getByRole('heading', { name: 'Ready to start the review' })).toBeTruthy()
  expect(screen.getByText(/Start the review by itself is off in Settings/)).toBeTruthy()
  expect(fact('Target')).toBe(
    'feature/people → origin/master · your branch · 14 files changed',
  )
  expect(fact('Lenses')).toBe(
    '2 run on this change, 1 reads none of its files · 1 off: performance · abac cleaned again, its source changed',
  )
  expect(fact('Agents')).toBe(
    '2 reviewers, 3 at a time, then one verifier per finding · claude-sonnet-5-5',
  )
  expect(rowOf('bugs').textContent).toContain('ready · reads 14 of 14 files')
  expect(rowOf('abac').textContent).toContain(
    'ready · cleaned again: its source changed · reads 9 of 14 files',
  )
  expect(rowOf('sql').textContent).toContain(
    'no changed file in its paths: it will not run',
  )
  expect(rowOf('performance').textContent).toContain('off in your settings')
  expect(switchOf('performance')).toHaveProperty('checked', false)
  expect(screen.getByRole('button', { name: 'Start the review' })).toHaveProperty(
    'disabled',
    false,
  )
  expect(
    screen.getByRole('link', { name: 'Change the lenses' }).getAttribute('href'),
  ).toBe('#settings/lenses')
})

test('the switches act on this review, the counts follow, and Start carries nothing else', () => {
  const { onStart } = renderReady()
  fireEvent.click(switchOf('bugs'))
  fireEvent.click(switchOf('performance'))
  expect(rowOf('bugs').textContent).toContain('off for this review')
  expect(rowOf('performance').textContent).toContain(
    'on for this review · reads 12 of 14',
  )
  expect(fact('Lenses')).toMatch(
    /^2 run on this change, 1 reads none of its files · 1 off: bugs/,
  )
  expect(screen.getByText(/2 changes for this review only/)).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Remember these choices' }))
  expect(rowOf('bugs').textContent).toContain('off · saved on Start')
  expect(
    screen.getByText(/your 2 changes are saved as Settings › Lenses saves them/),
  ).toBeTruthy()
  // Back as the settings say: no choice left on it.
  fireEvent.click(switchOf('bugs'))
  expect(rowOf('bugs').textContent).toContain('ready · reads 14 of 14 files')
  fireEvent.click(screen.getByRole('button', { name: 'Start the review' }))
  expect(onStart).toHaveBeenCalledWith(false)
})

test('a lens that is on and cannot be built refuses the start, until it is turned off', async () => {
  const failed: LensesProgress = {
    ...waiting,
    wait: 'flag',
    lenses: [
      ...waiting.lenses,
      {
        name: 'react-hooks',
        source: '~/.claude/agents/react-hooks-review.md',
        state: 'failed',
        files: 6,
        scope: 'global',
        reason: 'its source is gone',
        fix: 'restore the file',
      },
    ],
  }
  const { onStart } = renderReady(failed)
  expect(screen.getByText(/This run was opened with --no-start/)).toBeTruthy()
  expect(
    screen.getByRole('heading', {
      name: 'The review cannot start: a lens cannot be built',
    }),
  ).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('its source is gone')
  const start = screen.getByRole('button', { name: 'Start the review' })
  expect(start).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: 'Build the lenses again' }))
  expect(onStart).toHaveBeenCalledWith(true)
  // The switches hold while the server answers.
  await waitFor(() => expect(switchOf('react-hooks')).toHaveProperty('disabled', false))
  fireEvent.click(switchOf('react-hooks'))
  expect(rowOf('react-hooks').textContent).toContain(
    'off for this review · it cannot be built',
  )
  expect(screen.getByRole('button', { name: 'Start the review' })).toHaveProperty(
    'disabled',
    false,
  )
})

test('past 12 reviewers the token note warns, without blocking Start', () => {
  const many: LensRow[] = Array.from({ length: 13 }, (_, i) => ({
    name: `l${i}`,
    source: `tranchant:l${i}`,
    state: 'ready',
    files: 1,
  }))
  renderReady({ ...waiting, lenses: many })
  expect(screen.getByRole('note').textContent).toContain('13 reviewers.')
  expect(screen.getByRole('button', { name: 'Start the review' })).toHaveProperty(
    'disabled',
    false,
  )
  fireEvent.click(switchOf('l0'))
  expect(screen.queryByRole('note')).toBeNull()
})

const ESTIMATE: Estimate = {
  recorded: true,
  summary: { tokens: 96_000, reviews: ['r1', 'r2'] },
  lenses: [
    { name: 'bugs', tokens: 420_000, perFile: 30_000, runs: 5, reviews: ['r1', 'r3'] },
    {
      name: 'performance',
      tokens: 300_000,
      perFile: 25_000,
      runs: 2,
      reviews: ['r4'],
    },
  ],
}

const hint = () =>
  screen.getByRole('button', { name: 'Start the review' }).nextElementSibling

test('the ready screen estimates the tokens, and the figure follows the switches', () => {
  renderReady(waiting, 3, ESTIMATE)
  expect(fact('Tokens')).toBe(
    'about 516k tokens, from 3 past reviews in this project: each lens’s tokens per file read, its verifiers and the summary · + 1 lens with no past run, not counted',
  )
  expect(within(rowOf('bugs')).getByText('~420k').getAttribute('title')).toBe(
    '30k tokens per file read, the median of its last 5 reviews here, × 14 files, plus its verifiers',
  )
  expect(within(rowOf('abac')).getByText('no past run')).toBeTruthy()
  // Off, or reading none of the change: no figure on its row.
  expect(rowOf('performance').textContent).not.toContain('~')
  expect(rowOf('sql').textContent).not.toContain('no past run')
  expect(hint()?.textContent).toBe('2 reviewers start, 3 at a time · about 516k tokens')

  fireEvent.click(switchOf('performance'))
  expect(within(rowOf('performance')).getByText('~300k')).toBeTruthy()
  // Its past review is one more the figure comes from.
  expect(fact('Tokens')).toMatch(/^about 816k tokens, from 4 past reviews/)
  expect(hint()?.textContent).toBe('3 reviewers start, 3 at a time · about 816k tokens')
  fireEvent.click(switchOf('abac'))
  expect(fact('Tokens')).not.toContain('no past run')
})

test('with an estimate the warning past 12 goes; without one it stays, and the fact says why', () => {
  const many: LensRow[] = Array.from({ length: 13 }, (_, i) => ({
    name: `l${i}`,
    source: `tranchant:l${i}`,
    state: 'ready',
    files: 1,
  }))
  const priced: Estimate = {
    ...ESTIMATE,
    lenses: many.map((row) => ({
      name: row.name,
      tokens: 1000,
      perFile: 1000,
      runs: 1,
      reviews: ['r1'],
    })),
  }
  const { unmount } = render(
    <ReadyCenter
      step={{ ...waiting, lenses: many }}
      review={REVIEW}
      estimate={priced}
      choices={{ lenses: {}, remember: false }}
      cap={3}
      model={undefined}
      onChoices={() => undefined}
      onStart={() => Promise.resolve()}
    />,
  )
  expect(fact('Tokens')).toMatch(/^about 109k tokens/)
  expect(screen.queryByRole('note')).toBeNull()
  unmount()

  renderReady({ ...waiting, lenses: many }, 3, {
    recorded: false,
    summary: null,
    lenses: [],
  })
  expect(fact('Tokens')).toBe(
    'no estimate yet: no review in this project has recorded its tokens. The next one will.',
  )
  expect(screen.getByRole('note').textContent).toContain('13 reviewers.')
  expect(rowOf('l0').textContent).not.toContain('no past run')
  expect(hint()?.textContent).toBe('13 reviewers start, 3 at a time.')
})

test('past reviews recorded, but none of these lenses ran: no figure, the warning stays', () => {
  renderReady(waiting, 3, {
    recorded: true,
    summary: { tokens: 50_000, reviews: ['r1'] },
    lenses: [],
  })
  expect(fact('Tokens')).toMatch(/^no estimate: none of these lenses has a past run/)
  expect(within(rowOf('bugs')).getByText('no past run')).toBeTruthy()
  expect(hint()?.textContent).toBe('2 reviewers start, 3 at a time.')
})

test('a lens that cannot be built is not in the figure; no summary, none said', () => {
  const failed: LensesProgress = {
    ...waiting,
    lenses: [
      { name: 'bugs', source: 'tranchant:bugs', state: 'ready', files: 14 },
      {
        name: 'performance',
        source: 'tranchant:performance',
        state: 'failed',
        files: 12,
        reason: 'not found',
      },
    ],
  }
  renderReady(failed, 3, { ...ESTIMATE, summary: null })
  expect(fact('Tokens')).toBe(
    'about 420k tokens, from 2 past reviews in this project: each lens’s tokens per file read and its verifiers',
  )
  expect(rowOf('performance').textContent).not.toContain('~')
})

test('an older server sends no estimate: no Tokens fact, no figure on the rows', () => {
  renderReady()
  expect(screen.queryByText('Tokens')).toBeNull()
  expect(rowOf('bugs').querySelector('.tr-lens-row-est')).toBeNull()
  expect(hint()?.textContent).toBe('2 reviewers start, 3 at a time.')
})

test('a run of its own recipe has no choice to remember', () => {
  renderReady({ ...waiting, own: true })
  expect(screen.queryByRole('checkbox', { name: 'Remember these choices' })).toBeNull()
})

test('the page waits with a ready chip, and Start posts the choices', async () => {
  const server = fakeServer({
    ...payload({ review: { status: 'preparing', findings: [] } }),
    lenses: waiting,
    estimate: ESTIMATE,
  })
  render(<App />)
  expect(
    await screen.findByRole('heading', { name: 'Ready to start the review' }),
  ).toBeTruthy()
  expect(fact('Tokens')).toMatch(/^about 516k tokens/)
  expect(screen.getByText('ready to start')).toBeTruthy()
  expect(screen.queryByText('building the lenses')).toBeNull()
  fireEvent.click(switchOf('performance'))
  fireEvent.click(screen.getByRole('button', { name: 'Start the review' }))
  await waitFor(() =>
    expect(server.posts.find((post) => post.url === '/api/review/start')?.body).toEqual({
      lenses: { performance: true },
      remember: false,
    }),
  )
})

test('Settings has Start the review by itself, on by default', () => {
  const saved: StoredSettings[] = []
  const settings = settingsPayload()
  fakeServer(payload())
  render(
    <SettingsView
      settings={settings}
      offline={false}
      onDismiss={() => undefined}
      onSave={(change) => saved.push(change(settings.settings))}
    />,
  )
  const row = screen
    .getByText('Start the review by itself')
    .closest<HTMLElement>('.tr-setting')
  if (!row) throw new Error('no row')
  expect(within(row).getByRole('button', { name: 'On', pressed: true })).toBeTruthy()
  expect(within(row).getByText('Default: On')).toBeTruthy()
  fireEvent.click(within(row).getByRole('button', { name: 'Off' }))
  expect(saved).toEqual([{ startReview: false }])
})

test('while a waiting review builds, a lens that does not run is neither counted nor failed', () => {
  render(
    <LensesCenter
      step={{
        state: 'resolving',
        lenses: [
          { name: 'bugs', source: 'tranchant:bugs', state: 'ready', files: 3 },
          { name: 'docs', source: 'tranchant:docs', state: 'idle', files: 1, off: true },
        ],
      }}
      review={{ status: 'preparing' }}
    />,
  )
  expect(screen.getByRole('status').textContent).toBe('1 of 1 lens ready')
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
  expect(screen.queryByLabelText('failed')).toBeNull()
  expect(screen.getByText('off in your settings')).toBeTruthy()
})

test('a plan that could not be made again is said on the ready screen', () => {
  renderReady({ ...waiting, problem: 'the settings cannot be read: not JSON' })
  expect(screen.getByRole('alert').textContent).toContain(
    'The lenses were not planned again, the last plan stands: the settings cannot be read',
  )
})

test("each reviewer's row names the model it runs on, and what chose it", () => {
  renderReady({
    ...waiting,
    lenses: [
      {
        name: 'money',
        source: '.claude/agents/money-review.md',
        state: 'ready',
        files: 3,
        scope: 'local',
        model: 'claude-opus-5-5',
        modelFrom: 'auto',
      },
      {
        name: 'bugs',
        source: 'tranchant:bugs',
        state: 'ready',
        files: 14,
        modelFrom: 'auto',
        autoWhy: 'none',
      },
      {
        name: 'tests',
        source: 'tranchant:tests',
        state: 'ready',
        files: 2,
        model: 'claude-sonnet-5-5',
        modelFrom: 'reviewers',
      },
    ],
  })
  expect(rowOf('money').textContent).toContain('this project · auto · claude-opus-5-5')
  expect(rowOf('bugs').textContent).toContain("auto · the session's model")
  expect(rowOf('tests').textContent).toContain("reviewers' · claude-sonnet-5-5")
})

test("a lens whose source this change edits runs on the session's model, said in amber", () => {
  renderReady({
    ...waiting,
    lenses: [
      {
        name: 'money',
        source: '.claude/agents/money-review.md',
        state: 'ready',
        files: 3,
        scope: 'local',
        modelFrom: 'auto',
        autoWhy: 'held',
      },
    ],
  })
  const words = within(rowOf('money')).getByText(
    "· auto · the session's model (this change edits its source)",
  )
  expect(words.className).toContain('tr-warn')
})
