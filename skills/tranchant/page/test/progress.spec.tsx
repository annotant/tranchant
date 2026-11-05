import { expect, test } from 'vitest'
import type { ReviewAgent, Step } from '../src/domain'
import { lensOf, OTHER, progressOf } from '../src/progress'

const step = (fields: Partial<Step>): Step => ({
  at: 1,
  kind: 'read',
  label: 'src/a.ts',
  state: 'done',
  ...fields,
})
const end = (state: 'done' | 'failed') =>
  step({ kind: 'end', label: state === 'done' ? 'Ended' : 'Stopped', state })

const running = (name: string, steps: Step[] = []): ReviewAgent => ({
  name,
  running: true,
  steps,
})
const ended = (name: string, steps: Step[] = [end('done')]): ReviewAgent => ({
  name,
  running: false,
  outcome: 'done',
  steps,
})
const stopped = (name: string, steps: Step[]): ReviewAgent => ({
  name,
  running: false,
  outcome: 'failed',
  steps,
})

test('a finding id bears the longest lens it starts with', () => {
  expect(lensOf('correctness-2', ['correctness', 'types'])).toBe('correctness')
  expect(lensOf('a-b-1', ['a', 'a-b'])).toBe('a-b')
  expect(lensOf('f-01', ['bugs'])).toBeUndefined()
  // A lens's name alone is no finding of it.
  expect(lensOf('types', ['types'])).toBeUndefined()
})

test('lenses count their findings once done, verifiers group by lens', () => {
  const progress = progressOf(
    [
      ended('rv-correctness'),
      ended('rv-types'),
      running('rv-tests', [step({ label: 'src/a.test.ts', state: 'running' })]),
      ended('vf-correctness-1'),
      running('vf-correctness-2', [
        step({ kind: 'search', label: 'usePeople(', state: 'running' }),
      ]),
      ended('vf-correctness-3'),
      running('vf-f-01'),
    ],
    ['correctness-1', 'correctness-2', 'correctness-3', 'f-01'],
  )
  expect(progress.lenses).toEqual([
    { lens: 'correctness', state: 'done', findings: 3 },
    { lens: 'types', state: 'done', findings: 0 },
    { lens: 'tests', state: 'running', findings: 0 },
  ])
  expect(progress.verifying).toEqual([
    { lens: 'correctness', state: 'running', done: 2, total: 3 },
    { lens: OTHER, state: 'running', done: 0, total: 1 },
  ])
  expect(progress.now).toEqual([
    { name: 'rv-tests', who: 'tests', step: 'Reading src/a.test.ts' },
    {
      name: 'vf-correctness-2',
      who: 'verifying correctness-2',
      step: 'Searching usePeople(',
    },
    { name: 'vf-f-01', who: 'verifying f-01', step: 'Starting' },
  ])
  expect([progress.done, progress.total]).toEqual([4, 7])
  expect(progress.stopped).toEqual([])
})

test('an ended agent shows its outcome, never its last step', () => {
  const progress = progressOf(
    [
      ended('rv-bugs', [step({ kind: 'tool', label: 'SubagentHandback' }), end('done')]),
      ended('rv-types', [step({ kind: 'tool', label: 'SubagentHandback' }), end('done')]),
      stopped('rv-conventions', [
        step({ label: 'AGENTS.md', state: 'failed' }),
        end('failed'),
      ]),
      stopped('rv-tests', [step({}), end('failed')]),
      ended('vf-bugs-1'),
    ],
    ['bugs-1', 'bugs-2'],
  )
  expect(progress.all.map((agent) => [agent.role, agent.state, agent.text])).toEqual([
    ['Reviewer · bugs', 'done', '2 findings'],
    ['Reviewer · types', 'done', 'no finding'],
    ['Reviewer · conventions', 'failed', 'stopped: Reading AGENTS.md failed'],
    ['Reviewer · tests', 'failed', 'stopped'],
    ['Verifier · bugs-1', 'done', 'done'],
  ])
  expect(progress.lenses.map((one) => one.state)).toEqual([
    'done',
    'done',
    'failed',
    'failed',
  ])
  expect(progress.stopped).toEqual(['conventions', 'tests'])
  expect(progress.now).toEqual([])
})

test('one finding is worded in the singular', () => {
  const progress = progressOf([ended('rv-bugs')], ['bugs-1'])
  expect(progress.all[0]!.text).toBe('1 finding')
})

test('a stopped verifier marks its group failed once none of it runs', () => {
  const progress = progressOf(
    [ended('rv-bugs'), ended('vf-bugs-1'), stopped('vf-bugs-2', [end('failed')])],
    ['bugs-1', 'bugs-2'],
  )
  expect(progress.verifying).toEqual([
    { lens: 'bugs', state: 'failed', done: 2, total: 2 },
  ])
})
