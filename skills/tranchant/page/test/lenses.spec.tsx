import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from '../src/App'
import type { LensesProgress } from '../src/domain'
import { LensesStep } from '../src/LensesStep'
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

test('while the lenses build, each row says resolving, or ready and whether it changed', () => {
  render(<LensesStep step={building} review={{ status: 'preparing' }} />)
  const step = screen.getByRole('region', { name: 'Lenses' })
  expect(step.textContent).toContain('Building the lenses')
  expect(step.textContent).toContain('2 of 3 lenses done')
  const [abac, bugs, money] = rows()
  expect(within(abac!).getByLabelText('resolving')).toBeTruthy()
  expect(abac!.textContent).toContain('workflow:code-reviewer-abac')
  expect(bugs!.textContent).toContain('ready · unchanged')
  expect(money!.textContent).toContain('ready · updated since the last review')
})

test('once the review runs, the step is one line, its rows on demand', () => {
  render(
    <LensesStep
      step={{
        state: 'ready',
        lenses: building.lenses.map((row) => ({ ...row, state: 'ready' as const })),
      }}
      review={{ status: 'reviewing' }}
    />,
  )
  const step = screen.getByRole('region', { name: 'Lenses' })
  expect(step.textContent).toContain('3 lenses built, 1 updated since the last review')
  expect(screen.queryByRole('list', { name: 'The lenses, one per row' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Where each lens comes from' }))
  expect(rows()).toHaveLength(3)
})

test('a lens that failed shows its reason and its fix', () => {
  render(
    <LensesStep
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
  const [abac] = rows()
  expect(within(abac!).getByLabelText('failed')).toBeTruthy()
  expect(abac!.textContent).toContain('the plugin workflow is not installed')
  expect(abac!.textContent).toContain('install the plugin workflow (/plugin)')
  expect(screen.getByRole('alert').textContent).toBe(
    'Lens abac (workflow:code-reviewer-abac): the plugin workflow is not installed. To fix it: install the plugin workflow (/plugin).',
  )
})

test('a refused review shows the Lenses step and no reviewer', async () => {
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
  const step = await screen.findByRole('region', { name: 'Lenses' })
  expect(step.textContent).toContain('Review refused')
  expect(screen.queryByRole('region', { name: 'Review agents' })).toBeNull()
  expect(screen.getByText(/No reviewer ran: a lens could not be built/)).toBeTruthy()
  expect(screen.getByText('review refused')).toBeTruthy()
})
