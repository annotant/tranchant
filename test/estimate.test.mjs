// The estimate on Ready to start the review: lib/estimate.mjs, read from a
// state folder of past reviews.
import assert from 'node:assert/strict'
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import {
  estimateOf,
  lensHistories,
  median,
} from '../skills/tranchant/scripts/lib/estimate.mjs'
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

/**
 * A past review's findings, in findings/: each `{ id, lens?, verified? }`.
 * @param {string} dir
 * @param {object[]} findings
 */
async function withFindings(dir, findings) {
  await mkdir(path.join(dir, 'findings'), { recursive: true })
  for (const finding of findings)
    await writeFile(
      path.join(dir, 'findings', `${Reflect.get(finding, 'id')}.json`),
      JSON.stringify(finding),
    )
}

/** Marks a past review verified, as /tranchant review writes it. @param {string} dir */
async function verified(dir) {
  const file = path.join(dir, 'review.json')
  await writeFile(
    file,
    JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), verify: true }),
  )
}

test('lensHistories: per lens, its tokens and confirmed findings a review, over its complete reviews', async (t) => {
  const root = await tempDir(t)
  const r1 = await pastReview(root, 'r1', {
    createdAt: '2026-11-01T00:00:00.000Z',
    lenses: [lens('bugs', 'h1'), lens('tests', 'ht')],
    agents: {
      'rv-bugs': { usage: figure(25) }, // 100
      'vf-bugs-1': { usage: figure(10), lens: 'bugs' }, // 40
      'vf-bugs-2': { usage: figure(15), lens: 'bugs' }, // 60
      'rv-tests': { usage: figure(5) },
    },
  })
  await verified(r1)
  // Two confirmed, bugs-2 removed by its verifier; one with no lens is no lens's, even by its id.
  await withFindings(r1, [
    { id: 'bugs-1', lens: 'bugs', verified: true },
    { id: 'f-a', lens: 'bugs', verified: true },
    { id: 'bugs-3', verified: true },
    { id: 'f-c', lens: 'tests', verified: true },
  ])
  await writeFile(
    path.join(r1, 'reviewers', 'vf-f-a.jsonl'),
    [
      { at: 1, kind: 'start', model: 'm', agent: 'v', lens: 'bugs' },
      { at: 2, kind: 'end', agent: 'v', usage: figure(0) },
    ]
      .map((step) => JSON.stringify(step))
      .join('\n') + '\n',
  )
  await writeFile(
    path.join(r1, 'reviewers', 'vf-f-c.jsonl'),
    [
      { at: 1, kind: 'start', model: 'm', agent: 'v', lens: 'tests' },
      { at: 2, kind: 'end', agent: 'v', usage: figure(0) },
    ]
      .map((step) => JSON.stringify(step))
      .join('\n') + '\n',
  )
  // Not verified: every finding that stands is confirmed.
  const r2 = await pastReview(root, 'r2', {
    createdAt: '2026-11-02T00:00:00.000Z',
    lenses: [lens('bugs', 'h1')],
    agents: { 'rv-bugs': { usage: figure(50) } }, // 200
  })
  await withFindings(r2, [{ id: 'bugs-9', lens: 'bugs' }])
  // Still under way, and one whose verification reported nothing whole: not averaged.
  await pastReview(root, 'r3', {
    createdAt: '2026-11-03T00:00:00.000Z',
    status: 'reviewing',
    lenses: [lens('bugs', 'h1')],
    agents: { 'rv-bugs': { usage: figure(999) } },
  })
  await pastReview(root, 'r4', {
    createdAt: '2026-11-04T00:00:00.000Z',
    lenses: [lens('bugs', 'h1')],
    agents: {
      'rv-bugs': { usage: figure(999) },
      'vf-bugs-3': { usage: figure(1, { partial: true }), lens: 'bugs' },
    },
  })

  const [bugs, tests, fresh, odd] = await lensHistories(r2, [
    { name: 'bugs', hash: 'h1' },
    // Not built: its last run's prompt stands.
    { name: 'tests' },
    { name: 'fresh', hash: 'hf' },
    { name: '../odd', hash: 'h1' },
  ])
  // (200 + 200) / 2 tokens, (2 + 1) / 2 confirmed: the review the page serves counts.
  assert.deepEqual(bugs, { tokens: 200, confirmed: 1.5, runs: 2 })
  assert.deepEqual(tests, { tokens: 20, confirmed: 1, runs: 1 })
  assert.equal(fresh, null)
  assert.equal(odd, null)

  // Its prompt changed: its history starts over.
  assert.deepEqual(await lensHistories(r2, [{ name: 'bugs', hash: 'h2' }]), [null])

  // A finding lands unverified, its verifier never run (queued at a stop, lost): r1's cost is unknown.
  await writeFile(
    path.join(r1, 'findings', 'f-b.json'),
    JSON.stringify({ id: 'f-b', lens: 'bugs' }),
  )
  const [again] = await lensHistories(r2, [{ name: 'bugs', hash: 'h1' }])
  assert.deepEqual(again, { tokens: 200, confirmed: 1, runs: 1 })
})

test('lensHistories: the last ten reviews, the confirmed rounded to one decimal', async (t) => {
  const root = await tempDir(t)
  let dir = ''
  for (let n = 0; n < 12; n++) {
    dir = await pastReview(root, `r${n}`, {
      createdAt: `2026-11-${String(n + 1).padStart(2, '0')}T00:00:00.000Z`,
      lenses: [lens('bugs', 'h1')],
      agents: { 'rv-bugs': { usage: figure(n + 1) } },
    })
    // One confirmed in three reviews of the last ten.
    if (n % 3 === 0) await withFindings(dir, [{ id: `bugs-${n}`, lens: 'bugs' }])
  }
  const [bugs] = await lensHistories(dir, [{ name: 'bugs', hash: 'h1' }])
  // 4 × (3 … 12) / 10, and r3, r6, r9 of r2 … r11.
  assert.deepEqual(bugs, { tokens: 30, confirmed: 0.3, runs: 10 })
})

test('lensHistories: a prompt back to an older one starts over, and a review a stop cut is not averaged', async (t) => {
  const root = await tempDir(t)
  let dir = ''
  for (const [n, hash] of ['h1', 'h0', 'h1', 'h1'].entries())
    dir = await pastReview(root, `r${n}`, {
      createdAt: `2026-11-0${n + 1}T00:00:00.000Z`,
      lenses: [lens('bugs', hash)],
      agents: { 'rv-bugs': { usage: figure(10 * (n + 1)) } },
    })
  // r3 stopped: complete, but cut.
  const file = path.join(dir, 'review.json')
  await writeFile(
    file,
    JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), stopped: { at: 'x' } }),
  )
  // r2 alone: r1's prompt was another, r0 before it is not this one's history.
  assert.deepEqual(await lensHistories(dir, [{ name: 'bugs', hash: 'h1' }]), [
    { tokens: 120, confirmed: 0, runs: 1 },
  ])
  // Unknown prompt: its last run's, a cut one included.
  assert.deepEqual(await lensHistories(dir, [{ name: 'bugs' }]), [
    { tokens: 120, confirmed: 0, runs: 1 },
  ])
})

test('lensHistories: a finding that cannot be read leaves its review out of the averages, not of the estimate', async (t) => {
  const root = await tempDir(t)
  const dir = await pastReview(root, 'r1', {
    createdAt: '2026-11-01T00:00:00.000Z',
    lenses: [lens('bugs', 'h1')],
    agents: { 'rv-bugs': { usage: figure(10) } },
  })
  await withFindings(dir, [{ id: 'f-1', lens: 'bugs' }])
  await writeFile(path.join(dir, 'findings', 'f-2.json'), '{ not json')
  assert.deepEqual(await lensHistories(dir, [{ name: 'bugs', hash: 'h1' }]), [null])
  // Past 256 KiB: not read either.
  await writeFile(
    path.join(dir, 'findings', 'f-2.json'),
    JSON.stringify({ id: 'f-2', lens: 'bugs', pad: 'x'.repeat(300 * 1024) }),
  )
  assert.deepEqual(await lensHistories(dir, [{ name: 'bugs', hash: 'h1' }]), [null])
  const current = path.join(root, 'reviews', 'current')
  await mkdir(current, { recursive: true })
  const { lenses } = await estimateOf(
    current,
    [{ name: 'bugs', files: 1, hash: 'h1' }],
    NOW,
  )
  assert.equal(lenses[0]?.tokens, 40)
  await writeFile(
    path.join(dir, 'findings', 'f-2.json'),
    JSON.stringify({ id: 'f-2', lens: 'bugs' }),
  )
  assert.deepEqual(await lensHistories(dir, [{ name: 'bugs', hash: 'h1' }]), [
    { tokens: 40, confirmed: 2, runs: 1 },
  ])
})
