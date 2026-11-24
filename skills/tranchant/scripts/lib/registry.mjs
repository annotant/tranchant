// The Tranchant servers running on this machine, which the dashboard lists:
// one file per server in <state>/servers/, written whole on READY (a temp
// file renamed over its name) and removed as the server exits. No index to
// rewrite: two servers starting at once write two files, and a reader never
// sees half of one. A server killed outright leaves its file: a reader drops
// an entry whose process is gone, and removes its file.
import { randomBytes } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { alive } from './filelock.mjs'
import { STATE_ROOT } from './project.mjs'

/** The registry's folder: the state folder's, so a test's own state has its own. */
export const SERVERS_DIR = path.join(STATE_ROOT, 'servers')

const VERSION = 1
/** An entry's file: its kind, its pid and a tag, so a pid used again never names an old file. */
const ENTRY = /^(review|dashboard)-\d+-[0-9a-f]{8}\.json$/
const MAX_ENTRY = 64 * 1024

/**
 * Who runs a server: a Claude Code session until the dashboard runs reviews
 * itself (story 4); `cwd`, the session's folder.
 * @typedef {{ kind: 'session', cwd?: string }} Runner
 */
/**
 * A running server, as its file holds it.
 * @typedef {object} ServerEntry
 * @property {1} version
 * @property {'review' | 'dashboard'} kind
 * @property {number} pid
 * @property {number} port
 * @property {string} url
 * @property {string} startedAt
 * @property {string} [review] A review server's review id.
 * @property {string} [dir] Its review folder.
 * @property {string} [project] Its project's root.
 * @property {{ branch?: string, base?: string, mr?: string }} [target] What it reviews.
 * @property {Runner} [runner]
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
/** @param {unknown} value */
const isText = (value) => typeof value === 'string' && value.length > 0

/**
 * An entry as read, or undefined when it is not one this Tranchant wrote.
 * @param {unknown} raw
 * @returns {ServerEntry | undefined}
 */
function readEntry(raw) {
  if (!isObject(raw) || raw.version !== VERSION) return undefined
  if (raw.kind !== 'review' && raw.kind !== 'dashboard') return undefined
  if (!Number.isInteger(raw.pid) || !Number.isInteger(raw.port)) return undefined
  if (!isText(raw.url) || !isText(raw.startedAt)) return undefined
  // Only a page on this machine: the dashboard links it.
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(String(raw.url))) return undefined
  if (raw.kind === 'review' && !(isText(raw.review) && isText(raw.dir))) return undefined
  const target = isObject(raw.target) ? raw.target : {}
  const runner =
    isObject(raw.runner) && raw.runner.kind === 'session' ? raw.runner : undefined
  return {
    version: VERSION,
    kind: raw.kind,
    pid: Number(raw.pid),
    port: Number(raw.port),
    url: String(raw.url),
    startedAt: String(raw.startedAt),
    ...(isText(raw.review) && { review: String(raw.review) }),
    ...(isText(raw.dir) && { dir: String(raw.dir) }),
    ...(isText(raw.project) && { project: String(raw.project) }),
    target: {
      ...(isText(target.branch) && { branch: String(target.branch) }),
      ...(isText(target.base) && { base: String(target.base) }),
      ...(isText(target.mr) && { mr: String(target.mr) }),
    },
    ...(runner && {
      runner: {
        kind: /** @type {const} */ ('session'),
        ...(isText(runner.cwd) && { cwd: String(runner.cwd) }),
      },
    }),
  }
}

/**
 * Writes this process's entry, and answers how to remove it: synchronously,
 * so it runs in an `exit` handler too.
 * @param {Omit<ServerEntry, 'version' | 'pid' | 'startedAt'>} entry
 * @param {string} [dir]
 */
export async function registerServer(entry, dir = SERVERS_DIR) {
  await mkdir(dir, { recursive: true })
  const name = `${entry.kind}-${process.pid}-${randomBytes(4).toString('hex')}.json`
  const file = path.join(dir, name)
  // A dot first: a reader lists only the entries' own names.
  const temp = path.join(dir, `.${name}.tmp`)
  /** @type {ServerEntry} */
  const whole = {
    version: VERSION,
    ...entry,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }
  try {
    await writeFile(temp, `${JSON.stringify(whole, null, 2)}\n`)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
  return {
    file,
    entry: whole,
    remove: () => {
      try {
        unlinkSync(file)
      } catch {}
    },
  }
}

/**
 * The servers running, oldest first. An entry whose process is gone is left
 * out and its file removed; one that cannot be read is left out, and kept.
 * @param {string} [dir]
 * @returns {Promise<(ServerEntry & { file: string })[]>}
 */
export async function listServers(dir = SERVERS_DIR) {
  const names = await readdir(dir).catch(() => [])
  const entries = []
  for (const name of names) {
    if (!ENTRY.test(name)) continue
    const file = path.join(dir, name)
    let entry
    try {
      const text = await readFile(file, 'utf8')
      entry = text.length <= MAX_ENTRY ? readEntry(JSON.parse(text)) : undefined
    } catch {
      continue
    }
    if (!entry) continue
    if (!alive(entry.pid)) {
      await rm(file, { force: true }).catch(() => undefined)
      continue
    }
    entries.push({ ...entry, file })
  }
  return entries.toSorted((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/**
 * Runs `remove` as the process exits, however it is told to: the hooks end a
 * server with a signal, which by default exits with no `exit` event.
 * @param {() => void} remove
 */
export function removeOnExit(remove) {
  process.on('exit', remove)
  for (const [signal, code] of /** @type {const} */ ([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ]))
    process.once(signal, () => process.exit(code))
}
