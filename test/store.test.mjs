import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { AGENT_ENDED_REASON } from '../skills/tranchant/scripts/lib/format.mjs'
import {
  StoreRefusal,
  createStore,
  historyPath,
  progressPath,
} from '../skills/tranchant/scripts/lib/store.mjs'
import { importReview, tempDir } from './helpers.mjs'

/** @type {string} */
let stateDir

before(async (t) => {
  stateDir = await tempDir(t)
})

/**
 * Writes steps as the hooks do, one JSON line each.
 * @param {string} dir
 * @param {string} id
 * @param {...object} steps
 */
async function appendProgress(dir, id, ...steps) {
  await mkdir(path.dirname(progressPath(dir, id)), { recursive: true })
  await appendFile(
    progressPath(dir, id),
    steps.map((step) => `${JSON.stringify(step)}\n`).join(''),
  )
}

/**
 * @param {import('node:test').TestContext} t
 * @param {'theirs' | 'ours'} [name]
 * @param {Record<string, unknown>} [overrides]
 */
async function setUp(t, name = 'theirs', overrides = {}) {
  const { dir, review } = await importReview(t, name, stateDir, overrides)
  return { dir, review, store: createStore(dir) }
}

/** The states the finding went through, oldest first. */
const statesOf = (entry) => entry.events.map((event) => event.state)

const edit = (label, state = 'done') => ({ at: 1, kind: 'edit', label, state })

test('a fix queues an open finding, with the reviewer’s context', async (t) => {
  const { dir, store } = await setUp(t)
  const entry = await store.decide('f-01', {
    action: 'fix',
    context: ' keep the early return ',
  })
  assert.equal(entry.state, 'queued')
  assert.deepEqual(entry.decision, {
    action: 'fix',
    context: 'keep the early return',
    at: entry.events[0].at,
  })
  assert.deepEqual(
    entry.events.map((e) => [e.state, e.by]),
    [['queued', 'reviewer']],
  )
  const file = JSON.parse(await readFile(path.join(dir, 'decisions.json'), 'utf8'))
  assert.equal(file.version, 1)
  assert.equal(file.findings['f-01'].state, 'queued')
  // Nothing decided on the others: absent, they are open.
  assert.deepEqual(Object.keys(file.findings), ['f-01'])
})

test('claim then done: the run records the agent, the model, the summary and the changed files', async (t) => {
  const { dir, store } = await setUp(t)
  await store.decide('f-01', { action: 'fix' })
  const claimed = await store.claim('f-01', { agent: 'a1', model: 'claude-opus-5-5' })
  assert.equal(claimed.entry.state, 'working')
  assert.equal(claimed.finding.id, 'f-01')
  assert.deepEqual(claimed.run, {
    id: 'r1',
    agent: 'a1',
    model: 'claude-opus-5-5',
    startedAt: claimed.entry.events.at(-1)?.at,
  })
  assert.deepEqual(claimed.entry.events.at(-1), {
    at: claimed.run.startedAt,
    state: 'working',
    by: 'agent',
    run: 'r1',
    agent: 'a1',
  })
  await appendProgress(
    dir,
    'f-01',
    { at: 1, kind: 'start', label: 'Started', state: 'done', model: 'claude-opus-5-5' },
    edit('src/people/usePeople.ts'),
    { at: 3, kind: 'bash', label: 'vitest', state: 'failed', detail: 'red' },
    edit('src/people/useFiles.ts', 'failed'),
    edit('src/people/usePeople.ts'),
  )
  assert.deepEqual(Object.keys(await store.runs()), ['f-01'])
  const done = await store.done('f-01', ' Returned early while tenantId is undefined. ')
  assert.equal(done.state, 'fixed')
  assert.deepEqual(statesOf(done), ['queued', 'working', 'fixed'])
  const [run] = done.runs
  assert.equal(run.outcome, 'fixed')
  assert.equal(run.summary, 'Returned early while tenantId is undefined.')
  assert.deepEqual(run.changed, ['src/people/usePeople.ts'])
  assert.ok(run.endedAt)
  // The run's steps moved to the history, tagged with the run.
  assert.equal(existsSync(progressPath(dir, 'f-01')), false)
  const history = (await readFile(historyPath(dir, 'f-01'), 'utf8')).trim().split('\n')
  assert.equal(history.length, 5)
  assert.ok(history.every((line) => JSON.parse(line).run === 'r1'))
  assert.deepEqual(await store.runs(), {})
  // A fixed finding stays fixed.
  await assert.rejects(
    store.decide('f-01', { action: 'fix' }),
    (error) =>
      error instanceof StoreRefusal &&
      error.message === 'fix refused: finding f-01 is fixed already',
  )
  await assert.rejects(store.decide('f-01', { action: 'post' }), /post refused/)
})

const OPTIONS = [
  { label: 'Grid', description: 'Cards in a grid' },
  { label: 'List' },
  { label: 'Table' },
]

test('ask then answer: the question waits on the reviewer, the answer queues a new run', async (t) => {
  const { store } = await setUp(t)
  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'a1' })
  const asked = await store.ask('f-01', { text: ' Which layout? ', options: OPTIONS })
  assert.equal(asked.state, 'asking')
  assert.deepEqual(asked.question, {
    text: 'Which layout?',
    options: OPTIONS,
    at: asked.events.at(-1)?.at,
  })
  assert.equal(asked.runs[0].outcome, 'asking')
  assert.ok(asked.runs[0].endedAt)
  // Neither a fix nor another question: the reviewer answers.
  await assert.rejects(
    store.decide('f-01', { action: 'fix' }),
    /fix refused: finding f-01 is waiting on your answer/,
  )
  await assert.rejects(store.ask('f-01', { text: 'Again?' }), /ask refused/)
  await assert.rejects(store.answer('f-01', {}), /answer refused: it is empty/)
  await assert.rejects(
    store.answer('f-02', { text: 'x' }),
    /answer refused: finding f-02 is open/,
  )
  // One option only, among those offered and in their order, then the reviewer's own words.
  const answered = await store.answer('f-01', {
    choices: ['List', 'Grid', 'Carousel'],
    text: 'With bigger gaps',
  })
  assert.equal(answered.state, 'queued')
  assert.deepEqual(answered.answer, {
    text: 'With bigger gaps',
    choices: ['Grid'],
    at: answered.events.at(-1)?.at,
  })
  assert.equal(answered.events.at(-1)?.by, 'reviewer')
  const again = await store.claim('f-01', { agent: 'a2' })
  assert.equal(again.run.id, 'r2')
  assert.deepEqual(again.entry.answer?.choices, ['Grid'])
  // The next question forgets the answer.
  const asked2 = await store.ask('f-01', {
    text: 'Sure?',
    options: OPTIONS,
    multiple: true,
  })
  assert.equal(asked2.answer, undefined)
  assert.equal(asked2.question?.multiple, true)
  const several = await store.answer('f-01', { choices: ['Table', 'Grid'] })
  assert.deepEqual(several.answer?.choices, ['Grid', 'Table'])
  assert.equal(several.answer?.text, '')
})

test('stop: from queued, and from working with what the run changed', async (t) => {
  const { dir, store } = await setUp(t)
  await store.decide('f-01', { action: 'fix' })
  const stopped = await store.stop('f-01')
  assert.equal(stopped.state, 'stopped')
  assert.deepEqual(stopped.cancellation, {
    at: stopped.events.at(-1)?.at,
    changed: [],
    steps: 0,
  })
  assert.deepEqual(stopped.runs, [])
  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'a1' })
  await appendProgress(
    dir,
    'f-01',
    { at: 1, kind: 'start', label: 'Started', state: 'done' },
    { at: 2, kind: 'note', label: 'Looking' },
    edit('src/people/usePeople.ts'),
    {
      at: 4,
      kind: 'write',
      label: 'src/people/__tests__/usePeople.test.tsx',
      state: 'running',
    },
  )
  const cut = await store.stop('f-01')
  assert.equal(cut.state, 'stopped')
  assert.deepEqual(cut.cancellation, {
    at: cut.events.at(-1)?.at,
    changed: ['src/people/usePeople.ts', 'src/people/__tests__/usePeople.test.tsx'],
    steps: 3,
    run: 'r1',
  })
  assert.equal(cut.runs[0].outcome, 'stopped')
  assert.equal(existsSync(progressPath(dir, 'f-01')), false)
  assert.ok(existsSync(historyPath(dir, 'f-01')))
  await assert.rejects(store.stop('f-01'), /stop refused: finding f-01 is stopped/)
  await assert.rejects(store.stop('f-02'), /stop refused: finding f-02 is open/)
  // Sent again: the next agent reads the cancellation.
  const resent = await store.decide('f-01', { action: 'fix' })
  assert.equal(resent.state, 'queued')
  assert.equal(resent.cancellation?.run, 'r1')
})

test('post: needs theirs and the MR’s diffRefs, and keeps the reviewer’s edit', async (t) => {
  const ours = await setUp(t, 'ours')
  await assert.rejects(
    ours.store.decide('f-01', { action: 'post' }),
    /post refused: the review is ours, there is no MR to post on/,
  )
  const theirs = await setUp(t, 'theirs')
  const { mr } = theirs.review
  const unpositioned = await setUp(t, 'theirs', {
    id: '0d2c1b8e-3a4f-4b5c-9d6e-7f8a9b0c1d2e',
    mr: { project: mr.project, iid: mr.iid, url: mr.url, author: mr.author },
  })
  await assert.rejects(
    unpositioned.store.decide('f-01', { action: 'post' }),
    /post refused: the review has no mr.diffRefs/,
  )
  const queued = await theirs.store.decide('f-01', {
    action: 'post',
    comment: ' Edited words ',
  })
  assert.equal(queued.state, 'queued')
  assert.equal(queued.comment, 'Edited words')
  assert.deepEqual(queued.decision, { action: 'post', at: queued.events[0].at })
  await assert.rejects(
    theirs.store.claim('f-01'),
    /claim refused: finding f-01 is queued for a post/,
  )
  const posted = await theirs.store.posted('f-01', {
    discussionId: '6a1f',
    url: `${mr.url}#note_4242`,
  })
  assert.equal(posted.state, 'posted')
  assert.deepEqual(posted.posted, {
    discussionId: '6a1f',
    url: `${mr.url}#note_4242`,
    at: posted.events.at(-1)?.at,
  })
  assert.equal(posted.events.at(-1)?.by, 'server')
  await assert.rejects(
    theirs.store.decide('f-01', { action: 'post' }),
    /post refused: finding f-01 is posted already/,
  )
  await assert.rejects(
    theirs.store.posted('f-01', { discussionId: 'x', url: 'y' }),
    /posted refused/,
  )
  await assert.rejects(
    theirs.store.decide('f-01', { action: 'drop' }),
    /drop refused: finding f-01 is posted already/,
  )
  // Dropped while queued, then posted anew without an edit: the finding's own comment goes.
  await theirs.store.decide('f-02', { action: 'post', comment: 'Edited' })
  const dropped = await theirs.store.decide('f-02', {
    action: 'drop',
    reason: 'Posted by hand',
  })
  assert.equal(dropped.state, 'dropped')
  assert.equal(dropped.reason, 'Posted by hand')
  const again = await theirs.store.decide('f-02', { action: 'post' })
  assert.equal(again.comment, undefined)
  assert.equal(again.reason, undefined)
})

test('drop and skip from the undecided states only: never while working, fixed or posted', async (t) => {
  const { store } = await setUp(t)
  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'a1' })
  await assert.rejects(
    store.decide('f-01', { action: 'drop' }),
    /drop refused: finding f-01 is being worked on/,
  )
  await assert.rejects(store.decide('f-01', { action: 'skip' }), /skip refused/)
  await store.done('f-01', 'Done.')
  await assert.rejects(
    store.decide('f-01', { action: 'drop' }),
    /drop refused: finding f-01 is fixed already/,
  )
  const skipped = await store.decide('f-02', { action: 'skip' })
  assert.equal(skipped.state, 'skipped')
  assert.equal(skipped.reason, undefined)
  const dropped = await store.decide('f-02', {
    action: 'drop',
    reason: 'Reverted by hand',
  })
  assert.equal(dropped.state, 'dropped')
  assert.equal(dropped.reason, 'Reverted by hand')
  assert.equal((await store.decide('f-02', { action: 'fix' })).state, 'queued')
  assert.equal((await store.decide('f-03', { action: 'drop' })).reason, undefined)
})

test('fail and abandon: a failure ends the run with its reason', async (t) => {
  const { store } = await setUp(t)
  const failed = await store
    .decide('f-02', { action: 'post' })
    .then(() => store.fail('f-02', ' glab: 400 Bad Request: line not in diff '))
  assert.equal(failed.state, 'failed')
  assert.equal(failed.reason, 'glab: 400 Bad Request: line not in diff')
  assert.equal(failed.events.at(-1)?.by, 'server')
  assert.equal((await store.decide('f-02', { action: 'fix' })).reason, undefined)

  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'a1' })
  // Another agent's end leaves a run it did not claim.
  assert.equal(await store.abandon('f-01', 'a2'), undefined)
  const abandoned = await store.abandon('f-01', 'a1')
  assert.equal(abandoned?.state, 'failed')
  assert.equal(abandoned?.reason, AGENT_ENDED_REASON)
  assert.equal(abandoned?.runs[0].outcome, 'failed')
  assert.equal(abandoned?.events.at(-1)?.by, 'agent')
  assert.equal(await store.abandon('f-01', 'a1'), undefined)
  await assert.rejects(
    store.fail('f-01', 'again'),
    /fail refused: finding f-01 is failed/,
  )
  assert.equal((await store.decide('f-01', { action: 'fix' })).state, 'queued')
})

test('claim: only a queued finding; the same agent keeps its run', async (t) => {
  const { store } = await setUp(t)
  await assert.rejects(store.claim('f-01'), /claim refused: finding f-01 is open/)
  await store.decide('f-01', { action: 'fix' })
  const first = await store.claim('f-01', { agent: 'a1' })
  const same = await store.claim('f-01', { agent: 'a1' })
  assert.equal(same.run.id, first.run.id)
  assert.equal(same.entry.runs.length, 1)
  await assert.rejects(
    store.claim('f-01', { agent: 'a2' }),
    /claim refused: finding f-01 is being worked on/,
  )
  await assert.rejects(store.done('f-02', 'x'), /done refused: finding f-02 is open/)
  await assert.rejects(store.claim('f-99'), /no finding f-99 in the review/)
})

test('a decisions file of another version is refused, and left untouched', async (t) => {
  const { dir, store } = await setUp(t)
  const file = path.join(dir, 'decisions.json')
  await writeFile(file, '{"version":9,"findings":{}}')
  await assert.rejects(
    store.decide('f-01', { action: 'fix' }),
    /unknown decisions format \(version 9\)/,
  )
  await assert.rejects(store.readAll(), StoreRefusal)
  assert.equal(await readFile(file, 'utf8'), '{"version":9,"findings":{}}')
})
