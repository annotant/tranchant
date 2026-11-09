#!/usr/bin/env node
// post.mjs <id> --review <dir>
// Posts the finding's comment (the reviewer's edit when there is one) as a
// positioned discussion on the MR with `glab api`, then moves the finding
// from queued to posted, with the discussion's url, or to failed with glab's
// error. A finding from a PR/MR thread (`thread`) gets a reply on that
// thread instead, with `gh api graphql` on GitHub, `glab api` on GitLab, then
// the thread resolved when the reviewer asked: a resolve that fails leaves
// the reply posted, and says why. Prints `posted <url>` or `failed <reason>`.
// The server runs it on each post decision, one at a time; never an agent.
// TRANCHANT_GLAB and TRANCHANT_GH name other executables (the tests' fakes).
import { existsSync } from 'node:fs'
import { findReview, positional } from './lib/project.mjs'
import { firstLine, runWithInput } from './lib/command.mjs'
import { oneLine } from './lib/format.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'

const MAX_REASON = 300

/**
 * @param {string} reason
 * @returns {never}
 */
function failed(reason) {
  console.log(`failed ${oneLine(reason)}`)
  process.exit(1)
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

/**
 * Fails the post and says why: the reviewer reads the reason on the page.
 * @param {string} reason
 * @returns {Promise<never>}
 */
async function give(reason) {
  const short = reason.slice(0, MAX_REASON)
  await store.fail(id, short).catch((error) => {
    if (!(error instanceof StoreRefusal)) throw error
    console.error(error.message)
  })
  return failed(short)
}

// From the project: glab takes the GitLab host from the checkout's remote.
const cwd = existsSync(review.project) ? review.project : undefined
const json = ['--header', 'Content-Type: application/json', '--input', '-']

/**
 * Runs `tool` with `request` as its JSON body, and its answer parsed, or
 * fails the post with the tool's first error line.
 * @param {'gh' | 'glab'} tool
 * @param {string[]} args
 * @param {object} request
 * @returns {Promise<any>}
 */
async function call(tool, args, request) {
  const command =
    tool === 'gh'
      ? process.env.TRANCHANT_GH || 'gh'
      : process.env.TRANCHANT_GLAB || 'glab'
  const ran = await runWithInput(command, args, JSON.stringify(request), cwd)
  if (ran.code !== 0)
    return give(
      firstLine(ran.stderr) || firstLine(ran.stdout) || `${tool} exited with ${ran.code}`,
    )
  try {
    return JSON.parse(ran.stdout)
  } catch {
    return give(`${tool} answered something other than JSON`)
  }
}

/**
 * Like `call`, for what comes once the reply is posted: the reason it
 * failed, never a failed post.
 * @param {'gh' | 'glab'} tool
 * @param {string[]} args
 * @param {object} request
 * @returns {Promise<string | undefined>}
 */
async function after(tool, args, request) {
  const command =
    tool === 'gh'
      ? process.env.TRANCHANT_GH || 'gh'
      : process.env.TRANCHANT_GLAB || 'glab'
  const ran = await runWithInput(command, args, JSON.stringify(request), cwd)
  if (ran.code === 0 && !/"errors"\s*:/.test(ran.stdout)) return undefined
  return (
    firstLine(ran.stderr) ||
    firstLine(ran.stdout) ||
    `${tool} exited with ${ran.code}`
  ).slice(0, MAX_REASON)
}

/**
 * Records the post, and says where it landed: the reviewer may have moved
 * the finding meanwhile, the post is there all the same.
 * @param {{ discussionId: string, url: string, resolved?: boolean, unresolved?: string }} where
 */
async function landed(where) {
  try {
    await store.posted(id, where)
  } catch (error) {
    if (!(error instanceof StoreRefusal)) throw error
    console.error(`${error.message}; the comment is posted at ${where.url}`)
  }
  if (where.unresolved) console.error(`the thread is not resolved: ${where.unresolved}`)
  console.log(`posted ${where.url}`)
  process.exit(0)
}

const { mr } = review
const thread = finding?.thread
if (thread) {
  const body = entry?.comment
  if (!mr) await give('the review has no PR/MR to reply on')
  if (!body) await give(`the reply on ${id}'s thread is empty`)
  const resolve = entry?.decision?.resolve === true
  if (thread.forge === 'github') {
    const host = /^https?:\/\/([^/]+)/.exec(String(mr?.url))?.[1] ?? 'github.com'
    const graphql = ['api', 'graphql', '--method', 'POST', '--hostname', host, ...json]
    const answer = await call('gh', graphql, {
      query:
        'mutation($thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { url } } }',
      variables: { thread: thread.id, body },
    })
    const url = answer?.data?.addPullRequestReviewThreadReply?.comment?.url
    if (typeof url !== 'string' || !/^https?:\/\//.test(url))
      await give(
        `gh answered without the reply's url: ${firstLine(JSON.stringify(answer?.errors ?? answer ?? '')).slice(0, 200)}`,
      )
    const unresolved = resolve
      ? await after('gh', graphql, {
          query:
            'mutation($thread: ID!) { resolveReviewThread(input: { threadId: $thread }) { thread { isResolved } } }',
          variables: { thread: thread.id },
        })
      : undefined
    await landed({
      discussionId: thread.id,
      url,
      ...(resolve && (unresolved ? { unresolved } : { resolved: true })),
    })
  }
  const discussion = `projects/${encodeURIComponent(String(mr?.project))}/merge_requests/${mr?.iid}/discussions/${encodeURIComponent(thread.id)}`
  const note = await call(
    'glab',
    ['api', '--method', 'POST', ...json, `${discussion}/notes`],
    {
      body,
    },
  )
  if (note?.id === undefined) await give("glab answered without the reply's id")
  const unresolved = resolve
    ? await after('glab', ['api', '--method', 'PUT', ...json, discussion], {
        resolved: true,
      })
    : undefined
  await landed({
    discussionId: thread.id,
    url: `${mr?.url}#note_${note?.id}`,
    ...(resolve && (unresolved ? { unresolved } : { resolved: true })),
  })
}

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
const ran = await runWithInput(process.env.TRANCHANT_GLAB || 'glab', args, request, cwd)
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
