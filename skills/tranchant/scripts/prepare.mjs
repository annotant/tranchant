#!/usr/bin/env node
// prepare.mjs [<branch> | <merge request url>] [--recipe <recipe.json>]
// What `/tranchant review` runs first, from the session's folder: finds the
// change (the current branch, or <branch>, against the repository's default
// branch, `ours`, with the branch's open merge request when glab finds one;
// a merge request read with `glab mr view`, `theirs`), reads
// the recipe in force (--recipe, else the local recipe, else the project's
// .tranchant/recipe.json at BASE, else the settings' `recipe`, else the
// plugin's agents/review/recipe.json; without --recipe, the settings'
// `disabledLenses` are left out), writes the review's envelope, `preparing`
// with no finding yet, to <state>/inbox/<id>.json and prints `INBOX <file>`,
// then the lenses whose paths the change touches to <id>.plan.json next to
// it, with the recipe they come from, and prints `PLAN <file>`: lenses.mjs
// builds them once the page is open. The `otherwise` lens's paths are the
// changed files no other lens's globs match, when there are any. Any refusal
// prints `REVIEW_REFUSED <reason>` and exits 2.
// Nothing is written in the reviewed working tree; an MR's head is fetched.
// TRANCHANT_GLAB names another glab executable (the tests' fake one).
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { REVIEW_VERSION, oneLine } from './lib/format.mjs'
import { STATE_ROOT } from './lib/project.mjs'
import { RecipeRefusal, findRecipe, readRecipe } from './lib/lens.mjs'
import { loadSettings } from './lib/settings.mjs'

/** @typedef {import('./lib/lens.mjs').LensSpec} Lens */

// The branch's MR is optional: an unreachable GitLab must not hold the review.
const GLAB_TIMEOUT_MS = 20_000
const run = promisify(execFile)

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`REVIEW_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error)

/** What a command said on stderr, its first line, else its message. @param {unknown} error */
function firstWords(error) {
  const stderr =
    error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
  return (
    stderr
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('[glab] Update available')) ??
    message(error).split('\n')[0] ??
    ''
  ).replace(/^(?:fatal|error): /, '')
}

/**
 * git in `cwd`; its stdout trimmed.
 * @param {string} cwd
 * @param {string[]} args
 */
const git = async (cwd, args) =>
  (await run('git', ['-C', cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })).stdout.trim()

/** git's answer, or undefined when it fails. @param {string} cwd @param {string[]} args */
const gitOr = (cwd, args) => git(cwd, args).catch(() => undefined)

/** The commit `revision` names, or undefined. @param {string} cwd @param {string} revision */
const commitOf = (cwd, revision) =>
  gitOr(cwd, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`])

/**
 * The repository's default branch, as `origin/HEAD` names it, else the
 * first of the usual names that exists.
 * @param {string} project
 */
async function defaultBranch(project) {
  const remote = await gitOr(project, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  if (remote) return remote
  for (const name of ['origin/main', 'origin/master', 'main', 'master']) {
    if (await commitOf(project, name)) return name
  }
  return refuse(`${project} has no default branch: origin/HEAD, main or master`)
}

/**
 * The merge request at `url`, as `glab mr view` reads it, its head commit
 * fetched when the checkout lacks it.
 * @param {string} project
 * @param {string} url
 */
async function mergeRequest(project, url) {
  const glab = process.env.TRANCHANT_GLAB || 'glab'
  let mr
  try {
    // From the project: glab takes the GitLab host from the checkout's remote.
    const { stdout } = await run(glab, ['mr', 'view', url, '-F', 'json'], {
      cwd: project,
      maxBuffer: 16 * 1024 * 1024,
    })
    mr = JSON.parse(stdout)
  } catch (error) {
    return refuse(`glab cannot read ${url}: ${firstWords(error)}`)
  }
  const refs = mr?.diff_refs
  const sha = /^[0-9a-f]{7,64}$/
  if (![refs?.base_sha, refs?.head_sha, refs?.start_sha].every((one) => sha.test(one)))
    refuse(`glab read ${url} without its diff_refs`)
  if (!Number.isInteger(mr.iid)) refuse(`glab read ${url} without its iid`)
  const where = /^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/\d+/.exec(
    String(mr.web_url ?? url),
  )
  /** What the last fetch said when it failed: why a missing commit is missing. */
  let fetchWords = ''
  const fetchRef = (/** @type {string} */ ref) =>
    git(project, ['fetch', '--quiet', 'origin', ref]).catch((error) => {
      fetchWords = firstWords(error)
    })
  if (!(await commitOf(project, refs.head_sha))) {
    await fetchRef(refs.head_sha)
    if (!(await commitOf(project, refs.head_sha)))
      await fetchRef(`merge-requests/${mr.iid}/head`)
  }
  for (const commit of [refs.base_sha, refs.head_sha]) {
    if (!(await commitOf(project, commit)))
      refuse(
        `commit ${commit} of ${url} is not in ${project}${fetchWords ? ` (git fetch: ${fetchWords})` : ''}: fetch it first`,
      )
  }
  return {
    title: typeof mr.title === 'string' && mr.title.trim() ? mr.title.trim() : url,
    branch: String(mr.source_branch || `!${mr.iid}`),
    base: refs.base_sha,
    headSha: refs.head_sha,
    mr: {
      project: where?.[1] ?? mr.project_id,
      iid: mr.iid,
      url: String(mr.web_url ?? url),
      author: String(mr.author?.username || 'unknown'),
      diffRefs: {
        baseSha: refs.base_sha,
        headSha: refs.head_sha,
        startSha: refs.start_sha,
      },
    },
  }
}

/** Says on stderr why the branch's review has no MR to post on. @param {string} reason */
function skip(reason) {
  console.error(`no merge request to post on: ${oneLine(reason)}`)
  return undefined
}

/**
 * The open merge request whose source branch is `branch`, as `glab mr view`
 * reads it; undefined, with the reason on stderr, when there is none or glab
 * cannot say: the review then goes on without it.
 * @param {string} project
 * @param {string} branch
 */
async function branchMergeRequest(project, branch) {
  const glab = process.env.TRANCHANT_GLAB || 'glab'
  if (branch === 'HEAD') return skip('HEAD is detached')
  // GitLab knows the branch by its own name, not by the remote's ref.
  const name = branch.replace(/^origin\//, '')
  let mr
  try {
    // From the project: glab takes the GitLab host from the checkout's remote.
    const { stdout } = await run(glab, ['mr', 'view', name, '-F', 'json'], {
      cwd: project,
      maxBuffer: 16 * 1024 * 1024,
      timeout: GLAB_TIMEOUT_MS,
    })
    mr = JSON.parse(stdout)
  } catch (error) {
    const killed = error && typeof error === 'object' && 'killed' in error && error.killed
    return skip(
      killed
        ? `glab did not answer for ${branch} within ${GLAB_TIMEOUT_MS / 1000} s`
        : `glab cannot say for ${branch}: ${firstWords(error)}`,
    )
  }
  if (mr?.state !== 'opened') return skip(`the merge request of ${branch} is not open`)
  if (mr.source_branch !== name)
    return skip(`glab answered the merge request of ${mr?.source_branch}`)
  const refs = mr.diff_refs
  const sha = /^[0-9a-f]{7,64}$/
  if (
    !Number.isInteger(mr.iid) ||
    typeof mr.web_url !== 'string' ||
    !/^https?:\/\//.test(mr.web_url) ||
    ![refs?.base_sha, refs?.head_sha, refs?.start_sha].every((one) => sha.test(one))
  )
    return skip(
      `glab read the merge request of ${branch} without its iid, url or diff_refs`,
    )
  // The diff runs from the MR's base: a checkout behind the target branch lacks it.
  if (!(await commitOf(project, refs.base_sha))) {
    await git(project, ['fetch', '--quiet', 'origin', refs.base_sha]).catch(() => {})
    if (!(await commitOf(project, refs.base_sha)))
      return skip(`commit ${refs.base_sha}, the base of !${mr.iid}, is not in ${project}`)
  }
  const where = /^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/\d+/.exec(mr.web_url)
  return {
    project: where?.[1] ?? mr.project_id,
    iid: mr.iid,
    url: mr.web_url,
    author: String(mr.author?.username || 'unknown'),
    diffRefs: {
      baseSha: refs.base_sha,
      headSha: refs.head_sha,
      startSha: refs.start_sha,
    },
  }
}

/**
 * The branch to review against the default branch: `given`, else the
 * current one; with its open merge request, when it has one.
 * @param {string} project
 * @param {string | undefined} given
 */
async function branchChange(project, given) {
  const branch =
    given ??
    ((await gitOr(project, ['symbolic-ref', '--quiet', '--short', 'HEAD'])) || 'HEAD')
  const headSha = await commitOf(project, branch)
  if (!headSha) return refuse(`${branch} is not a branch or a commit of ${project}`)
  const base = await defaultBranch(project)
  const mr = await branchMergeRequest(project, branch)
  return { title: branch, branch, base, headSha, ...(mr && { mr }) }
}

let parsed
try {
  parsed = parseArgs({ allowPositionals: true, options: { recipe: { type: 'string' } } })
} catch (error) {
  refuse(message(error))
}
const { values, positionals } = parsed
if (positionals.length > 1) refuse('give one branch or merge request url at most')
const [target] = positionals
if (target?.startsWith('-')) refuse(`${target} is not a branch or a merge request url`)

const cwd = process.cwd()
const top = await gitOr(cwd, ['rev-parse', '--show-toplevel'])
if (!top) refuse(`${cwd} is not in a git repository`)
const project = path.resolve(top)
const { values: settings, problem } = await loadSettings()
// Read as none, as the server does: the review still runs, on the defaults.
if (problem) console.error(`settings: ${oneLine(problem)}`)
const theirs = target !== undefined && /^https?:\/\//.test(target)
const change = theirs
  ? await mergeRequest(project, target)
  : await branchChange(project, target)
// Read at BASE when it is the project's: the change cannot rewrite the lenses that review it.
const recipe = await findRecipe({
  ...(values.recipe && { flag: path.resolve(cwd, values.recipe) }),
  project,
  base: change.base,
  settings: settings.recipe,
})
const recipeName =
  recipe.from === 'project' ? `${change.base}:${recipe.file}` : recipe.file
/** @type {Lens[]} */
const lenses = await readRecipe(recipe).then(
  (read) => read.lenses,
  (error) => {
    if (!(error instanceof RecipeRefusal)) throw error
    return refuse(`recipe ${recipeName}: ${error.message}`)
  },
)
// The lenses turned off are the recipe in force's: a run's own recipe runs whole.
const disabled = new Set(values.recipe ? [] : settings.disabledLenses)
// The server's range: the MR's own refs, else what reached the head since the base.
const range = theirs
  ? `${change.base}..${change.headSha}`
  : `${change.base}...${change.headSha}`

/**
 * The changed files that match `paths`, git's `:(glob)` pathspecs.
 * @param {string[]} paths
 */
const touched = async (paths) =>
  (
    await git(project, [
      'diff',
      '--name-only',
      range,
      '--',
      ...paths.map((one) => `:(glob)${one}`),
    ]).catch((error) => refuse(`git diff ${range} failed: ${firstWords(error)}`))
  )
    .split('\n')
    .filter(Boolean)

const changed = await touched(['**'])
if (!changed.length) refuse(`${change.branch} has no change against ${change.base}`)
const covered = new Set()
/** @type {Map<Lens, string[]>} */
const matched = new Map()
for (const lens of lenses) {
  if (lens.otherwise) continue
  const files = await touched(lens.paths)
  for (const file of files) covered.add(file)
  if (files.length) matched.set(lens, lens.paths)
}
const uncovered = changed.filter((file) => !covered.has(file))
/** @type {Lens[]} */
const applied = lenses.flatMap((lens) => {
  // Turned off in the settings: not run, and its files reviewed by no other lens.
  if (disabled.has(lens.name)) return []
  if (lens.otherwise) return uncovered.length ? [{ ...lens, paths: uncovered }] : []
  const paths = matched.get(lens)
  return paths ? [{ ...lens, paths }] : []
})
if (!applied.length)
  refuse(
    lenses.every((lens) => disabled.has(lens.name))
      ? 'every lens of the recipe is turned off in the settings'
      : "no lens of the recipe applies to the change's files",
  )

const id = randomUUID()
const envelope = {
  version: REVIEW_VERSION,
  id,
  createdAt: new Date().toISOString(),
  project,
  branch: change.branch,
  base: change.base,
  headSha: change.headSha,
  ownership: theirs ? 'theirs' : 'ours',
  // reviewing once lenses.mjs built every lens; refused when one cannot be.
  status: 'preparing',
  verify: true,
  title: change.title,
  ...('mr' in change && { mr: change.mr }),
  // Blank until the summary agent writes them (summarize.mjs); the page hides the section meanwhile.
  summary: '',
  strengths: [],
  findings: [],
}
const inbox = path.join(STATE_ROOT, 'inbox')
await mkdir(inbox, { recursive: true })
const file = path.join(inbox, `${id}.json`)
await writeFile(file, `${JSON.stringify(envelope, null, 2)}\n`)
const plan = path.join(inbox, `${id}.plan.json`)
await writeFile(plan, `${JSON.stringify({ recipe, lenses: applied }, null, 2)}\n`)
console.log(`INBOX ${file}`)
console.log(`PLAN ${plan}`)
