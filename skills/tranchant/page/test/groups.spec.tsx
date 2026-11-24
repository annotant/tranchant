import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { LensesProgress, StartChoices } from '../src/domain'
import { ReadyCenter } from '../src/LensesStep'
import { LensesView } from '../src/LensesView'
import type { GroupsPayload, LensEntry } from '../src/settings'
import { groupHistoryOf, lensHistoryOf } from '../src/tokens'
import { settingsPayload } from './fixture'

const cleaned = {
  at: '2026-11-12T09:12:00Z',
  sourceHash: 'a'.repeat(64),
  removed: [],
  added: [],
}

const lens = (
  name: string,
  scope: LensEntry['scope'],
  more: Partial<LensEntry> = {},
): LensEntry => ({
  name,
  scope,
  on: true,
  runs: true,
  source: scope === 'recipe' ? `tranchant:${name}` : `${name}.md`,
  paths: ['**'],
  ...(scope !== 'recipe' && { rules: '', cleaned, origin: 'custom' as const }),
  ...more,
})

const LENSES: LensEntry[] = [
  lens('money', 'local'),
  lens('conventions', 'local', { replaces: true }),
  lens('sql', 'global', { on: false, runs: false }),
  lens('bugs', 'recipe'),
  lens('tests', 'recipe'),
  lens('conventions', 'recipe', { runs: false }),
]

const GROUPS: GroupsPayload = {
  file: '/me/.config/tranchant/projects/3c1e/groups.json',
  default: 'backend',
  list: [
    {
      name: 'backend',
      lenses: [
        { scope: 'local', name: 'money' },
        { scope: 'global', name: 'sql' },
        { scope: 'recipe', name: 'bugs' },
      ],
    },
    { name: 'frontend', lenses: [{ scope: 'recipe', name: 'tests' }] },
  ],
}

function renderLenses(
  focus?: string,
  groups: GroupsPayload = GROUPS,
  lenses: LensEntry[] = LENSES,
) {
  const settings = settingsPayload(
    {},
    {
      recipeFrom: 'plugin',
      lensSet: {
        dirs: {
          global: '/me/.config/tranchant/lenses',
          local: '/me/.config/tranchant/projects/3c1e/lenses',
        },
        lenses,
      },
      cleanings: [],
      groups,
    },
  )
  const onLens = vi.fn(() => Promise.resolve({}))
  render(
    <LensesView
      settings={settings}
      focus={focus}
      offline={false}
      onDismiss={() => undefined}
      onSave={() => undefined}
      onLens={onLens}
    />,
  )
  return { onLens }
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })

/** The list item `element` lies in. */
function itemOf(element: HTMLElement) {
  const item = element.closest('li')
  if (!item) throw new Error('not in a list item')
  return item
}

/** The `index`th of `elements`. */
function nth(elements: HTMLElement[], index: number) {
  const element = elements[index]
  if (!element) throw new Error(`no element ${index}`)
  return element
}

test('the Lenses tab names the groups of each lens, filters on one, and a chip opens that group', () => {
  renderLenses()
  expect(tab(/^Lenses/).getAttribute('aria-selected')).toBe('true')
  expect(tab(/^Groups/).textContent).toBe('Groups2')
  const money = itemOf(screen.getByText('money'))
  expect(within(money).getByRole('button', { name: 'backend' })).toBeTruthy()
  // In frontend: its one lens alone.
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'frontend' } })
  const names = Array.from(document.querySelectorAll('.tr-lns-name')).map(
    (one) => one.textContent,
  )
  expect(names).toEqual(['tests'])
  expect(screen.getByText('1 of 6 lenses')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'frontend' }))
  expect(tab(/^Groups/).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('region', { name: 'frontend' })).toBeTruthy()
})

test('the Groups tab lists each group with its lenses, its --group and the default; the default select saves', async () => {
  const { onLens } = renderLenses('groups')
  const list = within(screen.getByRole('list', { name: 'Groups' }))
  const backend = itemOf(list.getByText('backend'))
  expect(within(backend).getByText('3 lenses')).toBeTruthy()
  expect(within(backend).getByText('default')).toBeTruthy()
  expect(within(backend).getByText('--group backend')).toBeTruthy()
  expect(within(backend).getByText('money · project')).toBeTruthy()
  expect(within(backend).getByText('sql · global')).toBeTruthy()
  expect(within(backend).getByText('bugs')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Default group'), { target: { value: '' } })
  await waitFor(() =>
    expect(onLens).toHaveBeenCalledWith('group/default', { name: null }),
  )
})

test('a new group: one lens per name, the N shown checked at once, a scope by its heading, then created', async () => {
  const { onLens } = renderLenses('groups')
  fireEvent.click(nth(screen.getAllByRole('button', { name: 'New group' }), 0))
  const editor = within(screen.getByRole('region', { name: 'New group' }))
  const create = editor.getByRole('button', { name: 'Create the group' })
  expect(create).toHaveProperty('disabled', true)
  fireEvent.change(editor.getByLabelText('Name'), { target: { value: 'A' } })
  // The project's conventions, then the built-in one: it takes its place.
  const box = (scope: string, name: string) => {
    const input = within(editor.getByRole('group', { name: scope }))
      .getByText(name)
      .closest('label')
      ?.querySelector('input')
    if (!input) throw new Error(`no checkbox for ${name}`)
    return input
  }
  fireEvent.click(box('This project', 'conventions'))
  fireEvent.click(box('Built-in', 'conventions'))
  expect(box('This project', 'conventions').checked).toBe(false)
  expect(box('Built-in', 'conventions').checked).toBe(true)
  expect(
    editor.getByText(
      'conventions built-in checked: the conventions of this project is unchecked. One lens per name in a group.',
    ),
  ).toBeTruthy()
  // A lens off in the settings runs in a group: said on its row.
  expect(editor.getByText('off in your settings: runs in this group')).toBeTruthy()
  // Filtered on "t": the shown ones checked at once, the first of a name kept.
  fireEvent.change(editor.getByLabelText('Filter the lenses by name'), {
    target: { value: 't' },
  })
  fireEvent.click(editor.getByRole('button', { name: 'Check the 3 shown' }))
  expect(box('Built-in', 'tests').checked).toBe(true)
  expect(editor.getByRole('button', { name: 'Uncheck the 3 shown' })).toBeTruthy()
  fireEvent.change(editor.getByLabelText('Filter the lenses by name'), {
    target: { value: '' },
  })
  // Every lens of Global by its heading.
  fireEvent.click(editor.getByRole('checkbox', { name: 'Check every lens of Global' }))
  expect(box('Global', 'sql').checked).toBe(true)
  expect(editor.getByText('3 checked · 3 reviewers at most')).toBeTruthy()
  fireEvent.click(create)
  await waitFor(() =>
    expect(onLens).toHaveBeenCalledWith('group/save', {
      group: {
        name: 'A',
        lenses: [
          { scope: 'recipe', name: 'conventions' },
          { scope: 'recipe', name: 'tests' },
          { scope: 'global', name: 'sql' },
        ],
      },
    }),
  )
})

test('a group edited is saved under its name; Duplicate starts B from A; Delete never deletes its lenses', async () => {
  const { onLens } = renderLenses('group:frontend')
  const editor = within(screen.getByRole('region', { name: 'frontend' }))
  fireEvent.change(editor.getByLabelText('Name'), { target: { value: 'backend' } })
  expect(editor.getByText('A group is already named backend.')).toBeTruthy()
  fireEvent.change(editor.getByLabelText('Name'), { target: { value: 'web' } })
  fireEvent.click(editor.getByRole('button', { name: 'Save the group' }))
  await waitFor(() =>
    expect(onLens).toHaveBeenCalledWith('group/save', {
      name: 'frontend',
      group: { name: 'web', lenses: [{ scope: 'recipe', name: 'tests' }] },
    }),
  )
  fireEvent.click(nth(screen.getAllByRole('button', { name: 'Edit' }), 1))
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
  const copy = within(screen.getByRole('region', { name: 'frontend-copy' }))
  expect(copy.getByLabelText('Name')).toHaveProperty('value', 'frontend-copy')
  fireEvent.click(copy.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(nth(screen.getAllByRole('button', { name: 'Edit' }), 1))
  fireEvent.click(screen.getByRole('button', { name: 'Delete the group' }))
  await waitFor(() =>
    expect(onLens).toHaveBeenCalledWith('group/remove', { name: 'frontend' }),
  )
  expect(await screen.findByText('Group frontend deleted: its lenses stay.')).toBeTruthy()
})

test('no group yet: every review runs every lens that is on', () => {
  renderLenses('groups', { file: '/g.json', list: [] })
  expect(screen.getByText('No group yet.')).toBeTruthy()
  expect(screen.getByLabelText('Default group')).toHaveProperty('value', '')
  expect(screen.getByRole('option', { name: 'Every lens that is on · 4' })).toBeTruthy()
})

const WAITING: LensesProgress = {
  state: 'waiting',
  wait: 'setting',
  changed: 4,
  group: 'backend',
  notes: ["lens abac (this project's) was removed: group backend runs without it"],
  lenses: [
    { name: 'bugs', source: 'tranchant:bugs', state: 'ready', files: 4 },
    {
      name: 'sql',
      source: 'dba:sql',
      state: 'ready',
      files: 1,
      scope: 'global',
      offInSettings: true,
    },
    { name: 'tests', source: 'tranchant:tests', state: 'idle', files: 2, off: true },
  ],
}

test('the ready screen names the group, its lenses off in the settings, and a group picked builds its lenses before Start', async () => {
  const onStart = vi.fn((_build: boolean, _next?: StartChoices) => Promise.resolve())
  function Held() {
    const [choices, setChoices] = useState<StartChoices>({ lenses: {}, remember: false })
    return (
      <ReadyCenter
        step={WAITING}
        review={{ branch: 'feature/x', base: 'origin/main', ownership: 'ours' }}
        choices={choices}
        cap={3}
        model={null}
        groups={GROUPS}
        onChoices={setChoices}
        onStart={onStart}
      />
    )
  }
  render(<Held />)
  expect(screen.getByText(/was removed: group backend runs without it/)).toBeTruthy()
  expect(screen.getByRole('option', { name: 'backend · 3 lenses' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'frontend · 1 lens' })).toBeTruthy()
  expect(screen.getByText(/· 1 not in backend$/)).toBeTruthy()
  expect(
    screen.getByText(
      'ready · reads 1 of 4 files · off in your settings, on in this group',
    ),
  ).toBeTruthy()
  expect(screen.getByText('not in backend')).toBeTruthy()
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Save these switches in the group backend' }),
  )
  fireEvent.click(screen.getByRole('switch', { name: 'sql: on for this review' }))
  expect(screen.getByText('off · removed from backend on Start')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'frontend' } })
  await waitFor(() =>
    expect(onStart).toHaveBeenCalledWith(true, {
      lenses: {},
      remember: false,
      group: 'frontend',
    }),
  )
  // Its lenses not built yet: no Start on backend's rows.
  expect(screen.getByRole('button', { name: 'Start the review' })).toHaveProperty(
    'disabled',
    true,
  )
  expect(screen.getByText('Building the lenses of this group…')).toBeTruthy()
})

/** The lenses with a history: money and bugs; the others none. */
const WITH_HISTORY = LENSES.map((one) =>
  one.name === 'money'
    ? { ...one, history: { tokens: 140_000, confirmed: 0.8, runs: 10 } }
    : one.name === 'bugs' && one.scope === 'recipe'
      ? { ...one, history: { tokens: 300_000, confirmed: 1.3, runs: 4 } }
      : one,
)

test("a lens's average shows under its row, a lens with no history shows none", () => {
  renderLenses(undefined, GROUPS, WITH_HISTORY)
  const money = itemOf(screen.getByText('money'))
  const line = within(money).getByText(
    '~140k tokens · 0.8 confirmed findings a review · ~175k tokens per confirmed finding',
  )
  expect(line.className).toBe('tr-lns-history')
  expect(line.getAttribute('title')).toMatch(/last 10 complete reviews in this project/)
  expect(within(itemOf(screen.getByText('sql'))).queryByText(/ a review/)).toBeNull()
  expect(document.querySelectorAll('.tr-lns-history')).toHaveLength(2)
})

test("a group's average sums its lenses', those with none said; a group with none shows none", () => {
  renderLenses('groups', GROUPS, WITH_HISTORY)
  const list = within(screen.getByRole('list', { name: 'Groups' }))
  const backend = itemOf(list.getByText('backend'))
  expect(
    within(backend).getByText(
      '~440k tokens · 2.1 confirmed findings a review · ~210k tokens per confirmed finding · sql has no history yet, not counted',
    ),
  ).toBeTruthy()
  const frontend = itemOf(list.getByText('frontend'))
  expect(within(frontend).queryByText(/ a review/)).toBeNull()
})

test('a line says findings, one when exactly one, its tokens per confirmed finding when one is, and names the lenses with no history', () => {
  const one = { tokens: 100_000, confirmed: 1, runs: 2 }
  expect(lensHistoryOf(one)?.text).toBe(
    '~100k tokens · 1 confirmed finding a review · ~100k tokens per confirmed finding',
  )
  expect(lensHistoryOf({ ...one, confirmed: 0 })?.text).toBe(
    '~100k tokens · 0 confirmed findings a review',
  )
  expect(
    groupHistoryOf([{ name: 'bugs', history: one }, { name: 'docs' }, { name: 'tests' }])
      ?.text,
  ).toBe(
    '~100k tokens · 1 confirmed finding a review · ~100k tokens per confirmed finding · docs and tests have no history yet, not counted',
  )
  expect(
    groupHistoryOf([
      { name: 'bugs', history: one },
      ...['a', 'b', 'c', 'd'].map((name) => ({ name })),
    ])?.text,
  ).toBe(
    '~100k tokens · 1 confirmed finding a review · ~100k tokens per confirmed finding · 4 lenses have no history yet, not counted',
  )
  expect(groupHistoryOf([{ name: 'docs' }])).toBeUndefined()
})

test('with no history at all, no lens and no group shows an average', () => {
  renderLenses()
  expect(document.querySelectorAll('.tr-lns-history')).toHaveLength(0)
  fireEvent.click(tab(/^Groups/))
  expect(document.querySelectorAll('.tr-lns-history')).toHaveLength(0)
})

test("a group's line follows its draft while edited, and reads each member's own scope", () => {
  const lenses = WITH_HISTORY.map((one) =>
    one.name === 'conventions' && one.scope === 'local'
      ? { ...one, history: { tokens: 50_000, confirmed: 0.5, runs: 3 } }
      : one,
  )
  const groups: GroupsPayload = {
    ...GROUPS,
    list: [
      ...GROUPS.list,
      // The built-in conventions: the project's has the history, not this one.
      { name: 'style', lenses: [{ scope: 'recipe', name: 'conventions' }] },
    ],
  }
  renderLenses('group:backend', groups, lenses)
  const list = within(screen.getByRole('list', { name: 'Groups' }))
  expect(within(itemOf(list.getByText('style'))).queryByText(/ a review/)).toBeNull()
  const editor = within(screen.getByRole('region', { name: 'backend' }))
  const bugs = within(editor.getByRole('group', { name: 'Built-in' }))
    .getByText('bugs')
    .closest('label')
    ?.querySelector('input')
  if (!bugs) throw new Error('no checkbox for bugs')
  fireEvent.click(bugs)
  const backend = itemOf(editor.getByLabelText('Name'))
  expect(
    within(backend).getByText(
      '~140k tokens · 0.8 confirmed findings a review · ~175k tokens per confirmed finding · sql has no history yet, not counted',
    ),
  ).toBeTruthy()
})
