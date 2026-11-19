import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { SettingsChange } from '../src/api'
import { LensesView } from '../src/LensesView'
import type { CleaningEntry, LensEntry, StoredSettings } from '../src/settings'
import { settingsPayload } from './fixture'

const cleaned = {
  at: '2026-11-12T09:12:00Z',
  sourceHash: 'a'.repeat(64),
  removed: [{ what: 'Sliced mode', why: 'orchestration' }],
  added: ['Topic: Security & Permissions only.'],
}

const LENSES: LensEntry[] = [
  {
    name: 'abac',
    scope: 'local',
    on: true,
    runs: true,
    source: 'workflow:code-reviewer-abac',
    paths: ['**/*.ts'],
    topics: ['Security & Permissions'],
    rules: '- A route with no policy check is a finding.',
    cleaned,
  },
  {
    name: 'bugs',
    scope: 'global',
    on: true,
    runs: true,
    replaces: true,
    source: '/me/agents/bugs.md',
    paths: ['**'],
    rules: '',
    cleaned,
    stale: 'failed',
    failedCleaning: { at: '2026-11-13T00:00:00Z', reason: 'the agent wrote no lens.md' },
  },
  {
    name: 'bugs',
    scope: 'recipe',
    on: true,
    runs: false,
    source: 'tranchant:bugs',
    paths: ['**'],
  },
  {
    name: 'docs',
    scope: 'recipe',
    on: false,
    runs: false,
    source: 'tranchant:docs',
    paths: ['**'],
  },
]

const READY: CleaningEntry = {
  id: 'c-1',
  createdAt: '2026-11-18T00:00:00Z',
  name: 'money',
  scope: 'local',
  again: false,
  source: '.claude/agents/money-review.md',
  state: 'ready',
  report: {
    paths: ['src/billing/**'],
    topics: ['Bugs'],
    rules: '- Rounding is review.',
    removed: [{ what: 'The report table', why: 'output format' }],
    added: ['Topic: Bugs.'],
  },
  domain: 'Amounts are integers in cents.',
}

function renderLenses(cleanings: CleaningEntry[] = [], stored: StoredSettings = {}) {
  const settings = settingsPayload(stored, {
    recipeFrom: 'plugin',
    lensSet: {
      dirs: {
        global: '/me/.config/tranchant/lenses',
        local: '/me/.config/tranchant/projects/3c1e/lenses',
      },
      lenses: LENSES,
    },
    cleanings,
  })
  const saved: StoredSettings[] = []
  const onSave = vi.fn((change: SettingsChange) => {
    saved.push(change(settings.settings))
  })
  const onLens = vi.fn(() => Promise.resolve({}))
  render(
    <LensesView
      settings={settings}
      offline={false}
      onDismiss={() => undefined}
      onSave={onSave}
      onLens={onLens}
    />,
  )
  return { saved, onLens }
}

const group = (name: RegExp | string) => within(screen.getByRole('list', { name }))

test('the lenses show in three groups, each with its switch, its source and where it stands', () => {
  renderLenses()
  expect(screen.getByRole('heading', { name: 'Lenses Preview' })).toBeDefined()
  expect(screen.getByText(/2 lenses run on this project/)).toBeDefined()
  const local = group('This project')
  expect(local.getByText('workflow:code-reviewer-abac')).toBeDefined()
  expect(local.getByText('**/*.ts · Security & Permissions')).toBeDefined()
  const global = group('Global · every project')
  expect(global.getByText('replaces the built-in')).toBeDefined()
  expect(global.getByText('cleaning failed · its last version runs')).toBeDefined()
  expect(global.getByText('the agent wrote no lens.md')).toBeDefined()
  const builtIn = group("Built-in · the plugin's")
  expect(builtIn.getByText('replaced')).toBeDefined()
  expect(builtIn.getByRole('switch', { name: 'docs: off' })).toHaveProperty(
    'checked',
    false,
  )
  expect(builtIn.getAllByRole('button', { name: 'View' })).toHaveLength(2)
})

test('a lens of the recipe turns off and on in the settings, and its model is set there', () => {
  const { saved, onLens } = renderLenses([], { disabledLenses: ['docs'] })
  const builtIn = group("Built-in · the plugin's")
  fireEvent.click(builtIn.getByRole('switch', { name: 'docs: off' }))
  expect(saved.at(-1)).toEqual({})
  fireEvent.click(builtIn.getByRole('switch', { name: 'bugs: on' }))
  expect(saved.at(-1)).toEqual({ disabledLenses: ['docs', 'bugs'] })
  fireEvent.click(builtIn.getAllByRole('button', { name: 'View' })[0]!)
  fireEvent.change(screen.getByLabelText('Model'), {
    target: { value: 'claude-haiku-5-5' },
  })
  expect(saved.at(-1)).toEqual({
    disabledLenses: ['docs'],
    lensModels: { bugs: 'claude-haiku-5-5' },
  })
  expect(onLens).not.toHaveBeenCalled()
})

test('an added lens is switched, edited and saved through the server, and removed after a second click', async () => {
  const { onLens } = renderLenses()
  const local = group('This project')
  fireEvent.click(local.getByRole('switch', { name: 'abac: on' }))
  expect(onLens).toHaveBeenLastCalledWith('save', {
    scope: 'local',
    name: 'abac',
    lens: { on: false },
  })
  fireEvent.click(local.getByRole('button', { name: 'Edit' }))
  const editor = screen.getByRole('region', { name: 'abac' })
  fireEvent.change(within(editor).getByLabelText('Runs on'), {
    target: { value: 'src/**/*.ts, api/**' },
  })
  fireEvent.click(within(editor).getByRole('button', { name: 'Global' }))
  fireEvent.change(within(editor).getByLabelText('Added instructions'), {
    target: { value: '- Mine.' },
  })
  fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
  expect(onLens).toHaveBeenLastCalledWith('save', {
    scope: 'local',
    name: 'abac',
    // Only what changed: the rest stays as the server holds it.
    lens: {
      scope: 'global',
      paths: ['src/**/*.ts', 'api/**'],
      rules: '- Mine.',
    },
  })
  fireEvent.click(within(editor).getByRole('button', { name: 'Clean it again now' }))
  expect(onLens).toHaveBeenLastCalledWith('clean', { scope: 'local', name: 'abac' })
  fireEvent.click(within(editor).getByRole('button', { name: 'Remove the lens' }))
  fireEvent.click(within(editor).getByRole('button', { name: 'Remove abac for good' }))
  await waitFor(() =>
    expect(onLens).toHaveBeenLastCalledWith('remove', { scope: 'local', name: 'abac' }),
  )
})

test('What the reviewer reads shows what the cleaning removed and added, and the prompt whole', async () => {
  const fetch = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ prompt: 'THE CONTRACT\n\nTHE DOMAIN' })),
    ),
  )
  vi.stubGlobal('fetch', fetch)
  renderLenses()
  fireEvent.click(group('This project').getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('tab', { name: 'What the reviewer reads' }))
  expect(screen.getByText('Sliced mode')).toBeDefined()
  expect(await screen.findByText(/THE CONTRACT/)).toBeDefined()
  expect(String(fetch.mock.calls.at(-1)?.at(0))).toBe(
    '/api/lens/prompt?scope=local&name=abac',
  )
  vi.unstubAllGlobals()
})

test('Add a lens sends its source, name, scope and context skill to be cleaned', async () => {
  const { onLens } = renderLenses()
  fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
  const form = screen.getByRole('form', { name: 'Add a lens' })
  fireEvent.change(within(form).getByLabelText('Source'), {
    target: { value: 'workflow:code-reviewer-api' },
  })
  fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'bugs' } })
  expect(
    within(form).getByText('Replaces the built-in bugs where it lives.'),
  ).toBeDefined()
  fireEvent.click(within(form).getByRole('button', { name: 'Global' }))
  fireEvent.change(within(form).getByLabelText('Context skill'), {
    target: { value: 'workflow:api-rules' },
  })
  fireEvent.click(within(form).getByRole('button', { name: 'Import and clean' }))
  expect(onLens).toHaveBeenCalledWith('import', {
    source: 'workflow:code-reviewer-api',
    scope: 'global',
    name: 'bugs',
    context: 'workflow:api-rules',
  })
  await waitFor(() =>
    expect(screen.queryByRole('form', { name: 'Add a lens' })).toBeNull(),
  )
})

test('a cleaned lens shows what it found before Add this lens; a failed one, what to add instead', () => {
  const { onLens } = renderLenses([
    READY,
    {
      id: 'c-2',
      createdAt: '2026-11-17T00:00:00Z',
      name: 'code-review',
      scope: 'local',
      again: false,
      source: 'workflow:code-review',
      state: 'failed',
      reason: 'the source holds no single review: it starts two reviewers',
      instead: ['workflow:code-reviewer-abac', 'workflow:code-reviewer-api'],
    },
  ])
  const adding = within(screen.getByRole('list', { name: 'Lenses being added' }))
  expect(adding.getByText('The report table')).toBeDefined()
  expect(adding.getByText('workflow:code-reviewer-api')).toBeDefined()
  fireEvent.click(adding.getByRole('button', { name: 'Show the lens, whole' }))
  expect(adding.getByText('Amounts are integers in cents.')).toBeDefined()
  fireEvent.click(adding.getByRole('button', { name: 'Add this lens' }))
  expect(onLens).toHaveBeenLastCalledWith('add', {
    id: 'c-1',
    lens: { paths: ['src/billing/**'], topics: ['Bugs'], rules: '- Rounding is review.' },
  })
  fireEvent.click(adding.getAllByRole('button', { name: 'Discard' })[1]!)
  expect(onLens).toHaveBeenLastCalledWith('discard', { id: 'c-2' })
})
