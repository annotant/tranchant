import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { hashOf } from '../skills/tranchant/scripts/lib/project.mjs'
import { createStore, findingPath } from '../skills/tranchant/scripts/lib/store.mjs'
import { SCRIPTS, fixture, reviewFile, run, tempDir } from './helpers.mjs'

/** @type {string} */
let stateDir

before(async (t) => {
  stateDir = await tempDir(t)
})

const OPEN = path.join(SCRIPTS, 'open.mjs')

/** @param {string[]} args */
const open = (args) =>
  run(process.execPath, [OPEN, ...args], { env: { TRANCHANT_STATE_DIR: stateDir } })

test('imports a review into the state folder, one file per finding, and prints its folder', async (t) => {
  const { file, review, project } = await reviewFile(t, 'theirs')
  const opened = await open([file])
  assert.equal(opened.code, 0, opened.stderr)
  const dir = path.join(stateDir, hashOf(project), 'reviews', review.id)
  assert.equal(opened.stdout, `REVIEW ${dir}\n`)
  // review.json keeps the envelope; each finding has its file, stamped in the producer's order.
  const { findings, ...envelope } = review
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dir, 'review.json'), 'utf8')),
    envelope,
  )
  const stored = await Promise.all(
    findings.map(async (finding) =>
      JSON.parse(await readFile(findingPath(dir, finding.id), 'utf8')),
    ),
  )
  assert.deepEqual(
    stored.map(({ addedAt: _addedAt, ...content }) => content),
    findings,
  )
  const stamps = stored.map((finding) => String(finding.addedAt))
  for (let i = 1; i < stamps.length; i++)
    assert.ok(stamps[i - 1] < stamps[i], stamps.join())
  assert.deepEqual(
    (await createStore(dir).readReview()).findings.map((finding) => finding.id),
    findings.map((finding) => finding.id),
  )
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'decisions.json'), 'utf8')), {
    version: 1,
    findings: {},
  })
  assert.ok(existsSync(path.join(dir, 'runs')))
})

test('opens a review still reviewing, with no finding yet, and again once it grew', async (t) => {
  const { file, review, project } = await reviewFile(t, 'ours', {
    id: 'live-open-1',
    status: 'reviewing',
    findings: [],
  })
  const opened = await open([file])
  assert.equal(opened.code, 0, opened.stdout + opened.stderr)
  const dir = path.join(stateDir, hashOf(project), 'reviews', review.id)
  assert.ok(existsSync(path.join(dir, 'findings')))
  const store = createStore(dir)
  const stored = await store.readReview()
  assert.equal(stored.status, 'reviewing')
  assert.deepEqual(stored.findings, [])
  // The same file opens the review again once findings landed and it completed.
  const { findings } = await fixture('ours')
  await store.addFinding(findings[0])
  await store.complete()
  const again = await open([file])
  assert.equal(again.code, 0, again.stdout)
  assert.equal(again.stdout, opened.stdout)
  const grown = await store.readReview()
  assert.equal(grown.status, 'complete')
  assert.deepEqual(
    grown.findings.map((finding) => finding.id),
    ['f-01'],
  )
})

test('an inline finding imported already with other content is refused; a new one joins', async (t) => {
  const { file, review } = await reviewFile(t, 'ours', { id: 'grown-open-1' })
  const first = await open([file])
  const dir = first.stdout.trim().replace(/^REVIEW /, '')
  const [one, two, ...rest] = review.findings
  await writeFile(
    file,
    JSON.stringify({
      ...review,
      findings: [{ ...one, title: 'Another title' }, two, ...rest],
    }),
  )
  const changed = await open([file])
  assert.equal(changed.code, 2)
  assert.equal(changed.stdout, 'REVIEW_REFUSED finding f-01 exists with other content\n')
  assert.equal(
    JSON.parse(await readFile(findingPath(dir, 'f-01'), 'utf8')).title,
    one.title,
  )
  const extra = { ...two, id: 'f-99' }
  await writeFile(
    file,
    JSON.stringify({ ...review, findings: [...review.findings, extra] }),
  )
  const joined = await open([file])
  assert.equal(joined.code, 0, joined.stdout)
  assert.deepEqual(
    (await createStore(dir).readReview()).findings.map((finding) => finding.id),
    ['f-01', 'f-02', 'f-03', 'f-04', 'f-05', 'f-99'],
  )
})

test('a folder imported before findings/ existed reads its findings inline, and splits them on the next open', async (t) => {
  const { file, review, project } = await reviewFile(t, 'theirs', { id: 'legacy-open-1' })
  const dir = path.join(stateDir, hashOf(project), 'reviews', review.id)
  await mkdir(path.join(dir, 'runs'), { recursive: true })
  await writeFile(path.join(dir, 'review.json'), JSON.stringify(review, null, 2))
  const store = createStore(dir)
  assert.deepEqual(
    (await store.readReview()).findings.map((finding) => finding.id),
    review.findings.map((finding) => finding.id),
  )
  const opened = await open([file])
  assert.equal(opened.code, 0, opened.stdout)
  assert.ok(existsSync(findingPath(dir, 'f-01')))
  assert.equal((await store.readReview()).findings.length, review.findings.length)
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
  await writeFile(file, JSON.stringify({ ...review, status: 'done' }))
  assert.equal(
    (await open([file])).stdout,
    `REVIEW_REFUSED ${file}: status: preparing, reviewing, complete or refused\n`,
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

test('a file claiming verify, or verified findings, is opened undimmed; --verify keeps verify', async (t) => {
  const { findings } = await fixture('ours')
  const { file, review, project } = await reviewFile(t, 'ours', {
    id: 'claims-verify-1',
    verify: true,
    findings: [{ ...findings[0], verified: true }],
  })
  const opened = await open([file])
  assert.equal(opened.code, 0, opened.stdout + opened.stderr)
  const dir = path.join(stateDir, hashOf(project), 'reviews', review.id)
  const stored = await createStore(dir).readReview()
  assert.equal(stored.verify, undefined)
  assert.equal(stored.findings[0]?.verified, undefined)
  // Opened again with --verify, it is the same review: its verify stays as imported.
  assert.equal((await open([file, '--verify'])).code, 0)

  const {
    file: prepared,
    review: run_,
    project: where,
  } = await reviewFile(t, 'ours', {
    id: 'prepared-1',
    status: 'reviewing',
    verify: true,
    findings: [],
  })
  assert.equal((await open([prepared, '--verify'])).code, 0)
  const kept = await createStore(
    path.join(stateDir, hashOf(where), 'reviews', run_.id),
  ).readReview()
  assert.equal(kept.verify, true)
})
