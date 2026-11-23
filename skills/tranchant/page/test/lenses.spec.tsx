import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from '../src/App'
import type { LensesProgress } from '../src/domain'
import { LensesCenter, LensesControl } from '../src/LensesStep'
import { lensHref } from '../src/LensesView'
import { fakeServer, payload } from './fixture'

const building: LensesProgress = {
  state: 'resolving',
  lenses: [
    { name: 'abac', source: 'workflow:code-reviewer-abac', state: 'resolving' },
    { name: 'bugs', source: 'tranchant:bugs', state: 'ready', change: 'unchanged' },
    {
      name: 'money',
      source: './money.md',
      state: 'ready',
      change: 'updated',
    },
  ],
}

const rows = () =>
  within(screen.getByRole('list', { name: 'The lenses, one per row' })).getAllByRole(
    'listitem',
  )

const built: LensesProgress = {
  state: 'ready',
  lenses: building.lenses.map((row) => ({ ...row, state: 'ready' as const })),
}

test('while the lenses build, the center shows a spinner and how many are ready; the rows open and close', () => {
  render(<LensesCenter step={building} review={{ status: 'preparing' }} />)
  const center = screen.getByRole('main', { name: 'Lenses' })
  expect(center.textContent).toContain('Building the lenses')
  expect(screen.getByRole('status').textContent).toBe('2 of 3 lenses ready')
  const bar = screen.getByRole('progressbar', { name: 'Lenses ready' })
  expect(bar.getAttribute('aria-valuenow')).toBe('2')
  expect(bar.getAttribute('aria-valuemax')).toBe('3')
  expect(screen.queryByRole('list', { name: 'The lenses, one per row' })).toBeNull()
  const toggle = screen.getByRole('button', { name: 'Show details' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  const [abac, bugs, money] = rows()
  expect(within(abac!).getByLabelText('resolving')).toBeTruthy()
  expect(abac!.textContent).toContain('workflow:code-reviewer-abac')
  expect(bugs!.textContent).toContain('ready · unchanged')
  expect(money!.textContent).toContain('ready · updated since the last review')
  fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
  expect(screen.queryByRole('list', { name: 'The lenses, one per row' })).toBeNull()
})

test('before the first row is written, the center says only that the lenses build', () => {
  render(<LensesCenter step={undefined} review={{ status: 'preparing' }} />)
  expect(screen.getByRole('main', { name: 'Lenses' }).textContent).toBe(
    'Building the lenses',
  )
  expect(screen.queryByRole('button', { name: 'Show details' })).toBeNull()
})

test('once built, the lenses are a chip that opens their rows, and closes', () => {
  render(<LensesControl step={built} />)
  const chip = screen.getByRole('button', { name: '3 lenses' })
  expect(chip.className).not.toContain('tr-chip--lenses-warn')
  expect(screen.queryByRole('region', { name: 'Lenses' })).toBeNull()
  fireEvent.click(chip)
  const pop = screen.getByRole('region', { name: 'Lenses' })
  expect(pop.textContent).toContain('3 built, 1 updated since the last review')
  expect(rows()).toHaveLength(3)
  expect(
    within(pop).getByRole('link', { name: 'Manage the lenses' }).getAttribute('href'),
  ).toBe('#settings/lenses')
  fireEvent.click(within(pop).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('region', { name: 'Lenses' })).toBeNull()
  fireEvent.click(chip)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('region', { name: 'Lenses' })).toBeNull()
  fireEvent.click(chip)
  // A press inside keeps it open: its links stay clickable.
  fireEvent.mouseDown(screen.getByRole('link', { name: 'Manage the lenses' }))
  expect(screen.getByRole('region', { name: 'Lenses' })).toBeTruthy()
  fireEvent.mouseDown(document.body)
  expect(screen.queryByRole('region', { name: 'Lenses' })).toBeNull()
})

test('a refused review names each lens that failed, its reason, its fix and where to fix it', () => {
  render(
    <LensesCenter
      step={{
        state: 'refused',
        lenses: [
          {
            name: 'abac',
            source: 'workflow:code-reviewer-abac',
            state: 'failed',
            reason: 'the plugin workflow is not installed',
            fix: 'install the plugin workflow (/plugin)',
          },
          {
            name: 'hooks',
            source: '~/.claude/agents/hooks.md',
            state: 'failed',
            scope: 'global',
            reason: 'its source is gone',
          },
          { name: 'bugs', source: 'tranchant:bugs', state: 'ready' },
        ],
      }}
      review={{
        status: 'refused',
        refusal: {
          lens: 'abac',
          source: 'workflow:code-reviewer-abac',
          reason: 'the plugin workflow is not installed',
          fix: 'install the plugin workflow (/plugin)',
        },
      }}
    />,
  )
  expect(screen.getByRole('heading').textContent).toBe(
    'Review refused: 2 lenses cannot be built, no reviewer started',
  )
  expect(screen.getByRole('alert').textContent).toBe(
    'abac, hooks cannot be built: each row says why. Fix them, or turn them off, in Settings › Lenses, then run /tranchant review again.',
  )
  const [abac, hooks, bugs] = rows()
  expect(within(abac!).getByLabelText('failed')).toBeTruthy()
  expect(abac!.textContent).toContain('the plugin workflow is not installed')
  expect(abac!.textContent).toContain('install the plugin workflow (/plugin)')
  expect(
    within(abac!)
      .getByRole('link', { name: 'Fix abac in Settings › Lenses' })
      .getAttribute('href'),
  ).toBe('#settings/lenses/recipe%3Aabac')
  expect(
    within(hooks!)
      .getByRole('link', { name: 'Fix hooks in Settings › Lenses' })
      .getAttribute('href'),
  ).toBe('#settings/lenses/global%3Ahooks')
  expect(within(bugs!).queryByRole('link')).toBeNull()
})

test('a refusal with no row to carry it is said in its own words', () => {
  render(
    <LensesCenter
      step={undefined}
      review={{
        status: 'refused',
        refusal: {
          lens: 'Lenses step',
          source: '-',
          reason: 'the server did not start',
          fix: 'run /tranchant review again',
        },
      }}
    />,
  )
  expect(screen.getByRole('heading').textContent).toBe(
    'Review refused: the lenses were not built, no reviewer started',
  )
  expect(screen.getByRole('alert').textContent).toBe(
    'Lens Lenses step (-): the server did not start. To fix it: run /tranchant review again.',
  )
})

test('a refused review that says nothing still says what to do', () => {
  render(<LensesCenter step={undefined} review={{ status: 'refused' }} />)
  expect(screen.getByRole('alert').textContent).toBe(
    'The review does not say why: run /tranchant review again.',
  )
})

test('a lens that failed while the others build is not counted ready', () => {
  render(
    <LensesCenter
      step={{
        state: 'resolving',
        lenses: [
          { name: 'abac', source: 'nobody:abac', state: 'failed', reason: 'gone' },
          { name: 'bugs', source: 'tranchant:bugs', state: 'ready' },
          { name: 'docs', source: 'tranchant:docs', state: 'resolving' },
        ],
      }}
      review={{ status: 'preparing' }}
    />,
  )
  expect(screen.getByRole('status').textContent).toBe('1 of 3 lenses ready')
})

test('a refused review takes the page: its lenses in the center, no reviewer, no chip', async () => {
  fakeServer({
    ...payload({
      review: {
        status: 'refused',
        findings: [],
        refusal: { lens: 'abac', source: 'nobody:abac', reason: 'not installed' },
      },
    }),
    reviewers: [{ name: 'rv-bugs', running: true, steps: [] }],
    lenses: {
      state: 'refused',
      lenses: [
        { name: 'abac', source: 'nobody:abac', state: 'failed', reason: 'not installed' },
      ],
    },
  })
  render(<App />)
  const center = await screen.findByRole('main', { name: 'Lenses' })
  expect(center.textContent).toContain('Review refused: a lens cannot be built')
  expect(screen.queryByRole('region', { name: 'Review agents' })).toBeNull()
  expect(screen.queryByRole('navigation')).toBeNull()
  expect(screen.queryByRole('button', { name: /lens/ })).toBeNull()
  expect(screen.getByText('review refused')).toBeTruthy()
})

test('while the lenses build the page is their center; built, the review with their chip in the header', async () => {
  fakeServer({
    ...payload({ review: { status: 'preparing', findings: [] } }),
    lenses: building,
  })
  const { unmount } = render(<App />)
  expect(await screen.findByRole('main', { name: 'Lenses' })).toBeTruthy()
  expect(screen.getByText('building the lenses')).toBeTruthy()
  expect(screen.queryByRole('navigation')).toBeNull()
  expect(screen.queryByRole('button', { name: '3 lenses' })).toBeNull()
  unmount()
  fakeServer({ ...payload({ review: { status: 'reviewing' } }), lenses: built })
  render(<App />)
  const chip = await screen.findByRole('button', { name: '3 lenses' })
  expect(chip.closest('header')).toBeTruthy()
  expect(screen.queryByRole('main', { name: 'Lenses' })).toBeNull()
  expect(screen.getByRole('navigation')).toBeTruthy()
})

test('a lens whose source changed is cleaned again in the center, then says so in the chip', () => {
  const { unmount } = render(
    <LensesCenter
      step={{
        state: 'resolving',
        lenses: [
          {
            name: 'abac',
            source: 'workflow:code-reviewer-abac',
            state: 'resolving',
            scope: 'local',
            cleaning: 'running',
          },
          { name: 'bugs', source: 'tranchant:bugs', state: 'resolving' },
        ],
      }}
      review={{ status: 'preparing' }}
    />,
  )
  expect(screen.getByRole('main', { name: 'Lenses' }).textContent).toContain(
    'abac is cleaned again first, its source changed: the reviewers wait for it. This review runs the new version.',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
  expect(rows()[0]?.textContent).toContain('workflow:code-reviewer-abac · this project')
  expect(rows()[0]?.textContent).toContain('its source changed · cleaning again')
  unmount()
  render(
    <LensesControl
      step={{
        state: 'ready',
        lenses: [
          {
            name: 'abac',
            source: 'workflow:code-reviewer-abac',
            state: 'ready',
            cleaning: 'failed',
            reason: 'the agent wrote no lens.md',
          },
          { name: 'money', source: './money.md', state: 'ready', cleaning: 'again' },
        ],
      }}
    />,
  )
  // A failed cleaning turns the chip amber and opens nothing by itself.
  const chip = screen.getByRole('button', { name: '2 lenses · 1 warning' })
  expect(chip.className).toContain('tr-chip--lenses-warn')
  expect(screen.queryByRole('region', { name: 'Lenses' })).toBeNull()
  fireEvent.click(chip)
  const pop = screen.getByRole('region', { name: 'Lenses' })
  expect(pop.textContent).toContain(', 1 cleaned again')
  expect(pop.textContent).toContain(
    'abac could not be cleaned again: the last version runs',
  )
  expect(rows()[0]?.textContent).toContain('the agent wrote no lens.md')
  expect(rows()[1]?.textContent).toContain('ready · cleaned again: its source changed')
})

test('a link to a lens names it as Settings › Lenses keys it', () => {
  expect(lensHref({ name: 'a b', scope: 'local' })).toBe('#settings/lenses/local%3Aa%20b')
})
