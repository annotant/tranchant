import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { SettingsChange } from '../src/api'
import App from '../src/App'
import { LensesView } from '../src/LensesView'
import type { CleaningEntry, LensEntry, StoredSettings } from '../src/settings'
import { fakeServer, payload, settingsPayload } from './fixture'

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

function renderLenses(
  cleanings: CleaningEntry[] = [],
  stored: StoredSettings = {},
  focus?: string,
) {
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
      focus={focus}
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

test('a link to one lens opens its editor, and that one only', () => {
  renderLenses([], {}, 'recipe:bugs')
  const builtIn = group("Built-in · the plugin's")
  expect(builtIn.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
  expect(builtIn.getAllByRole('button', { name: 'View' })).toHaveLength(1)
  expect(screen.getByLabelText('Model')).toBeDefined()
})

test('a link to a lens these settings do not list says so, and opens none', () => {
  renderLenses([], {}, 'recipe:gone')
  expect(screen.getByRole('status').textContent).toContain(
    'The lens gone is not among these',
  )
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
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

test('a lens being renamed shows its new name on its row as it is typed, and its saved one once closed', () => {
  renderLenses()
  const local = group('This project')
  fireEvent.click(local.getByRole('button', { name: 'Edit' }))
  const editor = screen.getByRole('region', { name: 'abac' })
  fireEvent.change(within(editor).getByLabelText('Name'), {
    target: { value: 'policies' },
  })
  expect(local.getByText('policies')).toBeDefined()
  expect(screen.getByRole('region', { name: 'policies' })).toBe(editor)
  fireEvent.change(within(editor).getByLabelText('Name'), { target: { value: '  ' } })
  expect(local.getByText('abac')).toBeDefined()
  fireEvent.change(within(editor).getByLabelText('Name'), {
    target: { value: 'policies' },
  })
  fireEvent.click(local.getByRole('button', { name: 'Close' }))
  expect(local.getByText('abac')).toBeDefined()
  expect(local.queryByText('policies')).toBeNull()
  fireEvent.click(local.getByRole('button', { name: 'Edit' }))
  expect(
    within(screen.getByRole('region', { name: 'abac' })).getByLabelText('Name'),
  ).toHaveProperty('value', 'abac')
})

/** The settings the server answers with these lenses. */
const answered = (lenses: LensEntry[]) =>
  settingsPayload(
    {},
    {
      recipeFrom: 'plugin',
      lensSet: { dirs: { global: '/g', local: '/l' }, lenses },
    },
  )

/** One field of a request's body, read without trusting its shape. */
const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined

/** The view over a fake server whose saves rename and move a lens; it refuses other routes and the name `refused`. */
function renderSaving(focus?: string) {
  function Saving() {
    const [settings, setSettings] = useState(() => answered(LENSES))
    return (
      <LensesView
        settings={settings}
        focus={focus}
        offline={false}
        onDismiss={() => undefined}
        onSave={() => undefined}
        onLens={async (route, body) => {
          const name = field(body['lens'], 'name')
          const scope = field(body['lens'], 'scope')
          if (route !== 'save' || name === 'refused') throw new Error('refused')
          const lenses = (settings.lensSet?.lenses ?? []).map((one) =>
            one.scope === body['scope'] && one.name === body['name']
              ? {
                  ...one,
                  name: typeof name === 'string' ? name : one.name,
                  scope: scope === 'global' || scope === 'local' ? scope : one.scope,
                }
              : one,
          )
          setSettings(answered(lenses))
          return {}
        }}
      />
    )
  }
  render(<Saving />)
}

/** The open editor, under the lens's saved name or the one typed. */
const renamedEditor = () => screen.getByRole('region', { name: /^(abac|policies)$/ })

test('once saved, a renamed lens is listed under its new name, its editor still open on it', async () => {
  renderSaving()
  fireEvent.click(group('This project').getByRole('button', { name: 'Edit' }))
  fireEvent.change(within(renamedEditor()).getByLabelText('Name'), {
    target: { value: 'policies' },
  })
  fireEvent.click(within(renamedEditor()).getByRole('button', { name: 'Global' }))
  fireEvent.click(within(renamedEditor()).getByRole('button', { name: 'Save' }))
  const moved = await screen.findByRole('region', { name: 'policies' })
  expect(group('Global · every project').getByText('policies')).toBeDefined()
  expect(within(moved).getByLabelText('Name')).toHaveProperty('value', 'policies')
  expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
  expect(screen.queryByText('abac')).toBeNull()
})

test('a refused rename keeps the editor open, with what was typed', async () => {
  renderSaving()
  fireEvent.click(group('This project').getByRole('button', { name: 'Edit' }))
  const editor = screen.getByRole('region', { name: 'abac' })
  fireEvent.change(within(editor).getByLabelText('Name'), {
    target: { value: 'refused' },
  })
  fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
  await act(() => Promise.resolve())
  expect(screen.getByRole('region', { name: 'refused' })).toBe(editor)
  expect(within(editor).getByLabelText('Name')).toHaveProperty('value', 'refused')
})

test('the lens the page was opened at, renamed, is no lens gone: the link follows it', async () => {
  location.hash = '#settings/lenses/local%3Aabac'
  try {
    renderSaving('local:abac')
    const editor = screen.getByRole('region', { name: 'abac' })
    fireEvent.change(within(editor).getByLabelText('Name'), {
      target: { value: 'policies' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await screen.findByRole('region', { name: 'policies' })
    expect(screen.queryByRole('status')).toBeNull()
    expect(location.hash).toBe('#settings/lenses/local%3Apolicies')
  } finally {
    location.hash = ''
  }
})

test('a save that keeps the name keeps the editor open; one that moves the lens alone follows it', async () => {
  renderSaving()
  fireEvent.click(group('This project').getByRole('button', { name: 'Edit' }))
  const editor = screen.getByRole('region', { name: 'abac' })
  fireEvent.change(within(editor).getByLabelText('Added instructions'), {
    target: { value: '- Mine.' },
  })
  fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
  await act(() => Promise.resolve())
  expect(screen.getByRole('region', { name: 'abac' })).toBe(editor)
  fireEvent.click(within(editor).getByRole('button', { name: 'Global' }))
  fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(
      group('Global · every project').getAllByRole('button', { name: 'Close' }),
    ).toHaveLength(1),
  )
  expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
})

/** The view over these lenses, its saves answered with nothing. */
const quietView = (lenses: LensEntry[]) => (
  <LensesView
    settings={answered(lenses)}
    offline={false}
    onDismiss={() => undefined}
    onSave={() => undefined}
    onLens={() => Promise.resolve({})}
  />
)

test('a lens cleaned again while it is renamed shows its saved name, as its form does', () => {
  const { rerender } = render(quietView(LENSES))
  fireEvent.click(group('This project').getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'policies' } })
  expect(group('This project').getByText('policies')).toBeDefined()
  rerender(
    quietView(
      LENSES.map((one) =>
        one.name === 'abac'
          ? { ...one, cleaned: { ...cleaned, at: '2026-11-19T00:00:00Z' } }
          : one,
      ),
    ),
  )
  expect(group('This project').getByText('abac')).toBeDefined()
  expect(screen.getByLabelText('Name')).toHaveProperty('value', 'abac')
})

test('another lens renamed leaves the link the page was opened at as it was', async () => {
  location.hash = '#settings/lenses/local%3Aabac'
  try {
    renderSaving('local:abac')
    fireEvent.click(group('Global · every project').getByRole('button', { name: 'Edit' }))
    const editor = screen.getByRole('region', { name: 'bugs' })
    fireEvent.change(within(editor).getByLabelText('Name'), {
      target: { value: 'flaws' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await screen.findByRole('region', { name: 'flaws' })
    expect(location.hash).toBe('#settings/lenses/local%3Aabac')
    expect(screen.queryByRole('status')).toBeNull()
  } finally {
    location.hash = ''
  }
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

/** Moves the page to `hash`, as a link or the browser's back does. */
const go = (hash: string) =>
  act(() => {
    location.hash = hash
    window.dispatchEvent(new Event('hashchange'))
  })

/** The lenses whose editor is open. */
const openLenses = () =>
  screen.getAllByRole('button', { name: 'Close' }).map((one) => one.closest('li'))

test('the page opened at a lens shows its editor and scrolls to it; another link moves on; a broken one opens none', async () => {
  const server = fakeServer(payload())
  server.answerSettings(
    settingsPayload(
      {},
      {
        recipeFrom: 'plugin',
        lensSet: {
          dirs: { global: '/me/lenses', local: '/me/p/lenses' },
          lenses: LENSES,
        },
      },
    ),
  )
  const scrolls = vi.spyOn(Element.prototype, 'scrollIntoView')
  try {
    location.hash = '#settings/lenses/local%3Aabac'
    render(<App />)
    await screen.findByRole('heading', { name: 'Lenses Preview' })
    // The lenses load after the mount: the scroll waits for them.
    await waitFor(() => expect(openLenses()).toHaveLength(1))
    expect(openLenses()[0]?.textContent).toContain('workflow:code-reviewer-abac')
    await waitFor(() =>
      expect(
        scrolls.mock.contexts.map((one) => (one instanceof Element ? one.id : '')),
      ).toContain('tr-lns-local-abac'),
    )
    go('#settings/lenses/recipe%3Adocs')
    expect(openLenses()).toHaveLength(1)
    expect(
      within(openLenses()[0]!).getByRole('switch', { name: /^docs: / }),
    ).toBeDefined()
    go('#settings/lenses/%E0')
    expect(screen.getByRole('heading', { name: 'Lenses Preview' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  } finally {
    scrolls.mockRestore()
    location.hash = ''
  }
})

/** Fourteen lenses of the recipe, the last one replaced: thirteen run, less the one turned off. */
const manyLenses = (off?: string): LensEntry[] =>
  Array.from({ length: 14 }, (_, i) => ({
    name: `l${i}`,
    scope: 'recipe',
    on: `l${i}` !== off,
    runs: `l${i}` !== off && i !== 13,
    source: `tranchant:l${i}`,
    paths: ['**'],
  }))
const manyView = (set: LensEntry[]) => (
  <LensesView
    settings={settingsPayload(
      {},
      {
        recipeFrom: 'plugin',
        lensSet: { dirs: { global: '/g', local: '/l' }, lenses: set },
      },
    )}
    offline={false}
    onDismiss={() => undefined}
    onSave={() => undefined}
    onLens={() => Promise.resolve({})}
  />
)

test('past 12 lenses that run, a warning says how many and that each costs tokens; one off removes it', () => {
  const { rerender } = render(manyView(manyLenses()))
  expect(screen.getByText(/^13 lenses are on for this project\./).textContent).toMatch(
    /one more reviewer agent on every review: more lenses use more\s+tokens/,
  )
  rerender(manyView(manyLenses('l3')))
  expect(screen.queryByText(/lenses are on for this project/)).toBeNull()
  // Adding one takes the count back to 13: the form says so before it is added.
  fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
  expect(screen.getByText(/^With this one, 13 lenses are on/)).toBeDefined()
  // In place of one that runs, the count stays; of one turned off, it grows.
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'l0' } })
  expect(screen.queryByText(/lenses are on for this project/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'l3' } })
  expect(screen.getByText(/^With this one, 13 lenses are on/)).toBeDefined()
})

test('while a lens is added past the warning, the form alone says the count', () => {
  render(manyView(manyLenses()))
  fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
  expect(screen.getAllByText(/lenses are on for this project/)).toHaveLength(1)
  expect(screen.getByText(/^With this one, 14 lenses are on/)).toBeDefined()
})
