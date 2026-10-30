// The front-end playground test/fixtures/playground.mjs builds: the clean app
// as the base, the change as the head, the answer key anchored on the
// change's real lines, and the envelope of a review in progress.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { validateReview } from '../skills/tranchant/scripts/lib/format.mjs'
import { buildPlayground, inProgress } from './fixtures/playground.mjs'
import { fixture, tempDir } from './helpers.mjs'

const CHANGE = new URL('./fixtures/front-end/change/', import.meta.url).pathname
const BRANCH = 'feature/cart-discounts'

/** @param {string[]} list */
const sorted = (list) => list.toSorted((a, b) => a.localeCompare(b))

/** @param {string} dir @param {string[]} args */
const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()

/** The files of the change tree, relative: what the branch's diff holds. */
const changed = sorted(
  (await readdir(CHANGE, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(CHANGE, path.join(entry.parentPath, entry.name))),
)

/** @type {string} */
let dir
/** @type {import('../skills/tranchant/scripts/lib/format.mjs').Review} */
let placed

before(async (t) => {
  dir = await tempDir(t, 'tranchant-playground-')
  placed = buildPlayground(dir, await fixture('front-end'), { app: true })
})

test('the branch holds the change tree, checked out over the clean app', async () => {
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), BRANCH)
  assert.equal(git(dir, 'rev-parse', 'HEAD'), placed.headSha)
  assert.deepEqual(
    sorted(git(dir, 'diff', '--name-only', 'main...HEAD').split('\n')),
    changed,
  )
  assert.equal(git(dir, 'status', '--porcelain'), '')
  // The clean app is the base, with the project's own instructions.
  assert.match(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8'), /## Conventions/)
  assert.doesNotMatch(
    await readFile(path.join(dir, 'src/cart/Cart.tsx'), 'utf8'),
    /playground/,
  )
})

test('the front-end review is sound, and anchored on the branch', async () => {
  assert.deepEqual(validateReview(placed), [])
  assert.equal(placed.project, dir)
  assert.equal(placed.branch, BRANCH)
  assert.equal(placed.base, 'main')
  assert.equal(placed.findings.length, 7)
  for (const finding of placed.findings) {
    for (const { path: file, excerpt } of [finding, ...(finding.related ?? [])]) {
      const lines = (await readFile(path.join(dir, file), 'utf8')).split('\n')
      assert.deepEqual(
        lines.slice(excerpt.startLine - 1, excerpt.startLine - 1 + excerpt.lines.length),
        excerpt.lines,
        `${finding.id}: ${file}:${excerpt.startLine}`,
      )
      assert.ok(changed.includes(file), `${finding.id}: ${file} is in the diff`)
    }
  }
  // Every lens has its planted defect.
  assert.deepEqual(
    sorted(placed.findings.map((finding) => finding.id.replace(/-\d+$/, ''))),
    [
      'accessibility',
      'conventions',
      'correctness',
      'correctness',
      'security',
      'tests',
      'types',
    ],
  )
})

test('the live envelope is the same review in progress, with no finding yet', () => {
  const live = inProgress(placed)
  assert.deepEqual(validateReview(live), [])
  assert.equal(live.status, 'reviewing')
  assert.deepEqual(live.findings, [])
  assert.equal(live.headSha, placed.headSha)
  assert.notEqual(live.id, placed.id)
})
