// scripts/server.mjs, run as the plugin's hooks run it: its lines on stdout,
// its API on the port it printed.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { say } from '../skills/tranchant/scripts/lib/discussion.mjs'
import { createStore, progressPath } from '../skills/tranchant/scripts/lib/store.mjs'
import { buildPlayground } from './fixtures/playground.mjs'
import { SCRIPTS, fixture, importReview, json, run, tempDir } from './helpers.mjs'

const SERVER = path.join(SCRIPTS, 'server.mjs')
const FIRST_LINE = /^(READY|PORT_BUSY|REVIEW_REFUSED|HOOKS_MISSING|PAGE_MISSING)/

/** @type {string} */
let stateDir
/** The settings folder the servers read: the machine's own is never read or written. */
let configDir = ''
/** A stand-in for the built bundle. */
let page = ''
/**
 * The fake glab: answers `api user` with its account (its working folder
 * in `user.txt`, a line per call), else records its call, answers a discussion, or fails when
 * `glabDir/fail` exists.
 */
let glab = ''
let glabDir = ''

before(async (t) => {
  stateDir = await tempDir(t)
  configDir = await tempDir(t, 'tranchant-config-')
  page = path.join(await tempDir(t), 'page.js')
  await writeFile(page, "/* tranchant page (test) */ console.log('page')\n")
  await mkdir(path.join(path.dirname(page), 'chunks'))
  await writeFile(
    path.join(path.dirname(page), 'chunks', 'mermaid-AB12.js'),
    'export {}\n',
  )
  glabDir = await tempDir(t)
  glab = path.join(glabDir, 'glab')
  await writeFile(
    glab,
    [
      '#!/bin/sh',
      `if [ "$1 $2" = "api user" ]; then pwd -P >> "${glabDir}/user.txt"; printf '%s' '{"id":7,"username":"reviewer-bot"}'; exit 0; fi`,
      `printf '%s\\n' "$@" > "${glabDir}/args.txt"`,
      `cat > "${glabDir}/stdin.txt"`,
      `if [ -f "${glabDir}/fail" ]; then echo "glab: 400 Bad Request: line not in diff" >&2; exit 1; fi`,
      `printf '%s' '{"id":"6a1f","notes":[{"id":4242}]}'`,
      '',
    ].join('\n'),
  )
  await chmod(glab, 0o755)
})

/**
 * Starts a server on a fixture review (or on `dir`), and waits for its first
 * line.
 * @param {any} t
 * @param {{ name?: 'theirs' | 'ours', dir?: string, env?: Record<string, string>, overrides?: Record<string, unknown> }} [options]
 */
async function startServer(t, { name = 'theirs', dir: given, env = {}, overrides } = {}) {
  const imported = given ? undefined : await importReview(t, name, stateDir, overrides)
  const dir = given ?? imported?.dir ?? ''
  const child = spawn(process.execPath, [SERVER, '--review', dir], {
    env: {
      ...process.env,
      TRANCHANT_STATE_DIR: stateDir,
      TRANCHANT_HOOKS: '1',
      TRANCHANT_PAGE: page,
      TRANCHANT_GLAB: glab,
      XDG_CONFIG_HOME: configDir,
      // Never during a test: the server sees every change through its watches.
      TRANCHANT_POLL_MS: '600000',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  t.after(() => child.kill())
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  /** @type {Promise<number | null>} */
  const exit = new Promise((resolve) => child.on('exit', (code) => resolve(code)))
  const first = await new Promise((resolve) => {
    const check = () => {
      const line = output.split('\n').find((entry) => FIRST_LINE.test(entry))
      if (line) resolve(line)
    }
    child.stdout.on('data', check)
    child.on('exit', () => resolve(output.split('\n')[0] ?? ''))
    check()
  })
  const port = Number(/^READY http:\/\/127\.0\.0\.1:(\d+)/.exec(first)?.[1] ?? 0)
  /**
   * The first line starting with `prefix` the server printed after `from`.
   * @param {string} prefix
   * @param {number} from A length of the output, taken before the request.
   */
  async function nextLine(prefix, from) {
    for (let waited = 0; waited < 5000; waited += 25) {
      const line = output
        .slice(from)
        .split('\n')
        .find((entry) => entry.startsWith(prefix))
      if (line) return line
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`no line starting with ${prefix} in:\n${output.slice(from)}`)
  }
  return {
    first,
    port,
    base: `http://127.0.0.1:${port}`,
    dir,
    review: imported?.review,
    project: imported?.project ?? '',
    output: () => output,
    nextLine,
    exit,
  }
}

/** @typedef {Awaited<ReturnType<typeof startServer>>} Server */

/** @type {Server} */
let main

before(async (t) => {
  main = await startServer(t)
  assert.match(main.first, /^READY /, main.output())
  // A checkout with a HEAD, for `head.current`.
  const git = (/** @type {string[]} */ args) =>
    run('git', ['-C', main.project, '-c', 'commit.gpgsign=false', ...args])
  await git(['init', '-q'])
  await git([
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  ])
})

/**
 * @param {string} route
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
const post = (route, body, headers = {}) =>
  fetch(`${main.base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const findings = async () => (await json(await fetch(`${main.base}/api/review`))).findings

/**
 * Listens to a server's events, as the page does.
 * @param {string} [base]
 */
async function listen(base = main.base) {
  const controller = new AbortController()
  const response = await fetch(`${base}/api/events`, { signal: controller.signal })
  if (!response.body) throw new Error('no event stream')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let received = ''
  return {
    response,
    /**
     * The next `changed` event naming finding `id` (any one, without), within 3 s.
     * @param {string} [id]
     */
    changed(id) {
      return this.next('changed', (data) => id === undefined || data.ids.includes(id))
    },
    /**
     * The next event of `type` whose data `accepts`, within 3 s.
     * @param {string} type
     * @param {(data: any) => boolean} [accepts]
     */
    async next(type, accepts = () => true) {
      const deadline = setTimeout(() => controller.abort(), 3000)
      try {
        for (;;) {
          const events = received.split('\n\n')
          received = events.pop() ?? ''
          for (const event of events) {
            const data = new RegExp(`^event: ${type}\\ndata: (.*)$`, 'm').exec(event)?.[1]
            if (data && accepts(JSON.parse(data))) return event
          }
          const { value, done } = await reader.read()
          if (done) throw new Error(`no ${type} event`)
          received += value
        }
      } catch (error) {
        throw controller.signal.aborted ? new Error(`no ${type} event`) : error
      } finally {
        clearTimeout(deadline)
      }
    },
    close: () => controller.abort(),
  }
}

test('prints READY with the review and the project, and answers the health check', async () => {
  assert.equal(
    main.first,
    `READY ${main.base} review=${main.review.id} project=${main.project}`,
  )
  const health = await json(await fetch(`${main.base}/api/health`))
  const plugin = new URL('../.claude-plugin/plugin.json', import.meta.url)
  const { version } = JSON.parse(await readFile(plugin, 'utf8'))
  assert.deepEqual(health, { ok: true, review: main.review.id, version })
})

test('serves the page shell with the review’s title, and the bundle', async () => {
  const shell = await fetch(`${main.base}/`)
  assert.equal(shell.status, 200)
  assert.match(shell.headers.get('content-type') ?? '', /text\/html/)
  assert.match(shell.headers.get('content-security-policy') ?? '', /script-src 'self'/)
  // The page's fonts are inlined as data: URLs.
  assert.match(shell.headers.get('content-security-policy') ?? '', /font-src [^;]*data:/)
  const html = await shell.text()
  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('<title>Tranchant · People drawer and table</title>'), html)
  assert.ok(html.includes('<div id="root"></div>'))
  assert.ok(html.includes('<script type="module" src="/page.js"></script>'))
  const bundle = await fetch(`${main.base}/page.js`)
  assert.equal(bundle.status, 200)
  assert.match(bundle.headers.get('content-type') ?? '', /javascript/)
  assert.equal(await bundle.text(), await readFile(page, 'utf8'))
})

test('serves the chunks the page loads on demand, by name only', async () => {
  const chunk = await fetch(`${main.base}/chunks/mermaid-AB12.js`)
  assert.equal(chunk.status, 200)
  assert.match(chunk.headers.get('content-type') ?? '', /javascript/)
  assert.equal(await chunk.text(), 'export {}\n')
  assert.equal((await fetch(`${main.base}/chunks/missing-0000.js`)).status, 404)
  for (const escape of ['/chunks/..%2Fpage.js', '/chunks/.hidden.js', '/chunks/a/b.js']) {
    assert.equal((await fetch(`${main.base}${escape}`)).status, 404, escape)
  }
})

test('answers the review, its decisions, its runs and the heads', async () => {
  const body = await json(await fetch(`${main.base}/api/review`))
  assert.deepEqual(Object.keys(body).toSorted(), [
    'discussions',
    'findings',
    'head',
    'review',
    'reviewers',
    'runs',
  ])
  assert.deepEqual(body.reviewers, [])
  assert.deepEqual(body.discussions, {})
  assert.equal(body.review.id, main.review.id)
  assert.equal(body.review.findings.length, 5)
  assert.deepEqual(body.findings, {})
  assert.deepEqual(body.runs, {})
  assert.equal(body.head.reviewed, main.review.headSha)
  assert.match(body.head.current, /^[0-9a-f]{40}$/)
})

/**
 * The lines of file `file` on the new side of a unified diff, by number,
 * with their sign: what the page shows at each line.
 * @param {string} diff
 * @param {string} file
 */
function newSide(diff, file) {
  /** @type {Map<number, string>} */
  const lines = new Map()
  const section = diff
    .split(/^(?=diff --git )/m)
    .find((part) => part.startsWith(`diff --git a/${file} b/${file}\n`))
  let next = 0
  for (const line of (section ?? '').split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line)
    if (header) next = Number(header[1])
    else if (next && (line.startsWith('+') || line.startsWith(' ')))
      lines.set(next++, line)
  }
  return lines
}

/** A playground built for a fixture review, in a folder of its own. */
const playground = async (
  /** @type {any} */ t,
  /** @type {'ours' | 'theirs'} */ name,
  /** @type {{ folder?: string }} */ options = {},
) =>
  buildPlayground(await tempDir(t, 'tranchant-playground-'), await fixture(name), options)

/**
 * Runs git in `dir`, committing as a test user; throws when it fails.
 * @param {string} dir
 * @param {string[]} args
 */
async function gitIn(dir, ...args) {
  const done = await run('git', [
    '-C',
    dir,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    '-c',
    'commit.gpgsign=false',
    ...args,
  ])
  if (done.code !== 0) throw new Error(`git ${args.join(' ')}: ${done.stderr}`)
  return done.stdout.trim()
}

/** GET /api/diff on `server`: its status and body. @param {Server} server */
async function diffOf(server) {
  const response = await fetch(`${server.base}/api/diff`)
  return { status: response.status, body: await json(response) }
}

/** Git's order of paths: by code unit, not by locale. */
const byBytes = (/** @type {string} */ a, /** @type {string} */ b) =>
  a < b ? -1 : a > b ? 1 : 0

/** The paths a fixture review names: its findings' and their related ones. */
const namedPaths = (/** @type {any} */ review) => [
  ...new Set(
    review.findings.flatMap((/** @type {any} */ finding) => [
      finding.path,
      ...(finding.related ?? []).map((/** @type {any} */ related) => related.path),
    ]),
  ),
]

test('answers the diff of the change, every playground finding on an added line of it', async (t) => {
  const placed = await playground(t, 'ours')
  const server = await startServer(t, { name: 'ours', overrides: placed })
  assert.match(server.first, /^READY /, server.output())
  const { status, body } = await diffOf(server)
  assert.equal(status, 200)
  assert.deepEqual(Object.keys(body).toSorted(), ['base', 'diff', 'files', 'head'])
  assert.equal(body.base, 'main')
  assert.equal(body.head, placed.headSha)
  assert.deepEqual(
    body.files.map((/** @type {any} */ file) => file.path),
    namedPaths(placed).toSorted(byBytes),
  )
  for (const file of body.files) {
    assert.ok(file.additions > 0 && file.deletions > 0, file.path)
    assert.equal(file.binary, false)
  }
  for (const finding of placed.findings) {
    const text = finding.excerpt.lines[finding.line - finding.excerpt.startLine]
    assert.equal(
      newSide(body.diff, finding.path).get(finding.line),
      `+${text}`,
      finding.id,
    )
  }
  // Computed once: the repository gone, the diff still answers.
  const git = path.join(placed.project, '.git')
  await rename(git, `${git}.away`)
  try {
    assert.deepEqual(await diffOf(server), { status: 200, body })
  } finally {
    await rename(`${git}.away`, git)
  }
})

test('a diff that failed is computed again on the next request', async (t) => {
  const placed = await playground(t, 'ours')
  const git = path.join(placed.project, '.git')
  await rename(git, `${git}.away`)
  const server = await startServer(t, { name: 'ours', overrides: placed })
  assert.deepEqual(await diffOf(server), {
    status: 409,
    body: { error: `${placed.project} is not a git repository` },
  })
  await rename(`${git}.away`, git)
  assert.equal((await diffOf(server)).status, 200)
})

test('with diff refs, the diff is the MR’s own, base sha to head sha', async (t) => {
  // A base git cannot resolve: only the diff refs can make this answer.
  const placed = { ...(await playground(t, 'theirs')), base: 'nowhere' }
  const server = await startServer(t, { name: 'theirs', overrides: placed })
  const { status, body } = await diffOf(server)
  assert.equal(status, 200, JSON.stringify(body))
  assert.equal(body.base, placed.mr?.diffRefs?.baseSha)
  assert.equal(body.head, placed.mr?.diffRefs?.headSha)
  assert.equal(body.files.length, namedPaths(placed).length)
  const notes = [...newSide(body.diff, 'src/people/PersonNotes.tsx').values()]
  const excerpt = placed.findings.find((/** @type {any} */ f) => f.id === 'f-02')?.excerpt
  assert.deepEqual(
    notes.filter((line) => line.startsWith('+')),
    excerpt?.lines.map((/** @type {string} */ line) => `+${line}`),
  )
})

test('in a project that is a folder of its repository, paths are the findings’', async (t) => {
  const placed = await playground(t, 'ours', { folder: 'web' })
  const root = path.dirname(placed.project)
  // A change outside the project: not the project's diff.
  await writeFile(path.join(root, 'outside.txt'), 'elsewhere\n')
  await gitIn(root, 'add', '-A')
  await gitIn(root, 'commit', '-q', '-m', 'outside')
  const headSha = await gitIn(root, 'rev-parse', 'HEAD')
  const server = await startServer(t, { name: 'ours', overrides: { ...placed, headSha } })
  const { status, body } = await diffOf(server)
  assert.equal(status, 200, JSON.stringify(body))
  assert.deepEqual(
    body.files.map((/** @type {any} */ file) => file.path),
    namedPaths(placed).toSorted(byBytes),
  )
  const finding = placed.findings[0]
  assert.ok(newSide(body.diff, finding.path).has(finding.line))
})

test('lists a rename with its old path, a binary with no counts, and a quoted path', async (t) => {
  const project = await tempDir(t, 'tranchant-files-')
  await writeFile(
    path.join(project, 'old.ts'),
    'export const a = 1\nexport const b = 2\n',
  )
  await writeFile(path.join(project, 'logo.png'), Buffer.from([0x89, 0x50, 0, 1]))
  await gitIn(project, 'init', '-q', '-b', 'main')
  await gitIn(project, 'add', '-A')
  await gitIn(project, 'commit', '-q', '-m', 'base')
  await gitIn(project, 'checkout', '-q', '-b', 'files')
  await gitIn(project, 'mv', 'old.ts', 'new.ts')
  await writeFile(
    path.join(project, 'new.ts'),
    'export const a = 1\nexport const b = 3\n',
  )
  await writeFile(path.join(project, 'logo.png'), Buffer.from([0x89, 0x50, 0, 2]))
  await writeFile(path.join(project, 'say "hi".ts'), 'export {}\n')
  await gitIn(project, 'add', '-A')
  await gitIn(project, 'commit', '-q', '-m', 'head')
  const headSha = await gitIn(project, 'rev-parse', 'HEAD')
  const server = await startServer(t, {
    name: 'ours',
    overrides: { project, base: 'main', headSha },
  })
  const { status, body } = await diffOf(server)
  assert.equal(status, 200, JSON.stringify(body))
  assert.deepEqual(
    body.files.toSorted((/** @type {any} */ a, /** @type {any} */ b) =>
      a.path.localeCompare(b.path),
    ),
    [
      { path: 'logo.png', additions: 0, deletions: 0, binary: true },
      { path: 'new.ts', oldPath: 'old.ts', additions: 1, deletions: 1, binary: false },
      { path: 'say "hi".ts', additions: 1, deletions: 0, binary: false },
    ],
  )
  assert.ok(body.diff.includes('diff --git "a/say \\"hi\\".ts" "b/say \\"hi\\".ts"\n'))
})

/** GET /api/lines on `server`: its status and body. @param {Server} server @param {Record<string, string>} query */
async function linesOf(server, query) {
  const response = await fetch(
    `${server.base}/api/lines?${new URLSearchParams(query).toString()}`,
  )
  return { status: response.status, body: await json(response) }
}

/** `count` lines, `line <n>`, but line `changed`, with CRLF ends. */
const numbered = (/** @type {number} */ count, /** @type {number} */ changed) =>
  Array.from({ length: count }, (_, at) =>
    at + 1 === changed ? `changed ${at + 1}` : `line ${at + 1}`,
  ).join('\r\n') + '\r\n'

test('answers the lines of a file of the diff at its head, and refuses any other path or range', async (t) => {
  const root = await tempDir(t, 'tranchant-lines-')
  const project = path.join(root, 'web')
  await mkdir(project)
  await writeFile(path.join(project, 'long.ts'), numbered(30, 0))
  await writeFile(path.join(project, 'gone.ts'), 'bye\n')
  await writeFile(path.join(project, 'old.ts'), 'one\ntwo\nthree\nfour\n')
  await writeFile(path.join(project, 'secret.txt'), 'not in the diff\n')
  await writeFile(path.join(project, 'logo.png'), Buffer.from([0x89, 0x50, 0, 1]))
  await writeFile(path.join(root, 'outside.ts'), 'outside\n')
  await gitIn(root, 'init', '-q', '-b', 'main')
  await gitIn(root, 'add', '-A')
  await gitIn(root, 'commit', '-q', '-m', 'base')
  await gitIn(root, 'checkout', '-q', '-b', 'lines')
  await writeFile(path.join(project, 'long.ts'), numbered(30, 15))
  await writeFile(path.join(project, 'logo.png'), Buffer.from([0x89, 0x50, 0, 2]))
  await writeFile(path.join(root, 'outside.ts'), 'still outside\n')
  await gitIn(root, 'rm', '-q', 'web/gone.ts')
  await gitIn(root, 'mv', 'web/old.ts', 'web/new.ts')
  await writeFile(path.join(project, 'new.ts'), 'one\ntwo\nthree\nFOUR\n')
  await writeFile(path.join(project, 'say "hi" é.ts'), 'hi\nthere\n')
  // The user's own context: the page reads a file's end from three lines of it.
  await gitIn(root, 'config', 'diff.context', '1')
  await gitIn(root, 'add', '-A')
  await gitIn(root, 'commit', '-q', '-m', 'head')
  const headSha = await gitIn(root, 'rev-parse', 'HEAD')
  // The working tree moved on: the lines are the head's.
  await writeFile(path.join(project, 'long.ts'), 'edited since\n')
  const server = await startServer(t, {
    name: 'ours',
    overrides: { project, base: 'main', headSha },
  })
  assert.deepEqual(await linesOf(server, { path: 'long.ts', from: '14', to: '16' }), {
    status: 200,
    body: {
      path: 'long.ts',
      from: 14,
      to: 16,
      total: 30,
      lines: ['line 14', 'changed 15', 'line 16'],
    },
  })
  // `to` past the end stops at the file's last line.
  assert.deepEqual(
    (await linesOf(server, { path: 'long.ts', from: '29', to: '99' })).body,
    {
      path: 'long.ts',
      from: 29,
      to: 30,
      total: 30,
      lines: ['line 29', 'line 30'],
    },
  )
  assert.deepEqual(await linesOf(server, { path: 'long.ts', from: '31', to: '50' }), {
    status: 416,
    body: { error: 'long.ts has 30 lines: line 31 is past its end', total: 30 },
  })
  /** @type {Record<string, string>[]} */
  const refused = [
    { path: 'long.ts', from: '0', to: '3' },
    { path: 'long.ts', from: '5', to: '4' },
    { path: 'long.ts', from: 'x', to: '4' },
    { path: 'long.ts', from: '1' },
  ]
  for (const query of refused) {
    assert.equal((await linesOf(server, query)).status, 400, JSON.stringify(query))
  }
  // Only a text file of the diff: not another file, nor one out of the project.
  for (const file of ['secret.txt', '../outside.ts', 'logo.png', '', '/etc/passwd']) {
    assert.deepEqual(await linesOf(server, { path: file, from: '1', to: '1' }), {
      status: 404,
      body: { error: `${file} is not a text file of the diff` },
    })
  }
  // A renamed file by its new path, a quoted one by its own name, as the page parses them.
  assert.deepEqual(
    (await linesOf(server, { path: 'new.ts', from: '1', to: '2' })).body.lines,
    ['one', 'two'],
  )
  assert.deepEqual(
    (await linesOf(server, { path: 'say "hi" é.ts', from: '2', to: '2' })).body.lines,
    ['there'],
  )
  const { body: diff } = await diffOf(server)
  assert.ok(
    diff.diff.includes(' line 12\r\n line 13\r\n line 14\r\n-line 15\r\n+changed 15'),
    'three lines of context, whatever diff.context says',
  )
  const gone = await linesOf(server, { path: 'gone.ts', from: '1', to: '1' })
  assert.equal(gone.status, 409)
  assert.match(gone.body.error, new RegExp(`^gone.ts cannot be read at ${headSha}: `))
})

test('says why the diff is unavailable', async (t) => {
  // The main server's checkout holds one empty commit: neither diff ref is there.
  const refs = main.review.mr.diffRefs
  assert.deepEqual(await diffOf(main), {
    status: 409,
    body: { error: `base ${refs.baseSha} is not in ${main.project}: fetch it first` },
  })
  const plain = await startServer(t, { name: 'ours' })
  assert.deepEqual((await diffOf(plain)).body, {
    error: `${plain.project} is not a git repository`,
  })
  const gone = path.join(await tempDir(t), 'gone')
  const missing = await startServer(t, { name: 'ours', overrides: { project: gone } })
  assert.match(
    (await diffOf(missing)).body.error,
    /^git cannot read .*gone: cannot change to /,
  )
  const placed = await playground(t, 'ours')
  /** @type {[Record<string, string>, string][]} */
  const cases = [
    [{ base: 'nowhere' }, `base nowhere is not in ${placed.project}: fetch it first`],
    [{ headSha: 'abc1234' }, `head abc1234 is not in ${placed.project}: fetch it first`],
    [
      { base: placed.headSha },
      `the diff of ${placed.headSha}...${placed.headSha} is empty`,
    ],
  ]
  for (const [index, [overrides, error]] of cases.entries()) {
    const server = await startServer(t, {
      name: 'ours',
      overrides: { ...placed, ...overrides, id: `unavailable-${index}` },
    })
    assert.deepEqual(await diffOf(server), { status: 409, body: { error } })
  }
})

test('a base that reads as a git option is refused, and git writes nothing', async (t) => {
  const placed = await playground(t, 'ours')
  const out = await tempDir(t)
  const base = `--output=${path.join(out, 'x')}`
  const server = await startServer(t, { name: 'ours', overrides: { ...placed, base } })
  assert.deepEqual(await diffOf(server), {
    status: 409,
    body: { error: `base ${base} is not a revision` },
  })
  assert.deepEqual(await readdir(out), [])
})

test('an ours review whose MR is at another head shows its own branch’s diff', async (t) => {
  const placed = await playground(t, 'ours')
  const head = 'f'.repeat(40)
  const mr = {
    project: 'shop/web',
    iid: 3,
    url: 'https://gitlab.example.com/shop/web/-/merge_requests/3',
    author: 'me',
    diffRefs: { baseSha: head, headSha: head, startSha: head },
  }
  const server = await startServer(t, { name: 'ours', overrides: { ...placed, mr } })
  const { status, body } = await diffOf(server)
  assert.equal(status, 200, JSON.stringify(body))
  assert.equal(body.base, 'main')
  assert.equal(body.head, placed.headSha)
})

test('refuses diff refs of another head than the review’s', async (t) => {
  const placed = await playground(t, 'theirs')
  const other = placed.mr?.diffRefs?.baseSha ?? ''
  const server = await startServer(t, {
    name: 'theirs',
    overrides: { ...placed, headSha: other },
  })
  assert.deepEqual(await diffOf(server), {
    status: 409,
    body: {
      error: `the MR's diff refs are at ${placed.mr?.diffRefs?.headSha}, the review at ${other}`,
    },
  })
})

test('says when git is missing, or the diff is past the size limit', async (t) => {
  const placed = await playground(t, 'ours')
  const nowhere = await startServer(t, {
    name: 'ours',
    overrides: placed,
    env: { PATH: await tempDir(t) },
  })
  assert.deepEqual((await diffOf(nowhere)).body, { error: 'git is not installed' })
  const small = await startServer(t, {
    name: 'ours',
    overrides: placed,
    env: { TRANCHANT_MAX_DIFF_MIB: '0.0001' },
  })
  assert.deepEqual((await diffOf(small)).body, {
    error: `git diff main...${placed.headSha} failed: the diff is larger than 0.0001 MiB`,
  })
})

test('applies a batch of decisions in order, and prints a line for each', async () => {
  const printed = main.output().length
  const response = await post('/api/decisions', {
    decisions: [
      { id: 'f-01', action: 'fix', context: 'keep the early return' },
      { id: 'f-02', action: 'drop', reason: 'Notes are sanitized upstream' },
      { id: 'f-03', action: 'skip' },
      { id: 'f-99', action: 'fix' },
      { id: 'f-04', action: 'burn' },
      { id: 'f-01', action: 'fix' },
    ],
  })
  assert.equal(response.status, 200)
  const result = await json(response)
  assert.deepEqual(result.applied, ['f-01', 'f-02', 'f-03'])
  assert.deepEqual(result.refused, [
    { id: 'f-99', reason: 'no finding f-99 in the review' },
    { id: 'f-04', reason: 'not a decision' },
    { id: 'f-01', reason: 'fix refused: finding f-01 is queued' },
  ])
  assert.equal(await main.nextLine('FIX f-01', printed), 'FIX f-01')
  assert.equal(await main.nextLine('DROPPED f-02', printed), 'DROPPED f-02')
  assert.equal(await main.nextLine('SKIPPED f-03', printed), 'SKIPPED f-03')
  const decided = await findings()
  assert.equal(decided['f-01'].state, 'queued')
  assert.equal(decided['f-01'].decision.context, 'keep the early return')
  assert.equal(decided['f-02'].state, 'dropped')
  assert.equal(decided['f-02'].reason, 'Notes are sanitized upstream')
  assert.equal(decided['f-03'].state, 'skipped')
})

test('refuses a request from another origin, and takes its own', async () => {
  const other = await post(
    '/api/decisions',
    { decisions: [] },
    { origin: 'https://evil.example' },
  )
  assert.equal(other.status, 403)
  assert.deepEqual(await json(other), { error: 'origin not allowed' })
  const read = await fetch(`${main.base}/api/review`, {
    headers: { origin: 'http://localhost:3000' },
  })
  assert.equal(read.status, 403)
  const own = await post('/api/decisions', { decisions: [] }, { origin: main.base })
  assert.equal(own.status, 200)
  const local = await fetch(`${main.base}/api/health`, {
    headers: { origin: `http://localhost:${main.port}` },
  })
  assert.equal(local.status, 200)
  const broken = await fetch(`${main.base}/api/decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  })
  assert.equal(broken.status, 400)
})

test('tells the pages what changed, and prints STOP when the reviewer stops a finding', async () => {
  const events = await listen()
  try {
    const printed = main.output().length
    await post('/api/decisions', { decisions: [{ id: 'f-04', action: 'fix' }] })
    await events.changed('f-04')
    await main.nextLine('FIX f-04', printed)
    const stopped = await post('/api/stop', { id: 'f-04' })
    assert.equal(stopped.status, 200)
    assert.equal((await json(stopped)).finding.state, 'stopped')
    assert.equal(await main.nextLine('STOP f-04', printed), 'STOP f-04')
    await events.changed('f-04')
    const again = await post('/api/stop', { id: 'f-04' })
    assert.equal(again.status, 409)
    assert.deepEqual(await json(again), {
      error: 'stop refused: finding f-04 is stopped',
    })
  } finally {
    events.close()
  }
})

test('an answer queues the finding again, and prints FIX', async () => {
  const store = createStore(main.dir)
  await post('/api/decisions', { decisions: [{ id: 'f-05', action: 'fix' }] })
  await store.claim('f-05', { agent: 'a5' })
  await store.ask('f-05', {
    text: 'Which formatter?',
    options: [{ label: 'formatDate' }, { label: 'Intl' }],
  })
  const early = await post('/api/answer', { id: 'f-01', text: 'x' })
  assert.equal(early.status, 409)
  const printed = main.output().length
  const answered = await post('/api/answer', {
    id: 'f-05',
    text: ' keep the time zone ',
    choices: ['Intl', 'x'],
  })
  assert.equal(answered.status, 200)
  const { finding } = await json(answered)
  assert.equal(finding.state, 'queued')
  assert.deepEqual(finding.answer.choices, ['Intl'])
  assert.equal(finding.answer.text, 'keep the time zone')
  assert.equal(await main.nextLine('FIX f-05', printed), 'FIX f-05')
})

test('lists the steps of a run in progress, then its history', async () => {
  const store = createStore(main.dir)
  await store.claim('f-01', { agent: 'a1', model: 'claude-opus-5-5' })
  await mkdir(path.dirname(progressPath(main.dir, 'f-01')), { recursive: true })
  await appendFile(
    progressPath(main.dir, 'f-01'),
    [
      { at: 1, kind: 'start', label: 'Started', state: 'done', id: 't1' },
      {
        at: 2,
        kind: 'edit',
        label: 'src/people/usePeople.ts',
        state: 'running',
        id: 't2',
      },
      { at: 3, kind: 'edit', label: 'src/people/usePeople.ts', state: 'done', id: 't2' },
    ]
      .map((step) => `${JSON.stringify(step)}\n`)
      .join(''),
  )
  const review = await json(await fetch(`${main.base}/api/review`))
  assert.deepEqual(
    review.runs['f-01'].map((step) => [step.kind, step.state]),
    [
      ['start', 'done'],
      ['edit', 'done'],
    ],
  )
  await store.done('f-01', 'Returned early.')
  const runs = await json(await fetch(`${main.base}/api/runs/f-01`))
  assert.deepEqual(runs.progress, [])
  assert.equal(runs.history.length, 2)
  assert.equal((await fetch(`${main.base}/api/runs/..%2Fx`)).status, 404)
  assert.deepEqual((await json(await fetch(`${main.base}/api/review`))).runs, {})
})

/**
 * Runs a fix of finding `id` through the store, its run writing `steps`;
 * `end` says how the run ends: `done`, `failed`, or still `working`.
 * @param {string} dir
 * @param {string} id
 * @param {object[]} steps
 * @param {{ end?: 'done' | 'failed' | 'working' }} [options]
 */
async function fixWith(dir, id, steps, { end = 'done' } = {}) {
  const store = createStore(dir)
  await store.decide(id, { action: 'fix' })
  await store.claim(id, { agent: 'a1', model: 'claude-opus-5-5' })
  await writeSteps(dir, id, steps)
  if (end === 'done') await store.done(id, 'Done.')
  else if (end === 'failed') await store.abandon(id, 'a1')
}

/**
 * Appends `steps` to finding `id`'s run in progress.
 * @param {string} dir
 * @param {string} id
 * @param {object[]} steps
 */
async function writeSteps(dir, id, steps) {
  await mkdir(path.dirname(progressPath(dir, id)), { recursive: true })
  await appendFile(
    progressPath(dir, id),
    steps.map((step) => `${JSON.stringify(step)}\n`).join(''),
  )
}

test('lists the files a fix wrote and their diff against HEAD; another fix since is named', async (t) => {
  const server = await startServer(t, { name: 'ours' })
  const { project, dir } = server
  await mkdir(path.join(project, 'src'), { recursive: true })
  await writeFile(path.join(project, 'src/a.ts'), 'one\n')
  await writeFile(path.join(project, 'src/b.ts'), 'kept\n')
  await gitIn(project, 'init', '-q')
  await gitIn(project, 'add', '-A')
  await gitIn(project, 'commit', '-q', '-m', 'init')
  await writeFile(path.join(project, 'src/a.ts'), 'two\n')
  // Changed, but by a write that failed: not the fix's.
  await writeFile(path.join(project, 'src/b.ts'), 'changed\n')
  await writeFile(path.join(project, 'src/new file.ts'), 'fresh\n')
  await writeFile(path.join(project, 'src/early.ts'), 'early\n')
  await writeFile(path.join(project, 'README.md'), 'mine\n')
  // A first run that failed: its writes are not the fix's.
  await fixWith(
    dir,
    'f-01',
    [
      {
        at: 1,
        kind: 'write',
        label: 'src/early.ts',
        file: 'src/early.ts',
        state: 'done',
      },
    ],
    { end: 'failed' },
  )
  await fixWith(dir, 'f-01', [
    { at: 2, kind: 'read', label: 'src/b.ts', state: 'done' },
    { at: 3, kind: 'edit', label: 'src/a.ts', file: 'src/a.ts', state: 'done' },
    { at: 4, kind: 'write', label: 'src/new file.ts', state: 'done' },
    { at: 5, kind: 'edit', label: 'src/b.ts', file: 'src/b.ts', state: 'failed' },
    { at: 6, kind: 'edit', label: '../outside.ts', state: 'done' },
    // Outside the repository: the label is only a name, the project has one.
    {
      at: 7,
      kind: 'write',
      label: 'README.md',
      file: '../../tmp/README.md',
      state: 'done',
    },
  ])
  // Another fix wrote src/a.ts after this one did; a third is still writing it.
  await fixWith(dir, 'f-02', [
    { at: 9, kind: 'edit', label: 'src/a.ts', file: 'src/a.ts', state: 'done' },
  ])
  await fixWith(
    dir,
    'f-03',
    [{ at: 10, kind: 'edit', label: 'src/a.ts', file: 'src/a.ts', state: 'running' }],
    { end: 'working' },
  )

  const response = await fetch(`${server.base}/api/changes/f-01`)
  assert.equal(response.status, 200)
  const body = await json(response)
  assert.deepEqual(body.files, [
    { path: 'src/a.ts', since: ['f-02', 'f-03'] },
    { path: 'src/new file.ts', since: [] },
  ])
  assert.match(body.diff, /^diff --git a\/src\/a\.ts b\/src\/a\.ts$/m)
  assert.match(body.diff, /^-one$/m)
  assert.match(body.diff, /^\+two$/m)
  assert.match(body.diff, /^\+\+\+ b\/src\/new file\.ts\t?$/m)
  assert.match(body.diff, /^\+fresh$/m)
  assert.doesNotMatch(body.diff, /b\.ts|early|README/)

  const later = await json(await fetch(`${server.base}/api/changes/f-02`))
  assert.deepEqual(later.files, [{ path: 'src/a.ts', since: ['f-03'] }])
})

test('a run with no edit lists no file, and an id that is not one is not found', async (t) => {
  const server = await startServer(t, { name: 'ours' })
  await fixWith(server.dir, 'f-03', [
    { at: 1, kind: 'read', label: 'src/a.ts', state: 'done' },
  ])
  const response = await fetch(`${server.base}/api/changes/f-03`)
  assert.equal(response.status, 200)
  assert.deepEqual(await json(response), { files: [], diff: '' })
  assert.deepEqual(await json(await fetch(`${server.base}/api/changes/f-04`)), {
    files: [],
    diff: '',
  })
  assert.equal((await fetch(`${server.base}/api/changes/..%2Fx`)).status, 404)
  assert.equal((await fetch(`${server.base}/api/changes/f-99`)).status, 404)
})

test('an untracked path through a symlinked folder, or that is not a file, is not read', async (t) => {
  const server = await startServer(t, { name: 'ours' })
  const { project, dir } = server
  const outside = await tempDir(t)
  await writeFile(path.join(outside, 'secret.txt'), 'SECRET\n')
  await writeFile(path.join(project, 'kept.txt'), 'kept\n')
  await gitIn(project, 'init', '-q')
  await gitIn(project, 'add', '-A')
  await gitIn(project, 'commit', '-q', '-m', 'init')
  await symlink(outside, path.join(project, 'linked'))
  await mkdir(path.join(project, 'folder'))
  await fixWith(dir, 'f-01', [
    {
      at: 1,
      kind: 'write',
      label: 'linked/secret.txt',
      file: 'linked/secret.txt',
      state: 'done',
    },
    { at: 2, kind: 'write', label: 'folder', file: 'folder', state: 'done' },
  ])
  const response = await fetch(`${server.base}/api/changes/f-01`)
  assert.equal(response.status, 200)
  const body = await json(response)
  assert.equal(body.files.length, 2)
  assert.equal(body.diff, '')
})

test('a request for another host is refused', async () => {
  // fetch never sends the Host it is given: a rebound DNS name does.
  const status = await new Promise((resolve, reject) => {
    http
      .get(
        {
          host: '127.0.0.1',
          port: main.port,
          path: '/api/health',
          headers: { host: `rebound.example:${main.port}` },
        },
        (response) => {
          response.resume()
          resolve(response.statusCode)
        },
      )
      .on('error', reject)
  })
  assert.equal(status, 403)
})

test('the changes of a fix in a project git cannot read are unavailable', async (t) => {
  const server = await startServer(t, { name: 'ours' })
  await fixWith(server.dir, 'f-05', [
    { at: 1, kind: 'edit', label: 'src/a.ts', state: 'done' },
  ])
  const response = await fetch(`${server.base}/api/changes/f-05`)
  assert.equal(response.status, 409)
  assert.match((await json(response)).error, /not a git repository/)
})

test('posts a comment with glab itself, and records where it landed', async () => {
  const printed = main.output().length
  const response = await post('/api/decisions', {
    decisions: [{ id: 'f-02', action: 'post', comment: 'Edited words' }],
  })
  assert.deepEqual((await json(response)).applied, ['f-02'])
  assert.equal(await main.nextLine('POSTED f-02', printed), 'POSTED f-02')
  const { mr } = main.review
  const posted = (await findings())['f-02']
  assert.equal(posted.state, 'posted')
  assert.equal(posted.posted.discussionId, '6a1f')
  assert.equal(posted.posted.url, `${mr.url}#note_4242`)
  // A positioned discussion, as a JSON body, on the MR's project and iid.
  const args = (await readFile(path.join(glabDir, 'args.txt'), 'utf8')).trim().split('\n')
  assert.deepEqual(args, [
    'api',
    '--method',
    'POST',
    '--header',
    'Content-Type: application/json',
    '--input',
    '-',
    'projects/qohash%2Fdashboard-ui/merge_requests/5751/discussions',
  ])
  assert.deepEqual(JSON.parse(await readFile(path.join(glabDir, 'stdin.txt'), 'utf8')), {
    body: 'Edited words',
    position: {
      position_type: 'text',
      base_sha: mr.diffRefs.baseSha,
      head_sha: mr.diffRefs.headSha,
      start_sha: mr.diffRefs.startSha,
      old_path: 'src/people/PersonNotes.tsx',
      new_path: 'src/people/PersonNotes.tsx',
      new_line: 27,
    },
  })
})

test('names the account glab posts as, read once', async () => {
  for (let ask = 0; ask < 2; ask++) {
    const response = await fetch(`${main.base}/api/account`)
    assert.equal(response.status, 200)
    assert.deepEqual(await json(response), { username: 'reviewer-bot', tool: 'glab' })
  }
  // One call, from the project: glab takes the host it posts to from there.
  const calls = (await readFile(path.join(glabDir, 'user.txt'), 'utf8'))
    .trim()
    .split('\n')
  assert.deepEqual(calls, [await realpath(main.review.project)])
})

test('an account glab cannot read answers null, without failing', async (t) => {
  const server = await startServer(t, {
    env: { TRANCHANT_GLAB: path.join(glabDir, 'no-such-glab') },
  })
  const response = await fetch(`${server.base}/api/account`)
  assert.equal(response.status, 200)
  assert.deepEqual(await json(response), { username: null, tool: 'glab' })
})

test('a glab answering no username answers null', async (t) => {
  const odd = path.join(await tempDir(t), 'glab')
  await writeFile(odd, `#!/bin/sh\nprintf '%s' '{"message":"401 Unauthorized"}'\n`)
  await chmod(odd, 0o755)
  const server = await startServer(t, { env: { TRANCHANT_GLAB: odd } })
  const response = await fetch(`${server.base}/api/account`)
  assert.deepEqual(await json(response), { username: null, tool: 'glab' })
})

test('a post glab refuses fails the finding with glab’s first line', async () => {
  await writeFile(path.join(glabDir, 'fail'), '')
  try {
    const printed = main.output().length
    await post('/api/decisions', { decisions: [{ id: 'f-03', action: 'post' }] })
    assert.equal(
      await main.nextLine('POST_FAILED f-03', printed),
      'POST_FAILED f-03 glab: 400 Bad Request: line not in diff',
    )
    const failed = (await findings())['f-03']
    assert.equal(failed.state, 'failed')
    assert.equal(failed.reason, 'glab: 400 Bad Request: line not in diff')
    // The finding's own comment went, the reviewer having edited nothing.
    assert.equal(
      JSON.parse(await readFile(path.join(glabDir, 'stdin.txt'), 'utf8')).body,
      main.review.findings[2].comment,
    )
  } finally {
    await rm(path.join(glabDir, 'fail'), { force: true })
  }
})

test('a review opened before its findings grows as they land, then completes', async (t) => {
  const imported = await importReview(t, 'ours', stateDir, {
    id: 'live-server-1',
    status: 'reviewing',
    findings: [],
  })
  const server = await startServer(t, { dir: imported.dir })
  assert.match(server.first, /^READY /, server.output())
  const initial = await json(await fetch(`${server.base}/api/review`))
  assert.equal(initial.review.status, 'reviewing')
  assert.deepEqual(initial.review.findings, [])
  const events = await listen(server.base)
  try {
    const { findings: landing } = await fixture('ours')
    // f-02 lands before f-01: the order they landed, not the ids'.
    for (const finding of [landing[1], landing[0]]) {
      const added = await run(
        process.execPath,
        [path.join(SCRIPTS, 'add.mjs'), '--review', imported.dir],
        { input: JSON.stringify(finding) },
      )
      assert.equal(added.stdout, `ADDED ${finding.id}\n`, added.stderr)
      await events.changed(finding.id)
    }
    // The summary agent's write alone tells the page: no finding changed.
    const summarized = await run(
      process.execPath,
      [path.join(SCRIPTS, 'summarize.mjs'), '--review', imported.dir],
      { input: JSON.stringify({ summary: 'Adds discounts.', strengths: ['A test.'] }) },
    )
    assert.equal(summarized.stdout, 'SUMMARIZED\n', summarized.stderr)
    assert.match(await events.changed(), /"ids":\[\]/)
    const grown = await json(await fetch(`${server.base}/api/review`))
    assert.equal(grown.review.summary, 'Adds discounts.')
    assert.deepEqual(grown.review.strengths, ['A test.'])
    assert.deepEqual(
      grown.review.findings.map((finding) => finding.id),
      ['f-02', 'f-01'],
    )
    assert.equal(grown.review.status, 'reviewing')
    // A finding that just landed takes decisions like any other.
    const decided = await fetch(`${server.base}/api/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisions: [{ id: 'f-02', action: 'skip' }] }),
    })
    assert.deepEqual((await json(decided)).applied, ['f-02'])
    await events.changed('f-02')
    const done = await run(process.execPath, [
      path.join(SCRIPTS, 'complete.mjs'),
      '--review',
      imported.dir,
    ])
    assert.equal(done.stdout, 'COMPLETE\n', done.stderr)
    assert.match(await events.changed(), /"ids":\[\]/)
    const completed = await json(await fetch(`${server.base}/api/review`))
    assert.equal(completed.review.status, 'complete')
    assert.equal(completed.findings['f-02'].state, 'skipped')
  } finally {
    events.close()
  }
})

test('a verified review prints LANDED once per finding, and serves its review agents', async (t) => {
  const { findings: landing } = await fixture('ours')
  const imported = await importReview(t, 'ours', stateDir, {
    id: 'live-verify-1',
    status: 'reviewing',
    verify: true,
    findings: [landing[0], landing[1]],
  })
  // f-01 landed before the server started, and was verified: no LANDED.
  await createStore(imported.dir).verify(landing[0].id)
  const server = await startServer(t, { dir: imported.dir })
  assert.match(server.first, /^READY /, server.output())
  assert.equal(await server.nextLine('LANDED', 0), 'LANDED f-02')
  const events = await listen(server.base)
  try {
    const seen = server.output().length
    const added = await run(
      process.execPath,
      [path.join(SCRIPTS, 'add.mjs'), '--review', imported.dir],
      { input: JSON.stringify(landing[2]) },
    )
    assert.equal(added.stdout, `ADDED ${landing[2].id}\n`, added.stderr)
    await events.changed(landing[2].id)
    assert.equal(await server.nextLine('LANDED', seen), `LANDED ${landing[2].id}`)

    // A verifier confirms f-02 and removes the third: the page hears both.
    const verified = await run(process.execPath, [
      path.join(SCRIPTS, 'verify.mjs'),
      'f-02',
      '--review',
      imported.dir,
    ])
    assert.equal(verified.stdout, 'VERIFIED f-02\n', verified.stderr)
    await events.changed('f-02')
    const removed = await run(process.execPath, [
      path.join(SCRIPTS, 'remove.mjs'),
      landing[2].id,
      '--review',
      imported.dir,
    ])
    assert.equal(removed.stdout, `REMOVED ${landing[2].id}\n`, removed.stderr)
    await events.changed(landing[2].id)
    const body = await json(await fetch(`${server.base}/api/review`))
    assert.deepEqual(
      body.review.findings.map((finding) => [finding.id, finding.verified]),
      [
        ['f-01', true],
        ['f-02', true],
      ],
    )

    // A review agent's run file: its steps reach the page, running until its end.
    const file = path.join(imported.dir, 'reviewers', 'rv-bugs.jsonl')
    await appendFile(
      file,
      `${JSON.stringify({ at: 1, kind: 'start', label: 'Reviewing: bugs', state: 'done' })}\n`,
    )
    await events.changed()
    let agents = (await json(await fetch(`${server.base}/api/review`))).reviewers
    assert.deepEqual(agents, [
      {
        name: 'rv-bugs',
        running: true,
        steps: [{ at: 1, kind: 'start', label: 'Reviewing: bugs', state: 'done' }],
      },
    ])
    await appendFile(
      file,
      `${JSON.stringify({ at: 2, kind: 'end', label: 'Ended', state: 'done' })}\n`,
    )
    await events.changed()
    agents = (await json(await fetch(`${server.base}/api/review`))).reviewers
    assert.equal(agents[0].running, false)
    assert.equal(agents[0].outcome, 'done')
    // Printed once each: a server's later reads print nothing more.
    assert.deepEqual(
      server
        .output()
        .split('\n')
        .filter((line) => line.startsWith('LANDED')),
      ['LANDED f-02', `LANDED ${landing[2].id}`],
    )
  } finally {
    events.close()
  }
})

const REPLY = path.join(SCRIPTS, 'reply.mjs')

test('a question on a finding prints DISCUSS; the agent answers through reply.mjs', async (t) => {
  const server = await startServer(t, {
    overrides: { id: 'c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f' },
  })
  /** @param {unknown} body */
  const discuss = (body) =>
    fetch(`${server.base}/api/discuss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const reviewNow = async () => json(await fetch(`${server.base}/api/review`))
  /** @param {string[]} args @param {string} [input] */
  const reply = (args, input) =>
    run(process.execPath, [REPLY, ...args, '--review', server.dir], { input })

  const printed = server.output().length
  const asked = await discuss({ id: 'f-01', text: ' Is it reachable? ' })
  assert.equal(asked.status, 200)
  assert.equal(await server.nextLine('DISCUSS f-01', printed), 'DISCUSS f-01')
  const again = await discuss({ id: 'f-01', text: 'And?' })
  assert.equal(again.status, 409)
  assert.deepEqual(await json(again), {
    error: 'the agent is still answering the last message',
  })
  assert.equal((await discuss({ id: 'f-01', text: ' ' })).status, 409)
  assert.equal((await discuss({ id: 'f-99', text: 'x' })).status, 409)

  // Its agent's steps are the discussion's progress, never a review agent's.
  const agents = path.join(server.dir, 'reviewers')
  await mkdir(agents, { recursive: true })
  const step = { at: 1, kind: 'read', label: 'src/people/usePeople.ts', state: 'done' }
  await writeFile(path.join(agents, 'ds-f-01.jsonl'), `${JSON.stringify(step)}\n`)
  await writeFile(path.join(agents, 'rv-bugs.jsonl'), `${JSON.stringify(step)}\n`)
  let payload = await reviewNow()
  assert.deepEqual(
    payload.reviewers.map((/** @type {any} */ one) => one.name),
    ['rv-bugs'],
  )
  assert.equal(payload.discussions['f-01'].step.label, 'src/people/usePeople.ts')
  assert.equal(payload.discussions['f-01'].messages[0].text, 'Is it reachable?')

  const answer = { text: 'It is: `tenantId` is undefined on mount.', drop: 7 }
  const unsound = await reply(['f-01'], JSON.stringify(answer))
  assert.equal(unsound.code, 2)
  assert.equal(unsound.stdout, 'REPLY_REFUSED drop must be a text\n')
  assert.equal((await reply(['f-01'], 'not json')).code, 2)
  const replied = await reply(
    ['f-01'],
    JSON.stringify({ ...answer, drop: undefined, fix: 'Return early.' }),
  )
  assert.equal(replied.stdout, 'REPLIED f-01\n', replied.stderr)
  const late = await reply(['f-01'], JSON.stringify({ text: 'Again.' }))
  assert.equal(
    late.stdout,
    'REPLY_REFUSED no question on finding f-01 waits for an answer\n',
  )
  payload = await reviewNow()
  const [, said] = payload.discussions['f-01'].messages
  assert.equal(said.by, 'agent')
  assert.deepEqual(said.proposal, { fix: 'Return early.' })
  assert.equal(payload.discussions['f-01'].step, undefined)
  // Not a decision: the finding is open still.
  assert.equal(payload.findings['f-01'], undefined)

  // The page hears of an answer as it lands.
  const events = await listen(server.base)
  try {
    assert.equal((await discuss({ id: 'f-01', text: 'Then?' })).status, 200)
    await events.changed('f-01')
    await reply(['f-01'], JSON.stringify({ text: 'Then this.' }))
    await events.changed('f-01')
  } finally {
    events.close()
  }

  // A file this Tranchant cannot read is refused, never written over.
  const file = path.join(server.dir, 'discussions', 'f-03.json')
  await writeFile(file, '{"version":2,"messages":[]}')
  const newer = await discuss({ id: 'f-03', text: 'x' })
  assert.equal(newer.status, 409)
  assert.match((await json(newer)).error, /not a discussion this Tranchant reads/)
  assert.equal(await readFile(file, 'utf8'), '{"version":2,"messages":[]}')

  // A finding an agent works on, or settled, is not discussed.
  await createStore(server.dir).decide('f-01', { action: 'fix' })
  const queued = await discuss({ id: 'f-01', text: 'Still?' })
  assert.equal(queued.status, 409)
  assert.deepEqual(await json(queued), {
    error: 'finding f-01 is queued: no discussion now',
  })
})

test('a question left waiting is asked again at start; an agent that ended answers it as failed', async (t) => {
  const imported = await importReview(t, 'theirs', stateDir, {
    id: 'd2e3f4a5-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
  })
  await say(imported.dir, 'f-02', 'Why not Intl?')
  const server = await startServer(t, { dir: imported.dir })
  assert.equal(await server.nextLine('DISCUSS f-02', 0), 'DISCUSS f-02')
  const args = [REPLY, 'f-02', '--review', imported.dir, '--ended']
  assert.equal((await run(process.execPath, args)).stdout, 'UNANSWERED f-02\n')
  assert.equal((await run(process.execPath, args)).stdout, '')
  const payload = await json(await fetch(`${server.base}/api/review`))
  const last = payload.discussions['f-02'].messages.at(-1)
  assert.equal(last.failed, true)
  assert.equal(last.by, 'agent')
})

test('starts again on what was queued: FIX for a fix, a post for a post', async (t) => {
  const imported = await importReview(t, 'theirs', stateDir, {
    id: 'b7e6d5c4-3a2b-4c1d-9e8f-7a6b5c4d3e2f',
  })
  const store = createStore(imported.dir)
  await store.decide('f-01', { action: 'fix' })
  await store.decide('f-04', { action: 'post' })
  const server = await startServer(t, { dir: imported.dir })
  assert.match(server.first, /^READY /)
  assert.equal(await server.nextLine('FIX f-01', 0), 'FIX f-01')
  assert.equal(await server.nextLine('POSTED f-04', 0), 'POSTED f-04')
})

test('refuses to start outside the hooks, without the page, or on a folder with no review', async (t) => {
  const hooks = await startServer(t, { env: { TRANCHANT_HOOKS: '' } })
  assert.match(hooks.first, /^HOOKS_MISSING Tranchant's hooks did not load/)
  assert.equal(await hooks.exit, 2)
  const missing = await startServer(t, {
    env: { TRANCHANT_PAGE: path.join(glabDir, 'none.js') },
  })
  assert.match(missing.first, /^PAGE_MISSING run `npm ci && npm run build` in /)
  assert.equal(await missing.exit, 2)
  const empty = await startServer(t, { dir: await tempDir(t) })
  assert.match(empty.first, /^REVIEW_REFUSED no review.json in /)
  assert.equal(await empty.exit, 2)
})

test('says who holds a busy port', async (t) => {
  const busy = await startServer(t, { env: { TRANCHANT_PORT: String(main.port) } })
  assert.equal(
    busy.first,
    `PORT_BUSY ${main.port} is used by another /tranchant session (review ${main.review.id})`,
  )
  assert.equal(await busy.exit, 3)
})

/**
 * A server on the `ours` fixture whose project is a repository with `remote`
 * as its origin, and a fake `name` (gh or glab) that records its call and
 * answers `answer`, or fails with `error`.
 * @param {any} t
 * @param {{ remote: string, tool: 'gh' | 'glab', answer?: string, error?: string, overrides?: Record<string, unknown>, env?: Record<string, string> }} options
 */
async function issueServer(t, { remote, tool, answer = '', error, overrides, env = {} }) {
  const bin = await tempDir(t)
  const fake = path.join(bin, tool)
  await writeFile(
    fake,
    [
      '#!/bin/sh',
      // Its account, for /api/account: gh answers `login`, glab `username`.
      `if [ "$1 $2" = "api user" ]; then printf '%s' '{"login":"me","username":"me"}'; exit 0; fi`,
      `printf '%s\\n' "$@" > "${bin}/args.txt"`,
      `pwd -P > "${bin}/cwd.txt"`,
      `cat > "${bin}/stdin.txt"`,
      error ? `echo '${error}' >&2; exit 1` : `printf '%s' '${answer}'`,
      '',
    ].join('\n'),
  )
  await chmod(fake, 0o755)
  const server = await startServer(t, {
    name: 'ours',
    overrides,
    env: {
      ...(tool === 'gh' ? { TRANCHANT_GH: fake } : { TRANCHANT_GLAB: fake }),
      ...env,
    },
  })
  await run('git', ['-C', server.project, 'init', '-q'])
  await run('git', ['-C', server.project, 'remote', 'add', 'origin', remote])
  /** @param {unknown} body */
  const send = (body) =>
    fetch(`${server.base}/api/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const read = async (/** @type {string} */ name) =>
    readFile(path.join(bin, name), 'utf8')
  return { server, send, read }
}

test('opens an issue on GitHub with gh itself, and moves the finding there', async (t) => {
  const { server, send, read } = await issueServer(t, {
    remote: 'git@github.com:acme/app.git',
    tool: 'gh',
    answer: '{"number":12,"html_url":"https://github.com/acme/app/issues/12"}',
  })
  const tracker = await json(await fetch(`${server.base}/api/tracker`))
  assert.deepEqual(tracker, {
    kind: 'github',
    web: 'https://github.com/acme/app',
    prefix: '',
  })
  const printed = server.output().length
  const response = await send({
    decisions: [{ id: 'f-01', action: 'issue', title: 'Later', body: 'Why and how' }],
  })
  assert.deepEqual((await json(response)).applied, ['f-01'])
  assert.equal(await server.nextLine('MOVED f-01', printed), 'MOVED f-01')
  const entry = (await json(await fetch(`${server.base}/api/review`))).findings['f-01']
  assert.equal(entry.state, 'moved')
  assert.equal(entry.issue.url, 'https://github.com/acme/app/issues/12')
  assert.equal(entry.issue.ref, '#12')
  assert.deepEqual((await read('args.txt')).trim().split('\n'), [
    'api',
    '--method',
    'POST',
    '--hostname',
    'github.com',
    '--header',
    'Content-Type: application/json',
    '--input',
    '-',
    'repos/acme/app/issues',
  ])
  assert.deepEqual(JSON.parse(await read('stdin.txt')), {
    title: 'Later',
    body: 'Why and how',
  })
  assert.equal((await read('cwd.txt')).trim(), await realpath(server.project))
})

test('opens an issue on GitLab with glab, on the origin’s project the page names', async (t) => {
  const { server, send, read } = await issueServer(t, {
    remote: 'git@gitlab.com:group/sub/project.git',
    tool: 'glab',
    answer: '{"iid":7,"web_url":"https://gitlab.com/group/sub/project/-/issues/7"}',
    overrides: {
      mr: { project: 'qohash/other', iid: 1, url: 'https://gitlab.com/x', author: 'a' },
    },
  })
  const tracker = await json(await fetch(`${server.base}/api/tracker`))
  assert.equal(tracker.web, 'https://gitlab.com/group/sub/project')
  const printed = server.output().length
  await send({ decisions: [{ id: 'f-02', action: 'issue', title: 'T', body: 'B' }] })
  assert.equal(await server.nextLine('MOVED f-02', printed), 'MOVED f-02')
  const args = (await read('args.txt')).trim().split('\n')
  assert.deepEqual(args.slice(3, 5), ['--hostname', 'gitlab.com'])
  assert.equal(args.at(-1), 'projects/group%2Fsub%2Fproject/issues')
  assert.deepEqual(JSON.parse(await read('stdin.txt')), { title: 'T', description: 'B' })
  const entry = (await json(await fetch(`${server.base}/api/review`))).findings['f-02']
  assert.equal(entry.issue.ref, '#7')
})

test('an Enterprise GitHub host goes to gh with its hostname', async (t) => {
  const { server, send, read } = await issueServer(t, {
    remote: 'git@github.acme.io:acme/app.git',
    tool: 'gh',
    answer: '{"number":3,"html_url":"https://github.acme.io/acme/app/issues/3"}',
  })
  const printed = server.output().length
  await send({ decisions: [{ id: 'f-01', action: 'issue', title: 'T', body: 'B' }] })
  assert.equal(await server.nextLine('MOVED f-01', printed), 'MOVED f-01')
  const args = (await read('args.txt')).trim().split('\n')
  assert.deepEqual(args.slice(3, 5), ['--hostname', 'github.acme.io'])
})

test('a tool that succeeds without the issue’s url fails the finding, saying where to look', async (t) => {
  const { server, send } = await issueServer(t, {
    remote: 'git@github.com:acme/app.git',
    tool: 'gh',
    answer: '{}',
  })
  const printed = server.output().length
  await send({ decisions: [{ id: 'f-01', action: 'issue', title: 'T', body: 'B' }] })
  const line = await server.nextLine('ISSUE_FAILED f-01', printed)
  assert.match(
    line,
    /without the issue's url: check https:\/\/github\.com\/acme\/app\/issues/,
  )
  const entry = (await json(await fetch(`${server.base}/api/review`))).findings['f-01']
  assert.equal(entry.state, 'failed')
})

test('starts again on an issue left queued: it opens, and never goes to an agent', async (t) => {
  const bin = await tempDir(t)
  const fake = path.join(bin, 'gh')
  await writeFile(
    fake,
    `#!/bin/sh\ncat > /dev/null\nprintf '%s' '{"number":5,"html_url":"https://github.com/acme/app/issues/5"}'\n`,
  )
  await chmod(fake, 0o755)
  const imported = await importReview(t, 'ours', stateDir)
  await run('git', ['-C', imported.project, 'init', '-q'])
  await run('git', [
    '-C',
    imported.project,
    'remote',
    'add',
    'origin',
    'git@github.com:acme/app.git',
  ])
  await createStore(imported.dir).decide('f-01', {
    action: 'issue',
    title: 'T',
    body: 'B',
  })
  const server = await startServer(t, { dir: imported.dir, env: { TRANCHANT_GH: fake } })
  assert.equal(await server.nextLine('MOVED f-01', 0), 'MOVED f-01')
  assert.doesNotMatch(server.output(), /^FIX f-01$/m)
})

test('an issue the tracker refuses fails the finding with its first line', async (t) => {
  const { server, send } = await issueServer(t, {
    remote: 'https://github.com/acme/app.git',
    tool: 'gh',
    error: 'HTTP 410: Issues are disabled for this repo',
  })
  const printed = server.output().length
  await send({ decisions: [{ id: 'f-03', action: 'issue', title: 'T', body: 'B' }] })
  assert.equal(
    await server.nextLine('ISSUE_FAILED f-03', printed),
    'ISSUE_FAILED f-03 HTTP 410: Issues are disabled for this repo',
  )
  const entry = (await json(await fetch(`${server.base}/api/review`))).findings['f-03']
  assert.equal(entry.state, 'failed')
  assert.equal(entry.reason, 'HTTP 410: Issues are disabled for this repo')
})

test('a project with no origin has no tracker, and its issues fail saying so', async (t) => {
  const server = await startServer(t, { name: 'ours' })
  await run('git', ['-C', server.project, 'init', '-q'])
  const tracker = await json(await fetch(`${server.base}/api/tracker`))
  assert.equal(tracker.kind, null)
  assert.match(tracker.reason, /no origin remote/)
  const printed = server.output().length
  await fetch(`${server.base}/api/decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      decisions: [{ id: 'f-01', action: 'issue', title: 'T', body: 'B' }],
    }),
  })
  assert.match(await server.nextLine('ISSUE_FAILED f-01', printed), /no origin remote/)
})

// ---------------------------------------------------------------------------
// The settings: /api/settings, the theme on the shell, and what they change.

const DEFAULT_SETTINGS = {
  theme: 'system',
  view: 'diff',
  summary: 'open',
  fixModel: null,
  reviewModel: null,
  verifyModel: null,
  maxFixAgents: 3,
  maxReviewAgents: 3,
  recipe: null,
  disabledLenses: [],
  postWith: 'auto',
}

/** A server with a settings folder of its own, and ways to read and write its file. */
async function settingsServer(t, env = {}) {
  const config = await tempDir(t, 'tranchant-config-')
  const file = path.join(config, 'tranchant', 'settings.json')
  const server = await startServer(t, { env: { XDG_CONFIG_HOME: config, ...env } })
  const put = (/** @type {unknown} */ body) =>
    fetch(`${server.base}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const get = async () => json(await fetch(`${server.base}/api/settings`))
  const stored = async () => JSON.parse(await readFile(file, 'utf8'))
  return { server, file, put, get, stored }
}

test('GET /api/settings answers the defaults, the file, the recipe and its lenses when nothing is set', async (t) => {
  const { server, file, get } = await settingsServer(t)
  const answer = await get()
  assert.equal(answer.path, file)
  assert.deepEqual(answer.settings, {})
  assert.deepEqual(answer.values, DEFAULT_SETTINGS)
  assert.deepEqual(answer.defaults, DEFAULT_SETTINGS)
  assert.deepEqual(answer.locked, {})
  assert.match(answer.recipe, /\/agents\/review\/recipe\.json$/)
  assert.deepEqual(answer.lenses, [
    'correctness',
    'types',
    'accessibility',
    'performance',
    'security',
    'tests',
    'conventions',
    'bugs',
    'silent-failures',
    'docs',
  ])
  assert.equal(answer.problem, undefined)
  assert.equal(answer.recipeProblem, undefined)
  // Nothing written by a read.
  await assert.rejects(readFile(file))
  assert.equal(
    (await (await fetch(`${server.base}/`)).text()).includes('data-theme'),
    false,
  )
})

test('PUT /api/settings writes the file whole, answers it, tells the pages and themes the shell', async (t) => {
  const { server, file, put, get, stored } = await settingsServer(t)
  const stream = await listen(server.base)
  const response = await put({
    theme: 'dark',
    maxFixAgents: 5,
    disabledLenses: ['tests'],
  })
  assert.equal(response.status, 200)
  const answer = await json(response)
  assert.deepEqual(answer.settings, {
    theme: 'dark',
    maxFixAgents: 5,
    disabledLenses: ['tests'],
  })
  assert.equal(answer.values.theme, 'dark')
  assert.equal(answer.values.maxFixAgents, 5)
  assert.deepEqual(answer.values.disabledLenses, ['tests'])
  assert.equal(answer.values.view, 'diff')
  assert.deepEqual(await stored(), {
    version: 1,
    theme: 'dark',
    maxFixAgents: 5,
    disabledLenses: ['tests'],
  })
  await stream.next('settings')
  // An editor's change, another server's: the folder is watched from the first write on.
  await writeFile(file, JSON.stringify({ version: 1, theme: 'light', maxFixAgents: 2 }))
  await stream.next('settings')
  stream.close()
  assert.equal((await get()).values.maxFixAgents, 2)
  await put({ theme: 'dark', maxFixAgents: 5, disabledLenses: ['tests'] })
  // The shell carries the theme, so the page never flashes the other one.
  assert.match(
    await (await fetch(`${server.base}/`)).text(),
    /<html lang="en" data-theme="dark">/,
  )
  // A key left out leaves the file: the whole file is what a PUT sends.
  await put({ theme: 'light' })
  assert.deepEqual(await stored(), { version: 1, theme: 'light' })
  assert.deepEqual((await get()).settings, { theme: 'light' })
  // Empty: back to the defaults.
  await put({})
  assert.deepEqual(await stored(), { version: 1 })
  assert.deepEqual((await get()).values, DEFAULT_SETTINGS)
})

test('a settings change the file cannot hold is refused with its key, the file kept', async (t) => {
  const { put, stored } = await settingsServer(t)
  await put({ theme: 'dark' })
  /** @type {[unknown, string | RegExp][]} */
  const refusals = [
    [{ theme: 'sepia' }, 'theme: one of light, dark, system'],
    [{ view: 1 }, 'view: one of diff, list'],
    [{ maxFixAgents: 0 }, 'maxFixAgents: a whole number from 1 to 8'],
    [{ maxReviewAgents: 2.5 }, 'maxReviewAgents: a whole number from 1 to 8'],
    [{ fixModel: 'not a model!' }, 'fixModel: a model id, letters, digits, . : - and _'],
    [{ recipe: 'relative.json' }, 'recipe: an absolute path to a recipe file, or ~/…'],
    [{ disabledLenses: ['ok', 'not ok'] }, /^disabledLenses: up to 12 lens names/],
    [{ postWith: 'curl' }, 'postWith: one of auto, glab, gh'],
    [{ colour: 'red' }, 'colour: not a setting'],
    [{ version: 2 }, 'version: 1 is the only one read'],
    [[], 'the settings are not an object'],
  ]
  for (const [body, reason] of refusals) {
    const response = await put(body)
    assert.equal(response.status, 400, JSON.stringify(body))
    const { error } = await json(response)
    if (typeof reason === 'string') assert.equal(error, reason)
    else assert.match(error, reason)
  }
  assert.deepEqual(await stored(), { version: 1, theme: 'dark' })
})

test('TRANCHANT_MODEL locks the models: the page sees its value, the file keeps its own', async (t) => {
  const { put, get } = await settingsServer(t, { TRANCHANT_MODEL: 'claude-haiku-5-5' })
  await put({ fixModel: 'claude-opus-5-5' })
  const answer = await get()
  assert.deepEqual(answer.locked, {
    fixModel: 'TRANCHANT_MODEL',
    reviewModel: 'TRANCHANT_MODEL',
    verifyModel: 'TRANCHANT_MODEL',
  })
  assert.equal(answer.values.fixModel, 'claude-haiku-5-5')
  assert.equal(answer.values.verifyModel, 'claude-haiku-5-5')
  assert.deepEqual(answer.settings, { fixModel: 'claude-opus-5-5' })
})

test('a settings file this Tranchant cannot read is said, applies as none, and is never written over', async (t) => {
  const { file, put, get } = await settingsServer(t)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ version: 1, theme: 'sepia' }))
  const answer = await get()
  assert.equal(answer.problem, `${file}: theme: one of light, dark, system`)
  assert.deepEqual(answer.values, DEFAULT_SETTINGS)
  const refused = await put({ theme: 'dark' })
  assert.equal(refused.status, 409)
  assert.equal((await json(refused)).error, answer.problem)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    version: 1,
    theme: 'sepia',
  })
  await writeFile(file, '{ not json')
  assert.match((await get()).problem, /settings\.json is not JSON/)
  // Mended by hand: read again at once.
  await writeFile(file, JSON.stringify({ version: 1, view: 'list' }))
  assert.equal((await get()).problem, undefined)
  assert.equal((await get()).values.view, 'list')
})

test('a recipe the settings name that cannot be read is said, the lenses empty', async (t) => {
  const { put, get } = await settingsServer(t)
  await put({ recipe: '/no/such/recipe.json' })
  const answer = await get()
  assert.equal(answer.recipe, '/no/such/recipe.json')
  assert.deepEqual(answer.lenses, [])
  assert.equal(answer.recipeProblem, '/no/such/recipe.json: no such file')
  // Another recipe, this one readable: its lenses, `~` being the home.
  const home = await tempDir(t, 'tranchant-home-')
  const recipe = path.join(home, 'mine.json')
  await writeFile(
    recipe,
    JSON.stringify({ version: 1, lenses: [{ name: 'js', prompt: 'js.md' }] }),
  )
  await put({ recipe })
  assert.deepEqual((await get()).lenses, ['js'])
})

test('postWith names the forge for the tracker and the account when the remote does not say', async (t) => {
  const config = await tempDir(t, 'tranchant-config-')
  const { server, send, read } = await issueServer(t, {
    remote: 'git@git.corp.example:acme/app.git',
    tool: 'gh',
    answer: '{"number":3,"html_url":"https://git.corp.example/acme/app/issues/3"}',
    env: { XDG_CONFIG_HOME: config },
  })
  // Neither GitHub nor GitLab by its host: no tracker, and glab (the suite's fake) for the account.
  assert.equal((await json(await fetch(`${server.base}/api/tracker`))).kind, null)
  assert.deepEqual(await json(await fetch(`${server.base}/api/account`)), {
    username: 'reviewer-bot',
    tool: 'glab',
  })
  await fetch(`${server.base}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postWith: 'gh' }),
  })
  assert.deepEqual(await json(await fetch(`${server.base}/api/tracker`)), {
    kind: 'github',
    web: 'https://git.corp.example/acme/app',
    prefix: '',
  })
  assert.deepEqual(await json(await fetch(`${server.base}/api/account`)), {
    username: 'me',
    tool: 'gh',
  })
  // The batch bar asks for glab's account by name: MR comments go through glab whatever the setting.
  assert.deepEqual(await json(await fetch(`${server.base}/api/account?tool=glab`)), {
    username: 'reviewer-bot',
    tool: 'glab',
  })
  // issue.mjs reads the same setting: gh, on that host.
  const printed = server.output().length
  await send({ decisions: [{ id: 'f-01', action: 'issue', title: 'T', body: 'B' }] })
  assert.equal(await server.nextLine('MOVED f-01', printed), 'MOVED f-01')
  assert.deepEqual((await read('args.txt')).trim().split('\n').slice(0, 5), [
    'api',
    '--method',
    'POST',
    '--hostname',
    'git.corp.example',
  ])
})

test('a tool forced on the other forge\u2019s host is refused: no token goes to the wrong forge', async (t) => {
  const config = await tempDir(t, 'tranchant-config-')
  const { server, send } = await issueServer(t, {
    remote: 'git@github.com:acme/app.git',
    tool: 'glab',
    env: { XDG_CONFIG_HOME: config },
  })
  await fetch(`${server.base}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postWith: 'glab' }),
  })
  const tracker = await json(await fetch(`${server.base}/api/tracker`))
  assert.equal(tracker.kind, null)
  assert.equal(
    tracker.reason,
    "the origin's host github.com is on GitHub: the settings' glab cannot open issues there",
  )
  const printed = server.output().length
  await send({ decisions: [{ id: 'f-01', action: 'issue', title: 'T', body: 'B' }] })
  assert.match(
    await server.nextLine('ISSUE_FAILED f-01', printed),
    /glab cannot open issues there/,
  )
})
