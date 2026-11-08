import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { SettingsChange } from '../src/api'
import App from '../src/App'
import type { StoredSettings } from '../src/settings'
import { SettingsView } from '../src/SettingsView'
import { fakeEvents, fakeServer, LENSES, payload, settingsPayload } from './fixture'

const TITLE = 'Classification overview page'

/**
 * The Settings view on its own; `saved` holds each file a change would
 * write, applied to the file the view was given.
 */
function renderSettings(
  settings = settingsPayload(),
  { offline = false, error }: { offline?: boolean; error?: string } = {},
) {
  const saved: StoredSettings[] = []
  const onSave = vi.fn((change: SettingsChange) => {
    saved.push(change(settings.settings))
  })
  const onDismiss = vi.fn()
  fakeServer(payload())
  render(
    <SettingsView
      settings={settings}
      offline={offline}
      error={error}
      onDismiss={onDismiss}
      onSave={onSave}
    />,
  )
  return { onSave, onDismiss, saved }
}

/** The row of the setting labelled `label`. */
const row = (label: string) => {
  const found = screen.getByText(label).closest<HTMLElement>('.tr-setting')
  if (!found) throw new Error(`no row ${label}`)
  return within(found)
}

/** The page on `#settings`, opened from the review. */
async function renderPage(settings = settingsPayload()) {
  const server = fakeServer(payload())
  server.answerSettings(settings)
  location.hash = '#settings'
  render(<App />)
  await screen.findByRole('heading', { name: TITLE })
  await screen.findByRole('heading', { name: 'Settings' })
  return server
}

test('the four groups list every option, its value, its default and its help', () => {
  renderSettings(
    settingsPayload({ theme: 'dark', maxFixAgents: 5, fixModel: 'claude-haiku-5-5' }),
  )
  for (const group of ['Display', 'Agents', 'Review', 'Posting'])
    expect(screen.getByRole('heading', { name: group })).toBeDefined()
  expect(row('Theme').getByRole('button', { name: 'Dark', pressed: true })).toBeDefined()
  expect(row('Theme').getByText('Default: System')).toBeDefined()
  expect(
    row('Default view').getByRole('button', { name: 'Diff', pressed: true }),
  ).toBeDefined()
  expect(row('Fix agents at a time').getByRole('spinbutton')).toHaveProperty('value', '5')
  expect(row('Fix agents at a time').getByText('Default: 3')).toBeDefined()
  // A text with suggestions (a datalist) is a combobox to assistive tech.
  expect(row('Model for fixes').getByRole('combobox')).toHaveProperty(
    'value',
    'claude-haiku-5-5',
  )
  expect(row('Model for reviewers').getByRole('combobox')).toHaveProperty(
    'placeholder',
    "The session's model",
  )
  expect(row('Lenses').getAllByRole('checkbox')).toHaveLength(LENSES.length)
  expect(row('Lenses').getByText('Default: all 8')).toBeDefined()
  expect(
    row('Posts with').getByRole('button', { name: 'From the remote', pressed: true }),
  ).toBeDefined()
  expect(
    screen.getByText(/A change applies to the next agent, review or post/),
  ).toBeDefined()
  expect(
    screen.getByText(
      'Kept in /Users/me/.config/tranchant/settings.json, for every review on this machine.',
    ),
  ).toBeDefined()
})

test('a choice, a number and a text are saved as the whole file, a default unsetting its key', () => {
  const { onSave, saved } = renderSettings(settingsPayload({ theme: 'dark' }))
  fireEvent.click(row('Default view').getByRole('button', { name: 'List' }))
  expect(saved.at(-1)).toEqual({ theme: 'dark', view: 'list' })
  // Back to the default: the key leaves the file, not set to its default.
  fireEvent.click(row('Theme').getByRole('button', { name: 'System' }))
  expect(saved.at(-1)).toEqual({})
  const cap = row('Review agents at a time').getByRole('spinbutton')
  fireEvent.change(cap, { target: { value: '6' } })
  expect(onSave).toHaveBeenCalledTimes(2)
  fireEvent.blur(cap)
  expect(saved.at(-1)).toEqual({ theme: 'dark', maxReviewAgents: 6 })
  const model = row('Model for verifiers').getByRole('combobox')
  fireEvent.change(model, { target: { value: ' claude-haiku-5-5 ' } })
  fireEvent.keyDown(model, { key: 'Enter' })
  expect(saved.at(-1)).toEqual({ theme: 'dark', verifyModel: 'claude-haiku-5-5' })
  // Out of range: not sent (the server would refuse it), and the value in force shows again.
  fireEvent.change(cap, { target: { value: '12' } })
  fireEvent.blur(cap)
  expect(onSave).toHaveBeenCalledTimes(4)
  expect(cap).toHaveProperty('value', '3')
  // Escape gives up what was typed.
  fireEvent.change(model, { target: { value: 'opus' } })
  fireEvent.keyDown(model, { key: 'Escape' })
  expect(model).toHaveProperty('value', '')
  expect(onSave).toHaveBeenCalledTimes(4)
})

test('a lens unchecked is turned off; checked again, it is back', () => {
  const { saved } = renderSettings(settingsPayload({ disabledLenses: ['security'] }))
  const boxes = row('Lenses').getAllByRole('checkbox')
  expect(
    boxes.map((box) => (box instanceof HTMLInputElement ? box.checked : null)),
  ).toEqual(LENSES.map((lens) => lens !== 'security'))
  fireEvent.click(row('Lenses').getByRole('checkbox', { name: 'tests' }))
  expect(saved.at(-1)).toEqual({ disabledLenses: ['security', 'tests'] })
  // Every lens back on: the key leaves the file.
  fireEvent.click(row('Lenses').getByRole('checkbox', { name: 'security' }))
  expect(saved.at(-1)).toEqual({})
})

test('Reset shows on a changed option only, and resets it; Reset everything sends an empty file', () => {
  const { saved } = renderSettings(
    settingsPayload({ theme: 'dark', recipe: '/me/recipe.json' }),
  )
  expect(row('Default view').queryByRole('button', { name: /^Reset/ })).toBeNull()
  fireEvent.click(
    row('Default recipe').getByRole('button', {
      name: 'Reset Default recipe to its default',
    }),
  )
  expect(saved.at(-1)).toEqual({ theme: 'dark' })
  fireEvent.click(screen.getByRole('button', { name: 'Reset everything to defaults' }))
  expect(saved.at(-1)).toEqual({})
})

test('Reset everything keeps what an environment variable locks: the page cannot show it', () => {
  const { saved } = renderSettings(
    settingsPayload(
      { theme: 'dark', fixModel: 'claude-opus-5-5' },
      { locked: { fixModel: 'TRANCHANT_MODEL' } },
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Reset everything to defaults' }))
  expect(saved.at(-1)).toEqual({ fixModel: 'claude-opus-5-5' })
})

test('nothing changed: Reset everything is disabled', () => {
  renderSettings(settingsPayload())
  expect(
    screen.getByRole('button', { name: 'Reset everything to defaults' }),
  ).toHaveProperty('disabled', true)
})

test('an option an environment variable sets is read-only, the variable named', () => {
  renderSettings(
    settingsPayload(
      { fixModel: 'claude-haiku-5-5' },
      {
        locked: {
          fixModel: 'TRANCHANT_MODEL',
          reviewModel: 'TRANCHANT_MODEL',
          verifyModel: 'TRANCHANT_MODEL',
        },
      },
    ),
  )
  for (const label of ['Model for fixes', 'Model for reviewers', 'Model for verifiers']) {
    const field = row(label).getByRole('combobox')
    expect(field).toHaveProperty('disabled', true)
    // The environment's value shows, not the file's.
    expect(field).toHaveProperty('value', 'claude-sonnet-5-5')
    expect(
      row(label).getByText(
        'Set by TRANCHANT_MODEL in this session: unset it to change it here.',
      ),
    ).toBeDefined()
    expect(row(label).queryByText(/^Default:/)).toBeNull()
  }
  // Locked keys count for nothing: Reset everything has nothing to reset.
  expect(
    screen.getByRole('button', { name: 'Reset everything to defaults' }),
  ).toHaveProperty('disabled', true)
  expect(row('Fix agents at a time').getByRole('spinbutton')).toHaveProperty(
    'disabled',
    false,
  )
})

test('offline, the values show read-only and the page says why', () => {
  renderSettings(settingsPayload({ theme: 'dark', maxFixAgents: 5 }), { offline: true })
  expect(
    row('Theme').getByRole('button', { name: 'Dark', pressed: true }),
  ).toHaveProperty('disabled', true)
  expect(row('Fix agents at a time').getByRole('spinbutton')).toHaveProperty(
    'disabled',
    true,
  )
  expect(row('Fix agents at a time').getByRole('spinbutton')).toHaveProperty('value', '5')
  expect(
    row('Fix agents at a time').getByRole('button', { name: /^Reset/ }),
  ).toHaveProperty('disabled', true)
  expect(
    screen.getByRole('button', { name: 'Reset everything to defaults' }),
  ).toHaveProperty('disabled', true)
  expect(screen.getByText(/Read-only while the server is unreachable/)).toBeDefined()
})

test('a settings file the server cannot read is said, and nothing is written', () => {
  const { onSave } = renderSettings(
    settingsPayload(
      {},
      {
        problem:
          '/Users/me/.config/tranchant/settings.json: theme: one of light, dark, system',
      },
    ),
  )
  expect(screen.getByRole('alert').textContent).toContain(
    'theme: one of light, dark, system',
  )
  expect(row('Theme').getByRole('button', { name: 'Dark' })).toHaveProperty(
    'disabled',
    true,
  )
  expect(onSave).not.toHaveBeenCalled()
})

test('a refusal shows until dismissed; an unreadable recipe shows in place of its lenses', () => {
  const { onDismiss } = renderSettings(
    settingsPayload(
      { recipe: '/me/none.json' },
      { lenses: [], recipeProblem: '/me/none.json: no such file' },
    ),
    { error: 'maxFixAgents: a whole number from 1 to 8' },
  )
  expect(screen.getByRole('status').textContent).toContain(
    'The change was not kept: maxFixAgents: a whole number from 1 to 8',
  )
  fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
  expect(onDismiss).toHaveBeenCalled()
  expect(
    row('Lenses').getByText(/The recipe cannot be read: \/me\/none\.json/),
  ).toBeDefined()
  expect(row('Lenses').queryByRole('checkbox')).toBeNull()
})

test('Posts as names the account of the CLI in force', async () => {
  const server = fakeServer(payload())
  server.answerAccount({ username: 'reviewer-bot', tool: 'gh' })
  render(
    <SettingsView
      settings={settingsPayload({ postWith: 'gh' })}
      offline={false}
      onDismiss={() => undefined}
      onSave={() => undefined}
    />,
  )
  expect(await row('Posts as').findByText('reviewer-bot · gh')).toBeDefined()
})

test('on the page, a change is PUT, the answer shows, and a refusal is said', async () => {
  const server = await renderPage()
  fireEvent.click(row('Theme').getByRole('button', { name: 'Dark' }))
  await waitFor(() => expect(server.settingsPut()).toEqual({ theme: 'dark' }))
  await waitFor(() =>
    expect(
      row('Theme').getByRole('button', { name: 'Dark', pressed: true }),
    ).toBeDefined(),
  )
  // The theme applies at once, to this page too.
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  server.refuseSettings('recipe: an absolute path to a recipe file, or ~/…')
  const recipe = row('Default recipe').getByRole('textbox')
  fireEvent.change(recipe, { target: { value: 'relative.json' } })
  fireEvent.blur(recipe)
  expect((await screen.findByRole('status')).textContent).toContain(
    'The change was not kept: recipe: an absolute path to a recipe file, or ~/…',
  )
  // The file stays as it was: the theme still dark, the recipe unset.
  expect(row('Theme').getByRole('button', { name: 'Dark', pressed: true })).toBeDefined()
  location.hash = ''
  document.documentElement.removeAttribute('data-theme')
})

test('a server without the settings route says so; the review still opens, its theme switch for the visit', async () => {
  const server = fakeServer(payload())
  server.answerSettings(undefined)
  location.hash = '#settings'
  render(<App />)
  await screen.findByRole('heading', { name: 'Settings' })
  expect(
    await screen.findByText(
      /This server answers no settings: it runs an older Tranchant/,
    ),
  ).toBeDefined()
  location.hash = ''
  await screen.findByRole('navigation', { name: 'Findings' })
  const header = document.querySelector<HTMLElement>('.tr-header')
  const toggle = within(header!).getByRole('button', {
    name: /^Switch to (dark|light) theme$/,
  })
  const other = /dark/.test(toggle.getAttribute('aria-label') ?? '') ? 'dark' : 'light'
  fireEvent.click(toggle)
  expect(document.documentElement.getAttribute('data-theme')).toBe(other)
  expect(server.settingsPut()).toBeUndefined()
  document.documentElement.removeAttribute('data-theme')
})

test('the settings changed under the page: the stream says so, and the page reads them again', async () => {
  const events = fakeEvents()
  const server = await renderPage()
  expect(
    row('Theme').getByRole('button', { name: 'System', pressed: true }),
  ).toBeDefined()
  server.answerSettings(settingsPayload({ theme: 'dark', maxFixAgents: 5 }))
  events.send('settings')
  await waitFor(() =>
    expect(
      row('Theme').getByRole('button', { name: 'Dark', pressed: true }),
    ).toBeDefined(),
  )
  expect(row('Fix agents at a time').getByRole('spinbutton')).toHaveProperty('value', '5')
  // The theme follows, as if picked here.
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  location.hash = ''
  document.documentElement.removeAttribute('data-theme')
})

test('a refused theme switch on the review is said there too', async () => {
  const server = fakeServer(payload())
  server.refuseSettings(
    '/Users/me/.config/tranchant/settings.json: theme: one of light, dark, system',
  )
  render(<App />)
  await screen.findByRole('navigation', { name: 'Findings' })
  const header = document.querySelector<HTMLElement>('.tr-header')
  fireEvent.click(
    within(header!).getByRole('button', { name: /^Switch to (dark|light) theme$/ }),
  )
  expect((await screen.findByRole('status')).textContent).toContain(
    'The change was not kept: /Users/me/.config/tranchant/settings.json: theme: one of light, dark, system',
  )
  fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))
  expect(screen.queryByRole('status')).toBeNull()
})
