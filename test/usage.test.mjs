// What a review's agents spend: format.mjs's checked reader and sums, and
// lib/usage.mjs's usage.json and the sums /api/review answers.
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { readUsage, sumUsage, tokensOf } from '../skills/tranchant/scripts/lib/format.mjs'
import { createStore } from '../skills/tranchant/scripts/lib/store.mjs'
import {
  addReset,
  cleanerName,
  addUnclaimed,
  dropLive,
  readUsageFile,
  removedUsage,
  reviewUsage,
  setLive,
  usagePath,
} from '../skills/tranchant/scripts/lib/usage.mjs'
import { importReview, tempDir } from './helpers.mjs'

/** @type {string} */
let stateDir

before(async (t) => {
  stateDir = await tempDir(t)
})

/** One model's figure: `n` tokens of each count. */
const figure = (/** @type {number} */ n, model = 'claude-sonnet-5-5', more = {}) => ({
  models: [{ model, input: n, output: n, cacheRead: n, cacheWrite: n }],
  ...more,
})

test('readUsage keeps a sound figure, and reads anything else as not reported', () => {
  const sound = figure(10, 'claude-opus-5-5', { usd: 0.5, hasUnknownPrice: true })
  assert.deepEqual(readUsage(sound), sound)
  assert.deepEqual(readUsage({ ...figure(1), partial: true }), {
    ...figure(1),
    partial: true,
  })
  // Only the counts it knows, and none else.
  assert.deepEqual(
    readUsage({ models: [{ ...figure(2).models[0], extra: 'x' }], other: 1 }),
    figure(2),
  )
  const unsound = [
    undefined,
    null,
    'tokens',
    [],
    {},
    { models: [] },
    { models: 'x' },
    { models: [{ ...figure(1).models[0], input: -1 }] },
    { models: [{ ...figure(1).models[0], output: 1.5 }] },
    { models: [{ ...figure(1).models[0], cacheRead: Number.NaN }] },
    { models: [{ ...figure(1).models[0], cacheWrite: Infinity }] },
    { models: [{ ...figure(1).models[0], input: '3' }] },
    { models: [{ ...figure(1).models[0], model: 'claude opus' }] },
    { models: [{ ...figure(1).models[0], model: 'x'.repeat(81) }] },
    { models: [{ ...figure(1).models[0], model: undefined }] },
    { models: Array.from({ length: 9 }, (_, i) => figure(1, `m-${i}`).models[0]) },
  ]
  for (const one of unsound) assert.equal(readUsage(one), undefined, JSON.stringify(one))
  // A price that is not one is left out; the counts stand.
  assert.deepEqual(readUsage({ ...figure(1), usd: -2 }), figure(1))
  assert.deepEqual(readUsage({ ...figure(1), usd: 'free', partial: 'yes' }), figure(1))
})

test('sumUsage sums by model, partial when any is, priced only when all are', () => {
  assert.equal(sumUsage([]), undefined)
  assert.equal(sumUsage([undefined]), undefined)
  const sum = sumUsage([
    figure(1, 'a', { usd: 1 }),
    figure(2, 'b', { usd: 2 }),
    figure(3, 'a', { usd: 3 }),
  ])
  assert.deepEqual(sum, {
    models: [
      { model: 'a', input: 4, output: 4, cacheRead: 4, cacheWrite: 4 },
      { model: 'b', input: 2, output: 2, cacheRead: 2, cacheWrite: 2 },
    ],
    usd: 6,
  })
  assert.equal(tokensOf(sum), 24)
  const mixed = sumUsage([figure(1, 'a', { usd: 1 }), figure(1, 'a', { partial: true })])
  assert.equal(mixed?.usd, undefined)
  assert.equal(mixed?.partial, true)
})

/**
 * A `/tranchant review` with f-01 found by the lens `bugs`.
 * @param {import('node:test').TestContext} t
 */
async function reviewed(t) {
  const { dir } = await importReview(t, 'ours', stateDir, { verify: true })
  const file = path.join(dir, 'findings', 'f-01.json')
  await writeFile(
    file,
    JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), lens: 'bugs' }),
  )
  await mkdir(path.join(dir, 'reviewers'), { recursive: true })
  return { dir, store: createStore(dir) }
}

/** Writes a review agent's run file, a step per line. */
const steps = (
  /** @type {string} */ dir,
  /** @type {string} */ name,
  /** @type {object[]} */ all,
) =>
  writeFile(
    path.join(dir, 'reviewers', `${name}.jsonl`),
    all.map((one) => `${JSON.stringify(one)}\n`).join(''),
  )

const SINCE = 1_000_000

test("reviewUsage sums the review's agents by kind, lens and finding, live ones as running", async (t) => {
  const { dir, store } = await reviewed(t)
  // Paused now, then again: each agent's end counts.
  await steps(dir, 'rv-bugs', [
    { at: SINCE, kind: 'start', model: 'm', agent: 'r1' },
    {
      at: SINCE,
      kind: 'end',
      label: 'Interrupted',
      state: 'failed',
      agent: 'r1',
      usage: figure(10),
    },
    { at: SINCE, kind: 'start', model: 'm', agent: 'r2' },
    {
      at: SINCE,
      kind: 'end',
      label: 'Ended',
      state: 'done',
      agent: 'r2',
      usage: figure(5),
    },
  ])
  // Its lens from the hooks' start only, never a Bash claim's.
  await steps(dir, 'vf-f-01', [
    { at: SINCE, kind: 'start', model: 'm', lens: 'bugs', agent: 'v1' },
    { at: SINCE, kind: 'start', id: 't1', lens: 'tests', label: 'Started', agent: 'v1' },
    { at: SINCE, kind: 'end', state: 'done', agent: 'v1', usage: figure(2) },
  ])
  // Ended with no figure: not reported.
  await steps(dir, 'ds-f-01', [
    { at: SINCE, kind: 'start', model: 'm', agent: 'd1' },
    { at: SINCE, kind: 'end', state: 'done', agent: 'd1' },
  ])
  // At work: its figure so far.
  await steps(dir, 'sm-summary', [{ at: SINCE, kind: 'start', model: 'm', agent: 's1' }])
  await setLive(dir, 'sm-summary', 's1', figure(1))
  // A fix that ran, and one whose agent works before its claim.
  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'x1' })
  await store.recordUsage('f-01', 'x1', figure(100, 'claude-opus-5-5', { usd: 1 }))
  await setLive(dir, 'fix:f-02', 'x2', figure(3))
  await addUnclaimed(dir, 'f-03', 'x3', figure(4))

  const { review, decisions } = await store.readAll()
  const usage = await reviewUsage(dir, {
    review,
    decisions: decisions.findings,
    since: SINCE,
  })
  assert.equal(usage.running, true)
  assert.deepEqual(usage.notReported, ['ds-f-01'])
  assert.deepEqual(usage.partial, [])
  // 4 counts each: 15 + 2 + 1 + 100 + 3 + 4, and the discussion not reported.
  assert.equal(usage.total?.tokens, 4 * 125)
  assert.equal(usage.total?.partial, true)
  assert.deepEqual(
    usage.kinds.map((one) => [one.kind, one.agents, one.usage?.tokens ?? null]),
    [
      ['summary', 1, 4],
      ['reviewers', 2, 60],
      ['verifiers', 1, 8],
      ['fixes', 3, 428],
      ['discussions', 1, null],
    ],
  )
  assert.deepEqual(usage.lenses, [
    {
      lens: 'bugs',
      reviewer: { ...figure(15), tokens: 60 },
      verifiers: { ...figure(2), tokens: 8 },
      tokens: 68,
    },
  ])
  assert.deepEqual(
    usage.findings.map((one) => [
      one.id,
      one.fixes?.tokens ?? null,
      one.verifier?.tokens ?? null,
      one.usage?.tokens ?? null,
    ]),
    [
      ['f-01', 400, 8, 408],
      ['f-02', 12, null, 12],
      ['f-03', 16, null, 16],
    ],
  )
  assert.equal(usage.reset, null)

  // A live figure from before the serving session: counted, partial, not running.
  const later = await reviewUsage(dir, {
    review,
    decisions: decisions.findings,
    since: Date.now() + 60_000,
  })
  assert.equal(later.running, false)
  assert.deepEqual(later.partial.toSorted(), ['fix:f-02', 'sm-summary'])
})

test('reviewUsage: an id or a lens named like an object key sums like any other', async (t) => {
  const { dir, store } = await reviewed(t)
  await steps(dir, 'rv-__proto__', [
    { at: SINCE, kind: 'start', model: 'm', agent: 'r1' },
    { at: SINCE, kind: 'end', agent: 'r1', usage: figure(1) },
  ])
  await steps(dir, 'rv-constructor', [
    { at: SINCE, kind: 'start', model: 'm', agent: 'r2' },
    {
      at: SINCE,
      kind: 'end',
      agent: 'r2',
      usage: {
        models: [
          { model: '__proto__', input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
        ],
      },
    },
  ])
  // A figure an agent wrote by hand, unsound: not reported, never thrown.
  await steps(dir, 'vf-f-02', [
    { at: SINCE, kind: 'start', model: 'm', agent: 'v1' },
    {
      at: SINCE,
      kind: 'end',
      agent: 'v1',
      usage: { models: [{ model: 'x', input: -5 }] },
    },
  ])
  await writeFile(path.join(dir, 'reviewers', 'rv-broken.jsonl'), '{not json\n')
  await writeFile(usagePath(dir), '{"live": "everything"')
  const { review, decisions } = await store.readAll()
  const usage = await reviewUsage(dir, {
    review,
    decisions: decisions.findings,
    since: SINCE,
  })
  assert.deepEqual(
    usage.lenses.map((one) => one.lens),
    ['__proto__', 'constructor'],
  )
  assert.deepEqual(usage.notReported, ['vf-f-02'])
  assert.equal(usage.total?.tokens, 8)
  assert.equal(Object.getPrototypeOf({}), Object.prototype)
})

test('usage.json: live figures replaced and dropped by agent, unclaimed ones by agent', async (t) => {
  const { dir } = await reviewed(t)
  await setLive(dir, 'rv-bugs', 'r1', figure(1))
  await setLive(dir, 'rv-bugs', 'r1', figure(2))
  await setLive(dir, 'fix:f-01', 'x1', figure(3))
  // A key that is no run file's name is never written.
  await setLive(dir, '../escape', 'r1', figure(1))
  let file = await readUsageFile(dir)
  assert.deepEqual(
    file.live.map((one) => [one.key, one.agent, tokensOf(one.usage)]),
    [
      ['rv-bugs', 'r1', 8],
      ['fix:f-01', 'x1', 12],
    ],
  )
  // Pause now started the next agent: the first one's end leaves it.
  await dropLive(dir, 'rv-bugs', 'r0')
  assert.equal((await readUsageFile(dir)).live.length, 2)
  await dropLive(dir, 'rv-bugs', 'r1')
  await addUnclaimed(dir, 'f-02', 'x2', figure(1))
  await addUnclaimed(dir, 'f-02', 'x2', figure(2))
  file = await readUsageFile(dir)
  assert.deepEqual(
    file.live.map((one) => one.key),
    ['fix:f-01'],
  )
  assert.deepEqual(file.unclaimed, [{ finding: 'f-02', agent: 'x2', usage: figure(2) }])
})

test('a reset sums what it removes by kind and lens, adds it up, and the review after it counts it', async (t) => {
  const { dir, store } = await reviewed(t)
  await steps(dir, 'rv-bugs', [
    { at: SINCE, kind: 'start', model: 'm', agent: 'r1' },
    { at: SINCE, kind: 'end', agent: 'r1', usage: figure(10) },
  ])
  await steps(dir, 'vf-f-01', [
    { at: SINCE, kind: 'start', model: 'm', lens: 'bugs', agent: 'v1' },
    { at: SINCE, kind: 'end', agent: 'v1', usage: { ...figure(1), partial: true } },
  ])
  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'x1' })
  await store.recordUsage('f-01', 'x1', figure(5))
  await addUnclaimed(dir, 'f-02', 'x2', figure(2))
  await setLive(dir, 'rv-old', 'o1', figure(1))

  const removed = await removedUsage(dir)
  assert.deepEqual(
    removed?.kinds.map((one) => [
      one.kind,
      one.agents,
      tokensOf(one.usage),
      !!one.usage.partial,
    ]),
    [
      ['reviewers', 1, 40, false],
      ['verifiers', 1, 4, true],
      ['fixes', 2, 28, false],
    ],
  )
  assert.deepEqual(removed?.lenses, [
    { lens: 'bugs', reviewer: figure(10), verifiers: { ...figure(1), partial: true } },
  ])
  await addReset(dir, removed)
  let file = await readUsageFile(dir)
  assert.deepEqual(file.unclaimed, [])
  assert.deepEqual(file.live, [])
  assert.equal(file.reset?.kinds.length, 3)
  // A second reset adds to the first.
  await addReset(dir, removed)
  file = await readUsageFile(dir)
  assert.deepEqual(
    file.reset?.kinds.map((one) => [one.kind, one.agents, tokensOf(one.usage)]),
    [
      ['reviewers', 2, 80],
      ['verifiers', 2, 8],
      ['fixes', 4, 56],
    ],
  )
  assert.equal(tokensOf(file.reset?.lenses[0]?.reviewer), 80)

  // The review after it, its runs gone: its total counts what the resets removed, apart and in the sum.
  await rm(path.join(dir, 'reviewers'), { recursive: true })
  await mkdir(path.join(dir, 'reviewers'))
  await writeFile(
    path.join(dir, 'decisions.json'),
    JSON.stringify({ version: 1, findings: {} }),
  )
  await steps(dir, 'rv-bugs', [
    { at: SINCE, kind: 'start', model: 'm', agent: 'r9' },
    { at: SINCE, kind: 'end', agent: 'r9', usage: figure(3) },
  ])
  const { review, decisions } = await store.readAll()
  const usage = await reviewUsage(dir, {
    review,
    decisions: decisions.findings,
    since: SINCE,
  })
  assert.equal(usage.reset?.usage?.tokens, 4 * (20 + 2 + 14))
  assert.equal(usage.total?.tokens, 4 * (20 + 2 + 14 + 3))
  assert.deepEqual(
    usage.kinds.map((one) => [one.kind, one.usage?.tokens]),
    [['reviewers', 12]],
  )
})

test("a fix's agent at work after its claim counts once, from its live figure", async (t) => {
  const { dir, store } = await reviewed(t)
  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'x1' })
  await setLive(dir, 'fix:f-01', 'x1', figure(2))
  const { review, decisions } = await store.readAll()
  const usage = await reviewUsage(dir, {
    review,
    decisions: decisions.findings,
    since: SINCE,
  })
  assert.deepEqual(
    usage.kinds.map((one) => [one.kind, one.agents, one.usage?.tokens]),
    [['fixes', 1, 8]],
  )
  assert.equal(usage.running, true)
})

test('a figure goes on the run its own agent claimed, not on the next one', async (t) => {
  const { store } = await reviewed(t)
  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'x1' })
  await store.stop('f-01')
  await store.decide('f-01', { action: 'fix' })
  await store.claim('f-01', { agent: 'x2' })
  // The first agent's end comes after the second claimed.
  assert.equal(await store.recordUsage('f-01', 'x1', figure(1)), true)
  assert.equal(await store.recordUsage('f-01', 'x9', figure(1)), false)
  const runs = (await store.readDecisions()).findings['f-01']?.runs ?? []
  assert.deepEqual(
    runs.map((run) => [run.agent, run.usage]),
    [
      ['x1', figure(1)],
      ['x2', undefined],
    ],
  )
})

test('a sum of more models than one figure names folds the rest, and reads back whole', () => {
  const sum = sumUsage(Array.from({ length: 10 }, (_, i) => figure(i + 1, `m-${i}`)))
  assert.equal(sum?.models.length, 8)
  assert.equal(sum?.models.at(-1)?.model, 'other')
  // The three that spent least: 1 + 2 + 3.
  assert.equal(sum?.models.at(-1)?.input, 6)
  assert.deepEqual(readUsage(JSON.parse(JSON.stringify(sum))), sum)
  assert.equal(tokensOf(sum), 4 * 55)
})

test('a usage.json that cannot be read is never written over, and its review reads as partial', async (t) => {
  const { dir, store } = await reviewed(t)
  await steps(dir, 'rv-bugs', [
    { at: SINCE, kind: 'start', model: 'm', agent: 'r1' },
    { at: SINCE, kind: 'end', agent: 'r1', usage: figure(1) },
  ])
  for (const text of ['{"reset": ', JSON.stringify({ version: 2, live: [] })]) {
    await writeFile(usagePath(dir), text)
    await assert.rejects(setLive(dir, 'rv-bugs', 'r2', figure(1)), /not written over/)
    assert.equal(await readFile(usagePath(dir), 'utf8'), text)
    const { review, decisions } = await store.readAll()
    const usage = await reviewUsage(dir, {
      review,
      decisions: decisions.findings,
      since: SINCE,
    })
    assert.equal(usage.total?.tokens, 4)
    assert.equal(usage.total?.partial, true)
  }
})

test("a cleaning's live figure is keyed by the name the hooks spawn its agent under", () => {
  // test/hooks.test.ts spawns this cleaning as `tranchant:cl-cln00002`.
  assert.equal(cleanerName('cln00002-bbbb'), 'cl-cln00002')
})
