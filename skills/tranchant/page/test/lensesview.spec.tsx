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
  lenses: LensEntry[] = LENSES,
) {
  const settings = settingsPayload(stored, {
    recipeFrom: 'plugin',
    lensSet: {
      dirs: {
        global: '/me/.config/tranchant/lenses',
        local: '/me/.config/tranchant/projects/3c1e/lenses',
      },
      lenses,
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

const recipeLens = (name: string, topics: string[]): LensEntry => ({
  name,
  scope: 'recipe',
  on: true,
  runs: true,
  source: `tranchant:${name}`,
  paths: ['**'],
  topics,
})

const added = (
  name: string,
  scope: 'local' | 'global',
  origin: Pick<LensEntry, 'origin' | 'sourceKind'>,
  topics?: string[],
): LensEntry => ({
  name,
  scope,
  on: true,
  runs: true,
  source: `${name}.md`,
  paths: ['**'],
  ...origin,
  ...(topics && { topics }),
  rules: '',
  cleaned,
})

const MANY: LensEntry[] = [
  added('money', 'local', { origin: 'picked', sourceKind: 'agent' }, ['Bugs']),
  added('checkout', 'local', { origin: 'custom' }, ['Tests']),
  added('code-style', 'global', { origin: 'picked', sourceKind: 'skill' }, [
    'Conventions',
  ]),
  added('anything', 'global', { origin: 'custom' }),
  recipeLens('correctness', ['Bugs']),
  recipeLens('conventions', ['Conventions']),
  recipeLens('docs', ['Code Quality', 'Breaking Changes']),
  recipeLens('tests', ['Tests']),
]

const filterBar = () => within(screen.getByRole('search', { name: 'Filter the lenses' }))
const total = () => document.querySelector('.tr-lns-filter-total')?.textContent
const rowNames = () =>
  screen
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('.tr-lns-name')?.textContent)
    .filter(Boolean)

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

test('Add a lens sends its source, name and scope to be cleaned, and asks for no context skill', async () => {
  // A single reviewer: nothing inside it to list.
  const fetch = stubMatches({ inside: null, name: 'code-reviewer-api' })
  try {
    const { onLens } = renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = screen.getByRole('form', { name: 'Add a lens' })
    fireEvent.change(within(form).getByLabelText('Source'), {
      target: { value: 'workflow:code-reviewer-api' },
    })
    // Read first: Import waits for it.
    expect(within(form).getByRole('status').textContent).toContain(
      'Reading code-reviewer-api for the agents it starts…',
    )
    const add = within(form).getByRole('button', { name: 'Import and clean' })
    expect(add).toHaveProperty('disabled', true)
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'docs' } })
    expect(
      within(form).getByText('Replaces the built-in docs where it lives.'),
    ).toBeDefined()
    fireEvent.click(within(form).getByRole('button', { name: 'Global' }))
    expect(within(form).queryByLabelText('Context skill')).toBeNull()
    await waitFor(() => expect(add).toHaveProperty('disabled', false))
    expect(String(fetch.mock.calls.at(-1)?.at(0))).toBe(
      '/api/lens/inside?source=workflow%3Acode-reviewer-api',
    )
    expect(within(form).queryByRole('status')).toBeNull()
    fireEvent.click(add)
    expect(onLens).toHaveBeenCalledWith('import', {
      source: 'workflow:code-reviewer-api',
      scope: 'global',
      name: 'docs',
    })
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Add a lens' })).toBeNull(),
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test('Add a lens names it after its source before the cleaning; a name taken in that scope says so and waits for another', async () => {
  stubMatches({ inside: null, name: 'abac' })
  try {
    const { onLens } = renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: '.claude/agents/abac.md' },
    })
    const name = form.getByLabelText('Name')
    await waitFor(() => expect(name).toHaveProperty('value', 'abac'))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(form.getByRole('alert').textContent).toBe(
      "This project's abac is another lens, from workflow:code-reviewer-abac: give this one another name.",
    )
    const add = form.getByRole('button', { name: 'Import and clean' })
    expect(add).toHaveProperty('disabled', true)
    // Global, the name is free: the source's name goes as it is.
    fireEvent.click(form.getByRole('button', { name: 'Global' }))
    expect(form.queryByRole('alert')).toBeNull()
    expect(add).toHaveProperty('disabled', false)
    fireEvent.click(form.getByRole('button', { name: 'This project' }))
    // Emptied, the name is the source's again: still taken.
    fireEvent.change(name, { target: { value: '' } })
    expect(name.getAttribute('placeholder')).toBe('abac')
    expect(form.getByRole('alert')).toBeDefined()
    expect(add).toHaveProperty('disabled', true)
    // A lens is a folder: another case is the same name.
    fireEvent.change(name, { target: { value: 'Abac' } })
    expect(form.getByRole('alert').textContent).toMatch(
      /^This project's abac is another lens/,
    )
    fireEvent.change(name, { target: { value: 'my lens' } })
    expect(form.getByRole('alert').textContent).toBe(
      'A lens name is letters, digits, - and _ only, 40 at most: change this one.',
    )
    expect(add).toHaveProperty('disabled', true)
    fireEvent.change(name, { target: { value: 'abac-files' } })
    expect(form.queryByRole('alert')).toBeNull()
    expect(form.getByText('Yours; empty, it is abac, from its source.')).toBeDefined()
    fireEvent.click(add)
    expect(onLens).toHaveBeenCalledWith('import', {
      source: '.claude/agents/abac.md',
      scope: 'local',
      name: 'abac-files',
    })
  } finally {
    vi.unstubAllGlobals()
  }
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

/** The server's answer to every look: `/api/lens/matches` or `/api/lens/inside`. */
function stubMatches(answer: unknown) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(answer))))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const MATCHES = {
  matches: [
    { source: '.claude/agents/abac-review.md', name: 'abac' },
    { source: '.claude/agents/bugs-review.md', name: 'bugs' },
    { source: '.claude/agents/i18n-review.md', name: 'i18n-review' },
    {
      source: '.claude/agents/pr-review.md',
      name: 'pr-review',
      notReviewer: 'It starts other agents and holds no review of its own.',
    },
    { source: '.claude/agents/perf-review.md', name: 'perf-review' },
  ],
}

test('a glob lists its matches: a taken name blocks until renamed, one that is no reviewer starts unchecked, unchecked ones are left out', async () => {
  const fetch = stubMatches(MATCHES)
  try {
    const { onLens } = renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: '.claude/agents/*-review.md' },
    })
    // A glob has no Name: each match is named after its file.
    expect(form.queryByLabelText('Name')).toBeNull()
    const list = within(await screen.findByRole('list', { name: 'Matches' }))
    expect(String(fetch.mock.calls.at(-1)?.at(0))).toBe(
      '/api/lens/matches?source=.claude%2Fagents%2F*-review.md',
    )
    expect(form.getByText('5 files match')).toBeDefined()
    expect(form.getByText('4 checked')).toBeDefined()
    expect(list.getByLabelText('.claude/agents/pr-review.md')).toHaveProperty(
      'checked',
      false,
    )
    expect(list.getByText('not a reviewer')).toBeDefined()
    expect(list.getByText('replaces')).toBeDefined()
    expect(
      list.getByText(/Replaces the global bugs \(from \/me\/agents\/bugs\.md\)/),
    ).toBeDefined()
    // abac names another lens of this project: its name is the problem, to change.
    expect(list.getByText('name taken')).toBeDefined()
    expect(
      list.getByText(
        "This project's abac is another lens, from workflow:code-reviewer-abac: give this one another name.",
      ),
    ).toBeDefined()
    const abacName = list.getByLabelText('Lens name for .claude/agents/abac-review.md')
    expect(abacName.getAttribute('aria-invalid')).toBe('true')
    const add = form.getByRole('button', { name: 'Add the 4 lenses' })
    expect(add).toHaveProperty('disabled', true)
    fireEvent.change(abacName, { target: { value: 'abac-api' } })
    expect(list.queryByText('name taken')).toBeNull()
    expect(abacName.getAttribute('aria-invalid')).toBeNull()
    fireEvent.click(list.getByLabelText('.claude/agents/perf-review.md'))
    fireEvent.click(form.getByRole('button', { name: 'Add the 3 lenses' }))
    expect(onLens).toHaveBeenCalledWith('import', {
      sources: [
        { source: '.claude/agents/abac-review.md', name: 'abac-api' },
        { source: '.claude/agents/bugs-review.md', name: 'bugs' },
        { source: '.claude/agents/i18n-review.md', name: 'i18n-review' },
      ],
      from: '.claude/agents/*-review.md',
      scope: 'local',
    })
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Add a lens' })).toBeNull(),
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test('Check none disables the button; Check all checks every match, the one that is no reviewer too', async () => {
  stubMatches({ matches: MATCHES.matches.slice(2) })
  try {
    renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: '.claude/agents/*-review.md' },
    })
    await screen.findByRole('list', { name: 'Matches' })
    fireEvent.click(form.getByRole('button', { name: 'Check none' }))
    expect(form.getByRole('button', { name: 'Add the lenses' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.click(form.getByRole('button', { name: 'Check all' }))
    expect(form.getByRole('button', { name: 'Add the 3 lenses' })).toHaveProperty(
      'disabled',
      false,
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test('a glob that matches nothing says so, lists the folder it looked in, and runs nothing', async () => {
  stubMatches({
    matches: [],
    folder: {
      label: '.claude/agents/',
      files: ['api-review.md', 'perf-review.md'],
      count: 2,
    },
  })
  try {
    renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: '.claude/agents/*-reviewer.md' },
    })
    expect((await form.findByText(/No file matches/)).textContent).toBe(
      'No file matches .claude/agents/*-reviewer.md from the project’s root. Nothing will run.',
    )
    expect(form.getByText('perf-review.md')).toBeDefined()
    expect(form.getByRole('button', { name: 'Add the lenses' })).toHaveProperty(
      'disabled',
      true,
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

/** A card of a glob's batch, cleaning unless `more` says otherwise. */
const card = (id: string, name: string, more: Partial<CleaningEntry>): CleaningEntry => ({
  id,
  createdAt: `2026-11-18T00:00:0${id.at(-1)}Z`,
  name,
  scope: 'local',
  again: false,
  source: `.claude/agents/${name}.md`,
  from: '.claude/agents/*-review.md',
  state: 'cleaning',
  ...more,
})

test('a batch being added shows a bar of how many are cleaned; the ones at work fold behind Show the details, those to check or failed stay listed', () => {
  const { onLens } = renderLenses([
    { ...READY, from: '.claude/agents/*-review.md' },
    card('c-2', 'i18n-review', {}),
    card('c-3', 'security-review', { waiting: true }),
    card('c-4', 'perf-review', { state: 'failed', reason: 'no lens.md' }),
  ])
  expect(
    screen.getByText(
      '4 from .claude/agents/*-review.md · 1 to check, 1 cleaning, 1 waiting, 1 failed',
    ),
  ).toBeDefined()
  expect(
    screen
      .getByRole('progressbar', { name: 'Lenses cleaned' })
      .getAttribute('aria-valuenow'),
  ).toBe('2')
  expect(screen.getByText('2 of 4 cleaned')).toBeDefined()
  const folded = within(screen.getByRole('list', { name: 'Lenses being added' }))
  // Folded: the one to check and the failed one, nothing at work.
  expect(folded.getByText('money')).toBeDefined()
  expect(folded.getByText('perf-review')).toBeDefined()
  expect(folded.queryByText('security-review')).toBeNull()
  expect(folded.queryByRole('img', { name: 'being cleaned' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show the details' }))
  const adding = within(screen.getByRole('list', { name: 'Lenses being added' }))
  expect(adding.getByText('waits for a cleaning agent: 3 at a time')).toBeDefined()
  expect(adding.getAllByRole('img', { name: 'being cleaned' })).toHaveLength(1)
  const waiting = adding.getByText('security-review').closest('li')!
  fireEvent.click(within(waiting).getByRole('button', { name: 'Discard' }))
  expect(onLens).toHaveBeenLastCalledWith('discard', { id: 'c-3' })
})

test('the matches the server refused are said once the others are under way', async () => {
  stubMatches({ matches: MATCHES.matches.slice(2, 3) })
  try {
    const { onLens } = renderLenses()
    onLens.mockImplementation(() =>
      Promise.resolve({
        refused: [{ source: '.claude/agents/i18n-review.md', reason: 'no such file' }],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: '.claude/agents/i18n-*.md' },
    })
    await screen.findByRole('list', { name: 'Matches' })
    fireEvent.click(form.getByRole('button', { name: 'Add the lens' }))
    expect(await screen.findByText('One match was not added:')).toBeDefined()
    expect(screen.getByText(/: no such file/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
    expect(screen.queryByText('One match was not added:')).toBeNull()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('one lens being added shows its card, no bar', () => {
  renderLenses([card('c-2', 'i18n-review', { waiting: true })])
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.getByText('waits for a cleaning agent: 3 at a time')).toBeDefined()
})

test('a match whose file is a lens already, or being added, says so and cannot be checked, whatever its name', async () => {
  stubMatches({
    matches: [
      {
        source: '.claude/agents/abac-review.md',
        name: 'abac',
        already: [{ scope: 'local', name: 'abac' }],
      },
      {
        source: '.claude/agents/money-review.md',
        name: 'money-review',
        already: [{ scope: 'local', name: 'money', adding: true }],
      },
      { source: '.claude/agents/i18n-review.md', name: 'i18n-review' },
    ],
  })
  try {
    const { onLens } = renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: '.claude/agents/*-review.md' },
    })
    const list = within(await screen.findByRole('list', { name: 'Matches' }))
    expect(form.getByText('1 checked')).toBeDefined()
    expect(list.getByText('added already')).toBeDefined()
    expect(
      list.getByText("This file is this project's abac already: nothing to add."),
    ).toBeDefined()
    expect(list.getByText('being added')).toBeDefined()
    expect(
      list.getByText("This file is being added as this project's money: nothing to add."),
    ).toBeDefined()
    // Not a name problem: no red, and never checked, not even by Check all.
    expect(list.queryByText('name taken')).toBeNull()
    const abac = list.getByLabelText('.claude/agents/abac-review.md')
    expect(abac).toHaveProperty('disabled', true)
    expect(list.getByLabelText('.claude/agents/money-review.md')).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.click(form.getByRole('button', { name: 'Check all' }))
    expect(abac).toHaveProperty('checked', false)
    fireEvent.click(form.getByRole('button', { name: 'Add the lens' }))
    expect(onLens).toHaveBeenCalledWith('import', {
      sources: [{ source: '.claude/agents/i18n-review.md', name: 'i18n-review' }],
      from: '.claude/agents/*-review.md',
      scope: 'local',
    })
  } finally {
    vi.unstubAllGlobals()
  }
})

const PLUGIN_AGENTS = [
  'code-reviewer',
  'silent-failure-hunter',
  'pr-test-analyzer',
  'comment-analyzer',
  'type-design-analyzer',
].map((name) => ({
  source: `pr-review-toolkit:${name}`,
  name,
  kind: 'agent',
  ...(name === 'code-reviewer' && {
    already: [{ scope: 'global', name: 'code-reviewer' }],
  }),
}))

test("a plugin's command lists the agents it starts in place of a name; one that is a lens already is locked; the checked ones are added in a batch", async () => {
  const fetch = stubMatches({
    inside: {
      kind: 'command',
      label: 'pr-review-toolkit:review-pr',
      starts: PLUGIN_AGENTS,
    },
  })
  try {
    const { onLens } = renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: 'pr-review-toolkit:review-pr' },
    })
    const list = within(await screen.findByRole('list', { name: 'Its agents' }))
    expect(String(fetch.mock.calls.at(-1)?.at(0))).toBe(
      '/api/lens/inside?source=pr-review-toolkit%3Areview-pr',
    )
    expect(form.queryByLabelText('Name')).toBeNull()
    expect(form.getByText('review-pr is a command: it starts 5 agents')).toBeDefined()
    expect(form.getByText('4 checked')).toBeDefined()
    expect(list.getAllByText('plugin agent')).toHaveLength(5)
    const locked = list.getByLabelText('pr-review-toolkit:code-reviewer')
    expect(locked).toHaveProperty('checked', false)
    expect(locked).toHaveProperty('disabled', true)
    expect(list.getByText('added already')).toBeDefined()
    fireEvent.click(list.getByLabelText('pr-review-toolkit:type-design-analyzer'))
    fireEvent.click(form.getByRole('button', { name: 'Add the 3 lenses' }))
    expect(onLens).toHaveBeenCalledWith('import', {
      sources: [
        {
          source: 'pr-review-toolkit:silent-failure-hunter',
          name: 'silent-failure-hunter',
        },
        { source: 'pr-review-toolkit:pr-test-analyzer', name: 'pr-test-analyzer' },
        { source: 'pr-review-toolkit:comment-analyzer', name: 'comment-analyzer' },
      ],
      from: 'pr-review-toolkit:review-pr',
      scope: 'local',
    })
  } finally {
    vi.unstubAllGlobals()
  }
})

test('a command whose agents are written in it says none can become a lens, and adds nothing', async () => {
  stubMatches({
    inside: { kind: 'command', label: '.claude/commands/full-review.md', starts: [] },
  })
  try {
    renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: '.claude/commands/full-review.md' },
    })
    const said = await form.findByText(/No agent of its own in/)
    expect(said.textContent).toBe('No agent of its own in full-review.')
    expect(form.queryByLabelText('Name')).toBeNull()
    expect(form.getByRole('button', { name: 'Add the lenses' })).toHaveProperty(
      'disabled',
      true,
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test("a glob's command shows the agents it starts under it, each once; its checkbox checks or unchecks them all", async () => {
  stubMatches({
    matches: [
      { source: '.claude/agents/api-review.md', name: 'api-review', kind: 'agent' },
      { source: '.claude/agents/code-review.md', name: 'code-review', kind: 'agent' },
      {
        source: '.claude/commands/review-pr.md',
        name: 'review-pr',
        kind: 'command',
        starts: [
          { source: '.claude/agents/code-review.md', name: 'code-review', kind: 'agent' },
          { source: '.claude/agents/test-review.md', name: 'test-review', kind: 'agent' },
          {
            source: 'pr-review-toolkit:comment-analyzer',
            name: 'comment-analyzer',
            kind: 'agent',
          },
        ],
      },
    ],
  })
  try {
    const { onLens } = renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: '.claude/*/*review*.md' },
    })
    const kids = within(
      await screen.findByRole('list', { name: 'The agents review-pr starts' }),
    )
    expect(form.getByText('3 files match')).toBeDefined()
    expect(form.getByText('4 checked')).toBeDefined()
    // Matched and started: listed once, under the command.
    expect(form.getAllByLabelText('.claude/agents/code-review.md')).toHaveLength(1)
    expect(kids.getByLabelText('.claude/agents/code-review.md')).toBeDefined()
    expect(form.getByText('not a lens itself')).toBeDefined()
    expect(
      form.getByText(
        'It starts 3 agents: each one below can become a lens. code-review matches the glob too: listed once, here.',
      ),
    ).toBeDefined()
    const command = form.getByLabelText('.claude/commands/review-pr.md')
    expect(command).toHaveProperty('checked', true)
    expect(form.getByText('3 of its 3 agents checked')).toBeDefined()
    fireEvent.click(command)
    expect(form.getByText('0 of its 3 agents checked')).toBeDefined()
    fireEvent.click(kids.getByLabelText('.claude/agents/test-review.md'))
    expect(command).toHaveProperty('checked', false)
    expect(command).toHaveProperty('indeterminate', true)
    fireEvent.click(form.getByRole('button', { name: 'Add the 2 lenses' }))
    expect(onLens).toHaveBeenCalledWith('import', {
      sources: [
        { source: '.claude/agents/api-review.md', name: 'api-review' },
        { source: '.claude/agents/test-review.md', name: 'test-review' },
      ],
      from: '.claude/*/*review*.md',
      scope: 'local',
    })
  } finally {
    vi.unstubAllGlobals()
  }
})

test('past 40 checked, the batch waits and says how many to uncheck', async () => {
  stubMatches({
    matches: [
      {
        source: '.claude/commands/all.md',
        name: 'all',
        kind: 'command',
        starts: Array.from({ length: 12 }, (_, i) => ({
          source: `.claude/agents/c-${i}.md`,
          name: `c-${i}`,
          kind: 'agent',
        })),
      },
      ...Array.from({ length: 29 }, (_, i) => ({
        source: `.claude/agents/m-${i}.md`,
        name: `m-${i}`,
        kind: 'agent',
      })),
    ],
  })
  try {
    renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: '.claude/*/*.md' },
    })
    await screen.findByRole('list', { name: 'The agents all starts' })
    expect(form.getByText(/At most 40 lenses at a time: uncheck 1\./)).toBeDefined()
    expect(form.getByRole('button', { name: 'Add the 41 lenses' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.click(form.getByLabelText('.claude/agents/m-0.md'))
    expect(form.queryByText(/At most 40 lenses/)).toBeNull()
    expect(form.getByRole('button', { name: 'Add the 40 lenses' })).toHaveProperty(
      'disabled',
      false,
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test('a source that could not be read for its agents says so, and is imported as one reviewer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'down' }), { status: 500 })),
    ),
  )
  try {
    renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), {
      target: { value: 'team:review-pr' },
    })
    const said = await form.findByText(/could not be read for the agents it starts/)
    expect(said.textContent).toContain('Import cleans it as one reviewer')
    expect(form.getByRole('button', { name: 'Import and clean' })).toHaveProperty(
      'disabled',
      false,
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

const CATALOG = {
  plugins: [
    {
      name: 'dba',
      version: '1.2.0',
      folder: '~/.claude/plugins/dba/',
      enabled: false,
      items: [{ kind: 'agent', name: 'sql-review', source: 'dba:sql-review' }],
    },
    {
      name: 'workflow',
      version: '2.5.0',
      folder: '~/.claude/plugins/workflow/',
      enabled: true,
      items: [
        {
          kind: 'agent',
          name: 'code-reviewer-abac',
          source: 'workflow:code-reviewer-abac',
          already: [{ scope: 'local', name: 'abac' }],
        },
        {
          kind: 'agent',
          name: 'code-reviewer-api',
          source: 'workflow:code-reviewer-api',
        },
        { kind: 'command', name: 'review-mr', source: 'workflow:review-mr' },
      ],
    },
  ],
  project: {
    folder: '.claude/',
    items: [
      { kind: 'agent', name: 'money-review', source: '.claude/agents/money-review.md' },
    ],
  },
  user: { folder: '~/.claude/', items: [] },
  roots: [
    'this project (~/dev/people-app)',
    '~/.claude/',
    "the installed plugins' folders",
  ],
}

const DOCS = {
  root: 'project',
  path: 'docs',
  label: 'docs/',
  entries: [
    { name: 'checklists', kind: 'folder' },
    { name: 'private', kind: 'unreadable', reason: 'cannot be read: not opened' },
    { name: '.env', kind: 'hidden', reason: 'hidden: shown, never opened' },
    { name: 'shared', kind: 'link', reason: 'leaves this folder: not followed' },
    { name: 'review-checklist.md', kind: 'file', source: 'docs/review-checklist.md' },
  ],
}

const answer = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

/** The server as the picker asks it: the catalog, the folders, and nothing inside a source. */
function stubPicker() {
  const fetch = vi.fn((url: string) => {
    if (url === '/api/lens/catalog') return answer(200, CATALOG)
    if (url.startsWith('/api/lens/folder?go=')) {
      return url.includes('Documents')
        ? answer(409, {
            error:
              '~/Documents/checklists is not listed: it lies outside the folders Tranchant may list',
          })
        : answer(200, DOCS)
    }
    if (url.endsWith('path=docs%2Fchecklists'))
      return answer(200, {
        root: 'project',
        path: 'docs/checklists',
        label: 'docs/checklists/',
        entries: [
          { name: 'security.md', kind: 'file', source: 'docs/checklists/security.md' },
        ],
      })
    if (url.startsWith('/api/lens/folder'))
      return answer(200, { root: 'project', path: '', label: './', entries: [] })
    return answer(200, { inside: null, name: 'code-reviewer-api' })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

test("Browse lists the plugins' agents: one picked fills Source, which stays editable, and is imported", async () => {
  stubPicker()
  try {
    const { onLens } = renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.click(form.getByRole('button', { name: 'Browse…' }))
    const picker = within(screen.getByRole('region', { name: 'Pick a source' }))
    await picker.findByText('workflow')
    expect(picker.getByRole('tab', { name: 'Plugins 4' })).toBeDefined()
    // A plugin turned off: its items stay pickable, said so.
    expect(picker.getByText('turned off for this project')).toBeDefined()
    expect(picker.getByText('plugin off here: the lens would not build')).toBeDefined()
    expect(picker.getByText('already lens abac · this project')).toBeDefined()
    fireEvent.click(picker.getByRole('button', { name: /code-reviewer-api/ }))
    expect(screen.queryByRole('region', { name: 'Pick a source' })).toBeNull()
    const source = form.getByLabelText('Source')
    expect(source).toHaveProperty('value', 'workflow:code-reviewer-api')
    expect(
      form.getByText('Picked workflow:code-reviewer-api. The field stays yours to edit.'),
    ).toBeDefined()
    const add = form.getByRole('button', { name: 'Import and clean' })
    await waitFor(() => expect(add).toHaveProperty('disabled', false))
    fireEvent.click(add)
    // Only the source was given: the lens takes the skill's name, without the plugin.
    expect(form.getByLabelText('Name')).toHaveProperty('value', 'code-reviewer-api')
    expect(onLens).toHaveBeenCalledWith('import', {
      source: 'workflow:code-reviewer-api',
      scope: 'local',
      name: 'code-reviewer-api',
    })
  } finally {
    vi.unstubAllGlobals()
  }
})

test('an item already a lens stays pickable: the help says a second lens is made from it', async () => {
  stubPicker()
  try {
    renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.click(form.getByRole('button', { name: 'Browse…' }))
    const picker = within(screen.getByRole('region', { name: 'Pick a source' }))
    fireEvent.click(await picker.findByRole('button', { name: /code-reviewer-abac/ }))
    expect(
      form.getByText(
        'Picked workflow:code-reviewer-abac: it is already the source of lens abac · this project. Adding it again makes a second lens from it. The field stays yours to edit.',
      ),
    ).toBeDefined()
    // Typed over, it is the user's again.
    fireEvent.change(form.getByLabelText('Source'), { target: { value: 'workflow:x' } })
    expect(form.queryByText(/^Picked/)).toBeNull()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('a search filters every tab, each counting its matches; an empty one says where they are', async () => {
  stubPicker()
  try {
    renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    const picker = within(screen.getByRole('region', { name: 'Pick a source' }))
    await picker.findByText('workflow')
    fireEvent.change(picker.getByLabelText('Search by name'), {
      target: { value: 'money' },
    })
    expect(picker.getByRole('tab', { name: 'Plugins 0' })).toBeDefined()
    expect(picker.getByRole('tab', { name: 'This project 1' })).toBeDefined()
    expect(
      picker.getByText('Nothing named “money” here: 1 in This project.'),
    ).toBeDefined()
    fireEvent.click(picker.getByRole('tab', { name: 'This project 1' }))
    expect(picker.getByText('.claude/agents/')).toBeDefined()
    expect(picker.getByRole('button', { name: /money-review/ })).toBeDefined()
  } finally {
    vi.unstubAllGlobals()
  }
})

test('Files: hidden files, links out and unreadable folders are shown, never opened; a folder outside the roots is refused', async () => {
  const fetch = stubPicker()
  try {
    renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.click(form.getByRole('button', { name: 'Browse…' }))
    const picker = within(screen.getByRole('region', { name: 'Pick a source' }))
    fireEvent.click(picker.getByRole('tab', { name: 'Files' }))
    await picker.findByText('Nothing in this folder.')
    expect(String(fetch.mock.calls.at(-1)?.at(0))).toBe(
      '/api/lens/folder?root=project&path=',
    )
    const goTo = picker.getByLabelText('Go to a folder')
    fireEvent.change(goTo, { target: { value: 'docs' } })
    fireEvent.click(picker.getByRole('button', { name: 'Go' }))
    await picker.findByText('review-checklist.md')
    expect(picker.getByRole('button', { name: /\.env/ })).toHaveProperty('disabled', true)
    expect(picker.getByRole('button', { name: /shared/ })).toHaveProperty(
      'disabled',
      true,
    )
    expect(picker.getByRole('button', { name: /private\// })).toHaveProperty(
      'disabled',
      true,
    )
    expect(picker.getByText('leaves this folder: not followed')).toBeDefined()
    fireEvent.change(goTo, { target: { value: '~/Documents/checklists' } })
    fireEvent.keyDown(goTo, { key: 'Enter' })
    const refused = await picker.findByRole('alert')
    expect(refused.textContent).toContain(
      '~/Documents/checklists is not listed: it lies outside the folders Tranchant may list.',
    )
    expect(refused.textContent).toContain(
      "Tranchant may list this project (~/dev/people-app), ~/.claude/, the installed plugins' folders.",
    )
    // The folder open stays: its file is still there to pick.
    fireEvent.click(picker.getByRole('button', { name: /review-checklist\.md/ }))
    expect(form.getByLabelText('Source')).toHaveProperty(
      'value',
      'docs/review-checklist.md',
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test("Enter in the picker's search or Go to a folder never submits Add a lens; a folder opens, and the breadcrumb goes back", async () => {
  const fetch = stubPicker()
  try {
    const { onLens } = renderLenses()
    fireEvent.click(screen.getByRole('button', { name: 'Add a lens' }))
    const form = within(screen.getByRole('form', { name: 'Add a lens' }))
    fireEvent.change(form.getByLabelText('Source'), { target: { value: 'workflow:x' } })
    fireEvent.click(form.getByRole('button', { name: 'Browse…' }))
    const picker = within(screen.getByRole('region', { name: 'Pick a source' }))
    // fireEvent returns false when the default (the form's submit) was prevented.
    expect(
      fireEvent.keyDown(picker.getByLabelText('Search by name'), { key: 'Enter' }),
    ).toBe(false)
    fireEvent.click(picker.getByRole('tab', { name: 'Files' }))
    const goTo = picker.getByLabelText('Go to a folder')
    fireEvent.change(goTo, { target: { value: 'docs' } })
    expect(fireEvent.keyDown(goTo, { key: 'Enter' })).toBe(false)
    expect(onLens).not.toHaveBeenCalled()
    fireEvent.click(await picker.findByRole('button', { name: /checklists\// }))
    await picker.findByText('security.md')
    expect(String(fetch.mock.calls.at(-1)?.at(0))).toBe(
      '/api/lens/folder?root=project&path=docs%2Fchecklists',
    )
    const crumbs = within(picker.getByRole('navigation', { name: 'Folder' }))
    expect(crumbs.getByText('checklists').getAttribute('aria-current')).toBe('location')
    fireEvent.click(crumbs.getByRole('button', { name: 'docs' }))
    await waitFor(() =>
      expect(String(fetch.mock.calls.at(-1)?.at(0))).toBe(
        '/api/lens/folder?root=project&path=docs',
      ),
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test('each row names where its lens comes from: built-in, picked up from an agent or a skill, or custom', () => {
  renderLenses([], {}, undefined, MANY)
  const local = group('This project')
  expect(local.getByText('picked up · agent')).toBeDefined()
  expect(local.getByText('custom · checklist')).toBeDefined()
  expect(group('Global · every project').getByText('picked up · skill')).toBeDefined()
  expect(group("Built-in · the plugin's").getAllByText('built-in')).toHaveLength(4)
})

test('with no filter set, the bar counts every lens and offers no clearing', () => {
  renderLenses([], {}, undefined, MANY)
  const bar = filterBar()
  expect(total()).toBe('8 lenses')
  expect(bar.queryByRole('button', { name: 'Clear the filters' })).toBeNull()
  expect(bar.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(rowNames()).toHaveLength(8)
})

test('typing part of a name shows only the lenses whose name contains it; a group with none hides', () => {
  renderLenses([], {}, undefined, MANY)
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by name' }), {
    target: { value: 'CO' },
  })
  expect(rowNames()).toEqual(['code-style', 'correctness', 'conventions'])
  expect(screen.queryByRole('list', { name: 'This project' })).toBeNull()
  expect(total()).toBe('3 of 8 lenses')
  const heads = [...document.querySelectorAll('.tr-lns-group-head')].map(
    (head) => head.textContent,
  )
  expect(heads.some((head) => head.includes('This project'))).toBe(false)
  expect(heads.find((head) => head.includes('Global'))).toContain('1 of 2')
  expect(heads.find((head) => head.includes('Built-in'))).toContain('2 of 4')
})

test('built-in and a finding kind show only the built-in lenses filing under it; Clear the filters shows them all', () => {
  renderLenses([], {}, undefined, MANY)
  fireEvent.click(filterBar().getByRole('button', { name: 'Built-in' }))
  fireEvent.change(filterBar().getByRole('combobox', { name: 'Finding kind' }), {
    target: { value: 'Bugs' },
  })
  expect(rowNames()).toEqual(['correctness'])
  expect(
    filterBar().getByRole('button', { name: 'Built-in' }).getAttribute('aria-pressed'),
  ).toBe('true')
  expect(total()).toBe('1 of 8 lenses')
  fireEvent.click(filterBar().getByRole('button', { name: 'Clear the filters' }))
  expect(rowNames()).toHaveLength(8)
  expect(filterBar().getByRole<HTMLSelectElement>('combobox').value).toBe('')
})

test('a finding kind keeps the lenses that declare no topic: they file under any', () => {
  renderLenses([], {}, undefined, MANY)
  fireEvent.click(filterBar().getByRole('button', { name: 'Custom' }))
  fireEvent.change(filterBar().getByRole('combobox', { name: 'Finding kind' }), {
    target: { value: 'Tests' },
  })
  expect(rowNames()).toEqual(['checkout', 'anything'])
  fireEvent.click(filterBar().getByRole('button', { name: 'Picked up' }))
  expect(rowNames()).toEqual([])
})

test('no lens matches: the filters are named, and Clear the filters brings the groups back', () => {
  renderLenses([], {}, undefined, MANY)
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by name' }), {
    target: { value: 'money' },
  })
  fireEvent.click(filterBar().getByRole('button', { name: 'Built-in' }))
  fireEvent.change(filterBar().getByRole('combobox', { name: 'Finding kind' }), {
    target: { value: 'Tests' },
  })
  expect(rowNames()).toEqual([])
  expect(document.querySelectorAll('.tr-lns-group')).toHaveLength(0)
  const none = screen.getByText(/No lens matches/)
  expect(none.textContent).toContain('No lens matches name “money” · built-in · Tests.')
  fireEvent.click(within(none).getByRole('button', { name: 'Clear the filters' }))
  expect(screen.queryByText(/No lens matches/)).toBeNull()
  expect(rowNames()).toHaveLength(8)
})

test('the lens being edited stays shown while a filter would hide it, with what is typed in it', () => {
  renderLenses([], {}, undefined, MANY)
  fireEvent.click(
    within(screen.getByRole('list', { name: 'This project' }))
      .getAllByRole('button', { name: 'Edit' })
      .at(0)!,
  )
  const rules = screen.getByLabelText('Added instructions')
  fireEvent.change(rules, { target: { value: '- Cents only.' } })
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by name' }), {
    target: { value: 'docs' },
  })
  expect(rowNames()).toEqual(['money', 'docs'])
  // Shown, not counted: one lens matches.
  expect(total()).toBe('1 of 8 lenses')
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by name' }), {
    target: { value: 'zzz' },
  })
  expect(rowNames()).toEqual(['money'])
  expect(screen.getByText(/No lens matches/)).toBeDefined()
  expect(screen.getByLabelText<HTMLTextAreaElement>('Added instructions').value).toBe(
    '- Cents only.',
  )
})
