// The project's issue tracker: GitHub or GitLab, from the checkout's remote,
// for issue.mjs and the page's /api/tracker, so both name the same project.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * @typedef {object} Tracker
 * @property {'github' | 'gitlab'} kind
 * @property {string} host The forge's web host, the one gh and glab are logged in to.
 * @property {string} path The project's path on its host, `owner/repo` or `group/…/project`.
 * @property {string} web The project's page, `https://<host>/<path>`.
 * @property {string} prefix The project's folder within its repository, `/`-terminated, or ''.
 */

/** SSH endpoints that are not the forge's web host. */
const SSH_HOSTS = new Map([
  ['ssh.github.com', 'github.com'],
  ['altssh.gitlab.com', 'gitlab.com'],
])

/**
 * The web host behind an SSH host: the forges' port-443 endpoints, and the
 * `github.com-work` aliases of several accounts, name the forge itself.
 * @param {string} host
 */
const webHost = (host) => {
  const lower = host.toLowerCase()
  return SSH_HOSTS.get(lower) ?? /^(github\.com|gitlab\.com)-/.exec(lower)?.[1] ?? lower
}

/**
 * The web page of a git remote: scp-like (`git@host:path`), `ssh://`, `git://`
 * or `http(s)://`, its user, port and `.git` dropped; undefined for anything
 * else (a local path, a bundle).
 * @param {string} remote
 * @returns {{ host: string, path: string, web: string } | undefined}
 */
export function webOfRemote(remote) {
  const text = remote.trim()
  let host = ''
  let repo = ''
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(text)
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    host = scp[1] ?? ''
    repo = scp[2] ?? ''
  } else {
    let url
    try {
      url = new URL(text)
    } catch {
      return undefined
    }
    if (
      !['ssh:', 'git:', 'http:', 'https:', 'git+ssh:', 'ssh+git:'].includes(url.protocol)
    )
      return undefined
    host = url.hostname
    repo = decodeURIComponent(url.pathname)
  }
  repo = repo.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
  if (!host || !repo || repo.split('/').some((part) => !part || part === '..'))
    return undefined
  host = webHost(host)
  return {
    host,
    path: repo,
    web: `https://${host}/${repo.split('/').map(encodeURIComponent).join('/')}`,
  }
}

/**
 * Which forge `host` is: GitHub for github.com and its Enterprise hosts
 * (`*.ghe.com`, `github.<domain>`); GitLab for a host that names gitlab, or
 * any host when the review has a GitLab MR; undefined otherwise, so neither
 * tool is handed a host it has no login for.
 * @param {string} host
 * @param {boolean} gitlab
 * @returns {'github' | 'gitlab' | undefined}
 */
export function forgeOf(host, gitlab) {
  if (host === 'github.com' || host.endsWith('.ghe.com') || host.startsWith('github.'))
    return 'github'
  if (gitlab || /(^|[.-])gitlab([.-]|$)/.test(host)) return 'gitlab'
  return undefined
}

/** A field of a thrown value, whatever was thrown. */
const field = (/** @type {unknown} */ value, /** @type {string} */ key) =>
  value && typeof value === 'object'
    ? /** @type {unknown} */ (Reflect.get(value, key))
    : undefined

/**
 * The tracker of the checkout at `project`: its `origin` remote's project.
 * @param {string} project
 * @param {{ gitlab?: boolean }} [options] `gitlab`: the review has a GitLab MR.
 * @returns {Promise<Tracker>} Rejects with the reason there is none.
 */
export async function trackerOf(project, { gitlab = false } = {}) {
  if (!existsSync(project)) throw new Error(`the project ${project} is not there`)
  const git = (/** @type {string[]} */ args) =>
    exec('git', ['-C', project, ...args], { timeout: 5000 }).then(({ stdout }) =>
      stdout.trim(),
    )
  let remote
  try {
    remote = await git(['remote', 'get-url', 'origin'])
  } catch (error) {
    // Only git answering no means no origin: no git, a timeout or an unsafe folder is its own reason.
    const raw = field(error, 'stderr')
    const stderr = typeof raw === 'string' ? raw.trim() : ''
    if (
      typeof field(error, 'code') === 'number' &&
      !field(error, 'killed') &&
      /origin/.test(stderr)
    )
      throw new Error('the project has no origin remote to open an issue on', {
        cause: error,
      })
    throw new Error(
      `git cannot read the origin remote: ${(stderr || String(error)).split('\n')[0]}`,
      { cause: error },
    )
  }
  const where = webOfRemote(remote)
  if (!where) throw new Error(`the origin remote is not a url: ${remote}`)
  const kind = forgeOf(where.host, gitlab)
  if (!kind)
    throw new Error(`the origin's host ${where.host} is neither GitHub nor GitLab`)
  const prefix = await git(['rev-parse', '--show-prefix'])
  return { kind, ...where, prefix }
}
