// The dashboard: the registry of running servers (lib/registry.mjs), the
// reviews read from the state folder (lib/catalog.mjs), and its server
// (dashboard.mjs), one per machine, which pushes the list as it changes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS, importReview, run, tempDir } from './helpers.mjs'

const DASHBOARD = path.join(SCRIPTS, 'dashboard.mjs')
const LIB = path.join(SCRIPTS, 'lib')

/**
 * A module of lib/, loaded with its own state folder: each test reads its own.
 * @param {string} state
 * @param {string} body An ES module's body, `lib(name)` importing lib/<name>.mjs.
 */
async function inState(state, body) {
  const ran = await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const lib = (name) => import(process.env.TRANCHANT_LIB + '/' + name + '.mjs')\n${body}`,
    ],
    // The path through the environment: never written into the code run.
    { env: { TRANCHANT_STATE_DIR: state, TRANCHANT_LIB: LIB } },
  )
  assert.equal(ran.code, 0, ran.stderr)
  return ran.stdout.trim() ? JSON.parse(ran.stdout) : undefined
}

/**
 * Writes the decisions of review `dir`: each finding id's state.
 * @param {string} dir
 * @param {Record<string, string>} states
 */
async function decide(dir, states) {
  const findings = Object.fromEntries(
    Object.entries(states).map(([id, state]) => [id, { state, runs: [], events: [] }]),
  )
  await writeFile(
    path.join(dir, 'decisions.json'),
    JSON.stringify({ version: 1, findings }, null, 2),
  )
}

/**
 * Sets fields of review `dir`'s envelope.
 * @param {string} dir
 * @param {Record<string, unknown>} fields
 */
async function envelope(dir, fields) {
  const file = path.join(dir, 'review.json')
  const review = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...review, ...fields }, null, 2))
}

test('many servers register at once: each its own entry; an entry whose process is gone is dropped', async (t) => {
  const state = await tempDir(t)
  const servers = path.join(state, 'servers')
  // Twelve servers start at the same instant, then exit: each removes its own entry.
  const go = Date.now() + 300
  const started = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      inState(
        state,
        `const { registerServer } = await lib('registry')
        while (Date.now() < ${go}) {}
        const { entry, remove } = await registerServer({ kind: 'review', port: ${5000 + i}, url: 'http://127.0.0.1:${5000 + i}', review: 'r${i}', dir: '/state/r${i}', project: '/p' })
        const { listServers } = await lib('registry')
        const seen = (await listServers(undefined, { probe: false })).some((one) => one.review === 'r${i}')
        remove()
        console.log(JSON.stringify({ seen, pid: entry.pid }))`,
      ),
    ),
  )
  assert.ok(started.every((one) => one.seen))
  assert.deepEqual(await readdir(servers), [])

  // A server killed outright leaves its file: the next reader drops it, and removes it.
  await writeFile(
    path.join(servers, 'review-999999-0a0b0c0d.json'),
    JSON.stringify({
      version: 1,
      kind: 'review',
      pid: 999_999,
      port: 1,
      url: 'http://127.0.0.1:1',
      startedAt: new Date().toISOString(),
      review: 'gone',
      dir: '/state/gone',
    }),
  )
  assert.deepEqual(
    await inState(
      state,
      `const { listServers } = await lib('registry'); console.log(JSON.stringify(await listServers(undefined, { probe: false })))`,
    ),
    [],
  )
  assert.deepEqual(await readdir(servers), [])
})

test('a server told to stop by a signal removes its entry', async (t) => {
  const state = await tempDir(t)
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { registerServer, removeOnExit } = await import(process.env.TRANCHANT_LIB + '/registry.mjs')
      const { remove } = await registerServer({ kind: 'dashboard', port: 1, url: 'http://127.0.0.1:1' })
      removeOnExit(remove)
      console.log('REGISTERED')
      setInterval(() => {}, 1000)`,
    ],
    {
      env: { ...process.env, TRANCHANT_STATE_DIR: state, TRANCHANT_LIB: LIB },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  t.after(() => child.kill('SIGKILL'))
  await new Promise((resolve) => child.stdout.on('data', resolve))
  assert.equal((await readdir(path.join(state, 'servers'))).length, 1)
  child.kill('SIGTERM')
  await new Promise((resolve) => child.on('exit', resolve))
  assert.deepEqual(await readdir(path.join(state, 'servers')), [])
})

test('the catalog reads each review’s state from its files and whether a server serves it', async (t) => {
  const state = await tempDir(t)
  const settled = await importReview(t, 'ours', state)
  await decide(settled.dir, {
    'f-01': 'fixed',
    'f-02': 'fixed',
    'f-03': 'dropped',
    'f-04': 'moved',
    'f-05': 'skipped',
  })
  const needs = await importReview(t, 'theirs', state)
  await decide(needs.dir, { 'f-01': 'posted', 'f-02': 'asking' })
  const stopped = await importReview(t, 'ours', state, {
    status: 'reviewing',
    findings: [],
  })
  // As /tranchant review's Lenses step writes them: open.mjs keeps none of a file's.
  await envelope(stopped.dir, {
    lenses: [
      { name: 'bugs', source: 'bugs', hash: 'a'.repeat(64) },
      { name: 'style', source: 'style', hash: 'b'.repeat(64) },
    ],
  })
  const running = await importReview(t, 'ours', state, {
    status: 'reviewing',
    findings: [],
  })
  // Only /tranchant review writes a review preparing: imported reviewing, then made so.
  const ready = await importReview(t, 'ours', state, {
    status: 'reviewing',
    findings: [],
  })
  await envelope(ready.dir, { status: 'preparing' })
  await writeFile(
    path.join(ready.dir, 'lenses.json'),
    JSON.stringify({
      state: 'waiting',
      lenses: [
        { name: 'bugs', state: 'ready' },
        { name: 'idle', state: 'idle' },
      ],
    }),
  )

  const listed = await inState(
    state,
    `const { createCatalog } = await lib('catalog')
    const servers = [{ kind: 'review', dir: ${JSON.stringify(running.dir)}, url: 'http://127.0.0.1:4599', runner: { kind: 'session', cwd: '/work/web' } }]
    console.log(JSON.stringify(await createCatalog().list(servers)))`,
  )
  /** @param {string} dir */
  const of = (dir) => listed.find((/** @type {any} */ one) => one.dir === dir)
  assert.equal(listed.length, 5)
  assert.equal(of(settled.dir).state, 'settled')
  assert.equal(of(needs.dir).state, 'needs')
  assert.deepEqual(of(needs.dir).findings, { posted: 1, asking: 1, open: 3 })
  assert.deepEqual(of(needs.dir).mr, {
    url: needs.review.mr.url,
    label: '!5751',
    author: 'jfdoe',
  })
  assert.equal(of(needs.dir).ownership, 'theirs')
  // Reviewing with no server: its session ended mid-way.
  assert.equal(of(stopped.dir).state, 'stopped')
  assert.deepEqual(of(stopped.dir).lenses, { done: 0, total: 2 })
  assert.equal(of(running.dir).state, 'running')
  assert.deepEqual(of(running.dir).live, {
    url: 'http://127.0.0.1:4599',
    cwd: '/work/web',
  })
  assert.equal(of(ready.dir).state, 'ready')
  assert.deepEqual(of(ready.dir).lenses, { done: 0, total: 1 })
  // A project outside git is its own, by its folder's name.
  assert.equal(of(settled.dir).repo.name, path.basename(settled.project))
  assert.equal(of(settled.dir).branch, 'feature/people-drawer-ours')
})

/**
 * Starts dashboard.mjs on state folder `state`, and waits for its first line.
 * @param {any} t
 * @param {string} state
 * @param {string} config
 */
async function startDashboard(t, state, config) {
  const child = spawn(process.execPath, [DASHBOARD], {
    env: {
      ...process.env,
      TRANCHANT_STATE_DIR: state,
      XDG_CONFIG_HOME: config,
      TRANCHANT_POLL_MS: '600000',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  t.after(() => child.kill())
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  const first = await new Promise((resolve) => {
    const check = () => {
      if (output.includes('\n')) resolve(output.split('\n')[0])
    }
    child.stdout.on('data', check)
    child.on('exit', () => resolve(output.split('\n')[0] ?? ''))
  })
  return { child, first: String(first), url: String(first).split(' ')[1] ?? '' }
}

/**
 * The next `reviews` event on the dashboard's stream that `wanted` accepts.
 * @param {string} url
 * @param {(listing: any) => boolean} wanted
 */
async function nextListing(url, wanted) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${url}/api/events`, { signal: controller.signal })
    if (!response.body) throw new Error('no stream')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error('the stream ended')
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const end = buffer.indexOf('\n\n')
        if (end === -1) break
        const event = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = /^event: reviews\ndata: (.*)$/s.exec(event)?.[1]
        if (data && wanted(JSON.parse(data))) return JSON.parse(data)
      }
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

test('the dashboard serves the list, pushes it as a review changes, and runs once a machine', async (t) => {
  const state = await tempDir(t)
  const config = await tempDir(t, 'tranchant-config-')
  const review = await importReview(t, 'ours', state)
  const dashboard = await startDashboard(t, state, config)
  assert.match(dashboard.first, /^READY http:\/\/127\.0\.0\.1:\d+$/)

  const page = await fetch(dashboard.url)
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/)
  assert.match(await page.text(), /<script type="module" src="\/dashboard\.js">/)
  assert.equal((await fetch(`${dashboard.url}/dashboard.js`)).status, 200)

  /** @type {any} */
  const listing = await (await fetch(`${dashboard.url}/api/reviews`)).json()
  assert.equal(listing.state, state)
  assert.deepEqual(
    listing.reviews.map((/** @type {any} */ one) => [one.id, one.state]),
    [[review.review.id, 'needs']],
  )

  // Every finding settled: the page hears it, with no reload.
  // The stream's first event is the list as it stands; the change comes next.
  const settled = nextListing(dashboard.url, (now) => now.reviews[0]?.state === 'settled')
  await decide(review.dir, {
    'f-01': 'fixed',
    'f-02': 'fixed',
    'f-03': 'fixed',
    'f-04': 'fixed',
    'f-05': 'fixed',
  })
  assert.equal((await settled).reviews[0].findings.fixed, 5)

  // A second one while it runs: the first one's page, and it exits.
  const second = await startDashboard(t, state, config)
  assert.equal(second.first, `RUNNING ${dashboard.url}`)

  // Another site's page, or a rebound name, reads nothing.
  const foreign = await fetch(`${dashboard.url}/api/reviews`, {
    headers: { origin: 'https://evil.example' },
  })
  assert.equal(foreign.status, 403)

  // The theme, saved in the settings every page reads.
  const saved = await fetch(`${dashboard.url}/api/theme`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'dark' }),
  })
  assert.equal(saved.status, 200)
  const settings = JSON.parse(
    await readFile(path.join(config, 'tranchant', 'settings.json'), 'utf8'),
  )
  assert.equal(settings.theme, 'dark')
  const refused = await fetch(`${dashboard.url}/api/theme`, {
    method: 'PUT',
    body: JSON.stringify({ theme: 'pink' }),
  })
  assert.equal(refused.status, 400)

  // Stopped, it leaves no entry: the next one starts.
  dashboard.child.kill('SIGTERM')
  await new Promise((resolve) => dashboard.child.on('exit', resolve))
  assert.deepEqual(
    (await readdir(path.join(state, 'servers'))).filter((name) => name.endsWith('.json')),
    [],
  )
})

test('two dashboards started at once: one serves, the other opens its page', async (t) => {
  const state = await tempDir(t)
  const config = await tempDir(t, 'tranchant-config-')
  const both = await Promise.all([
    startDashboard(t, state, config),
    startDashboard(t, state, config),
  ])
  const ready = both.filter((one) => one.first.startsWith('READY '))
  const running = both.filter((one) => one.first.startsWith('RUNNING '))
  assert.equal(ready.length, 1, both.map((one) => one.first).join('\n'))
  assert.equal(running.length, 1)
  assert.equal(running[0]?.url, ready[0]?.url)
})

test("a dashboard's entry left by a crash, its pid another process's: a new dashboard starts all the same", async (t) => {
  const state = await tempDir(t)
  const config = await tempDir(t, 'tranchant-config-')
  const servers = path.join(state, 'servers')
  await mkdir(servers, { recursive: true })
  // This test's own pid: alive, and nothing answers on port 9.
  const stale = path.join(servers, `dashboard-${process.pid}-0a0b0c0d.json`)
  await writeFile(
    stale,
    JSON.stringify({
      version: 1,
      kind: 'dashboard',
      pid: process.pid,
      port: 9,
      url: 'http://127.0.0.1:9',
      startedAt: new Date().toISOString(),
    }),
  )
  const dashboard = await startDashboard(t, state, config)
  assert.match(dashboard.first, /^READY http:\/\/127\.0\.0\.1:\d+$/)
  assert.ok(!(await readdir(servers)).includes(path.basename(stale)))
})

test("a review's server registers itself: the dashboard lists it running, with its page and its session's folder", async (t) => {
  const state = await tempDir(t)
  const config = await tempDir(t, 'tranchant-config-')
  const review = await importReview(t, 'ours', state, {
    status: 'reviewing',
    findings: [],
  })
  const page = path.join(await tempDir(t), 'page.js')
  await writeFile(page, '/* page */\n')
  const server = spawn(
    process.execPath,
    [path.join(SCRIPTS, 'server.mjs'), '--review', review.dir],
    {
      env: {
        ...process.env,
        TRANCHANT_STATE_DIR: state,
        XDG_CONFIG_HOME: config,
        TRANCHANT_HOOKS: '1',
        TRANCHANT_PAGE: page,
        TRANCHANT_POLL_MS: '600000',
        TRANCHANT_SESSION_CWD: '/work/session',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  t.after(() => server.kill())
  const ready = await new Promise((resolve) => {
    let output = ''
    server.stdout.on('data', (chunk) => {
      output += chunk
      const line = output.split('\n').find((one) => one.startsWith('READY '))
      if (line) resolve(line)
    })
  })
  const url = String(ready).split(' ')[1]
  const dashboard = await startDashboard(t, state, config)
  /** @type {any} */
  const listing = await (await fetch(`${dashboard.url}/api/reviews`)).json()
  assert.equal(listing.reviews[0].state, 'running')
  assert.deepEqual(listing.reviews[0].live, { url, cwd: '/work/session' })

  // Stopped by the hooks, with a signal: its entry goes, and the review reads as stopped.
  const stopped = nextListing(dashboard.url, (now) => now.reviews[0]?.state === 'stopped')
  server.kill('SIGTERM')
  await new Promise((resolve) => server.on('exit', resolve))
  assert.deepEqual(
    (await readdir(path.join(state, 'servers'))).filter((name) =>
      name.startsWith('review-'),
    ),
    [],
  )
  // The poll is off here: a change in the state folder makes the dashboard read again.
  await writeFile(path.join(state, 'nudge'), '')
  assert.equal((await stopped).reviews[0].live, undefined)
})
