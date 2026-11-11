#!/usr/bin/env node
// server.mjs --review <dir>
// Serves the page and its API on a free port of 127.0.0.1, and prints one
// line per decision the plugin's hooks act on: FIX, STOP, DROPPED, SKIPPED,
// POSTED or POST_FAILED for the posts it runs itself (post.mjs, one at a
// time), MOVED or ISSUE_FAILED for the issues it opens (issue.mjs, in the
// same queue); LANDED for each finding a verifier must check, while a review whose
// findings are verified (`verify`) runs; DISCUSS for each question the
// reviewer asks about a finding. It watches the review folder, its
// findings, its run files and its review agents' (reviewers/), and
// pushes `changed` to the pages on /api/events: they reload only then. It
// watches the page's bundle too, and pushes `page` when a dev build replaces it.
// It computes the change's diff (/api/diff) once, with git, for the page's main view,
// and serves the text of its files at its head (/api/lines), for the lines its hunks hide.
// It serves and writes the user's settings (/api/settings, lib/settings.mjs),
// one write at a time, with the recipe in force and the recipes imported for
// the project (lib/imports.mjs), one of which /api/recipe/use puts in force;
// it pushes `settings` when the file or the imports change. It serves the
// Lenses step's progress (lenses.json) with the review.
// Only runs while a session watches (/tranchant): no server, no page.
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, watch } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { promisify } from 'node:util'
import { errorCode } from './lib/errors.mjs'
import { PLUGIN_ROOT, PLUGIN_VERSION, SKILL_DIR, findReview } from './lib/project.mjs'
import { oneLine, postBlocker, replyPending, statusOf } from './lib/format.mjs'
import { readDiscussions, say, syncChange, waitsForAnswer } from './lib/discussion.mjs'
import { ImportRefusal, importsDir, listImports, useImport } from './lib/imports.mjs'
import { describeRecipe } from './lib/lens.mjs'
import {
  DEFAULTS,
  SETTINGS_DIR,
  SETTINGS_FILE,
  SettingsRefusal,
  loadSettings,
  writeSettings,
} from './lib/settings.mjs'
import { trackerOf } from './lib/tracker.mjs'
import {
  MAX_ISSUE_BODY,
  MAX_ISSUE_TITLE,
  StoreRefusal,
  WRITE_KINDS,
  createStore,
  readProgress,
  readReviewAgents,
} from './lib/store.mjs'

/** @typedef {import('./lib/format.mjs').Entry} Entry */
/** @typedef {import('./lib/format.mjs').Step} Step */

const found = findReview()
if (!found) {
  console.error('usage: server.mjs --review <dir>')
  process.exit(2)
}
const dir = found
// The plugin's hooks (a Claude Code mod) set it in the session that starts the
// server. Without them a fix would run with no locks and show no progress.
if (!process.env.TRANCHANT_HOOKS) {
  console.log(
    "HOOKS_MISSING Tranchant's hooks did not load: they need Claude Code 2.1.287 or later",
  )
  process.exit(2)
}
const store = createStore(dir)
/** @type {import('./lib/format.mjs').Review} */
let review
try {
  review = await store.readReview()
  await store.readDecisions()
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  console.log(`REVIEW_REFUSED ${oneLine(error.message)}`)
  process.exit(2)
}
const PAGE = process.env.TRANCHANT_PAGE ?? path.join(SKILL_DIR, 'page', 'dist', 'page.js')
// Releases ship the built page; a clone of the repository builds it first.
if (!existsSync(PAGE)) {
  console.log(`PAGE_MISSING run \`npm ci && npm run build\` in ${PLUGIN_ROOT}`)
  process.exit(2)
}
// The parts of the page it loads on demand (Mermaid), next to it: a name, never a path.
const CHUNKS = path.join(path.dirname(PAGE), 'chunks')
const CHUNK = /^\/chunks\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\.js$/
const POST = path.join(SKILL_DIR, 'scripts', 'post.mjs')
const ISSUE = path.join(SKILL_DIR, 'scripts', 'issue.mjs')
const port = Number(process.env.TRANCHANT_PORT ?? 0)
// The re-read behind the folder watches, for the mounts whose writes they miss.
const pollMs = Number(process.env.TRANCHANT_POLL_MS ?? 5000)
const { project } = review
const runsDir = path.join(dir, 'runs')
const findingsDir = path.join(dir, 'findings')
const agentsDir = path.join(dir, 'reviewers')
const discussionsDir = path.join(dir, 'discussions')
/** A discussing agent's name: its steps are the discussion's, not a review agent's. */
const DISCUSSER = /^ds-/

/** The server's own origins, once it listens: the page's requests carry one of them. */
const origins = new Set()

function send(res, status, body, headers = {}) {
  const json = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    ...headers,
    ...(json && { 'content-type': 'application/json' }),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  res.end(json)
}

/** What the server answers to a request the client got wrong, by status. */
const CLIENT_ERRORS = /** @type {const} */ ({
  400: 'invalid JSON',
  403: 'origin not allowed',
  413: 'body too large',
})

/**
 * A request the client got wrong. The response takes its text from
 * CLIENT_ERRORS, never from the exception: no exception text reaches a client.
 */
class ClientError extends Error {
  /** @param {keyof typeof CLIENT_ERRORS} status */
  constructor(status) {
    super(CLIENT_ERRORS[status])
    this.status = status
  }
}

const MAX_BODY = 500_000

async function readJson(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw new ClientError(413)
  // Decoded as a whole: a character split between two chunks stays one.
  req.setEncoding('utf8')
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY) throw new ClientError(413)
  }
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    throw new ClientError(400)
  }
}

const ID = /^[\w-]{1,64}$/
const RUN_ID = /^r\d{1,6}$/
const MAX_RUNS = 50
const MAX_TEXT = 4000
const MAX_DECISIONS = 500
const ACTIONS = new Set(['fix', 'post', 'issue', 'drop', 'skip'])
// A reply's proposal is the `at` of the agent's message it came from, not text.
const MAX_PROPOSAL = 64

/** @param {unknown} value */
const text = (value, max = MAX_TEXT) =>
  typeof value === 'string' ? value.trim().slice(0, max) : undefined

/**
 * One decision of a batch, as the page sends it; undefined when it is not one.
 * @param {any} input
 * @returns {{ id: string, action: 'fix' | 'post' | 'issue' | 'drop' | 'skip', context?: string, comment?: string, resolve?: boolean, proposal?: string, reason?: string, title?: string, body?: string } | undefined}
 */
function sanitiseDecision(input) {
  if (!input || typeof input !== 'object') return undefined
  const { id, action } = input
  if (typeof id !== 'string' || !ID.test(id) || !ACTIONS.has(action)) return undefined
  return {
    id,
    action,
    context: text(input.context),
    comment: text(input.comment),
    resolve: input.resolve === true,
    proposal: text(input.proposal, MAX_PROPOSAL),
    reason: text(input.reason),
    title: text(input.title, MAX_ISSUE_TITLE),
    body: text(input.body, MAX_ISSUE_BODY),
  }
}

/** @param {string} value */
const escapeHtml = (value) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * The page's shell: the bundle draws everything in #root. The theme the
 * settings pick is on `<html>` from the start, so nothing flashes.
 * @param {'light' | 'dark' | 'system'} theme
 */
const shell = (theme) =>
  [
    '<!doctype html>',
    `<html lang="en"${theme === 'system' ? '' : ` data-theme="${theme}"`}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Tranchant · ${escapeHtml(review.title)}</title>`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    '<script type="module" src="/page.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')

// The page draws inline SVG the producer wrote: a script in it, missed by the
// page's sanitizer, would still not run.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const gitExec = promisify(execFile)

/** The checkout's HEAD, or null when git cannot say (no repository, no git). */
async function currentHead() {
  try {
    const { stdout } = await gitExec('git', ['-C', project, 'rev-parse', 'HEAD'], {
      timeout: 5000,
    })
    const sha = stdout.trim()
    return /^[0-9a-f]{7,64}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}

/** By tool, the account it posts as, asked once each. @type {Map<'glab' | 'gh', Promise<string | null>>} */
const accounts = new Map()

/**
 * The username `tool` posts as, read once from the project (glab takes the
 * host from its remote, gh too); null when the tool cannot say, and never
 * asked again.
 * @param {'glab' | 'gh'} tool
 */
function accountOnce(tool) {
  let account = accounts.get(tool)
  if (account) return account
  const command =
    tool === 'gh'
      ? process.env.TRANCHANT_GH || 'gh'
      : process.env.TRANCHANT_GLAB || 'glab'
  account = gitExec(command, ['api', 'user'], {
    cwd: existsSync(project) ? project : undefined,
    timeout: 10_000,
  })
    .then(({ stdout }) => {
      const answer = JSON.parse(stdout)
      // GitLab answers `username`, GitHub `login`.
      const username = tool === 'gh' ? answer?.login : answer?.username
      return typeof username === 'string' && username.trim() ? username.trim() : null
    })
    .catch((error) => {
      console.error(
        `tranchant server: /api/account: ${oneLine(String(error?.message ?? error))}`,
      )
      return null
    })
  accounts.set(tool, account)
  return account
}

/**
 * The CLI the settings post and open issues with: `glab` or `gh` as set,
 * else the tracker's forge, else glab, which posts the MR comments.
 * @param {import('./lib/settings.mjs').Values} values
 */
async function postingTool(values) {
  if (values.postWith !== 'auto') return values.postWith
  const { kind } = await trackerOnce(values)
  return kind === 'github' ? 'gh' : 'glab'
}

/** @typedef {{ kind: string | null, web?: string, prefix?: string, reason?: string }} TrackerAnswer */

/** By forge forced (`auto` when none), the tracker read once. @type {Map<string, Promise<TrackerAnswer>>} */
const trackers = new Map()

/**
 * Where the project's issues go, from its origin remote, as issue.mjs reads
 * it: the page names it and links an issue's anchor to the file on it. The
 * settings' `postWith` names the forge for a host neither tool recognises.
 * `kind` null, and why, when none; a failure is asked again next time.
 * @param {import('./lib/settings.mjs').Values} values
 */
function trackerOnce(values) {
  const forge =
    values.postWith === 'auto'
      ? undefined
      : values.postWith === 'gh'
        ? 'github'
        : 'gitlab'
  const key = forge ?? 'auto'
  let tracker = trackers.get(key)
  if (tracker) return tracker
  tracker = trackerOf(project, {
    gitlab: !!review.mr && review.mr.forge !== 'github',
    forge,
  }).then(
    ({ kind, web, prefix }) => ({ kind, web, prefix }),
    (error) => {
      const reason = String(error?.message ?? error)
      console.error(`tranchant server: /api/tracker: ${oneLine(reason)}`)
      trackers.delete(key)
      return { kind: null, reason }
    },
  )
  trackers.set(key, tracker)
  return tracker
}

/**
 * What `GET /api/settings` answers: the file as it stands, the values in
 * force, the keys an environment variable locks, the recipe in force for
 * this review's project (where it comes from, its lenses and their sources,
 * which the page lists to turn off) and the recipes imported for it.
 */
async function settingsPayload() {
  const { settings, values, locked, problem } = await loadSettings()
  const [recipe, imports] = await Promise.all([
    describeRecipe({ project, base: review.base, settings: values.recipe }),
    listImports(project).catch((error) => {
      console.error(`tranchant server: imports unreadable: ${oneLine(String(error))}`)
      return []
    }),
  ])
  return {
    path: SETTINGS_FILE,
    settings,
    values,
    defaults: DEFAULTS,
    locked,
    recipe: recipe.file,
    recipeFrom: recipe.from,
    recipeLenses: recipe.lenses,
    lenses: recipe.lenses.map((lens) => lens.name),
    imports,
    ...(recipe.problem && { recipeProblem: recipe.problem }),
    ...(problem && { problem }),
  }
}

/** The Lenses step's progress, as lenses.mjs writes it; undefined before it starts. */
const readLensesStep = () =>
  readFile(path.join(dir, 'lenses.json'), 'utf8')
    .then((json) => JSON.parse(json))
    .catch(() => undefined)

/** The most MiB of diff the server reads from git and hands the page. */
const MAX_DIFF_MIB = Number(process.env.TRANCHANT_MAX_DIFF_MIB ?? 32)
const MAX_DIFF = MAX_DIFF_MIB * 1024 * 1024
const GIT_TIMEOUT_MS = 30_000

/** A diff the server cannot compute; the reason answers 409, the cause goes to stderr. */
class DiffUnavailable extends Error {}

/**
 * One file of the change, as `git diff --numstat` counts it.
 * @typedef {{ path: string, oldPath?: string, additions: number, deletions: number, binary: boolean }} DiffStat
 */

/**
 * What `GET /api/diff` answers.
 * @typedef {{ base: string, head: string, files: DiffStat[], diff: string }} DiffPayload
 */

/**
 * The diff the page reads, and the head commit it was computed at.
 * @typedef {{ payload: DiffPayload, headSha: string }} ComputedDiff
 */

/**
 * The files of `git diff --numstat -z`: `added`, `deleted` and the path, tab
 * separated; a rename has an empty path then the old and the new one; `-`
 * counts a binary.
 * @param {string} raw
 * @returns {DiffStat[]}
 */
function parseNumstat(raw) {
  const parts = raw.split('\0')
  /** @type {DiffStat[]} */
  const files = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ''
    const first = part.indexOf('\t')
    const second = part.indexOf('\t', first + 1)
    if (first === -1 || second === -1) continue
    const added = part.slice(0, first)
    const deleted = part.slice(first + 1, second)
    let file = part.slice(second + 1)
    let oldPath
    if (file === '') {
      oldPath = parts[++i]
      file = parts[++i] ?? ''
    }
    const binary = added === '-'
    files.push({
      path: file,
      ...(oldPath !== undefined && { oldPath }),
      additions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(deleted),
      binary,
    })
  }
  return files
}

/** @param {unknown} error */
const stderrOf = (error) =>
  error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''

/**
 * Why git failed, in one line: the size or time limit it hit, else its
 * `fatal:` or `error:` line (a `warning:` may come first), else its first line.
 * @param {unknown} error
 */
function gitWords(error) {
  if (errorCode(error) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return `the diff is larger than ${MAX_DIFF_MIB} MiB`
  }
  if (error && typeof error === 'object' && 'killed' in error && error.killed) {
    return `git took longer than ${GIT_TIMEOUT_MS / 1000} s`
  }
  const lines = stderrOf(error)
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const line = lines.find((entry) => /^(?:fatal|error): /.test(entry)) ?? lines[0]
  if (line) return line.replace(/^(?:fatal|error): /, '')
  return (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? ''
}

/** Runs git in the project, the diff's size allowed. @param {string[]} args */
const git = (args) =>
  gitExec('git', ['-C', project, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_DIFF,
  })

/**
 * The commit `revision` names in the project, or the reason it cannot be had.
 * @param {string} what `base` or `head`, for the reason.
 * @param {string} revision
 */
async function commitOf(what, revision) {
  // `base` is the producer's free text: one starting with `-` would be a git option.
  if (revision.startsWith('-')) {
    throw new DiffUnavailable(`${what} ${revision} is not a revision`)
  }
  try {
    const { stdout } = await git([
      'rev-parse',
      '--verify',
      '--quiet',
      `${revision}^{commit}`,
    ])
    return stdout.trim()
  } catch (error) {
    // `--verify --quiet` exits 1, saying nothing, when the commit is not there.
    const missing =
      error && typeof error === 'object' && 'code' in error && error.code === 1
    if (missing && !stderrOf(error).trim()) {
      throw new DiffUnavailable(
        `${what} ${revision} is not in ${project}: fetch it first`,
      )
    }
    throw new DiffUnavailable(`git rev-parse ${revision} failed: ${gitWords(error)}`, {
      cause: error,
    })
  }
}

/** Refuses, with the reason, a project git cannot read. */
async function ensureRepository() {
  try {
    await git(['rev-parse', '--is-inside-work-tree'])
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new DiffUnavailable('git is not installed', { cause: error })
    }
    const words = gitWords(error)
    throw new DiffUnavailable(
      /not a git repository/.test(words)
        ? `${project} is not a git repository`
        : `git cannot read ${project}: ${words}`,
      { cause: error },
    )
  }
}

/**
 * The unified diff of the change and its files: the MR's own diff refs when
 * the review has them at its head, else what reached `headSha` since `base`.
 * @returns {Promise<ComputedDiff>}
 */
async function computeDiff() {
  const mrRefs = review.mr?.diffRefs
  const atHead = mrRefs && !postBlocker(review)
  // An ours review is the local branch's, which may be ahead of or behind its MR.
  if (mrRefs && !atHead && review.ownership === 'theirs') {
    throw new DiffUnavailable(
      `the MR's diff refs are at ${mrRefs.headSha}, the review at ${review.headSha}`,
    )
  }
  const refs = atHead ? mrRefs : undefined
  const base = refs ? refs.baseSha : review.base
  const head = refs ? refs.headSha : review.headSha
  await ensureRepository()
  const baseSha = await commitOf('base', base)
  const headSha = await commitOf('head', head)
  // Shas only from here: nothing the producer wrote reaches git as an argument.
  const range = refs ? `${baseSha}..${headSha}` : `${baseSha}...${headSha}`
  // --relative: the findings' paths are relative to `project`, which may be a
  // folder of the repository.
  // Three lines of context, whatever the user's diff.context: the page reads
  // the file's end from a last hunk with fewer.
  const flags = ['--no-color', '--no-ext-diff', '--relative', '--unified=3']
  let patch
  let numstat
  try {
    ;[patch, numstat] = await Promise.all([
      git([
        '-c',
        'core.quotePath=false',
        'diff',
        ...flags,
        '--src-prefix=a/',
        '--dst-prefix=b/',
        range,
        '--',
      ]),
      git(['diff', ...flags, '--numstat', '-z', range, '--']),
    ])
  } catch (error) {
    throw new DiffUnavailable(`git diff ${base}...${head} failed: ${gitWords(error)}`, {
      cause: error,
    })
  }
  if (!patch.stdout.trim()) {
    throw new DiffUnavailable(`the diff of ${base}...${head} is empty`)
  }
  return {
    payload: { base, head, files: parseNumstat(numstat.stdout), diff: patch.stdout },
    headSha,
  }
}

/** A range of lines the file does not have; `total` says how many it has. */
class OutsideFile extends Error {
  /** @param {string} message @param {number} total */
  constructor(message, total) {
    super(message)
    this.total = total
  }
}

/**
 * Lines `from` to `to` (1-based, `to` cut at the file's end) of `file` at the
 * diff's head, and how many the file has. Only a text file of the diff is
 * read: no other file of the repository is reachable through the page.
 * @param {string} file
 * @param {number} from
 * @param {number} to
 * @returns {Promise<{ path: string, from: number, to: number, total: number, lines: string[] } | undefined>}
 *   undefined when the diff has no such file.
 */
async function linesOf(file, from, to) {
  const { payload, headSha } = await diffOnce()
  // git resolves `..` after `./`: a crafted tree's entry would lead out of the file.
  const dotted = file
    .split('/')
    .some((part) => part === '' || part === '.' || part === '..')
  if (dotted || !payload.files.some((one) => one.path === file && !one.binary)) {
    return undefined
  }
  let content
  try {
    // `./`: the path is relative to the project, which may be a folder of the repository.
    content = (await git(['cat-file', 'blob', `${headSha}:./${file}`])).stdout
  } catch (error) {
    const words =
      errorCode(error) === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        ? `it is larger than ${MAX_DIFF_MIB} MiB`
        : gitWords(error)
    const reason = `${file} cannot be read at ${headSha}: ${words}`
    throw new DiffUnavailable(reason, { cause: error })
  }
  const lines = content.split('\n').map((line) => line.replace(/\r$/, ''))
  if (content.endsWith('\n')) lines.pop()
  const total = content ? lines.length : 0
  if (from > total) {
    throw new OutsideFile(
      `${file} has ${total} lines: line ${from} is past its end`,
      total,
    )
  }
  const last = Math.min(to, total)
  return { path: file, from, to: last, total, lines: lines.slice(from - 1, last) }
}

/**
 * One file a fix wrote, and the other findings whose runs wrote it after:
 * the diff then shows their changes too.
 * @typedef {{ path: string, since: string[] }} ChangedFile
 */

/**
 * Where a write step wrote, relative to `project`; undefined outside it, or
 * for a step that is not a write.
 * @param {Step} step
 */
function writtenPath(step) {
  if (!WRITE_KINDS.has(step.kind) || step.state === 'failed') return undefined
  // Older runs have no `file`: their label was the path, or only a name outside the repository.
  const where = typeof step.file === 'string' ? step.file : step.label
  if (typeof where !== 'string' || !where) return undefined
  const relative = path.relative(project, path.resolve(project, where))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    return undefined
  return relative
}

/**
 * By path, the last time finding `id`'s runs `wanted` that ended (with none
 * named, its run that fixed it, else its last run that ended) wrote it.
 * @param {string} id
 * @param {string[]} [wanted]
 */
async function writtenBy(id, wanted = []) {
  const { findings } = await store.readDecisions()
  const runs = findings[id]?.runs ?? []
  const fallback =
    runs.findLast((one) => one.outcome === 'fixed') ?? runs.findLast((one) => one.endedAt)
  const chosen = wanted.length
    ? new Set(
        runs.filter((one) => one.endedAt && wanted.includes(one.id)).map((one) => one.id),
      )
    : new Set(fallback ? [fallback.id] : [])
  // Runs named that are not there, or still running, wrote nothing yet.
  if (wanted.length && !chosen.size) return new Map()
  /** @type {Map<string, number>} */
  const last = new Map()
  for (const step of await readProgress(dir, id, undefined, { history: true })) {
    if (chosen.size && step.run && !chosen.has(step.run)) continue
    const file = writtenPath(step)
    if (file) last.set(file, Math.max(last.get(file) ?? 0, step.at ?? 0))
  }
  return last
}

/**
 * By path of `last`, the other findings whose runs, ended or in progress,
 * wrote it after `last` says this one did; with `runs`, this finding's other
 * runs too.
 * @param {string} id
 * @param {Map<string, number>} last
 * @param {string[]} [runs]
 */
async function writtenSince(id, last, runs = []) {
  /** @type {Map<string, Set<string>>} */
  const since = new Map([...last.keys()].map((file) => [file, new Set()]))
  /** @type {string[]} */
  let names = []
  try {
    names = await readdir(runsDir)
  } catch (error) {
    // Unreadable, the warning would be missing: only an absent folder means no run.
    if (errorCode(error) !== 'ENOENT') throw error
  }
  const others = new Set(
    names.flatMap((name) => {
      const other = /^([\w-]{1,64})(?:\.history)?\.jsonl$/.exec(name)?.[1]
      return other && other !== id ? [other] : []
    }),
  )
  // Runs named: this finding's later runs show in the diff too, as `<id> (<run>)`.
  if (runs.length) {
    const mine = [
      ...(await readProgress(dir, id)),
      ...(await readProgress(dir, id, undefined, { history: true })),
    ]
    for (const step of mine) {
      const file = writtenPath(step)
      const at = file === undefined ? undefined : last.get(file)
      if (
        file &&
        at !== undefined &&
        step.run &&
        !runs.includes(step.run) &&
        (step.at ?? 0) > at
      )
        since.get(file)?.add(`${id} (${step.run})`)
    }
  }
  for (const other of others) {
    const steps = [
      ...(await readProgress(dir, other)),
      ...(await readProgress(dir, other, undefined, { history: true })),
    ]
    for (const step of steps) {
      const file = writtenPath(step)
      const mine = file === undefined ? undefined : last.get(file)
      if (file && mine !== undefined && (step.at ?? 0) > mine) since.get(file)?.add(other)
    }
  }
  return since
}

/** @param {unknown} error */
const isGitFailure = (error) =>
  !!error && typeof error === 'object' && ('stderr' in error || 'killed' in error)

/**
 * Whether `file`, untracked, may be read as a new file: a regular file whose
 * real path is in the project and not in `.git`. A symlinked folder would lead
 * out of it, and a pipe would hold git until its timeout.
 * @param {string} file Relative to `project`.
 * @param {string} realProject
 */
async function readableNewFile(file, realProject) {
  const full = path.join(project, file)
  try {
    if (!(await lstat(full)).isFile()) return false
    const real = path.relative(realProject, await realpath(full))
    return (
      !!real &&
      !real.startsWith('..') &&
      !path.isAbsolute(real) &&
      real.split(path.sep)[0] !== '.git'
    )
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

/**
 * The diff against HEAD of `files` on the working tree: git's for the tracked
 * ones, a new file's for the others still there; past MAX_DIFF in all, refused.
 * @param {string[]} files Relative to `project`.
 */
async function workingDiff(files) {
  await ensureRepository()
  try {
    await git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
  } catch (error) {
    const missing =
      error && typeof error === 'object' && 'code' in error && error.code === 1
    throw new DiffUnavailable(
      missing && !stderrOf(error).trim()
        ? `${project} has no commit to compare with`
        : `git rev-parse HEAD failed: ${gitWords(error)}`,
      { cause: error },
    )
  }
  const flags = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']
  // Literal: a path the agent wrote is never a glob or a magic pathspec.
  const literal = ['--literal-pathspecs', '-c', 'core.quotePath=false']
  const parts = []
  let size = 0
  const add = (/** @type {string} */ part) => {
    size += Buffer.byteLength(part)
    if (size > MAX_DIFF) {
      throw new DiffUnavailable(`the changes are larger than ${MAX_DIFF_MIB} MiB`)
    }
    parts.push(part)
  }
  let command = 'git ls-files'
  try {
    const listed = await git([...literal, 'ls-files', '-z', '--', ...files])
    const tracked = new Set(listed.stdout.split('\0').filter(Boolean))
    if (tracked.size) {
      command = 'git diff HEAD'
      const { stdout } = await git([
        ...literal,
        'diff',
        ...flags,
        '--relative',
        'HEAD',
        '--',
        ...tracked,
      ])
      add(stdout)
    }
    const realProject = await realpath(project)
    for (const file of files) {
      if (tracked.has(file) || !(await readableNewFile(file, realProject))) continue
      command = `git diff --no-index ${file}`
      add(await newFileDiff([...literal, 'diff', ...flags], file))
    }
    return parts.join('')
  } catch (error) {
    if (!isGitFailure(error)) throw error
    throw new DiffUnavailable(`${command} failed: ${gitWords(error)}`, { cause: error })
  }
}

/**
 * The diff of an untracked file from nothing: `--no-index` exits 1 when the
 * two differ, which is its success here, unless git said why.
 * @param {string[]} args
 * @param {string} file
 */
async function newFileDiff(args, file) {
  try {
    return (await git([...args, '--no-index', '--', '/dev/null', file])).stdout
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 0
    if (
      code === 1 &&
      !stderrOf(error).trim() &&
      error &&
      typeof error === 'object' &&
      'stdout' in error
    ) {
      return String(error.stdout)
    }
    throw error
  }
}

/**
 * What `GET /api/changes/<id>` answers: the files finding `id`'s fix (its
 * runs `runs` when named: one change its discussion asked for) wrote and
 * their diff against HEAD as the working tree has them now.
 * @param {string} id
 * @param {string[]} [runs]
 * @returns {Promise<{ files: ChangedFile[], diff: string }>}
 */
async function changesOf(id, runs) {
  const last = await writtenBy(id, runs)
  if (!last.size) return { files: [], diff: '' }
  const since = await writtenSince(id, last, runs)
  const paths = [...last.keys()]
  return {
    files: paths.map((file) => ({
      path: file,
      since: [...(since.get(file) ?? [])].toSorted(),
    })),
    diff: await workingDiff(paths),
  }
}

/** @type {Promise<ComputedDiff> | undefined} */
let diff

/** The diff, computed once per head and base: a refresh that moves either computes it again. A failure is tried again. */
function diffOnce() {
  diff ??= computeDiff().catch((error) => {
    diff = undefined
    throw error
  })
  return diff
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  // A page of another site may send a request it cannot read the answer of:
  // it would decide findings, and start agents.
  const { origin } = req.headers
  if (origin && !origins.has(origin)) throw new ClientError(403)
  // A same-origin GET carries no Origin: a rebound DNS name would read the answers.
  if (!origins.has(`http://${req.headers.host}`)) throw new ClientError(403)

  if (req.method === 'GET' && url.pathname === '/') {
    const { values } = await loadSettings()
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    })
    return res.end(shell(values.theme))
  }

  const chunk = CHUNK.exec(url.pathname)?.[1]
  if (req.method === 'GET' && (url.pathname === '/page.js' || chunk)) {
    let source
    try {
      source = await readFile(chunk ? path.join(CHUNKS, `${chunk}.js`) : PAGE, 'utf8')
    } catch (error) {
      if (!chunk || errorCode(error) !== 'ENOENT') throw error
      return send(res, 404, { error: 'not found' })
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    })
    return res.end(source)
  }

  if (req.method === 'GET' && url.pathname === '/api/events') return listen(req, res)

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, review: review.id, version: PLUGIN_VERSION })
  }

  if (req.method === 'GET' && url.pathname === '/api/review') {
    // Read anew: findings land and the status flips while the review runs.
    const [{ review: latest, decisions }, runs, agents, discussions, current, lenses] =
      await Promise.all([
        store.readAll(),
        store.runs(),
        readReviewAgents(dir),
        readDiscussions(dir),
        currentHead(),
        readLensesStep(),
      ])
    return send(res, 200, {
      review: latest,
      ...(lenses && { lenses }),
      findings: decisions.findings,
      runs,
      reviewers: agents.filter((agent) => !DISCUSSER.test(agent.name)),
      discussions: Object.fromEntries(
        Object.entries(discussions).map(([id, discussion]) => {
          // While it answers: its agent's last step, the page's progress line.
          const steps = waitsForAnswer(discussion)
            ? agents.find((agent) => agent.name === `ds-${id}`)?.steps
            : undefined
          // The file holds every agent the thread had: an end is a past one's.
          const last = steps?.at(-1)
          const step = last && last.kind !== 'end' ? last : undefined
          return [id, { ...discussion, ...(step && { step }) }]
        }),
      ),
      head: { reviewed: latest.headSha, current },
    })
  }

  if (req.method === 'GET' && url.pathname === '/api/account') {
    const asked = url.searchParams.get('tool')
    // `?tool=glab`: the batch bar's, since MR comments always go through glab.
    const tool =
      asked === 'glab' || asked === 'gh'
        ? asked
        : await postingTool((await loadSettings()).values)
    return send(res, 200, { username: await accountOnce(tool), tool })
  }

  if (req.method === 'GET' && url.pathname === '/api/tracker') {
    return send(res, 200, await trackerOnce((await loadSettings()).values))
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    return send(res, 200, await settingsPayload())
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings') {
    const input = await readJson(req)
    return writeSettingsInTurn(res, input)
  }

  if (req.method === 'GET' && url.pathname === '/api/diff') {
    try {
      return send(res, 200, (await diffOnce()).payload)
    } catch (error) {
      if (!(error instanceof DiffUnavailable)) throw error
      // git's whole stderr, warnings included: the reason keeps one line of it.
      const detail = stderrOf(error.cause).trim()
      console.error(
        `tranchant server: /api/diff: ${error.message}${detail && `\n${detail}`}`,
      )
      return send(res, 409, { error: error.message })
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/lines') {
    const file = url.searchParams.get('path') ?? ''
    const from = Number(url.searchParams.get('from'))
    const to = Number(url.searchParams.get('to'))
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 1 ||
      to < from
    ) {
      return send(res, 400, { error: 'from and to are line numbers, from first' })
    }
    try {
      const answer = await linesOf(file, from, to)
      if (!answer)
        return send(res, 404, { error: `${file} is not a text file of the diff` })
      return send(res, 200, answer)
    } catch (error) {
      if (error instanceof OutsideFile) {
        return send(res, 416, { error: error.message, total: error.total })
      }
      if (!(error instanceof DiffUnavailable)) throw error
      const detail = stderrOf(error.cause).trim()
      console.error(
        `tranchant server: /api/lines: ${error.message}${detail && `\n${detail}`}`,
      )
      return send(res, 409, { error: error.message })
    }
  }

  const run = /^\/api\/runs\/([^/]+)$/.exec(url.pathname)?.[1]
  if (req.method === 'GET' && run !== undefined) {
    if (!ID.test(run)) return send(res, 404, { error: 'not found' })
    return send(res, 200, {
      progress: await readProgress(dir, run),
      history: await readProgress(dir, run, undefined, { history: true }),
    })
  }

  const changed = /^\/api\/changes\/([^/]+)$/.exec(url.pathname)?.[1]
  if (req.method === 'GET' && changed !== undefined) {
    const known = (await store.readReview()).findings.some((one) => one.id === changed)
    if (!ID.test(changed) || !known) return send(res, 404, { error: 'not found' })
    const ofRuns = url.searchParams.getAll('run')
    if (ofRuns.length > MAX_RUNS || ofRuns.some((one) => !RUN_ID.test(one)))
      return send(res, 400, { error: `run is a run id (r1, r2…), ${MAX_RUNS} at most` })
    try {
      return send(res, 200, await changesOf(changed, ofRuns))
    } catch (error) {
      if (!(error instanceof DiffUnavailable)) throw error
      console.error(`tranchant server: /api/changes/${changed}: ${error.message}`)
      return send(res, 409, { error: error.message })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/decisions') {
    const input = await readJson(req)
    const list = Array.isArray(input?.decisions)
      ? input.decisions.slice(0, MAX_DECISIONS)
      : []
    /** @type {string[]} */
    const applied = []
    /** @type {{ id: string, reason: string }[]} */
    const refused = []
    for (const raw of list) {
      const decision = sanitiseDecision(raw)
      if (!decision) {
        refused.push({ id: String(raw?.id ?? ''), reason: 'not a decision' })
        continue
      }
      try {
        await store.decide(decision.id, decision)
      } catch (error) {
        if (!(error instanceof StoreRefusal)) throw error
        refused.push({ id: decision.id, reason: error.message })
        continue
      }
      applied.push(decision.id)
      // A change dropped, skipped or replaced: the discussion says so.
      await settleDiscussion(decision.id)
      decided(decision.id, decision.action)
    }
    return send(res, 200, { applied, refused })
  }

  if (req.method === 'POST' && url.pathname === '/api/answer') {
    const input = await readJson(req)
    if (typeof input?.id !== 'string' || !ID.test(input.id)) {
      return send(res, 400, { error: 'id is required' })
    }
    const choices = Array.isArray(input.choices)
      ? input.choices.filter((choice) => typeof choice === 'string')
      : []
    const entry = await store.answer(input.id, { text: text(input.text), choices })
    await settleDiscussion(input.id)
    print(`FIX ${input.id}`)
    return send(res, 200, { finding: entry })
  }

  if (req.method === 'POST' && url.pathname === '/api/discuss') {
    const input = await readJson(req)
    if (typeof input?.id !== 'string' || !ID.test(input.id)) {
      return send(res, 400, { error: 'id is required' })
    }
    // A change asked for is a fix: an agent that writes, never the discussing one.
    const change = input.change === true
    const discussion = await say(dir, input.id, text(input.text) ?? '', { change })
    print(`${change ? 'FIX' : 'DISCUSS'} ${input.id}`)
    return send(res, 200, { discussion })
  }

  if (req.method === 'POST' && url.pathname === '/api/recipe/use') {
    const input = await readJson(req)
    if (typeof input?.id !== 'string' || !ID.test(input.id)) {
      return send(res, 400, { error: 'id is required' })
    }
    try {
      const used = await useImport(project, input.id)
      void importsChanged()
      // In force already: a settings payload that fails now is the page's to ask again.
      const settings = await settingsPayload().catch(() => undefined)
      return send(res, 200, { ...used, ...(settings && { settings }) })
    } catch (error) {
      if (error instanceof ImportRefusal) return send(res, 409, { error: error.message })
      throw error
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    const input = await readJson(req)
    if (typeof input?.id !== 'string' || !ID.test(input.id)) {
      return send(res, 400, { error: 'id is required' })
    }
    const entry = await store.stop(input.id)
    await settleDiscussion(input.id)
    print(`STOP ${input.id}`)
    return send(res, 200, { finding: entry })
  }

  return send(res, 404, { error: 'not found' })
}

/** The settings writes, one after the other: two pages saving at once never cross. @type {Promise<unknown>} */
let settingsWriting = Promise.resolve()

/**
 * Writes the settings `input` once the writes before it ended, and answers
 * the file as it then stands.
 * @param {http.ServerResponse} res
 * @param {unknown} input
 */
function writeSettingsInTurn(res, input) {
  const turn = settingsWriting.then(async () => {
    const { problem } = await loadSettings()
    // A file this Tranchant cannot read is the person's to mend: never written over.
    if (problem) return send(res, 409, { error: problem })
    try {
      await writeSettings(input)
    } catch (error) {
      if (error instanceof SettingsRefusal)
        return send(res, 400, { error: error.message })
      // The person's own file and folder: the cause may be theirs to mend (rights, disk).
      console.error(`tranchant server: PUT /api/settings: ${oneLine(String(error))}`)
      const code = errorCode(error)
      return send(res, 500, {
        error: `${SETTINGS_FILE} could not be written (${typeof code === 'string' ? code : 'error'})`,
      })
    }
    // The first write makes the folder: watched from now on; every page told, this one included.
    watchFolders()
    settingsChanged()
    return send(res, 200, await settingsPayload())
  })
  settingsWriting = turn.catch(() => undefined)
  return turn
}

/**
 * Brings finding `id`'s discussion in line with its decision once the store
 * moved it: a failure is the server's to say, never the move's, which stands.
 * @param {string} id
 */
async function settleDiscussion(id) {
  try {
    await syncChange(dir, id)
  } catch (error) {
    console.error(
      `tranchant server: the discussion of ${id} is left as it is: ${oneLine(String(error))}`,
    )
  }
}

/**
 * Prints `line` for the hooks. One event a line: a line break in what the
 * reviewer sent would forge another event.
 * @param {string} line
 */
function print(line) {
  console.log(oneLine(line))
}

/**
 * What a decision just taken starts: the hooks start an agent on a FIX,
 * the server posts or opens the issue itself.
 * @param {string} id
 * @param {'fix' | 'post' | 'issue' | 'drop' | 'skip'} action
 */
function decided(id, action) {
  if (action === 'fix') print(`FIX ${id}`)
  else if (action === 'post') enqueue(POST_SCRIPT, id)
  else if (action === 'issue') enqueue(ISSUE_SCRIPT, id)
  else print(`${action === 'drop' ? 'DROPPED' : 'SKIPPED'} ${id}`)
}

/**
 * A script the server runs on a decision, and the words it prints.
 * @typedef {{ action: 'post' | 'issue', file: string, done: string, ok: string, failed: string }} Script
 */

/** @type {Script} */
const POST_SCRIPT = {
  action: 'post',
  file: POST,
  done: 'posted ',
  ok: 'POSTED',
  failed: 'POST_FAILED',
}
/** @type {Script} */
const ISSUE_SCRIPT = {
  action: 'issue',
  file: ISSUE,
  done: 'moved ',
  ok: 'MOVED',
  failed: 'ISSUE_FAILED',
}

/** @type {Promise<void>} */
let running = Promise.resolve()

/** Runs `script` on finding `id` after the posts and issues under way: one at a time. */
function enqueue(/** @type {Script} */ script, /** @type {string} */ id) {
  running = running.then(() => runScript(script, id)).catch(() => undefined)
}

/**
 * Runs `script` on finding `id`, and prints its success or its failure from
 * its last line.
 * @param {Script} script
 * @param {string} id
 * @returns {Promise<void>}
 */
async function runScript(script, id) {
  const child = spawn(process.execPath, [script.file, id, '--review', dir], {
    env: process.env,
    stdio: /** @type {const} */ (['ignore', 'pipe', 'inherit']),
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  // The first of the two settles it: a spawn that fails may still close, and says nothing twice.
  /** @type {{ code: number | null } | { error: string }} */
  const exit = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ error: String(error) }))
    child.once('close', (code) => resolve({ code }))
  })
  const last = output.trim().split('\n').at(-1) ?? ''
  if ('code' in exit && exit.code === 0 && last.startsWith(script.done)) {
    print(`${script.ok} ${id}`)
    return
  }
  const reason =
    'error' in exit
      ? exit.error
      : last.replace(/^failed ?/, '') ||
        `${path.basename(script.file)} exited with ${exit.code}`
  print(await fallBack(script, id, reason))
}

/**
 * A script that crashed before it could say why leaves its finding queued:
 * the server fails it with `reason`, unless it moved on meanwhile.
 * @param {Script} script
 * @param {string} id
 * @param {string} reason
 * @returns {Promise<string>} The failure line to print.
 */
async function fallBack(script, id, reason) {
  try {
    const entry = (await store.readDecisions()).findings[id]
    const replying = script.action === 'post' && !!entry && replyPending(entry)
    if (
      replying ||
      (entry?.state === 'queued' && entry.decision?.action === script.action)
    )
      await store.fail(id, reason.slice(0, 300), { reply: replying })
  } catch (error) {
    if (!(error instanceof StoreRefusal))
      console.error(`tranchant server: ${script.action} ${id}: ${oneLine(String(error))}`)
  }
  return `${script.failed} ${id} ${reason}`
}

/**
 * The pages listening for changes: one stream per tab.
 * @type {Set<http.ServerResponse>}
 */
const listeners = new Set()

/**
 * Opens a stream of server-sent events: `changed`, with the ids of the
 * findings whose decisions or steps changed, each time a file under the
 * review folder changes; `page` when a dev build replaced the bundle;
 * `settings` when the settings file changed.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function listen(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  // Sent at once: the page's EventSource opens on the headers.
  res.write(': listening\n\n')
  listeners.add(res)
  req.on('close', () => listeners.delete(res))
}

/**
 * By finding id, what it was at the last read: its content, its decisions,
 * and the size and time of its run files.
 * @type {Map<string, string>}
 */
const fingerprints = new Map()
/** The review's status at the last read. @type {string | undefined} */
let statusSeen
/** The review agents' run files at the last read: their names, sizes and times. */
let agentsSeen = ''
/** The review's summary and strengths at the last read. @type {string | undefined} */
let summarySeen

/**
 * The ids of the findings that landed, or whose decisions or run files
 * changed, since the last read; whether the review's status or its review
 * agents did; and the review as read.
 */
async function changes() {
  /** @type {Map<string, string>} */
  const next = new Map()
  const latest = await store.readReview().catch(() => undefined)
  for (const finding of latest?.findings ?? []) {
    // The whole file: a verifier's `verified` changes what the page shows.
    const hash = createHash('sha1').update(JSON.stringify(finding)).digest('hex')
    next.set(finding.id, `finding ${hash}`)
  }
  const decisions = await store.readDecisions().catch(() => undefined)
  for (const [id, entry] of Object.entries(decisions?.findings ?? {})) {
    next.set(id, `${next.get(id) ?? ''}\n${JSON.stringify(entry)}`)
  }
  for (const name of await readdir(discussionsDir).catch(() => [])) {
    const id = /^([\w-]{1,64})\.json$/.exec(name)?.[1]
    if (!id) continue
    const size = await stat(path.join(discussionsDir, name)).then(
      (file) => `${file.size} ${file.mtimeMs}`,
      () => '',
    )
    next.set(id, `${next.get(id) ?? ''}\ndiscussion ${size}`)
  }
  const files = await readdir(runsDir).catch(() => [])
  for (const name of files) {
    const id = name.replace(/(?:\.history)?\.jsonl$/, '')
    if (id === name) continue
    const size = await stat(path.join(runsDir, name)).then(
      (file) => `${file.size} ${file.mtimeMs}`,
      () => '',
    )
    next.set(id, `${next.get(id) ?? ''}\n${name} ${size}`)
  }
  const ids = [
    ...[...next].filter(([id, mark]) => fingerprints.get(id) !== mark).map(([id]) => id),
    ...[...fingerprints.keys()].filter((id) => !next.has(id)),
  ]
  fingerprints.clear()
  for (const [id, mark] of next) fingerprints.set(id, mark)
  const status = latest ? statusOf(latest) : statusSeen
  const agents = []
  for (const name of (await readdir(agentsDir).catch(() => [])).toSorted((a, b) =>
    a.localeCompare(b),
  )) {
    const file = await stat(path.join(agentsDir, name)).then(
      (one) => `${one.size} ${one.mtimeMs}`,
      () => '',
    )
    agents.push(`${name} ${file}`)
  }
  // The Lenses step's rows, which change before any agent starts.
  agents.push(
    `lenses.json ${await stat(path.join(dir, 'lenses.json')).then(
      (one) => `${one.size} ${one.mtimeMs}`,
      () => '',
    )}`,
  )
  const agentsNow = agents.join('\n')
  const summary = latest
    ? JSON.stringify([latest.summary, latest.strengths])
    : summarySeen
  const reviewChanged =
    status !== statusSeen || agentsNow !== agentsSeen || summary !== summarySeen
  statusSeen = status
  agentsSeen = agentsNow
  summarySeen = summary
  return { ids, reviewChanged, latest }
}

/** Whether READY was printed: the hooks read it first, LANDED only after. */
let ready = false
/** The findings LANDED was printed for, once each. @type {Set<string>} */
const landed = new Set()

/**
 * LANDED for each finding not verified yet, while a review whose findings
 * are verified runs: the hooks start a verifier on it.
 * @param {import('./lib/format.mjs').Review | undefined} latest
 */
function announceLanded(latest) {
  if (!ready || !latest?.verify || statusOf(latest) !== 'reviewing') return
  for (const finding of latest.findings) {
    if (finding.verified === true || landed.has(finding.id)) continue
    landed.add(finding.id)
    print(`LANDED ${finding.id}`)
  }
}

/**
 * Reads the folder, and tells the pages which findings changed.
 * @param {boolean} first
 */
async function refresh(first) {
  const { ids, reviewChanged, latest } = await changes()
  // `/tranchant comments` imported its PR/MR again, which moved: the diff is the new head's.
  const moved =
    !!latest && (latest.headSha !== review.headSha || latest.base !== review.base)
  if (latest && moved) {
    review = latest
    diff = undefined
  }
  announceLanded(latest)
  if (first || (!ids.length && !reviewChanged && !moved)) return
  const event = `event: changed\ndata: ${JSON.stringify({ ids })}\n\n`
  for (const res of listeners) res.write(event)
}

/** @type {Promise<void>} */
let refreshing = Promise.resolve()

/** Refreshes after the refresh under way, never during it. */
const refreshNext = (first = false) =>
  (refreshing = refreshing.then(() => refresh(first)).catch(() => undefined))

/**
 * One write fires several watch events: one refresh for all those of the
 * next 50 ms. Not reset by each: steady writes would put it off.
 */
const BATCH_MS = 50
/** @type {NodeJS.Timeout | undefined} */
let batch

function changeSeen() {
  batch ??= setTimeout(() => {
    batch = undefined
    // A folder made since (findings/ by add.mjs) is watched from now on.
    watchFolders()
    void refreshNext()
  }, BATCH_MS)
}

/** The bundle's hash, or undefined while it is missing. */
function pageStamp() {
  try {
    return createHash('sha1').update(readFileSync(PAGE)).digest('hex')
  } catch {
    return undefined
  }
}
let pageSeen = pageStamp()
/** @type {NodeJS.Timeout | undefined} */
let pageBatch

/**
 * Tells the pages a new bundle is there, once its write is over: each event
 * puts it off, so a page never loads half a bundle.
 * @param {string} _event
 * @param {string | Buffer | null} file
 */
function pageChanged(_event, file) {
  if (file !== null && String(file) !== path.basename(PAGE)) return
  clearTimeout(pageBatch)
  pageBatch = setTimeout(() => {
    const built = pageStamp()
    if (!built || built === pageSeen) return
    pageSeen = built
    for (const res of listeners) res.write('event: page\ndata: {}\n\n')
  }, BATCH_MS)
}

/** The imports' folders and their files' times at the last look: an import that ends changes the page's Settings. */
let importsSeen = ''

/** Tells the pages the imports changed, when they did since the last look. */
async function importsChanged() {
  const root = importsDir(project)
  const marks = []
  for (const id of (await readdir(root).catch(() => [])).toSorted((a, b) =>
    a.localeCompare(b),
  )) {
    for (const name of ['import.json', 'recipe.json']) {
      const mark = await stat(path.join(root, id, name)).then(
        (one) => `${one.size} ${one.mtimeMs}`,
        () => '',
      )
      marks.push(`${id}/${name} ${mark}`)
    }
  }
  const now = marks.join('\n')
  if (now === importsSeen) return
  importsSeen = now
  for (const res of listeners) res.write('event: settings\ndata: {}\n\n')
}

/** The settings file's size and time at the last look, or '' while it is missing. */
function settingsStamp() {
  try {
    const file = statSync(SETTINGS_FILE)
    return `${file.size} ${file.mtimeMs}`
  } catch {
    return ''
  }
}
let settingsSeen = settingsStamp()
/** @type {NodeJS.Timeout | undefined} */
let settingsBatch

/**
 * Tells the pages the settings changed under them (another page, another
 * session, an editor), once the write is over.
 */
function settingsChanged() {
  clearTimeout(settingsBatch)
  settingsBatch = setTimeout(() => {
    const now = settingsStamp()
    if (now === settingsSeen) return
    settingsSeen = now
    for (const res of listeners) res.write('event: settings\ndata: {}\n\n')
  }, BATCH_MS)
}

/**
 * By folder, its watch and the folder's inode. The folders, not the files:
 * the store writes a temp file and renames it over the decisions file, which
 * a watch on the file loses.
 * @type {Map<string, { watcher: import('node:fs').FSWatcher, ino: number }>}
 */
const watchers = new Map()

/** The inode of folder `folder`, or undefined when it is gone. */
const inodeOf = (/** @type {string} */ folder) => {
  try {
    return statSync(folder).ino
  } catch {
    return undefined
  }
}

/**
 * Watches the folders not watched yet. A folder removed, or removed and made
 * again, is watched anew: a watch on the old one hears nothing more.
 */
function watchFolders() {
  /** @type {[string, (event: string, file: string | Buffer | null) => void][]} */
  const folders = [
    [dir, changeSeen],
    [runsDir, changeSeen],
    [findingsDir, changeSeen],
    [agentsDir, changeSeen],
    [discussionsDir, changeSeen],
    [path.dirname(PAGE), pageChanged],
    // Made by the first write: watched from then on, as findings/ is.
    [SETTINGS_DIR, settingsChanged],
  ]
  for (const [folder, onChange] of folders) {
    const ino = inodeOf(folder)
    const known = watchers.get(folder)
    if (known && known.ino === ino) continue
    known?.watcher.close()
    watchers.delete(folder)
    if (ino === undefined) continue
    try {
      const watcher = watch(folder, onChange)
      watcher.on('error', () => {
        watcher.close()
        if (watchers.get(folder)?.watcher === watcher) watchers.delete(folder)
      })
      watchers.set(folder, { watcher, ino })
    } catch {}
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    // A move the finding's state forbids: the store's own words, meant for the reviewer.
    if (error instanceof StoreRefusal) {
      send(res, 409, { error: error.message })
      return
    }
    if (error instanceof ClientError) {
      // The rest of a body too large is never read: a client reusing the
      // connection would wait on it forever.
      const close = error.status === 413 ? { connection: 'close' } : {}
      send(res, error.status, { error: CLIENT_ERRORS[error.status] }, close)
      return
    }
    // Internal details stay in the server's log, never in a response.
    console.error(
      `tranchant server: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
    send(res, 500, { error: 'internal error' })
  })
})

/**
 * The review served on `port` by a tranchant server, or undefined when
 * something else answers; rejects when nothing does.
 * @param {number} busy
 */
async function servedReview(busy) {
  const health = await (await fetch(`http://127.0.0.1:${busy}/api/health`)).json()
  return typeof health === 'object' && health !== null && 'review' in health
    ? String(health.review)
    : undefined
}

server.on('error', async (/** @type {NodeJS.ErrnoException} */ error) => {
  if (error.code !== 'EADDRINUSE') throw error
  let owner = 'another program'
  try {
    const served = await servedReview(port)
    if (served) owner = `another /tranchant session (review ${served})`
  } catch {}
  console.log(`PORT_BUSY ${port} is used by ${owner}`)
  process.exit(3)
})

/**
 * What waited while no server ran: the hooks start an agent on each queued
 * fix again (they skip the ones they handed over already) and on each
 * question left unanswered, and the server posts each queued post and
 * opens each queued issue.
 */
async function resumeQueued() {
  const decisions = await store.readDecisions().catch(() => undefined)
  for (const [id, entry] of Object.entries(decisions?.findings ?? {})) {
    // A reply on a thread, settled or its fix under way, waits outside the states.
    if (replyPending(entry)) decided(id, 'post')
    if (entry.state !== 'queued') continue
    const action = entry.decision?.action
    decided(id, action === 'post' || action === 'issue' ? action : 'fix')
  }
  const discussions = await readDiscussions(dir).catch((error) => {
    // The questions left waiting stay so until the server starts again: said.
    console.error(`tranchant server: discussions unreadable: ${oneLine(String(error))}`)
    return {}
  })
  for (const [id, discussion] of Object.entries(discussions)) {
    if (waitsForAnswer(discussion)) print(`DISCUSS ${id}`)
    // What a change left while no server ran, or a script failed to write.
    else await settleDiscussion(id)
  }
}

server.listen(port, '127.0.0.1', async () => {
  const address = server.address()
  const listening = typeof address === 'object' && address ? address.port : port
  for (const host of ['127.0.0.1', 'localhost'])
    origins.add(`http://${host}:${listening}`)
  // Made before the first run and the first finding: a folder must be there to be watched.
  await mkdir(runsDir, { recursive: true })
  await mkdir(findingsDir, { recursive: true })
  await mkdir(agentsDir, { recursive: true })
  await mkdir(discussionsDir, { recursive: true })
  await refreshNext(true)
  console.log(
    `READY http://127.0.0.1:${listening} review=${review.id} project=${project}`,
  )
  ready = true
  watchFolders()
  await resumeQueued()
  await refreshNext()
  await importsChanged()
  setInterval(() => {
    watchFolders()
    settingsChanged()
    void importsChanged()
    void refreshNext()
  }, pollMs)
})
