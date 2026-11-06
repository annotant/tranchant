import { expect, test } from 'vitest'
import type { ReviewAgent, Step } from '../src/domain'
import { gistOf, lensOf, OTHER, progressOf } from '../src/progress'

const step = (fields: Partial<Step>): Step => ({
  at: 1,
  kind: 'read',
  label: 'src/a.ts',
  state: 'done',
  ...fields,
})
/** Findings by id, titled after it. */
const found = (...ids: string[]) => ids.map((id) => ({ id, title: `Title of ${id}` }))

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
    found('correctness-1', 'correctness-2', 'correctness-3', 'f-01'),
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
    found('bugs-1', 'bugs-2'),
  )
  expect(progress.reports.map((one) => [one.lens, one.state, one.verdict])).toEqual([
    ['bugs', 'done', '2 findings'],
    ['types', 'done', 'no finding'],
    ['conventions', 'failed', 'stopped: Reading AGENTS.md failed'],
    ['tests', 'failed', 'stopped'],
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
  const progress = progressOf([ended('rv-bugs')], found('bugs-1'))
  expect(progress.reports[0]!.verdict).toBe('1 finding')
})

test('a stopped verifier marks its group failed once none of it runs', () => {
  const progress = progressOf(
    [ended('rv-bugs'), ended('vf-bugs-1'), stopped('vf-bugs-2', [end('failed')])],
    found('bugs-1', 'bugs-2'),
  )
  expect(progress.verifying).toEqual([
    { lens: 'bugs', state: 'failed', done: 2, total: 2 },
  ])
})

test('a stopped verifier keeps its group failed whatever the order, until one runs', () => {
  const ids = found('bugs-1', 'bugs-2')
  const stop = stopped('vf-bugs-1', [end('failed')])
  expect(
    progressOf([ended('rv-bugs'), stop, ended('vf-bugs-2')], ids).verifying[0]!.state,
  ).toBe('failed')
  expect(
    progressOf([ended('rv-bugs'), stop, running('vf-bugs-2')], ids).verifying[0]!.state,
  ).toBe('running')
})

test('a lens reports its last words, from the project, with what it looked at', () => {
  const root = '/work/app'
  const note = (label: string) => step({ kind: 'note', label })
  const progress = progressOf(
    [
      ended('rv-bugs', [
        step({ kind: 'start', label: 'Reviewing: bugs' }),
        step({ label: `${root}/src/a.ts` }),
        step({ label: `${root}/src/a.ts` }),
        step({ kind: 'bash', label: 'Show the diff' }),
        step({ kind: 'search', label: 'tenantId' }),
        note('Thinking.'),
        note(
          `I added 1 finding.\n- **bugs-1:** \`${root}/src/a.ts\` throws on undefined.`,
        ),
        end('done'),
      ]),
      ended('vf-bugs-1', [note('AMENDED: the mark moved.'), end('done')]),
      running('vf-bugs-2'),
    ],
    [...found('bugs-1', 'bugs-2'), { id: 'bugs-3', title: 'Third', verified: true }],
    `${root}/`,
  )
  const [report] = progress.reports
  expect(report).toEqual({
    lens: 'bugs',
    state: 'done',
    verdict: '3 findings',
    report: 'I added 1 finding.\n- **bugs-1:** `src/a.ts` throws on undefined.',
    gist: 'bugs-1: src/a.ts throws on undefined.',
    looked: '1 file · 1 command · 1 search',
    steps: expect.any(Array),
    findings: [
      {
        id: 'bugs-1',
        title: 'Title of bugs-1',
        check: 'amended',
        verifier: 'AMENDED: the mark moved.',
      },
      { id: 'bugs-2', title: 'Title of bugs-2', check: 'verifying' },
      { id: 'bugs-3', title: 'Third', check: 'verified' },
    ],
  })
  expect(report!.steps.map((one) => one.text)).toEqual([
    'Read src/a.ts',
    'Read src/a.ts',
    'Ran Show the diff',
    'Searched tenantId',
  ])
})

test('a lens that said nothing has no report, and its gist is empty', () => {
  const [report] = progressOf([running('rv-types')], []).reports
  expect(report!.report).toBeUndefined()
  expect([report!.gist, report!.looked, report!.verdict]).toEqual(['', '', 'Starting'])
})

test('a gist skips the sentence that only repeats the verdict', () => {
  expect(gistOf('No finding. I read `App.tsx`.')).toBe('I read App.tsx.')
  expect(gistOf('No finding.')).toBe('')
  expect(gistOf('I added 2 findings. - **a-1:** two plurals.')).toBe('a-1: two plurals.')
  expect(gistOf('VERIFIED The finding holds.')).toBe('')
  expect(gistOf('Everything renders as text. No finding.')).toBe(
    'Everything renders as text.',
  )
})
