#!/usr/bin/env node
// dashboard.mjs
// Serves the dashboard's page and its API on 127.0.0.1: every review of every
// project, read from the state folder (lib/catalog.mjs), and the servers that
// run (lib/registry.mjs), which make a review live. One dashboard per
// machine: started while another runs, it prints `RUNNING <url>` and exits;
// else it registers, prints `READY <url>`, and runs until it is told to stop
// (the session that started it ends, or `/tranchant stop`). It watches the
// state folder and pushes `reviews` to the pages on /api/events whenever the
// list changes; it reads the list again every few seconds too, for a server
// killed outright and the writes a watch misses. It runs nothing and writes no
// review's file: the theme alone, in the user's settings.
import { existsSync, watch } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createCatalog } from './lib/catalog.mjs'
import { errorCode } from './lib/errors.mjs'
import { LockBusy, withFileLock } from './lib/filelock.mjs'
import {
  CLIENT_ERRORS,
  CSP,
  ClientError,
  checkOrigin,
  readJson,
  send,
} from './lib/http.mjs'
import { PLUGIN_ROOT, PLUGIN_VERSION, SKILL_DIR, STATE_ROOT } from './lib/project.mjs'
import {
  SERVERS_DIR,
  listServers,
  registerServer,
  removeOnExit,
} from './lib/registry.mjs'
import { loadSettings, updateSettings } from './lib/settings.mjs'

const PAGE =
  process.env.TRANCHANT_DASHBOARD_PAGE ??
  path.join(SKILL_DIR, 'page', 'dist', 'dashboard', 'dashboard.js')
if (!existsSync(PAGE)) {
  console.log(`PAGE_MISSING run \`npm ci && npm run build\` in ${PLUGIN_ROOT}`)
  process.exit(2)
}
const port = Number(process.env.TRANCHANT_DASHBOARD_PORT ?? 0)
const pollMs = Number(process.env.TRANCHANT_POLL_MS ?? 5000)
/** One refresh for every watch event of the next 150 ms: a write fires several. */
const BATCH_MS = 150
const THEMES = new Set(['light', 'dark', 'system'])

/** The state folder as the page names it: under the home folder, with `~`. */
const home = os.homedir()
const stateShown =
  STATE_ROOT === home || STATE_ROOT.startsWith(`${home}${path.sep}`)
    ? `~${STATE_ROOT.slice(home.length)}`
    : STATE_ROOT

const catalog = createCatalog()
/** @type {Set<string>} */
const origins = new Set()
/** @type {Set<http.ServerResponse>} */
const listeners = new Set()

/** The list as the page reads it; `home` lets it write paths under it with `~`. */
async function listing() {
  return { state: stateShown, home, reviews: await catalog.list(await listServers()) }
}
/** The list's JSON at the last read: a refresh that finds the same pushes nothing. */
let seen = ''

/** @param {'light' | 'dark' | 'system'} theme */
const shell = (theme) =>
  [
    '<!doctype html>',
    `<html lang="en"${theme === 'system' ? '' : ` data-theme="${theme}"`}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Tranchant · Reviews</title>',
    '</head>',
    '<body>',
    '<div id="root"></div>',
    '<script type="module" src="/dashboard.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  checkOrigin(req, origins)

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
  if (req.method === 'GET' && url.pathname === '/dashboard.js') {
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    })
    return res.end(await readFile(PAGE, 'utf8'))
  }
  if (req.method === 'GET' && url.pathname === '/api/health')
    return send(res, 200, { ok: true, dashboard: true, version: PLUGIN_VERSION })
  if (req.method === 'GET' && url.pathname === '/api/reviews')
    return send(res, 200, await listing())
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    })
    // The list first, on every connection: a page that reconnects reads what it missed
    // from the same stream, so no older answer of another request lands after a newer push.
    res.write(seen ? `event: reviews\ndata: ${seen}\n\n` : ': listening\n\n')
    listeners.add(res)
    req.on('close', () => listeners.delete(res))
    return undefined
  }
  if (req.method === 'PUT' && url.pathname === '/api/theme') {
    const input = await readJson(req)
    const theme = input?.theme
    if (typeof theme !== 'string' || !THEMES.has(theme))
      return send(res, 400, { error: 'theme: light, dark or system' })
    // Read again under the lock: a review's server may be writing the settings too.
    /** @type {string | undefined} */
    let unreadable
    const written = await updateSettings((settings, problem) => {
      unreadable = problem
      return { ...settings, theme }
    })
    if (!written) {
      console.error(
        `tranchant dashboard: theme not saved: ${unreadable ?? 'no settings written'}`,
      )
      return send(res, 409, { error: unreadable ?? 'the settings file cannot be read' })
    }
    return send(res, 200, { theme })
  }
  return send(res, 404, { error: 'not found' })
}

/** Reads the list, and tells the pages when it changed. */
async function refresh() {
  const now = await listing()
  const json = JSON.stringify(now)
  failing = false
  if (json === seen) return
  seen = json
  for (const res of listeners) res.write(`event: reviews\ndata: ${json}\n\n`)
}
/** Whether the last read failed: the pages were told once, until one works again. */
let failing = false
/** @type {Promise<void>} */
let refreshing = Promise.resolve()
const refreshNext = () =>
  (refreshing = refreshing.then(refresh).catch((error) => {
    const said = error instanceof Error ? error.message : String(error)
    console.error(`tranchant dashboard: the list could not be read: ${said}`)
    // The pages keep the last list, no longer said live; the next read that works pushes again.
    if (!failing) for (const res of listeners) res.write('event: stale\ndata: {}\n\n')
    failing = true
    seen = ''
  }))
/** @type {NodeJS.Timeout | undefined} */
let batch
function changeSeen() {
  batch ??= setTimeout(() => {
    batch = undefined
    void refreshNext()
  }, BATCH_MS)
}

/** Watches the whole state folder: a project's first review makes its folder. */
function watchState() {
  try {
    const watcher = watch(STATE_ROOT, { recursive: true }, changeSeen)
    watcher.on('error', (error) => {
      watcher.close()
      console.error(
        `tranchant dashboard: the watch on ${STATE_ROOT} ended: ${String(error)}`,
      )
    })
  } catch (error) {
    // The poll below still reads the list every few seconds.
    console.error(`tranchant dashboard: no watch on ${STATE_ROOT}: ${String(error)}`)
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    if (error instanceof ClientError) {
      const close = error.status === 413 ? { connection: 'close' } : {}
      send(res, error.status, { error: CLIENT_ERRORS[error.status] }, close)
      return
    }
    // Another server holds the settings' lock: a try again, said as such.
    if (error instanceof LockBusy) {
      send(res, 503, { error: error.message })
      return
    }
    console.error(
      `tranchant dashboard: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
    send(res, 500, { error: 'internal error' })
  })
})

/** Listens on `port`, and answers the port it got. */
const listen = () =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : port)
    })
  })

await mkdir(STATE_ROOT, { recursive: true })
// One dashboard at a time: two sessions asking at once must not both start one.
const started = await withFileLock(path.join(SERVERS_DIR, 'dashboard'), async () => {
  const running = (await listServers()).find((one) => one.kind === 'dashboard')
  if (running) return { running: running.url }
  // Left by a dashboard killed outright, its pid another process's since: it answers no more.
  for (const stale of await listServers(SERVERS_DIR, { probe: false }))
    if (stale.kind === 'dashboard') await rm(stale.file, { force: true })
  let listening
  try {
    listening = Number(await listen())
  } catch (error) {
    if (errorCode(error) !== 'EADDRINUSE') throw error
    return { busy: port }
  }
  const url = `http://127.0.0.1:${listening}`
  for (const host of ['127.0.0.1', 'localhost'])
    origins.add(`http://${host}:${listening}`)
  const { remove } = await registerServer({ kind: 'dashboard', port: listening, url })
  removeOnExit(remove)
  return { url }
})
if ('running' in started) {
  console.log(`RUNNING ${started.running}`)
  process.exit(0)
}
if ('busy' in started) {
  console.log(`PORT_BUSY ${started.busy} is used by another program`)
  process.exit(3)
}
await refreshNext()
watchState()
setInterval(() => void refreshNext(), pollMs)
console.log(`READY ${started.url}`)
