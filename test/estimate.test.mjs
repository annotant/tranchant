// The estimate on Ready to start the review: lib/estimate.mjs, read from a
// state folder of past reviews.
import assert from 'node:assert/strict'
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { estimateOf, median } from '../skills/tranchant/scripts/lib/estimate.mjs'
import { tempDir } from './helpers.mjs'

/** `n` tokens of each of the four counts: 4n tokens. */
const figure = (/** @type {number} */ n, more = {}) => ({
  models: [
    { model: 'claude-sonnet-5-5', input: n, output: n, cacheRead: n, cacheWrite: n },
  ],
  ...more,
})

/**
 * A past review: its review.json, and one run file per agent, each a start
 * and an end with its figure (none: no `end`'s usage).
 * @param {string} root
 * @param {string} id
 * @param {{ createdAt: string, status?: string, lenses: object[], agents?: Record<string, { usage?: object, lens?: string }> }} review
 */
async function pastReview(
  root,
  id,
  { createdAt, status = 'complete', lenses, agents = {} },
) {
  const dir = path.join(root, 'reviews', id)
  await mkdir(path.join(dir, 'reviewers'), { recursive: true })
  await writeFile(
    path.join(dir, 'review.json'),
    JSON.stringify({ version: 1, createdAt, status, lenses, findings: [] }),
  )
  for (const [name, { usage, lens }] of Object.entries(agents))
    await writeFile(
      path.join(dir, 'reviewers', `${name}.jsonl`),
      [
        { at: 1, kind: 'start', model: 'm', agent: name, ...(lens && { lens }) },
        { at: 2, kind: 'end', state: 'done', agent: name, ...(usage && { usage }) },
      ]
        .map((step) => JSON.stringify(step))
        .join('\n') + '\n',
    )
  return dir
}

const lens = (/** @type {string} */ name, /** @type {string} */ hash, files = 1) => ({
  name,
  source: `tranchant:${name}`,
  hash,
  files,
})

test('median: the middle value, or the mean of the two middle ones', () => {
  assert.equal(median([]), undefined)
  assert.equal(median([3]), 3)
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([4, 1, 3, 2]), 2.5)
})

test('estimateOf: per lens, its medians over its last runs times the files it reads now', async (t) => {
  const root = await tempDir(t)
  const current = path.join(root, 'reviews', 'current')
  await mkdir(current, { recursive: true })
  await pastReview(root, 'r1', {
    createdAt: '2026-11-01T00:00:00.000Z',
    lenses: [lens('bugs', 'h1', 2)],
    agents: {
      'sm-summary': { usage: figure(5) },
      'rv-bugs': { usage: figure(50) }, // 200 tokens, 2 files: 100 a file
      'vf-f-1': { usage: figure(10), lens: 'bugs' },
      'vf-f-2': { usage: figure(20), lens: 'bugs' },
    },
  })
  await pastReview(root, 'r2', {
    createdAt: '2026-11-02T00:00:00.000Z',
    lenses: [lens('bugs', 'h1', 1), lens('tests', 'h0', 2)],
    agents: {
      'sm-summary': { usage: figure(10) },
      'rv-bugs': { usage: figure(75) }, // 300 a file, no finding
      'rv-tests': { usage: figure(1000) },
    },
  })
  // A run that read no file, and one whose figure is partial: skipped, not counted.
  await pastReview(root, 'r3', {
    createdAt: '2026-11-03T00:00:00.000Z',
    lenses: [lens('bugs', 'h1', 0), lens('tests', 'h2', 2)],
    agents: {
      'rv-bugs': { usage: figure(999) },
      'rv-tests': { usage: figure(999, { partial: true }) },
    },
  })
  await pastReview(root, 'r4', {
    createdAt: '2026-11-04T00:00:00.000Z',
    lenses: [lens('bugs', 'h1', 4), lens('tests', 'h2', 2), lens('style', 'hs', 1)],
    agents: {
      'sm-summary': { usage: figure(15) },
      'rv-bugs': { usage: figure(200) }, // 200 a file
      'vf-f-3': { usage: figure(30), lens: 'bugs' },
      'rv-tests': { usage: figure(25) }, // 50 a file
      'rv-style': { usage: figure(10) }, // 40 a file
    },
  })

  const estimate = await estimateOf(
    current,
    [
      { name: 'bugs', files: 4, hash: 'h1' },
      // Its prompt changed after r2: r2's run is not its history.
      { name: 'tests', files: 2, hash: 'h2' },
      // Not built (off): its last run's prompt stands.
      { name: 'style', files: 2 },
      // No past run: left out, the page says it.
      { name: 'fresh', files: 3, hash: 'hf' },
      // Reads no file: it does not run.
      { name: 'docs', files: 0, hash: 'hd' },
    ],
    NOW,
  )
  assert.deepEqual(estimate, {
    recorded: true,
    // 20, 40 and 60.
    summary: { tokens: 40, reviews: ['r4', 'r2', 'r1'] },
    lenses: [
      // Median 200 a file × 4, plus the median verification (40, 80, 120) × the median findings (2, 0, 1).
      { name: 'bugs', tokens: 880, perFile: 200, runs: 3, reviews: ['r4', 'r2', 'r1'] },
      { name: 'tests', tokens: 100, perFile: 50, runs: 1, reviews: ['r4'] },
      { name: 'style', tokens: 80, perFile: 40, runs: 1, reviews: ['r4'] },
    ],
  })

  // A prompt changed now: that lens starts over, with no past run.
  const changed = await estimateOf(current, [{ name: 'bugs', files: 4, hash: 'h9' }], NOW)
  assert.deepEqual(changed.lenses, [])
})

/** The review waiting to start: created after every past review of the tests. */
const NOW = '2026-12-01T00:00:00.000Z'

test('estimateOf: a prompt back to an older one starts over all the same', async (t) => {
  const root = await tempDir(t)
  const current = path.join(root, 'reviews', 'current')
  await mkdir(current, { recursive: true })
  for (const [n, hash] of ['h1', 'h2', 'h1'].entries())
    await pastReview(root, `r${n}`, {
      createdAt: `2026-11-0${n + 1}T00:00:00.000Z`,
      lenses: [lens('bugs', hash, 1)],
      agents: { 'rv-bugs': { usage: figure(10 * (n + 1)) } },
    })
  const { lenses } = await estimateOf(
    current,
    [{ name: 'bugs', files: 1, hash: 'h1' }],
    NOW,
  )
  assert.deepEqual(lenses, [
    { name: 'bugs', tokens: 120, perFile: 120, runs: 1, reviews: ['r2'] },
  ])
})

test('estimateOf: the review itself, and one created after it, are not its past', async (t) => {
  const root = await tempDir(t)
  const current = await pastReview(root, 'current', {
    createdAt: '2026-11-10T00:00:00.000Z',
    status: 'preparing',
    lenses: [lens('bugs', 'h1', 1)],
    agents: { 'rv-bugs': { usage: figure(500) } },
  })
  await pastReview(root, 'later', {
    createdAt: '2026-11-11T00:00:00.000Z',
    lenses: [lens('bugs', 'h1', 1)],
    agents: { 'rv-bugs': { usage: figure(700) } },
  })
  await pastReview(root, 'before', {
    createdAt: '2026-11-09T00:00:00.000Z',
    lenses: [lens('bugs', 'h1', 1)],
    agents: { 'rv-bugs': { usage: figure(10) } },
  })
  const { lenses } = await estimateOf(
    `${current}${path.sep}`.slice(0, -1),
    [{ name: 'bugs', files: 1, hash: 'h1' }],
    '2026-11-10T00:00:00.000Z',
  )
  assert.deepEqual(lenses[0]?.reviews, ['before'])
  assert.equal(lenses[0]?.tokens, 40)
})

test('estimateOf: a verifier run again is summed on its finding', async (t) => {
  const root = await tempDir(t)
  const current = path.join(root, 'reviews', 'current')
  await mkdir(current, { recursive: true })
  const dir = await pastReview(root, 'r1', {
    createdAt: '2026-11-01T00:00:00.000Z',
    lenses: [lens('bugs', 'h1', 1)],
    agents: { 'rv-bugs': { usage: figure(10) } },
  })
  // Pause now: two agents in one run file, each its end.
  await writeFile(
    path.join(dir, 'reviewers', 'vf-f-1.jsonl'),
    [
      { at: 1, kind: 'start', model: 'm', agent: 'v1', lens: 'bugs' },
      { at: 2, kind: 'end', agent: 'v1', usage: figure(5) },
      { at: 3, kind: 'start', model: 'm', agent: 'v2', lens: 'bugs' },
      { at: 4, kind: 'end', agent: 'v2', usage: figure(20) },
    ]
      .map((step) => JSON.stringify(step))
      .join('\n') + '\n',
  )
  const { lenses } = await estimateOf(
    current,
    [{ name: 'bugs', files: 1, hash: 'h1' }],
    NOW,
  )
  // 40 for its reviewer, plus one finding verified for 20 + 80.
  assert.equal(lenses[0]?.tokens, 140)
})

test('estimateOf: no past review recorded its tokens, no estimate', async (t) => {
  const root = await tempDir(t)
  const current = path.join(root, 'reviews', 'current')
  await mkdir(current, { recursive: true })
  const rows = [{ name: 'bugs', files: 2, hash: 'h1' }]
  assert.deepEqual(await estimateOf(current, rows, NOW), {
    recorded: false,
    summary: null,
    lenses: [],
  })
  // Written before the tokens were: run files with no usage.
  await pastReview(root, 'old', {
    createdAt: '2026-10-01T00:00:00.000Z',
    lenses: [{ name: 'bugs', source: 'tranchant:bugs', hash: 'h1' }],
    agents: { 'rv-bugs': {}, 'sm-summary': {} },
  })
  // Unsound folders are left out, never a failure: not JSON, no date, a FIFO-like folder in place of a file.
  await mkdir(path.join(root, 'reviews', 'broken'), { recursive: true })
  await writeFile(path.join(root, 'reviews', 'broken', 'review.json'), '{ not json')
  await pastReview(root, 'undated', {
    createdAt: 'yesterday',
    lenses: [lens('bugs', 'h1', 1)],
    agents: { 'rv-bugs': { usage: figure(10) } },
  })
  await mkdir(path.join(root, 'reviews', 'odd', 'review.json'), { recursive: true })
  const none = await estimateOf(current, rows, NOW)
  assert.equal(none.recorded, false)
})

test('estimateOf: the newest 5 runs of the last 20 reviews written, a review unchanged read once', async (t) => {
  const root = await tempDir(t)
  const current = path.join(root, 'reviews', 'current')
  await mkdir(current, { recursive: true })
  const oldest = await pastReview(root, 'oldest', {
    createdAt: '2026-01-01T00:00:00.000Z',
    lenses: [lens('old', 'ho', 1)],
    agents: { 'rv-old': { usage: figure(10) } },
  })
  await utimes(path.join(oldest, 'review.json'), 1, 1)
  for (let n = 0; n < 20; n++)
    await pastReview(root, `r${n}`, {
      createdAt: `2026-02-${String(n + 1).padStart(2, '0')}T00:00:00.000Z`,
      lenses: [lens('bugs', 'h1', 1)],
      agents: {
        'rv-bugs': { usage: figure(n + 1) },
        'sm-summary': { usage: figure(n + 1) },
      },
    })
  const newest = path.join(root, 'reviews', 'r19', 'review.json')
  await utimes(newest, 1000, 1000)
  const rows = [
    { name: 'old', files: 1, hash: 'ho' },
    { name: 'bugs', files: 1, hash: 'h1' },
  ]
  const first = await estimateOf(current, rows, NOW)
  const last5 = ['r19', 'r18', 'r17', 'r16', 'r15']
  // 80, 76, 72, 68 and 64: the oldest of the 20 and the one before them not read.
  assert.deepEqual(first.lenses, [
    { name: 'bugs', tokens: 72, perFile: 72, runs: 5, reviews: last5 },
  ])
  assert.deepEqual(first.summary, { tokens: 72, reviews: last5 })

  // Rewritten to the same size and time: the sums kept stand, nothing is read again.
  const text = await readFile(newest, 'utf8')
  await writeFile(newest, text.replace('"h1"', '"h2"'))
  await utimes(newest, 1000, 1000)
  assert.deepEqual((await estimateOf(current, rows, NOW)).lenses, first.lenses)
  // A run file that changes: read again, its prompt now another.
  await writeFile(
    path.join(root, 'reviews', 'r19', 'reviewers', 'rv-bugs.jsonl'),
    `${JSON.stringify({ at: 1, kind: 'start', model: 'm', agent: 'x' })}\n${JSON.stringify({ at: 2, kind: 'end', agent: 'x', usage: figure(1000) })}\n`,
  )
  assert.deepEqual((await estimateOf(current, rows, NOW)).lenses, [])
})

test('estimateOf: a review still running is read again as it goes', async (t) => {
  const root = await tempDir(t)
  const current = path.join(root, 'reviews', 'current')
  await mkdir(current, { recursive: true })
  const dir = await pastReview(root, 'running', {
    createdAt: '2026-11-01T00:00:00.000Z',
    status: 'reviewing',
    lenses: [lens('bugs', 'h1', 1)],
    agents: { 'rv-bugs': {} },
  })
  const rows = [{ name: 'bugs', files: 1, hash: 'h1' }]
  assert.equal((await estimateOf(current, rows, NOW)).recorded, false)
  await writeFile(
    path.join(dir, 'reviewers', 'rv-bugs.jsonl'),
    `${JSON.stringify({ at: 1, kind: 'start', model: 'm', agent: 'x' })}\n${JSON.stringify({ at: 2, kind: 'end', agent: 'x', usage: figure(10) })}\n`,
  )
  assert.equal((await estimateOf(current, rows, NOW)).lenses[0]?.tokens, 40)
})
