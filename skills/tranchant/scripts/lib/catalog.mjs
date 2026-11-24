// Every review on this machine, as the dashboard lists it: the folders
// <state>/<project hash>/reviews/<id>/, each read with the store as its own
// server reads it, and the registry's running servers (lib/registry.mjs),
// which say the reviews a session serves now. Read only: the dashboard never
// writes a review's files.
import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { errorCode } from './errors.mjs'
import { STATE_ROOT } from './project.mjs'
import { StoreRefusal, createStore, readReviewAgents } from './store.mjs'
import { reviewUsage } from './usage.mjs'

/** @typedef {import('./format.mjs').Review} Review */
/** @typedef {import('./registry.mjs').ServerEntry} ServerEntry */

/**
 * Where a review stands. `stopped`: it was preparing or reviewing when no
 * server served it any more, its session ended mid-way.
 * @typedef {'preparing' | 'ready' | 'running' | 'stopped' | 'needs' | 'settled'} ReviewState
 */
/**
 * What a review's files say, whoever serves it.
 * @typedef {object} Facts
 * @property {string} id
 * @property {string} dir
 * @property {string} project
 * @property {string} title
 * @property {string} createdAt
 * @property {number} activeAt When one of its files last changed, in ms.
 * @property {string} [branch]
 * @property {string} [base]
 * @property {'ours' | 'theirs'} ownership
 * @property {{ url: string, label: string, author?: string }} [mr]
 * @property {'preparing' | 'reviewing' | 'complete' | 'refused'} status
 * @property {true} [waiting] Preparing, its lenses built: it waits for Start the review.
 * @property {true} [paused]
 * @property {string} [refusal] Why it was refused.
 * @property {{ done: number, total: number }} [lenses] Its reviewers ended, of its lenses; ready to start, `total` alone.
 * @property {{ done: number, total: number }} [verified] Reviewing with verification: the findings a verifier checked.
 * @property {Record<string, number>} findings Its findings by state, `open` included.
 * @property {{ count: number, partial?: true }} [tokens] What its agents spent.
 */
/**
 * A review as the dashboard lists it.
 * @typedef {Facts & { state: ReviewState, repo: { key: string, name: string }, live?: { url: string, cwd?: string } }} Listed
 */

/** A finding's states the reviewer settled: nothing more waits on them. */
const SETTLED = new Set(['fixed', 'posted', 'moved', 'dropped', 'skipped'])
/** A folder under the state folder that holds a project's reviews: its root's hash. */
const PROJECT_DIR = /^[0-9a-f]{12}$/
const LENS_REVIEWER = /^rv-/

const run = promisify(execFile)

/**
 * The state a review is in, from its files and whether a server serves it.
 * @param {Facts} facts
 * @param {boolean} served
 * @returns {ReviewState}
 */
function stateOf(facts, served) {
  if (facts.status === 'preparing') {
    if (facts.waiting) return 'ready'
    return served ? 'preparing' : 'stopped'
  }
  if (facts.status === 'reviewing') return served ? 'running' : 'stopped'
  if (facts.status === 'refused') return 'needs'
  const left = Object.entries(facts.findings).some(
    ([state, count]) => count > 0 && !SETTLED.has(state),
  )
  return left ? 'needs' : 'settled'
}

/** The merge request as a row names it: `PR #12` on GitHub, `!12` on GitLab. */
function mrOf(/** @type {Review} */ review) {
  const { mr } = review
  if (!mr?.url) return undefined
  return {
    url: mr.url,
    label: mr.forge === 'github' ? `PR #${mr.iid}` : `!${mr.iid}`,
    ...(mr.author && { author: mr.author }),
  }
}

/** The JSON file `file`, or undefined. */
const readJson = (/** @type {string} */ file) =>
  readFile(file, 'utf8').then(
    (text) => JSON.parse(text),
    () => undefined,
  )

/**
 * What changed in a review's folder since a read: its files' sizes and times,
 * those of its folders' files too. Cheaper than reading them.
 * @param {string} dir
 */
async function stampOf(dir) {
  const marks = []
  for (const name of ['review.json', 'decisions.json', 'lenses.json', 'usage.json'])
    marks.push(await markOf(path.join(dir, name)))
  for (const folder of ['findings', 'reviewers', 'runs']) {
    const names = await readdir(path.join(dir, folder)).catch(() => [])
    for (const name of names.toSorted((a, b) => a.localeCompare(b)))
      marks.push(`${name} ${await markOf(path.join(dir, folder, name))}`)
  }
  return marks.join('\n')
}

/** @param {string} file */
const markOf = (file) =>
  stat(file).then(
    (one) => `${one.size}:${one.mtimeMs}`,
    () => '-',
  )

/** The latest time a review's own files changed, in ms. */
async function activeAt(/** @type {string} */ dir) {
  let latest = 0
  for (const name of ['review.json', 'decisions.json', 'lenses.json', 'usage.json']) {
    const at = await stat(path.join(dir, name)).then(
      (one) => one.mtimeMs,
      () => 0,
    )
    latest = Math.max(latest, at)
  }
  return Math.round(latest)
}

/**
 * Reads a review's facts, or undefined when its folder holds no review this
 * Tranchant reads (a review being imported, another version).
 * @param {string} dir
 * @returns {Promise<Facts | undefined>}
 */
async function factsOf(dir) {
  let read
  try {
    read = await createStore(dir).readAll()
  } catch (error) {
    if (error instanceof StoreRefusal || error instanceof SyntaxError) return undefined
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
  const { review, decisions } = read
  const status = review.status ?? 'complete'
  /** @type {Record<string, number>} */
  const findings = {}
  for (const finding of review.findings) {
    const state = decisions.findings[finding.id]?.state ?? 'open'
    findings[state] = (findings[state] ?? 0) + 1
  }
  const step =
    status === 'preparing' ? await readJson(path.join(dir, 'lenses.json')) : undefined
  const rows = Array.isArray(step?.lenses) ? step.lenses : []
  const waiting = status === 'preparing' && step?.state === 'waiting'
  /** @type {Facts['lenses']} */
  let lenses
  if (waiting) {
    lenses = { done: 0, total: rows.filter((row) => row?.state === 'ready').length }
  } else if (status === 'reviewing' && review.lenses?.length) {
    const agents = await readReviewAgents(dir, 1)
    const done = agents.filter(
      (agent) => LENS_REVIEWER.test(agent.name) && !agent.running,
    ).length
    lenses = { done: Math.min(done, review.lenses.length), total: review.lenses.length }
  }
  const usage = await reviewUsage(dir, {
    review,
    decisions: decisions.findings,
    since: 0,
  }).catch(() => undefined)
  return {
    id: review.id,
    dir,
    project: review.project,
    title: review.title,
    createdAt: review.createdAt,
    activeAt: await activeAt(dir),
    ...(review.branch && { branch: review.branch }),
    ...(review.base && { base: review.base }),
    ownership: review.ownership,
    ...(mrOf(review) && { mr: mrOf(review) }),
    status,
    ...(waiting && { waiting: /** @type {const} */ (true) }),
    ...(review.paused && !review.stopped && { paused: /** @type {const} */ (true) }),
    ...(status === 'refused' &&
      review.refusal && { refusal: `${review.refusal.lens}: ${review.refusal.reason}` }),
    ...(lenses && { lenses }),
    ...(status === 'reviewing' &&
      review.verify && {
        verified: {
          done: review.findings.filter((finding) => finding.verified).length,
          total: review.findings.length,
        },
      }),
    findings,
    ...(usage?.total && {
      tokens: {
        count: usage.total.tokens,
        ...(usage.total.partial && { partial: /** @type {const} */ (true) }),
      },
    }),
  }
}

/**
 * The repository a project is in, by its main checkout: the worktrees of one
 * repository are one project. A folder gone or outside git is its own.
 * @param {string} project
 */
async function repoOf(project) {
  try {
    const { stdout } = await run(
      'git',
      ['-C', project, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { timeout: 5_000 },
    )
    const common = stdout.trim()
    const key = path.basename(common) === '.git' ? path.dirname(common) : common
    return { key, name: path.basename(key) }
  } catch {
    return { key: project, name: path.basename(project) }
  }
}

/**
 * The catalog: reads every review, each read again only once its files
 * changed, and the repository of each project once.
 * @param {{ root?: string }} [options]
 */
export function createCatalog({ root = STATE_ROOT } = {}) {
  /** @type {Map<string, { stamp: string, facts: Facts | undefined }>} */
  const known = new Map()
  /** @type {Map<string, Promise<{ key: string, name: string }>>} */
  const repos = new Map()

  /** @param {string} project */
  const repo = (project) => {
    let found = repos.get(project)
    if (!found) {
      found = repoOf(project)
      repos.set(project, found)
    }
    return found
  }

  /** The review folders under the state folder. */
  async function folders() {
    const dirs = []
    for (const hash of await readdir(root).catch(() => [])) {
      if (!PROJECT_DIR.test(hash)) continue
      const reviews = path.join(root, hash, 'reviews')
      for (const id of await readdir(reviews).catch(() => []))
        if (!id.startsWith('.')) dirs.push(path.join(reviews, id))
    }
    return dirs
  }

  return {
    /**
     * Every review, newest activity first, with its state and the server
     * that serves it, if one does.
     * @param {ServerEntry[]} servers
     * @returns {Promise<Listed[]>}
     */
    async list(servers) {
      const dirs = await folders()
      for (const gone of [...known.keys()].filter((dir) => !dirs.includes(dir)))
        known.delete(gone)
      const served = new Map(
        servers.flatMap((one) =>
          one.kind === 'review' && one.dir ? [[path.resolve(one.dir), one]] : [],
        ),
      )
      /** @type {Listed[]} */
      const listed = []
      for (const dir of dirs) {
        const stamp = await stampOf(dir)
        let facts = known.get(dir)?.stamp === stamp ? known.get(dir)?.facts : undefined
        if (known.get(dir)?.stamp !== stamp) {
          facts = await factsOf(dir).catch(() => undefined)
          known.set(dir, { stamp, facts })
        }
        if (!facts) continue
        const server = served.get(path.resolve(dir))
        listed.push({
          ...facts,
          state: stateOf(facts, !!server),
          repo: await repo(facts.project),
          ...(server && {
            live: {
              url: server.url,
              ...(server.runner?.cwd && { cwd: server.runner.cwd }),
            },
          }),
        })
      }
      return listed.toSorted(
        (a, b) => b.activeAt - a.activeAt || a.id.localeCompare(b.id),
      )
    },
  }
}
