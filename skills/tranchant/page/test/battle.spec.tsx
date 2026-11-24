import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import App from '../src/App'
import {
  battleMarkdown,
  battleView,
  mirrorRecords,
  pairsOf,
  scoreOf,
  sidesOf,
} from '../src/battle'
import type {
  BattleRecord,
  Finding,
  LensesProgress,
  ReviewAgent,
  StartChoices,
} from '../src/domain'
import { ReadyCenter } from '../src/LensesStep'
import type { GroupsPayload } from '../src/settings'
import { decisionsOf, fakeServer, FINDINGS, payload, record } from './fixture'

const TITLE = 'Classification overview page'

const BATTLE: BattleRecord = {
  a: 'builtin',
  b: 'team',
  lenses: { bugs: 'both', correctness: 'a', money: 'b' },
}

const [first, second] = FINDINGS
if (!first || !second) throw new Error('the fixture has two findings at least')

/** A shared lens's finding, a pair (A's and B's on the same lines), and one only B found. */
const BATTLE_FINDINGS: Finding[] = [
  { ...second, id: 'bugs-1', lens: 'bugs' },
  { ...first, id: 'correctness-1', lens: 'correctness' },
  {
    ...first,
    id: 'money-1',
    lens: 'money',
    line: 43,
    marks: [],
    title: 'The people query runs before the tenant is known',
  },
  {
    ...first,
    id: 'money-2',
    lens: 'money',
    path: 'src/cart/total.ts',
    title: 'Total goes below zero',
  },
]

const placed = (
  id: string,
  path: string,
  line: number,
  topic: Finding['topic'] = 'Bugs',
) => ({
  id,
  path,
  line,
  topic,
})

test('a finding of A pairs with one of B on the same file, topic and lines; the closest first', () => {
  const findings = [
    placed('a-1', 'x.ts', 10),
    placed('a-2', 'x.ts', 12),
    placed('a-3', 'x.ts', 40),
    placed('a-4', 'y.ts', 5, 'Tests'),
    placed('b-1', 'x.ts', 12),
    placed('b-2', 'x.ts', 50),
    placed('b-3', 'y.ts', 5),
  ]
  const sides = new Map(
    findings.map((one) => [
      one.id,
      one.id.startsWith('a') ? ('a' as const) : ('b' as const),
    ]),
  )
  // b-1 is a-2's (same line), not a-1's; a-3 and b-2 are too far apart; a-4 and b-3 differ in kind.
  expect(pairsOf(findings, sides)).toEqual([{ a: 'a-2', b: 'b-1' }])
  // A pair the reviewer split never pairs again; the next closest does.
  expect(pairsOf(findings, sides, [['b-1', 'a-2']])).toEqual([{ a: 'a-1', b: 'b-1' }])
  // A mark's line counts as the finding's.
  const marked = [
    { ...placed('a-1', 'x.ts', 10), marks: [{ line: 30 }] },
    placed('b-1', 'x.ts', 32),
  ]
  expect(
    pairsOf(
      marked,
      new Map([
        ['a-1', 'a'],
        ['b-1', 'b'],
      ]),
    ),
  ).toEqual([{ a: 'a-1', b: 'b-1' }])
})

test("a finding's side is its lens's, never read from its id when it names one", () => {
  const sides = sidesOf(BATTLE, [
    { id: 'bugs-1', lens: 'bugs' },
    { id: 'money-1' },
    { id: 'correctness-2', lens: 'money' },
    { id: 'other-1', lens: 'other' },
  ])
  expect([...sides]).toEqual([
    ['bugs-1', 'both'],
    ['money-1', 'b'],
    ['correctness-2', 'b'],
  ])
})

test('a pair is settled once: the open twin reads as the settled one, and its decision goes there', () => {
  const twins = new Map([
    ['a-1', 'b-1'],
    ['b-1', 'a-1'],
    ['a-2', 'b-2'],
    ['b-2', 'a-2'],
  ])
  const fixed = record('fixed')
  const { records, target } = mirrorRecords(
    { 'b-1': fixed, 'a-2': record('dropped'), 'b-2': record('posted') },
    twins,
  )
  expect(records['a-1']).toBe(fixed)
  expect([...target]).toEqual([['a-1', 'b-1']])
  // Both settled: each its own.
  expect(records['a-2']?.state).toBe('dropped')
  expect(records['b-2']?.state).toBe('posted')
})

const stepAt = (at: number) => ({ at, kind: 'read', label: 'x', state: 'done' as const })

test('the scorecard counts each side, the shared lens for both, and marks the better side', () => {
  const view = battleView({ battle: BATTLE, findings: BATTLE_FINDINGS })
  if (!view) throw new Error('a battle')
  expect(view.pairs).toEqual([{ a: 'correctness-1', b: 'money-1' }])
  const agents: ReviewAgent[] = [
    { name: 'rv-bugs', running: false, steps: [stepAt(0), stepAt(60_000)] },
    { name: 'rv-correctness', running: false, steps: [stepAt(1000), stepAt(400_000)] },
    { name: 'rv-money', running: false, steps: [stepAt(1000), stepAt(100_000)] },
    // A verifier whose finding is gone dropped it.
    { name: 'vf-money-3', running: false, steps: [stepAt(110_000)] },
  ]
  const records = { 'money-2': record('fixed'), 'correctness-1': record('dropped') }
  const score = scoreOf({
    review: { findings: BATTLE_FINDINGS, verify: true },
    view,
    records: mirrorRecords(records, view.twins).records,
    agents,
    usage: {
      total: null,
      kinds: [],
      findings: [],
      reset: null,
      notReported: [],
      partial: [],
      running: false,
      lenses: [
        { lens: 'bugs', reviewer: null, verifiers: null, tokens: 100_000 },
        { lens: 'correctness', reviewer: null, verifiers: null, tokens: 300_000 },
        { lens: 'money', reviewer: null, verifiers: null, tokens: 200_000 },
      ],
    },
  })
  const row = (label: string) => score.find((one) => one.label === label)
  expect(row('Findings')).toMatchObject({ a: '2', b: '3' })
  expect(row('Found by both')).toMatchObject({ a: '2', b: '2' })
  expect(row('Only this group')).toMatchObject({ a: '0', b: '1', win: 'b' })
  expect(row('Dropped by the verifier')).toMatchObject({ a: '0', b: '1' })
  // The pair's drop counts for both; B's fix for B.
  expect(row('Kept by you')).toMatchObject({ a: '0', b: '1', win: 'b' })
  expect(row('Dropped by you')).toMatchObject({ a: '1', b: '1' })
  expect(row('Dropped by you')?.win).toBeUndefined()
  expect(row('Reviewers')).toMatchObject({
    a: '2',
    b: '2',
    help: 'bugs shared, run once',
  })
  expect(row('Tokens')).toMatchObject({ a: '400k', b: '300k', win: 'b' })
  expect(row('Time'), JSON.stringify(row('Time'))).toMatchObject({
    a: '6m 40s',
    b: '1m 50s',
    win: 'b',
  })
  const markdown = battleMarkdown({
    review: { findings: BATTLE_FINDINGS, branch: 'feature/x', base: 'main', title: 'X' },
    view,
    score,
  })
  expect(markdown).toContain('# Battle review: builtin (A) against team (B)')
  expect(markdown).toContain('| Tokens | 400k | 300k ▲ |')
  expect(markdown).toContain('## Found by both (2)')
  expect(markdown).toContain('## Only B found (1)')
  expect(markdown).toContain('- `money-2` Total goes below zero (src/cart/total.ts:42)')
})

const GROUPS: GroupsPayload = {
  file: '/x/groups.json',
  list: [
    {
      name: 'builtin',
      lenses: [
        { scope: 'recipe', name: 'bugs' },
        { scope: 'recipe', name: 'correctness' },
      ],
    },
    {
      name: 'team',
      lenses: [
        { scope: 'recipe', name: 'bugs' },
        { scope: 'local', name: 'money' },
      ],
    },
    { name: 'solo', lenses: [{ scope: 'recipe', name: 'tests' }] },
  ],
}

const waiting = (fields: Partial<LensesProgress> = {}): LensesProgress => ({
  state: 'waiting',
  wait: 'flag',
  changed: 4,
  lenses: [{ name: 'bugs', source: 'tranchant:bugs', state: 'ready', files: 4 }],
  ...fields,
})

const BUILT = waiting({
  wait: 'battle',
  battle: { a: 'builtin', b: 'team' },
  lenses: [
    { name: 'bugs', source: 'tranchant:bugs', state: 'ready', files: 4, side: 'both' },
    {
      name: 'correctness',
      source: 'tranchant:correctness',
      state: 'ready',
      files: 4,
      side: 'a',
    },
    {
      name: 'money',
      source: 'money.md',
      state: 'ready',
      files: 2,
      side: 'b',
      scope: 'local',
    },
  ],
})

function renderReady(step: LensesProgress, groups: GroupsPayload = GROUPS) {
  const onStart = vi.fn((_build: boolean, _next?: StartChoices) => Promise.resolve())
  function Held() {
    const [choices, setChoices] = useState<StartChoices>({ lenses: {}, remember: false })
    return (
      <ReadyCenter
        step={step}
        review={{ branch: 'feature/cart', base: 'main', ownership: 'ours' }}
        choices={choices}
        cap={3}
        model={null}
        groups={groups}
        onChoices={setChoices}
        onStart={onStart}
      />
    )
  }
  render(<Held />)
  return { onStart }
}

test('the Battle review tab builds the first two groups, then starts the battle on them', async () => {
  const { onStart } = renderReady(waiting())
  const tab = screen.getByRole('tab', { name: 'Battle review' })
  expect(screen.getByRole('tab', { name: 'Review' }).getAttribute('aria-selected')).toBe(
    'true',
  )
  fireEvent.click(tab)
  await waitFor(() =>
    expect(onStart).toHaveBeenCalledWith(true, {
      lenses: {},
      remember: false,
      battle: { a: 'builtin', b: 'team' },
    }),
  )
  // Not built yet: no Start.
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Start the battle' }).disabled,
  ).toBe(true)
  expect(screen.getByLabelText('What the two groups share').textContent).toContain(
    'Only in Acorrectness',
  )
})

test('a battle built shows its reviewers, and Start the battle sends it', async () => {
  const { onStart } = renderReady(BUILT)
  expect(
    screen.getByRole('tab', { name: 'Battle review' }).getAttribute('aria-selected'),
  ).toBe('true')
  expect(
    screen.getByText('This run was opened with --battle', { exact: false }),
  ).toBeTruthy()
  expect(screen.getByText('Agents').nextElementSibling?.textContent).toMatch(
    /^3 reviewers \(2 for A, 2 for B, 1 shared once\), 3 at a time across both/,
  )
  // The shared lens is dashed on both sides.
  const sideA = screen.getByRole('list', { name: 'The lenses of builtin' })
  expect(within(sideA).getByText('bugs').className).toContain('tr-bt-lens--shared')
  expect(screen.getByText('/tranchant review --battle builtin,team')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Start the battle' }))
  await waitFor(() =>
    expect(onStart).toHaveBeenCalledWith(false, {
      lenses: {},
      remember: false,
      battle: { a: 'builtin', b: 'team' },
    }),
  )
  // The same group twice: said, and no Start.
  fireEvent.change(screen.getByRole('combobox', { name: 'Group B' }), {
    target: { value: 'builtin' },
  })
  expect(screen.getByRole('alert').textContent).toContain('A and B are the same group')
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Start the battle' }).disabled,
  ).toBe(true)
})

test('with fewer than two groups, the battle tab leads to Settings › Lenses › Groups', () => {
  renderReady(waiting(), { file: '/x', list: [{ name: 'solo', lenses: [] }] })
  fireEvent.click(screen.getByRole('tab', { name: 'Battle review' }))
  expect(screen.getByText('A battle needs two groups of lenses.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Make the groups' }).getAttribute('href')).toBe(
    '#settings/lenses/groups',
  )
})

const battlePayload = (fields = {}, records = {}) =>
  payload({
    records,
    review: {
      battle: BATTLE,
      verify: true,
      status: 'complete',
      lenses: Object.keys(BATTLE.lenses).map((name) => ({
        name,
        source: `tranchant:${name}`,
        hash: 'a'.repeat(64),
      })),
      findings: BATTLE_FINDINGS.map((finding) => ({ ...finding, verified: true })),
      ...fields,
    },
  })

async function renderBattle(data = battlePayload()) {
  const server = fakeServer(data)
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  await screen.findByRole('navigation', { name: 'Findings' })
  return server
}

const listed = () =>
  screen
    .getAllByRole('option')
    .map((option) => option.id.replace('tr-option-', ''))
    .toSorted()

const row = (id: string) => document.getElementById(`tr-option-${id}`)

const detail = () => screen.getByRole('article')

test("the header's switch shows A's findings, then B's, each saying who found it", async () => {
  await renderBattle()
  const switcher = screen.getByRole('group', { name: 'Whose findings' })
  expect(
    within(switcher)
      .getByRole('button', { name: /^A\s*2$/ })
      .getAttribute('aria-pressed'),
  ).toBe('true')
  expect(listed()).toEqual(['bugs-1', 'correctness-1'])
  expect(row('bugs-1')?.querySelector('.tr-bt-who')?.textContent).toBe('A + B')
  expect(row('correctness-1')?.querySelector('.tr-bt-who')?.textContent).toBe('also B')
  fireEvent.click(within(switcher).getByRole('button', { name: /^B\s*3$/ }))
  expect(listed()).toEqual(['bugs-1', 'money-1', 'money-2'])
  expect(row('money-2')?.querySelector('.tr-bt-who')?.textContent).toBe('only B')
})

test("a pair's open twin reads as the settled one, and a decision on it goes to the settled one", async () => {
  const server = await renderBattle(battlePayload({}, { 'money-1': record('dropped') }))
  const option = document.getElementById('tr-option-correctness-1')
  if (!option) throw new Error('no correctness-1 in the list')
  fireEvent.click(within(option).getByRole('button'))
  await screen.findByText('B found it too.')
  const note = document.querySelector('.tr-bt-twin')
  if (!note) throw new Error('no battle note')
  expect(note.textContent).toContain('B found it too.')
  expect(note.textContent).toContain('money-1')
  // Dropped in B: set aside in A too.
  expect(within(detail()).getAllByText('Set aside').length).toBeGreaterThan(0)
  // Open it in B: the switch moves, and B's finding opens.
  fireEvent.click(within(detail()).getByRole('button', { name: 'Open it in B' }))
  expect(
    screen.getByRole('button', { name: /^B\s*3$/ }).getAttribute('aria-pressed'),
  ).toBe('true')
  await screen.findByRole('heading', {
    name: 'The people query runs before the tenant is known',
  })
  // Back in A, fixing the twin fixes B's, the one that was decided on.
  fireEvent.click(screen.getByRole('button', { name: /^A\s*2$/ }))
  fireEvent.click(
    within(document.getElementById('tr-option-correctness-1') ?? document.body).getByRole(
      'button',
    ),
  )
  await screen.findByText('B found it too.')
  fireEvent.click(within(detail()).getByRole('button', { name: 'Fix now' }))
  await waitFor(() =>
    expect(
      decisionsOf(server.posts.findLast((post) => post.url === '/api/decisions')),
    ).toEqual([{ id: 'money-1', action: 'fix' }]),
  )
})

test('Compare waits for both reviews to be done; meanwhile the board shows A and B side by side', async () => {
  await renderBattle(battlePayload({ status: 'reviewing' }))
  const compare = screen.getByRole<HTMLButtonElement>('button', { name: 'Compare' })
  expect(compare.disabled).toBe(true)
  expect(screen.getByText('Battle in progress')).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Group A: builtin' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Group B: team' })).toBeTruthy()
  // Queued, the shared lens in the strip above, the others in their group's column.
  expect(
    within(screen.getByRole('list', { name: 'The shared lenses, run once' })).getByText(
      'bugs',
    ),
  ).toBeTruthy()
  expect(
    within(screen.getByRole('list', { name: "Group B's own lenses" })).getByText('money'),
  ).toBeTruthy()
})

test('the comparison lists the pairs and the findings only one group found', async () => {
  const server = await renderBattle()
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
  await screen.findByRole('heading', { name: 'builtin against team on this change' })
  const table = screen.getByRole('table')
  expect(within(table).getByRole('rowheader', { name: /^Findings/ })).toBeTruthy()
  const both = screen.getByRole('region', { name: /Found by both/ })
  expect(within(both).getByText('shared lens')).toBeTruthy()
  expect(within(both).getAllByText(/correctness-1|money-1/).length).toBe(2)
  expect(
    within(screen.getByRole('region', { name: /Only B found/ })).getByText(
      'Total goes below zero',
    ),
  ).toBeTruthy()
  fireEvent.click(within(both).getByRole('button', { name: 'Not the same' }))
  await waitFor(() =>
    expect(
      server.posts.findLast((post) => post.url === '/api/battle/split')?.body,
    ).toEqual({
      pair: ['correctness-1', 'money-1'],
      split: true,
    }),
  )
})

test('switching groups clears the selection: a batch acts on the findings shown', async () => {
  await renderBattle()
  const option = document.getElementById('tr-option-correctness-1')
  if (!option) throw new Error('no correctness-1 in the list')
  fireEvent.click(within(option).getByRole('checkbox'))
  expect(within(option).getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /^B\s*3$/ }))
  fireEvent.click(screen.getByRole('button', { name: /^A\s*2$/ }))
  const again = document.getElementById('tr-option-correctness-1')
  if (!again) throw new Error('no correctness-1 in the list')
  expect(within(again).getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
})

test('a stopped battle opens Compare, its review still reviewing', async () => {
  await renderBattle(
    battlePayload({ status: 'reviewing', stopped: { at: '2026-11-23T10:00:00Z' } }),
  )
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Compare' }).disabled,
  ).toBe(false)
})

test('the Review tab of a battle plans one group again, the default one; twice is sent with the battle', async () => {
  const { onStart } = renderReady(BUILT, { ...GROUPS, default: 'team' })
  fireEvent.click(screen.getByRole('checkbox', { name: /Run the shared lenses twice/ }))
  await waitFor(() =>
    expect(onStart).toHaveBeenLastCalledWith(true, {
      lenses: {},
      remember: false,
      battle: { a: 'builtin', b: 'team', twice: true },
    }),
  )
  fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
  await waitFor(() =>
    expect(onStart).toHaveBeenLastCalledWith(true, {
      lenses: {},
      remember: false,
      battle: null,
      group: 'team',
    }),
  )
})

test('a battle picked but never built is dropped when the Review tab starts', async () => {
  const onStart = vi.fn((_build: boolean, _next?: StartChoices) => Promise.resolve())
  render(
    <ReadyCenter
      step={waiting()}
      review={{ branch: 'feature/cart', base: 'main', ownership: 'ours' }}
      choices={{ lenses: {}, remember: false, battle: { a: 'builtin', b: 'solo' } }}
      cap={3}
      model={null}
      groups={GROUPS}
      onChoices={() => undefined}
      onStart={onStart}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Start the review' }))
  await waitFor(() =>
    expect(onStart).toHaveBeenCalledWith(false, {
      lenses: {},
      remember: false,
      battle: null,
    }),
  )
})
