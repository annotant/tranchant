// The review's controls on the page: Pause, Resume, Stop the review and
// Reset the review, as lib/store.mjs and reset.mjs carry them out.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import {
  StoreRefusal,
  createStore,
  findingPath,
  readReviewAgents,
} from '../skills/tranchant/scripts/lib/store.mjs'
import { SCRIPTS, importReview, run, tempDir } from './helpers.mjs'

const RESET = path.join(SCRIPTS, 'reset.mjs')

/** @type {string} */
let stateDir

before(async (t) => {
  stateDir = await tempDir(t)
})

/**
 * A fixture review as `/tranchant review` runs it: `reviewing`, verified,
 * its lenses recorded, and its plan in the inbox.
 * @param {import('node:test').TestContext} t
 */
async function reviewRun(t) {
  const { dir, review } = await importReview(t, 'ours', stateDir, { verify: true })
  const file = path.join(dir, 'review.json')
  const envelope = JSON.parse(await readFile(file, 'utf8'))
  const lenses = ['bugs', 'tests'].map((name) => ({
    name,
    source: `tranchant:${name}`,
    hash: 'a'.repeat(64),
  }))
  await writeFile(file, JSON.stringify({ ...envelope, status: 'reviewing', lenses }))
  const inbox = path.join(stateDir, 'inbox')
  await mkdir(inbox, { recursive: true })
  const plan = path.join(inbox, `${review.id}.plan.json`)
  await writeFile(
    plan,
    JSON.stringify({
      recipe: { origin: 'plugin', file: '/plugin/agents/review/recipe.json' },
      lenses: [{ name: 'bugs', prompt: 'bugs.md', paths: ['**'] }],
    }),
  )
  return { dir, review, plan, store: createStore(dir) }
}

/** One step's line in a run file. */
const step = (/** @type {object} */ one) => `${JSON.stringify(one)}\n`

const refused = (/** @type {RegExp} */ pattern) => (/** @type {unknown} */ error) =>
  error instanceof StoreRefusal && pattern.test(error.message)

test('pause, pause now and resume: the review keeps running, its pause recorded', async (t) => {
  const { store } = await reviewRun(t)
  const paused = await store.pause()
  assert.equal(typeof paused.at, 'string')
  assert.equal(paused.now, undefined)
  // Pause now while it pauses keeps the pause's time.
  assert.deepEqual(await store.pause(true), { at: paused.at, now: true })
  assert.equal((await store.readReview()).status, 'reviewing')
  await store.resume()
  assert.equal((await store.readReview()).paused, undefined)
  await assert.rejects(store.resume(), refused(/not paused/))
})

test('stop: no resume, nothing lands; only a review that runs is stopped', async (t) => {
  const { store } = await reviewRun(t)
  await store.pause()
  await store.halt()
  const stopped = await store.readReview()
  assert.equal(typeof stopped.stopped?.at, 'string')
  assert.equal(stopped.paused, undefined)
  await assert.rejects(store.pause(), refused(/stopped/))
  await assert.rejects(store.resume(), refused(/stopped/))
  await assert.rejects(store.halt(), refused(/stopped/))
  await assert.rejects(
    store.addFinding({ ...stopped.findings[0], id: 'f-99' }),
    refused(/stopped/),
  )
  await assert.rejects(store.summarize({ summary: 'late' }), refused(/stopped/))
  // The hooks complete it once its agents ended; its findings stay to settle.
  await store.complete()
  assert.equal((await store.readReview()).findings.length, 5)
})

test('a review opened from a file, or complete, has no controls', async (t) => {
  const { dir } = await importReview(t, 'ours', stateDir)
  await assert.rejects(createStore(dir).pause(), refused(/only a \/tranchant review/))
  const { store } = await reviewRun(t)
  await store.complete()
  await assert.rejects(store.halt(), refused(/complete/))
  await assert.rejects(store.reset(), refused(/not stopped/))
})

test('reset.mjs: the findings go, those under way stay, and the plan waits to start', async (t) => {
  const { dir, plan, store } = await reviewRun(t)
  await store.decide('f-01', { action: 'fix' })
  await store.decide('f-02', { action: 'drop' })
  await mkdir(path.join(dir, 'reviewers'), { recursive: true })
  for (const name of ['rv-bugs', 'vf-f-03', 'sm-summary', 'ds-f-01', 'ds-f-04'])
    await writeFile(path.join(dir, 'reviewers', `${name}.jsonl`), '')
  await store.halt()
  await store.complete()

  const ran = await run(process.execPath, [RESET, '--review', dir], {
    env: { TRANCHANT_STATE_DIR: stateDir },
  })
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  assert.equal(ran.stdout.trim(), `RESET ${plan}`)
  assert.match(ran.stderr, /kept 1 finding\(s\) still under way: f-01/)

  const now = await store.readReview()
  assert.equal(now.status, 'preparing')
  assert.equal(now.stopped, undefined)
  assert.equal(now.summary, '')
  assert.deepEqual(
    now.findings.map((one) => one.id),
    ['f-01'],
  )
  assert.ok(!existsSync(findingPath(dir, 'f-02')))
  const { findings } = await store.readDecisions()
  assert.deepEqual(Object.keys(findings), ['f-01'])
  assert.equal(findings['f-01']?.state, 'queued')
  // The kept finding's discussing agent may still answer: its file stays.
  assert.deepEqual(
    (await readReviewAgents(dir)).map((one) => one.name),
    ['ds-f-01'],
  )
  assert.equal(JSON.parse(await readFile(plan, 'utf8')).wait, 'reset')
  // The lenses it ran, on again for Start.
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'choices.json'), 'utf8')), {
    lenses: { bugs: true, tests: true },
    remember: false,
  })

  const again = await run(process.execPath, [RESET, '--review', dir], {
    env: { TRANCHANT_STATE_DIR: stateDir },
  })
  assert.equal(again.code, 2)
  assert.match(again.stdout, /^RESET_REFUSED the review is not stopped/)
})

test('reset.mjs refuses a review with no plan, and removes nothing', async (t) => {
  const { dir, plan, store } = await reviewRun(t)
  await writeFile(plan, 'not json')
  await store.halt()
  const ran = await run(process.execPath, [RESET, '--review', dir], {
    env: { TRANCHANT_STATE_DIR: stateDir },
  })
  assert.equal(ran.code, 2)
  assert.match(ran.stdout, /^RESET_REFUSED no plan to start it again from/)
  assert.equal((await store.readReview()).findings.length, 5)
})

test('an agent interrupted then started again runs; its end before says interrupted', async (t) => {
  const { dir } = await reviewRun(t)
  const file = path.join(dir, 'reviewers', 'rv-bugs.jsonl')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(
    file,
    step({ at: 1, kind: 'start', label: 'Reviewing: bugs', state: 'done' }) +
      step({ at: 2, kind: 'end', label: 'Interrupted', state: 'failed' }),
  )
  const [interrupted] = await readReviewAgents(dir)
  assert.equal(interrupted?.running, false)
  assert.equal(interrupted?.outcome, 'interrupted')
  await writeFile(
    file,
    `${await readFile(file, 'utf8')}${step({ at: 3, kind: 'start', label: 'Reviewing: bugs', state: 'done' })}`,
  )
  const [again] = await readReviewAgents(dir)
  assert.equal(again?.running, true)
  assert.equal(again?.outcome, undefined)
})

test('reset keeps a finding being fixed or asking, with its run; a stale agent adds nothing after it', async (t) => {
  const { dir, store } = await reviewRun(t)
  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'a1' })
  await store.decide('f-02', { action: 'fix' })
  await store.claim('f-02', { agent: 'a2' })
  await store.ask('f-02', { text: 'Which one?' })
  const [late] = (await store.readReview()).findings
  await store.halt()
  const { kept } = await store.reset()
  assert.deepEqual(kept.toSorted(), ['f-01', 'f-02'])
  assert.equal((await store.readDecisions()).findings['f-01']?.state, 'working')
  assert.equal((await store.readDecisions()).findings['f-02']?.state, 'asking')
  assert.ok(existsSync(path.join(dir, 'decisions.json')))
  // An agent of the run before the reset lands nothing on it.
  await assert.rejects(
    store.addFinding({ ...late, id: 'f-99' }),
    refused(/waits to start/),
  )
  await assert.rejects(store.verify('f-01'), refused(/waits to start/))
  await assert.rejects(store.summarize({ summary: 'late' }), refused(/preparing/))
})

test('complete drops a pause that landed as the last agent ended', async (t) => {
  const { store } = await reviewRun(t)
  await store.pause()
  await store.complete()
  const done = await store.readReview()
  assert.equal(done.status, 'complete')
  assert.equal(done.paused, undefined)
})

test("hook.mjs drops a review agent's late steps on a reset review, never a discussing agent's", async (t) => {
  const { dir, review } = await reviewRun(t)
  const file = path.join(dir, 'review.json')
  await writeFile(
    file,
    JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), status: 'preparing' }),
  )
  const note = (/** @type {string} */ name) =>
    run(
      process.execPath,
      [
        path.join(SCRIPTS, 'hook.mjs'),
        'note',
        '--reviewer',
        name,
        '--review',
        dir,
        '--project',
        review.project,
        '--agent',
        'a1',
      ],
      { input: step({ at: 1, kind: 'note', label: 'late', state: 'done' }) },
    )
  assert.equal((await note('rv-bugs')).code, 0)
  assert.ok(!existsSync(path.join(dir, 'reviewers', 'rv-bugs.jsonl')))
  assert.equal((await note('ds-f-01')).code, 0)
  assert.ok(existsSync(path.join(dir, 'reviewers', 'ds-f-01.jsonl')))
})
