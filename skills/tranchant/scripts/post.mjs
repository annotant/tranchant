#!/usr/bin/env node
// post.mjs <id> --review <dir>
// Posts the finding's comment (the reviewer's edit when there is one) as a
// positioned discussion on the MR with `glab api`, then moves the finding
// from queued to posted, with the discussion's url, or to failed with glab's
// error. Prints `posted <url>` or `failed <reason>`. The server runs it on
// each post decision, one at a time; never an agent.
// TRANCHANT_GLAB names another glab executable (the tests' fake one).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { findReview, positional } from './lib/project.mjs'
import { oneLine } from './lib/format.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'

const MAX_REASON = 300
// Built, not written: a control character in a regex literal fails the linter.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** @param {string} reason */
function failed(reason) {
  console.log(`failed ${oneLine(reason)}`)
  process.exit(1)
}

/** glab's first line of error, without its colours. */
const firstLine = (/** @type {string} */ output) =>
  output
    .replaceAll(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('[glab] Update available')) ?? ''

/**
 * Runs glab with `body` on stdin.
 * @param {string} glab
 * @param {string[]} args
 * @param {string} body
 * @param {string | undefined} cwd
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function runGlab(glab, args, body, cwd) {
  return new Promise((resolve) => {
    const child = spawn(glab, args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => resolve({ code: null, stdout, stderr: String(error) }))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.on('error', () => undefined)
    child.stdin.end(body)
  })
}

const [id] = positional()
const dir = findReview()
if (!id || !dir) {
  console.error('usage: post.mjs <id> --review <dir>')
  process.exit(2)
}
const store = createStore(dir)
const { review, decisions } = await store.readAll()
const finding = review.findings.find((one) => one.id === id)
if (!finding) failed(`no finding ${id} in the review`)
const entry = decisions.findings[id]
if (!finding || entry?.state !== 'queued' || entry.decision?.action !== 'post') {
  failed(`finding ${id} is not queued for a post`)
}

/** Fails the post and says why: the reviewer reads the reason on the page. */
async function give(/** @type {string} */ reason) {
  const short = reason.slice(0, MAX_REASON)
  await store.fail(id, short).catch((error) => {
    if (!(error instanceof StoreRefusal)) throw error
    console.error(error.message)
  })
  failed(short)
}

const { mr } = review
const refs = mr?.diffRefs
if (!mr || !refs)
  await give('the review has no mr.diffRefs: nothing to position the comment on')
const body = entry?.comment ?? finding?.comment
if (!body) await give(`finding ${id} has no comment`)
const request = JSON.stringify({
  body,
  position: {
    position_type: 'text',
    base_sha: refs?.baseSha,
    head_sha: refs?.headSha,
    start_sha: refs?.startSha,
    old_path: finding?.path,
    new_path: finding?.path,
    new_line: finding?.line,
  },
})
const endpoint = `projects/${encodeURIComponent(String(mr?.project))}/merge_requests/${mr?.iid}/discussions`
// --input sends the JSON body as is, nested: glab's -f fields would flatten
// `position` into one key. The header: glab sends --input with no content type.
const args = [
  'api',
  '--method',
  'POST',
  '--header',
  'Content-Type: application/json',
  '--input',
  '-',
  endpoint,
]
// From the project: glab takes the GitLab host from the checkout's remote.
const cwd = existsSync(review.project) ? review.project : undefined
const ran = await runGlab(process.env.TRANCHANT_GLAB || 'glab', args, request, cwd)
if (ran.code !== 0) {
  await give(
    firstLine(ran.stderr) || firstLine(ran.stdout) || `glab exited with ${ran.code}`,
  )
}
let answer
try {
  answer = JSON.parse(ran.stdout)
} catch {
  await give('glab answered something other than the discussion')
}
const discussionId = String(answer?.id ?? '')
const noteId = answer?.notes?.[0]?.id
if (!discussionId) await give('glab answered without a discussion id')
const url = noteId === undefined ? String(mr?.url) : `${mr?.url}#note_${noteId}`
try {
  await store.posted(id, { discussionId, url })
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  // On the MR all the same: the reviewer moved the finding meanwhile.
  console.error(`${error.message}; the comment is posted at ${url}`)
}
console.log(`posted ${url}`)
