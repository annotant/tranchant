// scripts/add.mjs and scripts/complete.mjs, run as a producer runs them: a
// review opened before its findings grows one file at a time, then completes.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { createStore, findingPath } from '../skills/tranchant/scripts/lib/store.mjs'
import { SCRIPTS, fixture, importReview, run, tempDir } from './helpers.mjs'

/** @type {string} */
let stateDir

before(async (t) => {
  stateDir = await tempDir(t)
})

const ADD = path.join(SCRIPTS, 'add.mjs')
const COMPLETE = path.join(SCRIPTS, 'complete.mjs')

/**
 * @param {string} dir
 * @param {string[]} args
 * @param {string} [input] The finding on stdin.
 */
const add = (dir, args, input = '') =>
  run(process.execPath, [ADD, '--review', dir, ...args], { input })

const complete = (/** @type {string} */ dir) =>
  run(process.execPath, [COMPLETE, '--review', dir])

/**
 * A review imported before its findings, and the fixture's findings to add.
 * @param {import('node:test').TestContext} t
 * @param {'theirs' | 'ours'} name
 * @param {string} id
 */
async function live(t, name, id) {
  const { dir } = await importReview(t, name, stateDir, {
    id,
    status: 'reviewing',
    findings: [],
  })
  const { findings } = await fixture(name)
  return { dir, findings, store: createStore(dir) }
}

test('adds findings one at a time, from stdin or a file, in the order they land', async (t) => {
  const { dir, findings, store } = await live(t, 'ours', 'live-add-1')
  const first = await add(dir, [], JSON.stringify(findings[0]))
  assert.equal(first.code, 0, first.stderr)
  assert.equal(first.stdout, 'ADDED f-01\n')
  const file = path.join(await tempDir(t), 'finding.json')
  await writeFile(file, JSON.stringify(findings[1]))
  const second = await add(dir, ['--file', file])
  assert.equal(second.code, 0, second.stderr)
  assert.equal(second.stdout, 'ADDED f-02\n')
  const { addedAt, ...content } = JSON.parse(
    await readFile(findingPath(dir, 'f-01'), 'utf8'),
  )
  assert.equal(typeof addedAt, 'string')
  assert.deepEqual(content, findings[0])
  const review = await store.readReview()
  assert.equal(review.status, 'reviewing')
  assert.deepEqual(
    review.findings.map((finding) => finding.id),
    ['f-01', 'f-02'],
  )
})

test('the same finding again is accepted silently; another under its id is refused', async (t) => {
  const { dir, findings } = await live(t, 'ours', 'live-add-2')
  await add(dir, [], JSON.stringify(findings[0]))
  // The same finding, its keys in another order.
  const relaid = Object.fromEntries(Object.entries(findings[0]).toReversed())
  const again = await add(dir, [], JSON.stringify(relaid))
  assert.equal(again.code, 0, again.stderr)
  assert.equal(again.stdout, 'ADDED f-01\n')
  assert.equal(again.stderr, '')
  const other = await add(
    dir,
    [],
    JSON.stringify({ ...findings[0], title: 'Another title' }),
  )
  assert.equal(other.code, 2)
  assert.equal(other.stdout, 'ADD_REFUSED finding f-01 exists with other content\n')
  assert.equal(
    JSON.parse(await readFile(findingPath(dir, 'f-01'), 'utf8')).title,
    findings[0].title,
  )
})

test('refuses a finding that is not sound, naming what is wrong, and writes nothing', async (t) => {
  const { dir, findings } = await live(t, 'theirs', 'live-add-3')
  const outside = await add(dir, [], JSON.stringify({ ...findings[0], line: 9999 }))
  assert.equal(outside.code, 2)
  assert.match(outside.stdout, /^ADD_REFUSED finding\.line: 9999 is outside the /)
  const { comment: _comment, ...silent } = findings[1]
  const noComment = await add(dir, [], JSON.stringify(silent))
  assert.equal(
    noComment.stdout,
    'ADD_REFUSED finding.comment: required when ownership is theirs\n',
  )
  assert.match(
    (await add(dir, [], '{ not json')).stdout,
    /^ADD_REFUSED the finding is not JSON/,
  )
  assert.match((await add(dir, [])).stdout, /^ADD_REFUSED no finding given/)
  const missing = await add(dir, ['--file', path.join(dir, 'nope.json')])
  assert.equal(missing.code, 2)
  assert.match(missing.stdout, /^ADD_REFUSED cannot read /)
  const usage = await run(process.execPath, [ADD], { env: { TRANCHANT_REVIEW: '' } })
  assert.equal(usage.code, 2)
  assert.match(usage.stderr, /usage: add.mjs/)
  assert.equal(existsSync(findingPath(dir, 'f-01')), false)
  assert.equal(existsSync(findingPath(dir, 'f-02')), false)
})

test('complete.mjs flips the status once; nothing new can be added after', async (t) => {
  const { dir, findings, store } = await live(t, 'ours', 'live-add-4')
  await add(dir, [], JSON.stringify(findings[0]))
  const done = await complete(dir)
  assert.equal(done.code, 0, done.stderr)
  assert.equal(done.stdout, 'COMPLETE\n')
  const review = await store.readReview()
  assert.equal(review.status, 'complete')
  assert.equal(review.findings.length, 1)
  const envelope = JSON.parse(await readFile(path.join(dir, 'review.json'), 'utf8'))
  assert.equal(envelope.status, 'complete')
  assert.equal('findings' in envelope, false)
  const again = await complete(dir)
  assert.equal(again.code, 2)
  assert.equal(again.stdout, 'COMPLETE_REFUSED the review is complete already\n')
  const late = await add(dir, [], JSON.stringify(findings[1]))
  assert.equal(late.code, 2)
  assert.equal(late.stdout, 'ADD_REFUSED the review is complete: nothing can be added\n')
  // The same finding again still is: nothing changes.
  assert.equal((await add(dir, [], JSON.stringify(findings[0]))).stdout, 'ADDED f-01\n')
})

test('a review imported whole is complete already', async (t) => {
  const { dir } = await importReview(t, 'ours', stateDir, { id: 'live-add-5' })
  const done = await complete(dir)
  assert.equal(done.code, 2)
  assert.equal(done.stdout, 'COMPLETE_REFUSED the review is complete already\n')
  const usage = await run(process.execPath, [COMPLETE], { env: { TRANCHANT_REVIEW: '' } })
  assert.equal(usage.code, 2)
  assert.match(usage.stderr, /usage: complete.mjs/)
})
