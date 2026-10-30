import { expect, test } from 'vitest'
import { activityOf, runningStep } from '../src/activity'
import type { Step } from '../src/domain'

const step = (fields: Partial<Step>): Step => ({
  at: 1,
  kind: 'read',
  label: 'src/a.ts',
  state: 'done',
  ...fields,
})

test('a step is worded by its kind and state', () => {
  expect(activityOf(step({ state: 'running' }))).toBe('Reading src/a.ts')
  expect(activityOf(step({}))).toBe('Read src/a.ts')
  expect(activityOf(step({ kind: 'edit', state: 'running' }))).toBe('Editing src/a.ts')
  expect(activityOf(step({ kind: 'bash', label: 'pnpm test', state: 'running' }))).toBe(
    'Running pnpm test',
  )
  expect(activityOf(step({ kind: 'bash', label: 'pnpm test', state: 'failed' }))).toBe(
    'Running pnpm test failed',
  )
  expect(activityOf(step({ kind: 'search', label: 'tenantId' }))).toBe(
    'Searched tenantId',
  )
  expect(activityOf(step({ kind: 'mcp', label: 'jira', state: 'running' }))).toBe(
    'Using jira',
  )
})

test('the start names the model, and a note stands as written', () => {
  expect(
    activityOf(step({ kind: 'start', label: 'Started', model: 'claude-opus-5-5' })),
  ).toBe('Started on opus')
  expect(activityOf(step({ kind: 'start', label: 'Started', state: 'running' }))).toBe(
    'Starting',
  )
  expect(activityOf(step({ kind: 'note', label: 'Early return added.' }))).toBe(
    'Early return added.',
  )
})

test('the spinner sits on the latest running step', () => {
  const steps = [step({ at: 1 }), step({ at: 2, state: 'running' }), step({ at: 3 })]
  expect(runningStep(steps)?.at).toBe(2)
  expect(runningStep([step({ at: 1 })])).toBeUndefined()
})
