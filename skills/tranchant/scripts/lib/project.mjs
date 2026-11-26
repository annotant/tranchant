import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SKILL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)
/** This plugin's root: its manifest, and `agents/`. */
export const PLUGIN_ROOT = path.resolve(SKILL_DIR, '../..')

/** The plugin's version, from its manifest; the page and the health check show it. */
export const PLUGIN_VERSION = (() => {
  try {
    const manifest = path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')
    return String(JSON.parse(readFileSync(manifest, 'utf8')).version)
  } catch {
    return '0.0.0'
  }
})()

// Not os.tmpdir(): hooks, sandboxed shells and the server may each see a different TMPDIR.
// hooks/register.ts finds the same folder the same way.
export const STATE_ROOT =
  process.env.TRANCHANT_STATE_DIR ??
  path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'tranchant')

/** The first 12 hex digits of the SHA-1 of a root: its folder in the state. */
export const hashOf = (/** @type {string} */ root) =>
  createHash('sha1').update(root).digest('hex').slice(0, 12)

/** The state folder of the project at `root`. */
const projectDir = (/** @type {string} */ root) => path.join(STATE_ROOT, hashOf(root))

/**
 * The folder of review `id` of the project at `root`.
 * @param {string} root
 * @param {string} id
 */
export const reviewDir = (root, id) => path.join(projectDir(root), 'reviews', id)

/**
 * The lock table of the git repository at `lockRoot`: one per repository, in
 * its own state folder (the project's, when the project is the repository),
 * whichever review the agents work for.
 */
export const locksDir = (/** @type {string} */ repository) =>
  path.join(projectDir(repository), 'locks')

/**
 * The review folder a script acts on: `--review <dir>`, else TRANCHANT_REVIEW.
 * @param {string[]} [argv]
 */
export function findReview(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--review')
  const dir = flag === -1 ? process.env.TRANCHANT_REVIEW : argv[flag + 1]
  return dir ? path.resolve(dir) : undefined
}

/**
 * The git repository the project at `root` is in, where its locks are
 * tabled; the project itself when git cannot say.
 * @param {string} root
 */
export function lockRoot(root) {
  try {
    const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return top || root
  } catch {
    return root
  }
}

/** `one`'s real path, its case as the disk has it; resolved only when it is not there. @param {string} one */
function real(one) {
  try {
    return realpathSync.native(one)
  } catch {
    return path.resolve(one)
  }
}

/** projectHome's answers, by root: git runs once per root and process. */
const homes = new Map()

/**
 * The folder that stands for the project at `root` whatever path it is
 * opened from: its place in the main worktree of its git repository (else
 * in the repository's git folder, when it is bare or a submodule's), the
 * same for every worktree, a symlink or another case of the path; else
 * `root`'s real path.
 * @param {string} root
 * @returns {string}
 */
export function projectHome(root) {
  const known = homes.get(root)
  if (known) return known
  let home
  try {
    const env = { ...process.env }
    // Unset: they point git at another repository than root's.
    for (const name of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE']) delete env[name]
    // One line each: the common dir, relative to `-C root` without --path-format (git 2.31), then root's place in its worktree.
    const [common = '', prefix = ''] = execFileSync(
      'git',
      ['-C', root, 'rev-parse', '--git-common-dir', '--show-prefix'],
      { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] },
    ).split('\n')
    const dir = common ? real(path.resolve(root, common)) : undefined
    const top = dir && (path.basename(dir) === '.git' ? path.dirname(dir) : dir)
    home = top && path.resolve(top, prefix || '.')
  } catch {
    home = undefined
  }
  home ??= real(root)
  homes.set(root, home)
  return home
}

/** Removes `--review <dir>` so the remaining arguments are positional. */
export function positional(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--review')
  return flag === -1 ? argv : argv.filter((_, i) => i !== flag && i !== flag + 1)
}
