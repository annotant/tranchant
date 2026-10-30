import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { hashOf } from '../skills/tranchant/scripts/lib/project.mjs'
import { createStore } from '../skills/tranchant/scripts/lib/store.mjs'
import { SCRIPTS, reviewFile, run, tempDir } from './helpers.mjs'

/** @type {string} */
let stateDir

before(async (t) => {
  stateDir = await tempDir(t)
})

const OPEN = path.join(SCRIPTS, 'open.mjs')

/** @param {string[]} args */
const open = (args) =>
  run(process.execPath, [OPEN, ...args], { env: { TRANCHANT_STATE_DIR: stateDir } })

test('imports a review into the state folder, and prints its folder', async (t) => {
  const { file, review, project } = await reviewFile(t, 'theirs')
  const opened = await open([file])
  assert.equal(opened.code, 0, opened.stderr)
  const dir = path.join(stateDir, hashOf(project), 'reviews', review.id)
  assert.equal(opened.stdout, `REVIEW ${dir}\n`)
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dir, 'review.json'), 'utf8')),
    review,
  )
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'decisions.json'), 'utf8')), {
    version: 1,
    findings: {},
  })
  assert.ok(existsSync(path.join(dir, 'runs')))
})

test('reuses an id imported with the same content, however laid out, keeping its decisions', async (t) => {
  const { file, review } = await reviewFile(t, 'ours')
  const first = await open([file])
  const dir = first.stdout.trim().replace(/^REVIEW /, '')
  await createStore(dir).decide('f-01', { action: 'fix' })
  // The same review, written on one line this time.
  await writeFile(file, JSON.stringify(review))
  const second = await open([file])
  assert.equal(second.code, 0, second.stderr)
  assert.equal(second.stdout, first.stdout)
  const decisions = JSON.parse(await readFile(path.join(dir, 'decisions.json'), 'utf8'))
  assert.equal(decisions.findings['f-01'].state, 'queued')
})

test('refuses an id imported already with other content, and leaves the first import', async (t) => {
  const { file, review } = await reviewFile(t, 'ours')
  const first = await open([file])
  const dir = first.stdout.trim().replace(/^REVIEW /, '')
  await writeFile(file, JSON.stringify({ ...review, title: 'Another title' }))
  const second = await open([file])
  assert.equal(second.code, 2)
  assert.equal(
    second.stdout,
    `REVIEW_REFUSED id ${review.id} exists with other content\n`,
  )
  const kept = JSON.parse(await readFile(path.join(dir, 'review.json'), 'utf8'))
  assert.equal(kept.title, review.title)
})

test('refuses a review that is not sound, naming what is wrong', async (t) => {
  const { file, review } = await reviewFile(t, 'theirs')
  await writeFile(file, JSON.stringify({ ...review, findings: [] }))
  const empty = await open([file])
  assert.equal(empty.code, 2)
  assert.equal(
    empty.stdout,
    `REVIEW_REFUSED ${file}: findings: at least one is required\n`,
  )
  await writeFile(file, JSON.stringify({ ...review, version: 2 }))
  assert.match(
    (await open([file])).stdout,
    /^REVIEW_REFUSED .*unknown review format \(version 2\)/,
  )
  await writeFile(file, '{ not json')
  assert.match((await open([file])).stdout, /^REVIEW_REFUSED .*the review is not JSON/)
  const missing = await open([path.join(path.dirname(file), 'nope.json')])
  assert.equal(missing.code, 2)
  assert.match(missing.stdout, /^REVIEW_REFUSED cannot read /)
  const usage = await open([])
  assert.equal(usage.code, 2)
  assert.match(usage.stderr, /usage: open.mjs/)
  // A refused review leaves no folder behind.
  assert.equal(
    existsSync(path.join(stateDir, hashOf(review.project), 'reviews', review.id)),
    false,
  )
})
