#!/usr/bin/env node
// server.mjs --review <dir>
// Serves the page and its API on a free port of 127.0.0.1, and prints one
// line per decision the plugin's hooks act on: FIX, STOP, DROPPED, SKIPPED,
// and POSTED or POST_FAILED for the posts it runs itself (post.mjs, one at a
// time). It watches the review folder and its run files, and pushes
// `changed` to the pages on /api/events: they reload only then. It watches
// the page's bundle too, and pushes `page` when a dev build replaces it.
// Only runs while a session watches (/tranchant): no server, no page.
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, watch } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { promisify } from 'node:util'
import { PLUGIN_ROOT, PLUGIN_VERSION, SKILL_DIR, findReview } from './lib/project.mjs'
import { oneLine } from './lib/format.mjs'
import { StoreRefusal, createStore, readProgress } from './lib/store.mjs'

/** @typedef {import('./lib/format.mjs').Entry} Entry */

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
const POST = path.join(SKILL_DIR, 'scripts', 'post.mjs')
const port = Number(process.env.TRANCHANT_PORT ?? 0)
// The re-read behind the folder watches, for the mounts whose writes they miss.
const pollMs = Number(process.env.TRANCHANT_POLL_MS ?? 5000)
const { project } = review
const runsDir = path.join(dir, 'runs')

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
const MAX_TEXT = 4000
const MAX_DECISIONS = 500
const ACTIONS = new Set(['fix', 'post', 'drop', 'skip'])

/** @param {unknown} value */
const text = (value) =>
  typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : undefined

/**
 * One decision of a batch, as the page sends it; undefined when it is not one.
 * @param {any} input
 * @returns {{ id: string, action: 'fix' | 'post' | 'drop' | 'skip', context?: string, comment?: string, reason?: string } | undefined}
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
    reason: text(input.reason),
  }
}

/** @param {string} value */
const escapeHtml = (value) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The page's shell: the bundle draws everything in #root. */
const SHELL = [
  '<!doctype html>',
  '<html lang="en">',
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

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  // A page of another site may send a request it cannot read the answer of:
  // it would decide findings, and start agents.
  const { origin } = req.headers
  if (origin && !origins.has(origin)) throw new ClientError(403)

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    })
    return res.end(SHELL)
  }

  if (req.method === 'GET' && url.pathname === '/page.js') {
    const source = await readFile(PAGE, 'utf8')
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
    const [{ decisions }, runs, current] = await Promise.all([
      store.readAll(),
      store.runs(),
      currentHead(),
    ])
    return send(res, 200, {
      review,
      findings: decisions.findings,
      runs,
      head: { reviewed: review.headSha, current },
    })
  }

  const run = /^\/api\/runs\/([^/]+)$/.exec(url.pathname)?.[1]
  if (req.method === 'GET' && run !== undefined) {
    if (!ID.test(run)) return send(res, 404, { error: 'not found' })
    return send(res, 200, {
      progress: await readProgress(dir, run),
      history: await readProgress(dir, run, undefined, { history: true }),
    })
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
    print(`FIX ${input.id}`)
    return send(res, 200, { finding: entry })
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    const input = await readJson(req)
    if (typeof input?.id !== 'string' || !ID.test(input.id)) {
      return send(res, 400, { error: 'id is required' })
    }
    const entry = await store.stop(input.id)
    print(`STOP ${input.id}`)
    return send(res, 200, { finding: entry })
  }

  return send(res, 404, { error: 'not found' })
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
 * the server posts itself.
 * @param {string} id
 * @param {'fix' | 'post' | 'drop' | 'skip'} action
 */
function decided(id, action) {
  if (action === 'fix') print(`FIX ${id}`)
  else if (action === 'post') enqueuePost(id)
  else print(`${action === 'drop' ? 'DROPPED' : 'SKIPPED'} ${id}`)
}

/** @type {Promise<void>} */
let posting = Promise.resolve()

/** Posts finding `id`'s comment after the posts under way: one at a time. */
function enqueuePost(id) {
  posting = posting.then(() => runPost(id)).catch(() => undefined)
}

/**
 * Runs post.mjs on finding `id`, and prints POSTED or POST_FAILED from its
 * last line.
 * @param {string} id
 * @returns {Promise<void>}
 */
function runPost(id) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [POST, id, '--review', dir], {
      env: process.env,
      stdio: /** @type {const} */ (['ignore', 'pipe', 'inherit']),
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.on('error', (error) => {
      print(`POST_FAILED ${id} ${String(error)}`)
      resolve()
    })
    child.on('close', (code) => {
      const last = output.trim().split('\n').at(-1) ?? ''
      if (code === 0 && last.startsWith('posted ')) print(`POSTED ${id}`)
      else
        print(
          `POST_FAILED ${id} ${last.replace(/^failed ?/, '') || `post.mjs exited with ${code}`}`,
        )
      resolve()
    })
  })
}

/**
 * The pages listening for changes: one stream per tab.
 * @type {Set<http.ServerResponse>}
 */
const listeners = new Set()

/**
 * Opens a stream of server-sent events: `changed`, with the ids of the
 * findings whose decisions or steps changed, each time a file under the
 * review folder changes; `page` when a dev build replaced the bundle.
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
 * By finding id, what it was at the last read: its decisions, and the size
 * and time of its run files.
 * @type {Map<string, string>}
 */
const fingerprints = new Map()

/** The ids of the findings whose decisions or run files changed since the last read. */
async function changedIds() {
  /** @type {Map<string, string>} */
  const next = new Map()
  const decisions = await store.readDecisions().catch(() => undefined)
  for (const [id, entry] of Object.entries(decisions?.findings ?? {})) {
    next.set(id, JSON.stringify(entry))
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
  return ids
}

/**
 * Reads the folder, and tells the pages which findings changed.
 * @param {boolean} first
 */
async function refresh(first) {
  const ids = await changedIds()
  if (first || !ids.length) return
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
    [path.dirname(PAGE), pageChanged],
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
 * fix again (they skip the ones they handed over already), and the server
 * posts each queued post.
 */
async function resumeQueued() {
  const decisions = await store.readDecisions().catch(() => undefined)
  for (const [id, entry] of Object.entries(decisions?.findings ?? {})) {
    if (entry.state !== 'queued') continue
    decided(id, entry.decision?.action === 'post' ? 'post' : 'fix')
  }
}

server.listen(port, '127.0.0.1', async () => {
  const address = server.address()
  const listening = typeof address === 'object' && address ? address.port : port
  for (const host of ['127.0.0.1', 'localhost'])
    origins.add(`http://${host}:${listening}`)
  // Made before the first run: a folder must be there to be watched.
  await mkdir(runsDir, { recursive: true })
  await refreshNext(true)
  console.log(
    `READY http://127.0.0.1:${listening} review=${review.id} project=${project}`,
  )
  watchFolders()
  await resumeQueued()
  setInterval(() => {
    watchFolders()
    void refreshNext()
  }, pollMs)
})
