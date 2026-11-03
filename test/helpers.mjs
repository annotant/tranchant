// Shared by the tests: throwaway projects and state folders, the fixture
// reviews, and a way to run the scripts as the hooks and the agents would.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const SCRIPTS = new URL('../skills/tranchant/scripts/', import.meta.url).pathname
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname

/**
 * A response's JSON, as the test expects it to be.
 * @param {Response} response
 * @returns {Promise<any>}
 */
export const json = (response) => response.json()

/**
 * A folder removed after the test.
 * @param {any} t A test or hook context: `after` removes the folder.
 */
export async function tempDir(t, prefix = 'tranchant-test-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/**
 * A fixture review, parsed anew: each test may change its copy, however it likes.
 * @param {'theirs' | 'ours' | 'front-end'} name
 * @returns {Promise<any>}
 */
export const fixture = async (name) =>
  JSON.parse(await readFile(path.join(FIXTURES, `review-${name}.json`), 'utf8'))

/**
 * A fixture review written to a temp file, its `project` a temp folder with
 * a `src/` in it: what a producer hands open.mjs.
 * @param {any} t A test or hook context: `after` removes the folder.
 * @param {'theirs' | 'ours'} name
 * @param {Record<string, unknown>} [overrides]
 */
export async function reviewFile(t, name, overrides = {}) {
  const project = await tempDir(t, 'tranchant-project-')
  await mkdir(path.join(project, 'src'), { recursive: true })
  const review = { ...(await fixture(name)), project, ...overrides }
  const file = path.join(await tempDir(t, 'tranchant-review-'), 'review.json')
  await writeFile(file, JSON.stringify(review, null, 2))
  return { file, review, project }
}

/**
 * Runs a script with `input` on stdin.
 * @param {string} command
 * @param {string[]} args
 * @param {{ input?: string, env?: Record<string, string>, cwd?: string }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
export function run(command, args, { input = '', env = {}, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}

/**
 * Imports a fixture review with open.mjs, into the state folder `stateDir`.
 * @param {any} t A test or hook context: `after` removes the folder.
 * @param {'theirs' | 'ours'} name
 * @param {string} stateDir
 * @param {Record<string, unknown>} [overrides]
 */
export async function importReview(t, name, stateDir, overrides = {}) {
  const written = await reviewFile(t, name, overrides)
  const opened = await run(
    process.execPath,
    // A verify review is /tranchant review's, which passes --verify.
    [
      path.join(SCRIPTS, 'open.mjs'),
      written.file,
      ...(overrides.verify ? ['--verify'] : []),
    ],
    {
      env: { TRANCHANT_STATE_DIR: stateDir },
    },
  )
  if (opened.code !== 0) throw new Error(`open.mjs: ${opened.stdout}${opened.stderr}`)
  const dir = opened.stdout.trim().replace(/^REVIEW /, '')
  return { ...written, dir }
}
