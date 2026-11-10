#!/usr/bin/env node
// comments.mjs [<PR/MR url>]
// What `/tranchant comments` runs first, from the session's folder: reads the
// unresolved review threads of a pull request (`gh`) or a merge request
// (`glab`), the current branch's when no url is given, and writes a review
// with one finding per thread, `ours`, to <state>/inbox/<id>.json; prints
// `INBOX <file>`. The id is the PR/MR's own: run again, it is the same
// review, refreshed (open.mjs --refresh). A thread whose line moved since
// it was written is `outdated`, a thread on a whole file `file`; a GitLab
// discussion on no file is listed in the summary. Notes go to stderr. Any
// refusal prints `REVIEW_REFUSED <reason>` and exits 2.
// Nothing is written in the working tree; a head the checkout lacks is fetched.
// TRANCHANT_GH and TRANCHANT_GLAB name other executables (the tests' fakes).
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { firstLine, runWithInput } from './lib/command.mjs'
import { REVIEW_VERSION, oneLine, validateReview, problemsText } from './lib/format.mjs'
import { STATE_ROOT } from './lib/project.mjs'
import { loadSettings } from './lib/settings.mjs'
import { trackerOf, webOfRemote } from './lib/tracker.mjs'

/** @typedef {import('./lib/format.mjs').Finding} Finding */
/** @typedef {import('./lib/format.mjs').Thread} Thread */
/** @typedef {import('./lib/format.mjs').ThreadComment} ThreadComment */

/**
 * A thread as both forges come down to: where it sits, and what was said.
 * @typedef {object} Found
 * @property {'github' | 'gitlab'} forge
 * @property {string} id
 * @property {string} url
 * @property {string} path
 * @property {number} line Its line in the head, else in `commit`'s file; 1 on a whole file.
 * @property {number} [startLine] A comment on several lines: the first.
 * @property {boolean} outdated
 * @property {boolean} file
 * @property {string} [commit] The commit whose file `line` counts in when `outdated`: the one it was written on.
 * @property {boolean} [old] On a deleted line: `line` counts in the base's file, read at the change's merge base.
 * @property {ThreadComment[]} comments
 */

const run = promisify(execFile)
const BUFFER = 64 * 1024 * 1024
const CONTEXT = 3
const MAX_TITLE = 120
const MAX_LINE = 400
const MAX_COMMENTS = 100
const MAX_BODY = 65_536
const MAX_PAGES = 20
// A tab is the only control character a line of code may hold, as format.mjs says.
const CONTROL = /[^\P{Cc}\t]/gu
const SHA = /^[0-9a-f]{40}$/

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`REVIEW_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

/** A note for the person, on stderr: the import goes on. @param {string} text */
const note = (text) => console.error(`note: ${oneLine(text)}`)

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error)

/** What a command said on stderr, its first line, else its message. @param {unknown} error */
function words(error) {
  const stderr =
    error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
  return firstLine(stderr) || (message(error).split('\n')[0] ?? '')
}

const gh = () => process.env.TRANCHANT_GH || 'gh'
const glab = () => process.env.TRANCHANT_GLAB || 'glab'

/**
 * git in `cwd`; its stdout.
 * @param {string} cwd
 * @param {string[]} args
 */
const git = async (cwd, args) =>
  (await run('git', ['-C', cwd, ...args], { maxBuffer: BUFFER })).stdout

/** The commit `revision` names, or undefined. @param {string} cwd @param {string} revision */
const commitOf = (cwd, revision) =>
  git(cwd, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`]).then(
    (out) => out.trim() || undefined,
    () => undefined,
  )

/**
 * `sha`, fetched from origin when the checkout lacks it: by itself, else
 * through `ref` (the forge's ref of the PR/MR's head). '' once it is there,
 * else what git said.
 * @param {string} project
 * @param {string} sha
 * @param {string} [ref]
 */
async function ensureCommit(project, sha, ref) {
  if (await commitOf(project, sha)) return ''
  let said = 'git fetch found nothing'
  for (const one of [sha, ref]) {
    if (!one) continue
    await git(project, ['fetch', '--quiet', 'origin', one]).catch((error) => {
      said = `git fetch: ${words(error)}`
    })
    if (await commitOf(project, sha)) return ''
  }
  return said
}

/**
 * The lines of `file` at `commit`, or undefined when it is not there or
 * not text.
 * @param {string} project
 * @param {string} commit
 * @param {string} file
 */
async function linesAt(project, commit, file) {
  // An old version's commit, gone from the checkout after a force-push: fetched once.
  if (!(await commitOf(project, commit)) && !tried.has(commit)) {
    tried.add(commit)
    const said = await ensureCommit(project, commit)
    if (said)
      note(`commit ${commit} is not in the checkout (${said}): its threads read the head`)
  }
  const text = await git(project, ['cat-file', 'blob', `${commit}:${file}`]).catch(
    () => undefined,
  )
  if (text === undefined || text.includes('\0')) return undefined
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((line) => line.replace(/\r$/, ''))
}

/** The commits fetched once already for an old version's excerpt. @type {Set<string>} */
const tried = new Set()

/**
 * `body` cut to `max` characters.
 * @param {string} body
 * @param {number} max
 */
const cut = (body, max) => (body.length <= max ? body : `${body.slice(0, max - 1)}…`)

/**
 * A finding's title from what the reviewer wrote: its first words, as plain text.
 * @param {string} body
 * @param {string} author
 */
function titleOf(body, author) {
  // A suggestion's code is no title: the words around it are.
  const prose = body.replace(/^\s*```[^\n]*\n[\s\S]*?(?:^\s*```\s*$|(?![\s\S]))/gm, '')
  const first =
    prose
      .split('\n')
      .map((line) =>
        line
          .replace(/^\s*(?:[#>*+-]|\d+\.)+\s*/, '')
          .replace(/[`*_~]/g, '')
          .trim(),
      )
      .find(Boolean) ?? ''
  return cut(first || `Comment by @${author}`, MAX_TITLE)
}

/**
 * The finding for a thread, the reviewer's comment as its problem: its
 * excerpt from the head, or from the commit it was written on when it is
 * outdated (what the reviewer read), each the other's fallback.
 * @param {string} project
 * @param {string} head
 * @param {Found} thread
 * @returns {Promise<Finding>}
 */
async function findingOf(project, head, thread) {
  let { line, outdated } = thread
  const then = thread.commit && thread.commit !== head ? thread.commit : undefined
  let lines = await linesAt(project, outdated && then ? then : head, thread.path)
  if (!lines && then) {
    lines = await linesAt(project, outdated ? head : then, thread.path)
    outdated = true
  }
  if (!lines?.length) {
    // Neither commit has it as text: one blank line holds its place, on the file's header.
    lines = ['']
    outdated = true
    line = 1
  } else if (line > lines.length) {
    line = lines.length
    outdated = true
  }
  // A selection longer than an excerpt keeps its last lines: the anchor must be in it.
  const first =
    thread.startLine && !outdated
      ? Math.max(1, thread.startLine, line - (79 - CONTEXT))
      : line
  const from = Math.max(1, Math.min(first, line) - CONTEXT)
  const to = Math.min(lines.length, line + CONTEXT, from + 79)
  const excerpt = lines
    .slice(from - 1, to)
    .map((one) => cut(one.replace(CONTROL, ''), MAX_LINE))
  const marked = outdated || thread.file ? [] : range(Math.max(from, first), line)
  const [opening] = thread.comments
  const body = opening?.body.trim() ?? ''
  const author = opening?.author ?? 'unknown'
  const replies = thread.comments.length - 1
  return {
    id: `t-${createHash('sha1').update(`${thread.forge} ${thread.id}`).digest('hex').slice(0, 10)}`,
    topic: 'Code Quality',
    bucket: 'review',
    tag: body.includes('```suggestion')
      ? 'suggestion'
      : body.endsWith('?')
        ? 'question'
        : 'concern',
    title: titleOf(body, author),
    path: thread.path,
    line,
    excerpt: { startLine: from, lines: excerpt },
    ...(marked.length && { marks: marked.map((one) => ({ line: one })) }),
    problem: body || '_The comment has no text._',
    why: `@${author} left it on the ${thread.forge === 'github' ? 'pull request' : 'merge request'}, unresolved${replies ? ` (${replies} ${replies === 1 ? 'reply' : 'replies'})` : ''}.`,
    fix: 'Address the comment as its thread asks, then reply on the thread.',
    thread: {
      forge: thread.forge,
      id: thread.id,
      url: thread.url,
      comments: thread.comments,
      ...(outdated && { outdated: true }),
      ...(thread.file && { file: true }),
    },
  }
}

/** The integers from `from` to `to`. @param {number} from @param {number} to */
const range = (from, to) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)

/**
 * A comment as the finding keeps it.
 * @param {{ author: unknown, body: unknown, at: unknown, url?: unknown }} raw
 * @returns {ThreadComment}
 */
const commentOf = ({ author, body, at, url }) => ({
  author: typeof author === 'string' && author.trim() ? author.trim() : 'ghost',
  body: typeof body === 'string' ? cut(body, MAX_BODY) : '',
  at: typeof at === 'string' && at ? at : new Date(0).toISOString(),
  ...(typeof url === 'string' && /^https?:\/\//.test(url) && { url }),
})

/**
 * Who runs the import, the page's "you": a forge user name, or nothing.
 * @param {unknown} login
 */
const viewerOf = (login) =>
  typeof login === 'string' && /^[\w.-]{1,255}$/.test(login) ? { viewer: login } : {}

/**
 * The GitLab user glab speaks for, on the origin's host; undefined, with a note, when glab cannot say.
 * @param {string} project
 */
async function gitlabViewer(project) {
  try {
    const { stdout } = await run(glab(), ['api', 'user'], {
      cwd: project,
      maxBuffer: BUFFER,
    })
    return JSON.parse(stdout)?.username
  } catch (error) {
    note(
      `glab cannot tell who you are, your own comments are not marked: ${words(error)}`,
    )
    return undefined
  }
}

// GitHub: the pull request through `gh pr view`, its threads through GraphQL.

const THREADS = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine startLine originalStartLine diffSide subjectType
          comments(first: ${MAX_COMMENTS}) {
            nodes { author { login } body createdAt url originalCommit { oid } }
          }
        }
      }
    }
  }
}`

/**
 * @param {string} project
 * @param {string | undefined} url
 */
async function github(project, url) {
  let pr
  try {
    const { stdout } = await run(
      gh(),
      [
        'pr',
        'view',
        ...(url ? [url] : []),
        '--json',
        'number,url,title,headRefName,headRefOid,baseRefName,baseRefOid,author',
      ],
      { cwd: project, maxBuffer: BUFFER },
    )
    pr = JSON.parse(stdout)
  } catch (error) {
    return refuse(
      `gh cannot read ${url ?? "the current branch's pull request"}: ${words(error)}`,
    )
  }
  const where = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(String(pr?.url))
  if (!where || !Number.isInteger(pr.number) || !/^[0-9a-f]{40}$/.test(pr.headRefOid))
    return refuse(`gh read ${url ?? 'the pull request'} without its url, number or head`)
  const [, host = 'github.com', owner = '', name = ''] = where
  /** @type {any[]} */
  const nodes = []
  /** @type {unknown} */
  let viewer
  let after = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const ran = await runWithInput(
      gh(),
      ['api', 'graphql', '--method', 'POST', '--hostname', host, '--input', '-'],
      JSON.stringify({
        query: THREADS,
        variables: { owner, name, number: pr.number, after },
      }),
      project,
    )
    if (ran.code !== 0)
      return refuse(
        `gh cannot read the threads of ${pr.url}: ${firstLine(ran.stderr) || firstLine(ran.stdout)}`,
      )
    let answer
    try {
      answer = JSON.parse(ran.stdout)
    } catch {
      return refuse(`gh answered the threads of ${pr.url} with something other than JSON`)
    }
    viewer ??= answer?.data?.viewer?.login
    const threads = answer?.data?.repository?.pullRequest?.reviewThreads
    if (!threads) return refuse(`gh read ${pr.url} without its review threads`)
    nodes.push(...(threads.nodes ?? []))
    if (!threads.pageInfo?.hasNextPage) break
    after = threads.pageInfo.endCursor
    if (page === MAX_PAGES - 1)
      note(`${pr.url} has more threads than ${MAX_PAGES * 100}: the rest is left out`)
  }
  /** @type {Found[]} */
  const found = nodes.flatMap((node) => {
    if (node?.isResolved !== false || typeof node.path !== 'string') return []
    const comments = (node.comments?.nodes ?? []).map((/** @type {any} */ one) =>
      commentOf({
        author: one?.author?.login,
        body: one?.body,
        at: one?.createdAt,
        url: one?.url,
      }),
    )
    if (!comments.length) return []
    const file = node.subjectType === 'FILE'
    // On the old side, the line is the deleted one's, in the base's file.
    const left = node.diffSide === 'LEFT'
    const current = Number.isInteger(node.line) && !left ? node.line : undefined
    const was = Number.isInteger(node.originalLine) ? node.originalLine : undefined
    const commit = node.comments?.nodes?.[0]?.originalCommit?.oid
    return [
      {
        forge: /** @type {const} */ ('github'),
        id: String(node.id),
        url: comments[0]?.url ?? pr.url,
        path: node.path,
        line: file ? 1 : (current ?? was ?? node.line ?? 1),
        ...(Number.isInteger(node.startLine) && { startLine: node.startLine }),
        outdated: !file && (node.isOutdated === true || left || current === undefined),
        file,
        ...(left && !file && { old: true }),
        // A commit goes to git as an argument: a sha, or nothing.
        ...(typeof commit === 'string' && SHA.test(commit) && { commit }),
        comments,
      },
    ]
  })
  return {
    name: `${owner}/${name}#${pr.number}`,
    branch: String(pr.headRefName || `#${pr.number}`),
    headSha: pr.headRefOid,
    headRef: `pull/${pr.number}/head`,
    base: {
      sha: SHA.test(String(pr.baseRefOid)) ? pr.baseRefOid : undefined,
      name: `origin/${pr.baseRefName}`,
    },
    mr: {
      forge: /** @type {const} */ ('github'),
      project: `${owner}/${name}`,
      iid: pr.number,
      url: pr.url,
      author: String(pr.author?.login || 'unknown'),
      ...viewerOf(viewer),
    },
    found,
    general: /** @type {{ author: string, body: string, url: string }[]} */ ([]),
  }
}

// GitLab: the merge request through `glab mr view`, its discussions through the API.

/**
 * @param {string} project
 * @param {string | undefined} url
 */
async function gitlab(project, url) {
  const branch = url
    ? undefined
    : (
        await git(project, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(
          (error) =>
            // git says 1 for a detached HEAD, and its own words for anything else.
            error?.code === 1
              ? ''
              : refuse(`git cannot read the branch: ${words(error)}`),
        )
      ).trim()
  if (!url && !branch) return refuse('HEAD is detached: give the merge request url')
  let mr
  try {
    // From the project: glab takes the GitLab host from the checkout's remote.
    const { stdout } = await run(
      glab(),
      ['mr', 'view', url ?? String(branch), '-F', 'json'],
      {
        cwd: project,
        maxBuffer: BUFFER,
      },
    )
    mr = JSON.parse(stdout)
  } catch (error) {
    return refuse(
      `glab cannot read ${url ?? `the merge request of ${branch}`}: ${words(error)}`,
    )
  }
  const refs = mr?.diff_refs
  const sha = /^[0-9a-f]{7,64}$/
  if (
    !Number.isInteger(mr?.iid) ||
    typeof mr.web_url !== 'string' ||
    ![refs?.base_sha, refs?.head_sha, refs?.start_sha].every((one) => sha.test(one))
  )
    return refuse(
      `glab read ${url ?? 'the merge request'} without its iid, url or diff_refs`,
    )
  const where = /^https?:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/\d+/.exec(mr.web_url)
  const projectId = where?.[2] ?? mr.project_id
  // glab api, here and to reply, goes to the origin's host: the merge request must be there.
  const remote = await git(project, ['remote', 'get-url', 'origin']).catch(() => '')
  const origin = webOfRemote(remote)?.host
  if (where?.[1] && origin && where[1].toLowerCase() !== origin)
    return refuse(
      `${mr.web_url} is on ${where[1]}, the checkout's origin on ${origin}: run it from a checkout of the merge request's project`,
    )
  const endpoint = `projects/${encodeURIComponent(String(projectId))}/merge_requests/${mr.iid}/discussions`
  /** @type {any[]} */
  const discussions = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    let batch
    try {
      const { stdout } = await run(
        glab(),
        ['api', `${endpoint}?per_page=100&page=${page}`],
        {
          cwd: project,
          maxBuffer: BUFFER,
        },
      )
      batch = JSON.parse(stdout)
    } catch (error) {
      return refuse(`glab cannot read the discussions of ${mr.web_url}: ${words(error)}`)
    }
    if (!Array.isArray(batch))
      return refuse(`glab read ${mr.web_url} without its discussions`)
    discussions.push(...batch)
    if (batch.length < 100) break
    if (page === MAX_PAGES)
      note(
        `${mr.web_url} has more discussions than ${MAX_PAGES * 100}: the rest is left out`,
      )
  }
  const head = refs.head_sha
  /** @type {Found[]} */
  const found = []
  /** @type {{ author: string, body: string, url: string }[]} */
  const general = []
  for (const discussion of discussions) {
    const notes = (discussion?.notes ?? []).filter(
      (/** @type {any} */ one) => !one?.system,
    )
    const open = notes.some((/** @type {any} */ one) => one?.resolvable && !one.resolved)
    if (!open || typeof discussion.id !== 'string') continue
    const comments = notes.slice(0, MAX_COMMENTS).map((/** @type {any} */ one) =>
      commentOf({
        author: one?.author?.username,
        body: one?.body,
        at: one?.created_at,
        url: `${mr.web_url}#note_${one?.id}`,
      }),
    )
    const [opening] = comments
    if (!opening) continue
    const position = notes[0]?.position
    const filePath = position?.new_path ?? position?.old_path
    if (!position || typeof filePath !== 'string') {
      general.push({
        author: opening.author,
        body: opening.body,
        url: opening.url ?? mr.web_url,
      })
      continue
    }
    const file = position.position_type === 'file'
    const newLine = Number.isInteger(position.new_line) ? position.new_line : undefined
    const oldLine = Number.isInteger(position.old_line) ? position.old_line : undefined
    let outdated = !file && newLine === undefined
    const written = sha.test(String(position.head_sha)) ? position.head_sha : undefined
    if (!file && newLine !== undefined && written && written !== head) {
      // Written on an older version: in place only while its line still reads the same.
      const then = await linesAt(project, written, filePath)
      const now = await linesAt(project, head, filePath)
      outdated = !then || !now || then[newLine - 1] !== now[newLine - 1]
    }
    found.push({
      forge: 'gitlab',
      id: discussion.id,
      url: opening.url ?? mr.web_url,
      path: filePath,
      line: file ? 1 : (newLine ?? oldLine ?? 1),
      outdated,
      file,
      ...(!file && newLine === undefined && oldLine !== undefined && { old: true }),
      ...(written && { commit: written }),
      comments,
    })
  }
  return {
    name: `${projectId}!${mr.iid}`,
    branch: String(mr.source_branch || `!${mr.iid}`),
    headSha: head,
    headRef: `merge-requests/${mr.iid}/head`,
    base: { sha: refs.base_sha, name: refs.base_sha },
    mr: {
      forge: /** @type {const} */ ('gitlab'),
      project: projectId,
      iid: mr.iid,
      url: mr.web_url,
      author: String(mr.author?.username || 'unknown'),
      ...viewerOf(await gitlabViewer(project)),
      diffRefs: {
        baseSha: refs.base_sha,
        headSha: refs.head_sha,
        startSha: refs.start_sha,
      },
    },
    found,
    general,
  }
}

let parsed
try {
  parsed = parseArgs({ allowPositionals: true, options: {} })
} catch (error) {
  refuse(message(error))
}
const { positionals } = parsed
if (positionals.length > 1) refuse('give one pull request or merge request url at most')
const [target] = positionals
if (target !== undefined && !/^https?:\/\//.test(target))
  refuse(`${target} is not a pull request or merge request url`)

const cwd = process.cwd()
const top = await git(cwd, ['rev-parse', '--show-toplevel']).catch((error) =>
  refuse(`${cwd} is not in a git repository: ${words(error)}`),
)
if (!top.trim()) refuse(`${cwd} is not in a git repository`)
const project = path.resolve(top.trim())

/** The forge of `url`, or of the checkout's origin with no url. */
async function forgeOf(/** @type {string | undefined} */ url) {
  if (url && /\/pull\/\d+/.test(url)) return 'github'
  if (url && /\/-\/merge_requests\/\d+/.test(url)) return 'gitlab'
  if (url) return refuse(`${url} is neither a pull request nor a merge request url`)
  const { postWith } = (await loadSettings()).values
  const tracker = await trackerOf(project, {
    ...(postWith !== 'auto' && { forge: postWith === 'gh' ? 'github' : 'gitlab' }),
  }).catch((error) => refuse(message(error)))
  return tracker.kind
}

const change =
  (await forgeOf(target)) === 'github'
    ? await github(project, target)
    : await gitlab(project, target)
const missing = await ensureCommit(project, change.headSha, change.headRef)
if (missing)
  refuse(
    `commit ${change.headSha}, the head of ${change.mr.url}, is not in ${project} (${missing}): fetch it first`,
  )
/** @type {string} */
let base
const baseMissing = change.base.sha
  ? await ensureCommit(project, change.base.sha)
  : 'the forge did not name it'
if (change.base.sha && !baseMissing) base = change.base.sha
else if (await commitOf(project, change.base.name)) {
  base = change.base.name
  note(
    `the base commit of ${change.mr.url} is not in the checkout (${baseMissing}): the diff runs from ${base}, which may have moved since`,
  )
} else
  base = refuse(
    `the base of ${change.mr.url} is not in ${project} (${baseMissing}): fetch it first`,
  )
if (!change.found.length)
  refuse(
    `${change.mr.url} has no unresolved review thread on a file${change.general.length ? ` (${change.general.length} on the merge request itself)` : ''}`,
  )

// A deleted line counts in the base's file as the change found it.
const mergeBase =
  (await git(project, ['merge-base', base, change.headSha]).catch(() => '')).trim() ||
  base
const findings = []
for (const found of change.found)
  findings.push(
    await findingOf(
      project,
      change.headSha,
      found.old ? { ...found, commit: mergeBase } : found,
    ),
  )
const kind = change.mr.forge === 'github' ? 'pull request' : 'merge request'
const summary = [
  `The unresolved review threads of the ${kind} [${change.mr.url}](${change.mr.url}): ${findings.length} on its files.`,
  ...(change.general.length
    ? [
        '',
        `**On the ${kind} itself**, not on a file: settle them there.`,
        '',
        ...change.general.map(
          (one) =>
            `- @${one.author}, [the thread](${one.url}): ${cut(oneLine(one.body).trim(), 300) || '_no text_'}`,
        ),
      ]
    : []),
].join('\n')

const id = `comments-${createHash('sha1').update(change.mr.url).digest('hex').slice(0, 12)}`
const review = {
  version: REVIEW_VERSION,
  id,
  createdAt: new Date().toISOString(),
  project,
  branch: change.branch,
  base,
  headSha: change.headSha,
  ownership: 'ours',
  // The PR/MR's own title is a third party's words: it would reach the session as the tool's answer.
  title: `Comments on ${change.name}`.slice(0, 300),
  mr: change.mr,
  summary,
  strengths: [],
  findings,
}
const problems = validateReview(review)
if (problems.length)
  refuse(`the review of ${change.mr.url} is unsound: ${problemsText(problems)}`)
const inbox = path.join(STATE_ROOT, 'inbox')
await mkdir(inbox, { recursive: true })
const file = path.join(inbox, `${id}.json`)
await writeFile(file, `${JSON.stringify(review, null, 2)}\n`)
console.log(`INBOX ${file}`)
