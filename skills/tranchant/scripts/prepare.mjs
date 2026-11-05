#!/usr/bin/env node
// prepare.mjs [<branch> | <merge request url>] [--recipe <recipe.json>]
// What `/tranchant review` runs first, from the session's folder: finds the
// change (the current branch, or <branch>, against the repository's default
// branch, `ours`, with the branch's open merge request when glab finds one;
// a merge request read with `glab mr view`, `theirs`), reads
// the recipe (the plugin's agents/review/recipe.json unless --recipe), writes
// the review's envelope, `reviewing` with no finding yet, to
// <state>/inbox/<id>.json and prints `INBOX <file>`, then one `LENS <json>`
// per lens whose paths the change touches: `{ name, prompt, paths }`, `prompt`
// the lens's instructions file, absolute; the `otherwise` lens's paths are the
// changed files no other lens's globs match, when there are any. Any refusal prints `REVIEW_REFUSED <reason>` and exits 2.
// Nothing is written in the reviewed working tree; an MR's head is fetched.
// TRANCHANT_GLAB names another glab executable (the tests' fake one).
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { REVIEW_VERSION, oneLine } from './lib/format.mjs'
import { SKILL_DIR, STATE_ROOT } from './lib/project.mjs'

/** @typedef {{ name: string, prompt: string, paths: string[], otherwise?: boolean }} Lens */

const DEFAULT_RECIPE = path.join(SKILL_DIR, '..', '..', 'agents', 'review', 'recipe.json')
const LENS_NAME = /^[\w-]{1,40}$/
const MAX_LENSES = 12
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
 * The recipe's lenses, each prompt file absolute, or the refusal.
 * @param {string} file
 * @returns {Promise<Lens[]>}
 */
async function readRecipe(file) {
  let recipe
  try {
    recipe = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    return refuse(`recipe ${file}: ${message(error)}`)
  }
  const lenses = recipe?.lenses
  if (recipe?.version !== 1 || !Array.isArray(lenses) || !lenses.length) {
    return refuse(`recipe ${file}: version 1 and at least one lens are required`)
  }
  if (lenses.length > MAX_LENSES) {
    return refuse(`recipe ${file}: ${MAX_LENSES} lenses at most`)
  }
  const names = new Set()
  let otherwise = false
  return lenses.map((lens, i) => {
    const where = `recipe ${file}: lenses[${i}]`
    if (typeof lens?.name !== 'string' || !LENS_NAME.test(lens.name))
      refuse(`${where}.name: letters, digits, - and _ only`)
    if (names.has(lens.name)) refuse(`${where}.name: ${lens.name} is used twice`)
    names.add(lens.name)
    if (typeof lens.prompt !== 'string' || !lens.prompt)
      refuse(`${where}.prompt: the lens's instructions file is required`)
    const prompt = path.resolve(path.dirname(file), lens.prompt)
    if (!existsSync(prompt)) refuse(`${where}.prompt: no file ${prompt}`)
    if (lens.otherwise === true) {
      if (lens.paths !== undefined) refuse(`${where}: an otherwise lens has no paths`)
      if (otherwise) refuse(`${where}: one otherwise lens at most`)
      otherwise = true
      return { name: lens.name, prompt, paths: [], otherwise: true }
    }
    const paths = lens.paths ?? ['**']
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.some((one) => typeof one !== 'string' || !one || one.startsWith('-'))
    )
      refuse(`${where}.paths: a list of path globs is required`)
    return { name: lens.name, prompt, paths }
  })
}

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
  let mr
  try {
    // From the project: glab takes the GitLab host from the checkout's remote.
    const { stdout } = await run(glab, ['mr', 'view', branch, '-F', 'json'], {
      cwd: project,
      maxBuffer: 16 * 1024 * 1024,
    })
    mr = JSON.parse(stdout)
  } catch (error) {
    return skip(`glab found none for ${branch}: ${firstWords(error)}`)
  }
  if (mr?.state !== 'opened') return skip(`the merge request of ${branch} is not open`)
  if (mr.source_branch !== branch.replace(/^origin\//, ''))
    return skip(`glab answered the merge request of ${mr?.source_branch}`)
  const refs = mr.diff_refs
  const sha = /^[0-9a-f]{7,64}$/
  if (
    !Number.isInteger(mr.iid) ||
    typeof mr.web_url !== 'string' ||
    ![refs?.base_sha, refs?.head_sha, refs?.start_sha].every((one) => sha.test(one))
  )
    return skip(`glab read the merge request of ${branch} without its iid or diff_refs`)
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
const lenses = await readRecipe(
  values.recipe ? path.resolve(cwd, values.recipe) : DEFAULT_RECIPE,
)
const theirs = target !== undefined && /^https?:\/\//.test(target)
const change = theirs
  ? await mergeRequest(project, target)
  : await branchChange(project, target)
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
  if (lens.otherwise)
    return uncovered.length
      ? [{ name: lens.name, prompt: lens.prompt, paths: uncovered }]
      : []
  const paths = matched.get(lens)
  return paths ? [{ name: lens.name, prompt: lens.prompt, paths }] : []
})
if (!applied.length) refuse("no lens of the recipe applies to the change's files")

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
  status: 'reviewing',
  verify: true,
  title: change.title,
  ...('mr' in change && { mr: change.mr }),
  summary: `Reviewed by Tranchant, lens by lens: ${applied.map((lens) => lens.name).join(', ')}.`,
  strengths: [],
  findings: [],
}
const inbox = path.join(STATE_ROOT, 'inbox')
await mkdir(inbox, { recursive: true })
const file = path.join(inbox, `${id}.json`)
await writeFile(file, `${JSON.stringify(envelope, null, 2)}\n`)
console.log(`INBOX ${file}`)
for (const lens of applied) console.log(`LENS ${JSON.stringify(lens)}`)
