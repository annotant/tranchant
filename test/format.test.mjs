import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DECISIONS_VERSION,
  FormatError,
  MOVES,
  REVIEW_VERSION,
  STATES,
  canMove,
  contentOf,
  currentRun,
  envelopeOf,
  identityOf,
  nextRunId,
  oneLine,
  parseDecisions,
  parseReview,
  statusOf,
  validateEnvelope,
  validateFinding,
  validateReview,
} from '../skills/tranchant/scripts/lib/format.mjs'
import { fixture } from './helpers.mjs'

/** @typedef {import('../skills/tranchant/scripts/lib/format.mjs').State} State */
/** @typedef {import('../skills/tranchant/scripts/lib/format.mjs').Move} Move */

test('both fixtures are sound', async () => {
  for (const name of /** @type {const} */ (['theirs', 'ours'])) {
    assert.deepEqual(validateReview(await fixture(name)), [], name)
  }
})

test('names each required field of the envelope that is missing', async () => {
  const required = [
    'id',
    'createdAt',
    'project',
    'branch',
    'base',
    'headSha',
    'ownership',
    'title',
    'summary',
    'strengths',
    'findings',
  ]
  for (const key of required) {
    const review = await fixture('theirs')
    delete review[key]
    const problems = validateReview(review)
    assert.ok(
      problems.some((problem) => problem.startsWith(`${key}:`)),
      `${key}: ${problems.join('; ')}`,
    )
  }
})

test('names each required field of a finding that is missing', async () => {
  const required = [
    'id',
    'topic',
    'bucket',
    'title',
    'path',
    'line',
    'excerpt',
    'problem',
    'why',
    'fix',
    'comment',
  ]
  for (const key of required) {
    const review = await fixture('theirs')
    delete review.findings[1][key]
    const problems = validateReview(review)
    assert.ok(
      problems.some((problem) => problem.startsWith(`findings[1].${key}`)),
      `${key}: ${problems.join('; ')}`,
    )
  }
  // A comment is only required on someone else's change.
  const ours = await fixture('ours')
  assert.deepEqual(validateReview(ours), [])
})

test('a review may have no finding only while it is reviewing', async () => {
  const review = await fixture('ours')
  review.findings = []
  assert.deepEqual(validateReview(review), ['findings: at least one is required'])
  assert.equal(statusOf(review), 'complete')
  review.status = 'reviewing'
  assert.deepEqual(validateReview(review), [])
  assert.equal(statusOf(review), 'reviewing')
  review.status = 'done'
  assert.deepEqual(validateReview(review), [
    'status: reviewing or complete',
    'findings: at least one is required',
  ])
  review.status = 'reviewing'
  review.findings = 'none'
  assert.deepEqual(validateReview(review), ['findings: an array is required'])
  // The envelope alone says nothing about the findings.
  delete review.findings
  assert.deepEqual(validateEnvelope(review), [])
  assert.deepEqual(validateEnvelope({ ...review, version: 2 }), [
    `unknown review format (version 2): this Tranchant reads version ${REVIEW_VERSION}`,
  ])
})

test('checks one finding as the review does; a comment is required on theirs', async () => {
  const { findings } = await fixture('ours')
  assert.deepEqual(validateFinding(findings[0]), [])
  assert.deepEqual(validateFinding(findings[0], { theirs: true }), [
    'finding.comment: required when ownership is theirs',
  ])
  assert.deepEqual(validateFinding({ ...findings[0], line: 1 }, { where: 'f' }), [
    'f.line: 1 is outside the excerpt',
  ])
  assert.deepEqual(validateFinding(null), ['finding: an object is required'])
  assert.deepEqual(validateFinding({ ...findings[0], addedAt: 3 }), [
    'finding.addedAt: a date is required',
  ])
  assert.deepEqual(
    validateFinding({ ...findings[0], addedAt: '2026-10-30T16:02:11Z' }),
    [],
  )
})

test('tells reviews apart by their envelope and findings by their content, however laid out', async () => {
  const review = await fixture('ours')
  const envelope = envelopeOf(review)
  assert.equal('findings' in envelope, false)
  assert.equal(envelope.title, review.title)
  // Grown and completed, it is still the same review.
  assert.equal(
    identityOf({ ...review, status: 'complete', findings: [] }),
    identityOf({ ...review, status: 'reviewing' }),
  )
  assert.equal(
    identityOf(Object.fromEntries(Object.entries(review).toReversed())),
    identityOf(review),
  )
  assert.notEqual(identityOf({ ...review, title: 'Other' }), identityOf(review))
  const [finding] = review.findings
  assert.equal(
    contentOf({ ...finding, addedAt: 'now' }),
    contentOf(Object.fromEntries(Object.entries(finding).toReversed())),
  )
  assert.notEqual(contentOf({ ...finding, line: 43 }), contentOf(finding))
})

test('refuses another version first, and says nothing else', async () => {
  const review = await fixture('theirs')
  review.version = 2
  delete review.title
  assert.deepEqual(validateReview(review), [
    `unknown review format (version 2): this Tranchant reads version ${REVIEW_VERSION}`,
  ])
  assert.deepEqual(validateReview(null), ['a JSON object is required'])
})

/**
 * The problems of the theirs fixture once `change` touched it.
 * @param {(review: any) => unknown} change
 */
async function problemsWith(change) {
  const review = await fixture('theirs')
  change(review)
  return validateReview(review)
}

test('checks the anchor against the excerpt, the hunk and the marks', async () => {
  assert.deepEqual(await problemsWith((r) => (r.findings[0].line = 99)), [
    'findings[0].line: 99 is outside the excerpt',
  ])
  assert.deepEqual(await problemsWith((r) => (r.findings[0].marks[1].line = 2)), [
    'findings[0].marks[1].line: 2 is outside the excerpt',
  ])
  assert.deepEqual(await problemsWith((r) => (r.findings[0].marks[0].to = 3)), [
    'findings[0].marks[0]: to must be after from',
  ])
  // The hunk's new side, not the excerpt, holds the line when there is one.
  assert.deepEqual(
    await problemsWith((r) => (r.findings[1].hunk = '@@ -1,2 +100,2 @@\n a\n b')),
    [
      'findings[1].line: 27 is outside the hunk',
      'findings[1].marks[0].line: 27 is outside the excerpt',
    ],
  )
  assert.deepEqual(await problemsWith((r) => (r.findings[1].hunk = 'not a hunk')), [
    'findings[1].hunk: must start with a hunk header (@@ -a,b +c,d @@)',
  ])
  assert.deepEqual(await problemsWith((r) => (r.findings[2].id = 'f-01')), [
    'findings[2].id: f-01 is used twice',
  ])
  for (const bad of ['/etc/passwd', '../secrets.ts', 'C:\\x.ts', '']) {
    assert.deepEqual(
      await problemsWith((r) => (r.findings[3].path = bad)),
      ['findings[3].path: a path relative to the project is required'],
      bad,
    )
  }
  assert.deepEqual(
    await problemsWith((r) => (r.findings[3].excerpt.lines[0] = 'a\u0007b')),
    ['findings[3].excerpt.lines[0]: control characters other than tabs are not allowed'],
  )
  assert.deepEqual(
    await problemsWith((r) => (r.findings[3].excerpt.lines[0] = '\tok')),
    [],
  )
  assert.deepEqual(
    await problemsWith(
      (r) =>
        (r.findings[4].related = Array.from(
          { length: 5 },
          () => r.findings[4].related[0],
        )),
    ),
    ['findings[4].related: up to 4 excerpts'],
  )
  assert.deepEqual(await problemsWith((r) => (r.findings[0].diagram.kind = 'png')), [
    'findings[0].diagram.kind: svg or text',
  ])
  assert.deepEqual(await problemsWith((r) => delete r.mr.diffRefs.startSha), [
    'mr.diffRefs.startSha: a sha is required',
  ])
  assert.deepEqual(await problemsWith((r) => (r.findings[0].tag = 'nit')), [
    'findings[0].tag: concern, question, suggestion',
  ])
  assert.deepEqual(await problemsWith((r) => (r.findings[0].topic = 'Style')), [
    'findings[0].topic: one of Bugs, Security & Permissions, Breaking Changes, Tests, Conventions, Code Quality, Deprecation & Feature Flags',
  ])
})

test('parseReview names the first problems, and refuses what is not JSON', async () => {
  const review = await fixture('ours')
  delete review.title
  delete review.summary
  delete review.branch
  delete review.base
  assert.throws(
    () => parseReview(JSON.stringify(review)),
    (error) =>
      error instanceof FormatError &&
      error.message ===
        'branch: a text is required; base: a text is required; title: a text is required (and 1 more)',
  )
  assert.throws(() => parseReview('{'), /the review is not JSON/)
  assert.equal(parseReview(JSON.stringify(await fixture('ours'))).id, review.id)
})

test('reads decisions of its version, and refuses another untouched', () => {
  const decisions = parseDecisions(
    JSON.stringify({ version: DECISIONS_VERSION, findings: {} }),
  )
  assert.deepEqual(decisions, { version: 1, findings: {} })
  assert.throws(
    () =>
      parseDecisions(JSON.stringify({ version: 2, findings: {} }), '/x/decisions.json'),
    (error) =>
      error instanceof FormatError &&
      error.message ===
        'unknown decisions format (version 2) in /x/decisions.json: this Tranchant reads version 1',
  )
  assert.throws(() => parseDecisions('[]'), FormatError)
})

/** @type {Move[]} */
const MOVE_NAMES = [
  'fix',
  'post',
  'drop',
  'skip',
  'answer',
  'stop',
  'claim',
  'done',
  'ask',
  'posted',
  'fail',
]

// Nothing has landed in these states: the reviewer may still drop or skip.
/** @type {State[]} */
const DROP_FROM = ['open', 'queued', 'asking', 'failed', 'stopped', 'skipped']
/** @type {State[]} */
const SKIP_FROM = ['open', 'queued', 'asking', 'failed', 'stopped', 'dropped']

/** The moves the contract lists, from each state. @type {[Move, State, State][]} */
const ALLOWED = [
  ['fix', 'open', 'queued'],
  ['fix', 'dropped', 'queued'],
  ['fix', 'skipped', 'queued'],
  ['fix', 'failed', 'queued'],
  ['fix', 'stopped', 'queued'],
  ['post', 'open', 'queued'],
  ['post', 'dropped', 'queued'],
  ['post', 'skipped', 'queued'],
  ['post', 'failed', 'queued'],
  ['answer', 'asking', 'queued'],
  ['stop', 'queued', 'stopped'],
  ['stop', 'working', 'stopped'],
  ['claim', 'queued', 'working'],
  ['done', 'working', 'fixed'],
  ['ask', 'working', 'asking'],
  ['posted', 'queued', 'posted'],
  ['fail', 'queued', 'failed'],
  ['fail', 'working', 'failed'],
  ...DROP_FROM.map(
    (state) => /** @type {[Move, State, State]} */ (['drop', state, 'dropped']),
  ),
  ...SKIP_FROM.map(
    (state) => /** @type {[Move, State, State]} */ (['skip', state, 'skipped']),
  ),
]

test('allows every move of the table, and no other', () => {
  for (const [move, from, to] of ALLOWED) {
    assert.ok(canMove(move, from), `${move} from ${from}`)
    assert.equal(MOVES[move].to, to, move)
  }
  assert.deepEqual(Object.keys(MOVES), MOVE_NAMES)
  for (const move of MOVE_NAMES) {
    for (const from of STATES) {
      const allowed = ALLOWED.some(([m, f]) => m === move && f === from)
      assert.equal(canMove(move, from), allowed, `${move} from ${from}`)
    }
  }
  // The ones an agent or the page could try: a fixed finding stays fixed, a
  // question is answered rather than fixed again, nothing moves a working one
  // but its agent, a stop or a failure.
  assert.equal(canMove('fix', 'fixed'), false)
  assert.equal(canMove('post', 'fixed'), false)
  assert.equal(canMove('drop', 'fixed'), false)
  assert.equal(canMove('skip', 'posted'), false)
  assert.equal(canMove('fix', 'asking'), false)
  assert.equal(canMove('post', 'posted'), false)
  assert.equal(canMove('drop', 'working'), false)
  assert.equal(canMove('claim', 'open'), false)
})

test('numbers runs in sequence, and finds the one in progress', () => {
  assert.equal(nextRunId({ runs: [] }), 'r1')
  const runs = [
    {
      id: 'r1',
      startedAt: '',
      endedAt: 'then',
      outcome: /** @type {const} */ ('asking'),
    },
    { id: 'r2', startedAt: '' },
  ]
  assert.equal(nextRunId({ runs }), 'r3')
  assert.equal(currentRun({ state: 'working', runs })?.id, 'r2')
  assert.equal(currentRun({ state: 'asking', runs }), undefined)
  assert.equal(currentRun({ state: 'working', runs: [runs[0]] }), undefined)
})

test('folds line breaks into one line, for the hooks', () => {
  assert.equal(oneLine('a\nb\r\nc\u2028d\u2029e'), 'a b  c d e')
})
