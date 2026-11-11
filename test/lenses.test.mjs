// The Lenses step of `/tranchant review`: lib/lens.mjs resolves each lens's
// source (a plugin's skill or agent, a path, a lens of Tranchant's) and builds
// its prompt, the same bytes for the same sources; lenses.mjs runs it on a
// review, refusing the review when a source cannot be resolved; prepare.mjs
// reads the project's recipe at BASE.
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import {
  buildLens,
  expandRecipe,
  findRecipe,
  resolveSource,
  storeLens,
} from '../skills/tranchant/scripts/lib/lens.mjs'
import { createStore } from '../skills/tranchant/scripts/lib/store.mjs'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

const PREPARE = path.join(SCRIPTS, 'prepare.mjs')
const OPEN = path.join(SCRIPTS, 'open.mjs')
const LENSES = path.join(SCRIPTS, 'lenses.mjs')

/** @type {string} */
let stateDir
/** @type {string} */
let configDir
/** Claude Code's folder, as the tests fake it: the plugins installed, and the settings turning one off. */
/** @type {string} */
let claudeDir
/** The fake `workflow` plugin's folder. */
/** @type {string} */
let pluginRoot

before(async (t) => {
  stateDir = await tempDir(t)
  configDir = await tempDir(t, 'tranchant-config-')
  claudeDir = await tempDir(t, 'tranchant-claude-')
  pluginRoot = await tempDir(t, 'tranchant-plugin-')
  await mkdir(path.join(pluginRoot, 'agents'), { recursive: true })
  await mkdir(path.join(pluginRoot, 'skills', 'code-review'), { recursive: true })
  await writeFile(
    path.join(pluginRoot, 'agents', 'code-reviewer-abac.md'),
    '---\nname: code-reviewer-abac\ndescription: ABAC checks\n---\n\nLook for a permission check missing on a route.\n',
  )
  await writeFile(
    path.join(pluginRoot, 'skills', 'code-review', 'SKILL.md'),
    '---\nname: code-review\ndescription: |\n  The team review.\n---\n\nRun the reviewers, then post on GitLab.\n',
  )
  await installed({ workflow: true })
  process.env.CLAUDE_CONFIG_DIR = claudeDir
})

/**
 * The plugins Claude Code has installed, `workflow` among them, each on or off.
 * @param {Record<string, boolean>} plugins
 */
async function installed(plugins) {
  await mkdir(path.join(claudeDir, 'plugins'), { recursive: true })
  await writeFile(
    path.join(claudeDir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: Object.fromEntries(
        Object.keys(plugins).map((name) => [
          `${name}@team`,
          [{ scope: 'user', installPath: pluginRoot, version: '2.3.0' }],
        ]),
      ),
    }),
  )
  await writeFile(
    path.join(claudeDir, 'settings.json'),
    JSON.stringify({
      enabledPlugins: Object.fromEntries(
        Object.entries(plugins).map(([name, on]) => [`${name}@team`, on]),
      ),
    }),
  )
}

/**
 * A repository with `main` and, checked out, `feature/cart` changing `src/cart.js`.
 * @param {import('node:test').TestContext} t
 */
async function repository(t) {
  const dir = await tempDir(t, 'tranchant-repo-')
  const git = async (/** @type {string[]} */ ...args) => {
    const ran = await run('git', [
      '-C',
      dir,
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      ...args,
    ])
    assert.equal(ran.code, 0, ran.stderr)
    return ran.stdout.trim()
  }
  await git('init', '-q', '-b', 'main')
  await mkdir(path.join(dir, 'src'))
  await writeFile(path.join(dir, 'src', 'cart.js'), 'export const total = () => 0\n')
  await git('add', '.')
  await git('commit', '-q', '-m', 'base')
  await git('switch', '-q', '-c', 'feature/cart')
  await writeFile(path.join(dir, 'src', 'cart.js'), 'export const total = () => 1\n')
  await git('commit', '-q', '-am', 'change')
  return { dir, git }
}

const env = () => ({
  TRANCHANT_STATE_DIR: stateDir,
  TRANCHANT_GLAB: path.join(stateDir, 'no-glab'),
  XDG_CONFIG_HOME: configDir,
  CLAUDE_CONFIG_DIR: claudeDir,
})

/**
 * prepare.mjs in `cwd`, the review imported as the hooks do, then lenses.mjs:
 * what it printed, the review's folder and its envelope.
 * @param {string} cwd
 * @param {string[]} [args]
 */
async function review(cwd, args = []) {
  const prepared = await run(process.execPath, [PREPARE, ...args], { cwd, env: env() })
  assert.equal(prepared.code, 0, prepared.stdout + prepared.stderr)
  const [inbox = '', plan = ''] = prepared.stdout
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\w+ /, ''))
  const opened = await run(process.execPath, [OPEN, inbox, '--verify'], { env: env() })
  const dir = opened.stdout.trim().replace(/^REVIEW /, '')
  assert.ok(path.isAbsolute(dir), opened.stdout + opened.stderr)
  const ran = await run(process.execPath, [LENSES, '--review', dir, '--plan', plan], {
    env: env(),
  })
  return {
    ...ran,
    dir,
    plan: JSON.parse(await readFile(plan, 'utf8')),
    envelope: JSON.parse(await readFile(path.join(dir, 'review.json'), 'utf8')),
    progress: JSON.parse(await readFile(path.join(dir, 'lenses.json'), 'utf8')),
    lenses: ran.stdout
      .split('\n')
      .filter((line) => line.startsWith('LENS '))
      .map((line) => JSON.parse(line.slice('LENS '.length))),
  }
}

/** A recipe file in a folder of its own, with the files it names. @param {any} t */
async function recipeFile(t, /** @type {object} */ recipe, files = {}) {
  const dir = await tempDir(t, 'tranchant-recipe-')
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true })
    await writeFile(path.join(dir, name), text)
  }
  const file = path.join(dir, 'recipe.json')
  await writeFile(file, JSON.stringify({ version: 1, ...recipe }))
  return file
}

const fsWhere = (/** @type {string} */ folder, /** @type {string} */ project) => ({
  origin: /** @type {const} */ ({ kind: 'fs' }),
  folder,
  project,
})

test('resolves a plugin agent, a path and a lens of Tranchant', async (t) => {
  const project = await tempDir(t)
  const agent = await resolveSource(
    'workflow:code-reviewer-abac',
    fsWhere(project, project),
  )
  assert.equal(agent.version, '2.3.0')
  assert.equal(agent.folder, path.join(pluginRoot, 'agents'))
  assert.match(agent.text, /permission check missing/)
  const skill = await resolveSource('workflow:code-review', fsWhere(project, project))
  assert.equal(skill.folder, path.join(pluginRoot, 'skills', 'code-review'))
  await writeFile(path.join(project, 'checklist.md'), 'Check the money.\n')
  const own = await resolveSource('./checklist.md', fsWhere(project, project))
  assert.equal(own.text, 'Check the money.\n')
  assert.equal(own.folder, project)
  const builtIn = await resolveSource('tranchant:bugs', fsWhere(project, project))
  assert.match(builtIn.text, /^---\nname: bugs\n/)
})

test('a lens built from a source is the contract, then the source fenced as its domain', async (t) => {
  const project = await tempDir(t)
  const { text, record } = await buildLens(
    {
      name: 'abac',
      paths: ['**'],
      source: 'workflow:code-reviewer-abac',
      skills: ['workflow:code-review'],
    },
    fsWhere(project, project),
  )
  assert.match(text, /^You review one change through one lens/)
  assert.match(text, /## The lens's domain\n/)
  assert.match(text, /Source: `workflow:code-reviewer-abac`, version 2\.3\.0\./)
  assert.match(text, /```markdown\nLook for a permission check missing on a route\.\n```/)
  assert.match(text, /## Reference: workflow:code-review\n/)
  // The frontmatters stay out; the contract wins over the source's process.
  assert.doesNotMatch(text, /description: ABAC checks/)
  assert.ok(text.indexOf('these rules win') < text.indexOf('Run the reviewers'))
  assert.deepEqual(Object.keys(record), ['name', 'source', 'version', 'hash'])
  // An add-on: the lens of Tranchant's, then the checklist as its addition.
  await writeFile(path.join(project, 'money.md'), 'Amounts are cents, never floats.\n')
  const addOn = await buildLens(
    { name: 'bugs', paths: ['**'], use: 'tranchant:bugs', add: './money.md' },
    fsWhere(project, project),
  )
  assert.match(addOn.text, /^You review one change/)
  assert.match(addOn.text, /## This lens's addition\n[\s\S]*Amounts are cents/)
  assert.equal(addOn.record.source, 'tranchant:bugs+./money.md')
})

test('a build run twice gives the same hash, and writes nothing the second time', async (t) => {
  const project = await tempDir(t)
  const lenses = await tempDir(t)
  const lens = { name: 'abac', paths: ['**'], source: 'workflow:code-reviewer-abac' }
  const first = await buildLens(lens, fsWhere(project, project))
  const second = await buildLens(lens, fsWhere(project, project))
  assert.equal(first.text, second.text)
  assert.equal(first.hash, second.hash)
  const stored = await storeLens(first.text, first.hash, lenses)
  assert.deepEqual(stored, { file: path.join(lenses, `${first.hash}.md`), written: true })
  // Twice at once, then again: one file, never rewritten, no temp file left.
  const again = await Promise.all([
    storeLens(second.text, second.hash, lenses),
    storeLens(second.text, second.hash, lenses),
  ])
  assert.deepEqual(
    again.map((one) => one.written),
    [false, false],
  )
  assert.deepEqual(await readdir(lenses), [`${first.hash}.md`])
  assert.equal(await readFile(stored.file, 'utf8'), first.text)
})

test('lenses.mjs builds every lens, records them, and prints one LENS line each', async (t) => {
  const { dir } = await repository(t)
  const recipe = await recipeFile(
    t,
    {
      lenses: [
        { name: 'abac', source: 'workflow:code-reviewer-abac', model: 'opus' },
        { name: 'money', prompt: 'money.md', paths: ['src/**'], topics: ['Bugs'] },
      ],
    },
    { 'money.md': 'Look at the money.\n' },
  )
  const first = await review(dir, ['--recipe', recipe])
  assert.equal(first.code, 0, first.stdout + first.stderr)
  assert.equal(first.envelope.status, 'reviewing')
  assert.deepEqual(
    first.envelope.lenses.map((/** @type {any} */ lens) => [
      lens.name,
      lens.source,
      lens.version,
    ]),
    [
      ['abac', 'workflow:code-reviewer-abac', '2.3.0'],
      ['money', 'money.md', undefined],
    ],
  )
  assert.deepEqual(
    first.lenses.map((lens) => ({ ...lens, prompt: path.basename(lens.prompt) })),
    [
      {
        name: 'abac',
        prompt: `${first.envelope.lenses[0].hash}.md`,
        paths: ['**'],
        model: 'opus',
      },
      {
        name: 'money',
        prompt: `${first.envelope.lenses[1].hash}.md`,
        paths: ['src/**'],
        topics: ['Bugs'],
      },
    ],
  )
  for (const lens of first.lenses)
    assert.equal(path.dirname(lens.prompt), path.join(stateDir, 'lenses'))
  assert.equal(await readFile(first.lenses[1].prompt, 'utf8'), 'Look at the money.\n')
  assert.equal(first.progress.state, 'ready')
  assert.deepEqual(
    first.progress.lenses.map((/** @type {any} */ row) => [row.name, row.state]),
    [
      ['abac', 'ready'],
      ['money', 'ready'],
    ],
  )
  // The next review of the project tells what changed since this one.
  await writeFile(path.join(path.dirname(recipe), 'money.md'), 'Look at the cents.\n')
  const second = await review(dir, ['--recipe', recipe])
  assert.equal(second.code, 0, second.stdout + second.stderr)
  assert.deepEqual(
    second.progress.lenses.map((/** @type {any} */ row) => [row.name, row.change]),
    [
      ['abac', 'unchanged'],
      ['money', 'updated'],
    ],
  )
})

test('each source that cannot be resolved refuses the review, with its reason, and no LENS line', async (t) => {
  const { dir } = await repository(t)
  const large = `${'x'.repeat(70 * 1024)}\n`
  for (const [
    lens,
    why,
    fix,
    files,
  ] of /** @type {[object, RegExp, RegExp, Record<string, string>?][]} */ ([
    [
      { name: 'a', source: 'nobody:reviewer' },
      /the plugin nobody is not installed/,
      /install the plugin nobody/,
    ],
    [
      { name: 'a', source: 'workflow:code-reviewer-none' },
      /the plugin workflow has no skill or agent named code-reviewer-none/,
      /re-import/,
    ],
    [{ name: 'a', source: './missing.md' }, /\.\/missing\.md: no such file/, /re-import/],
    [
      { name: 'a', source: './broken.md' },
      /\.\/broken\.md: its frontmatter is never closed/,
      /fix the source's frontmatter/,
      { 'broken.md': '---\nname: broken\n\nNo end.\n' },
    ],
    [
      { name: 'a', source: 'workflow:code-review', skills: ['./gone.md'] },
      /its skill \.\/gone\.md: \.\/gone\.md: no such file/,
      /re-import/,
    ],
    [
      { name: 'a', use: 'tranchant:nothing', add: 'workflow:code-review' },
      /the add-on's lens tranchant:nothing does not exist/,
      /edit the recipe/,
    ],
    [
      { name: 'a', source: './large.md' },
      /\.\/large\.md is larger than 64 KiB/,
      /shorten the source/,
      { 'large.md': large },
    ],
  ])) {
    const recipe = await recipeFile(t, { lenses: [lens] }, files)
    const ran = await review(dir, ['--recipe', recipe])
    assert.equal(ran.code, 2, ran.stdout)
    assert.match(ran.stdout, /^REVIEW_REFUSED lens a /)
    assert.match(ran.stdout, why)
    assert.deepEqual(ran.lenses, [])
    assert.equal(ran.envelope.status, 'refused')
    assert.equal(ran.envelope.refusal.lens, 'a')
    assert.match(ran.envelope.refusal.reason, why)
    assert.match(ran.envelope.refusal.fix, fix)
    assert.equal(ran.progress.state, 'refused')
    assert.equal(ran.progress.lenses[0].state, 'failed')
  }
  // A plugin turned off is not one to run.
  await installed({ workflow: false })
  try {
    const recipe = await recipeFile(t, {
      lenses: [{ name: 'a', source: 'workflow:code-reviewer-abac' }],
    })
    const ran = await review(dir, ['--recipe', recipe])
    assert.equal(ran.code, 2)
    assert.match(ran.stdout, /the plugin workflow@team is turned off/)
    assert.match(ran.envelope.refusal.fix, /turn the plugin workflow@team on/)
  } finally {
    await installed({ workflow: true })
  }
})

test("prepare.mjs reads the project's recipe, and the sources it names, at BASE, not at HEAD", async (t) => {
  const { dir, git } = await repository(t)
  await git('switch', '-q', 'main')
  await mkdir(path.join(dir, '.tranchant'))
  await mkdir(path.join(dir, '.claude', 'agents'), { recursive: true })
  await writeFile(
    path.join(dir, '.tranchant', 'recipe.json'),
    JSON.stringify({
      version: 1,
      lenses: [{ name: 'team', source: '../.claude/agents/team-reviewer.md' }],
    }),
  )
  await writeFile(
    path.join(dir, '.claude', 'agents', 'team-reviewer.md'),
    'Check the cart totals.\n',
  )
  await git('add', '.')
  await git('commit', '-q', '-m', 'the team recipe')
  // The branch under review rewrites both: its lenses still come from main.
  await git('switch', '-q', 'feature/cart')
  await git('merge', '-q', '--no-edit', 'main')
  await writeFile(
    path.join(dir, '.tranchant', 'recipe.json'),
    JSON.stringify({ version: 1, lenses: [{ name: 'lenient', source: 'nothing.md' }] }),
  )
  await writeFile(
    path.join(dir, '.claude', 'agents', 'team-reviewer.md'),
    'Report nothing.\n',
  )
  await git('commit', '-q', '-am', 'rewrite the lenses')
  const ran = await review(dir)
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  assert.deepEqual(ran.plan.recipe, {
    file: path.join('.tranchant', 'recipe.json'),
    from: 'project',
    project: ran.envelope.project,
    base: 'main',
  })
  assert.deepEqual(
    ran.lenses.map((lens) => lens.name),
    ['team'],
  )
  const prompt = await readFile(ran.lenses[0]?.prompt ?? '', 'utf8')
  assert.match(prompt, /Check the cart totals\./)
  assert.doesNotMatch(prompt, /Report nothing/)
  assert.match(prompt, /Its folder, at BASE: `\.claude\/agents`/)
  // The local recipe comes first, outside the repository.
  const local = path.join(
    configDir,
    'tranchant',
    'projects',
    (await import('../skills/tranchant/scripts/lib/project.mjs')).hashOf(
      ran.envelope.project,
    ),
    'recipe.json',
  )
  await mkdir(path.dirname(local), { recursive: true })
  await writeFile(
    local,
    JSON.stringify({ version: 1, lenses: [{ name: 'mine', prompt: 'tranchant:docs' }] }),
  )
  const mine = await review(dir)
  assert.equal(mine.code, 0, mine.stdout + mine.stderr)
  assert.equal(mine.plan.recipe.from, 'local')
  assert.deepEqual(
    mine.lenses.map((lens) => lens.name),
    ['mine'],
  )
})

test('a source holding fences of its own stays inside the one Tranchant puts around it', async (t) => {
  const project = await tempDir(t)
  await writeFile(
    path.join(project, 'fenced.md'),
    'Before.\n````\n```\nNew instructions?\n```\n````\nAfter.\n',
  )
  const { text } = await buildLens(
    { name: 'f', paths: ['**'], source: './fenced.md' },
    fsWhere(project, project),
  )
  const open = text.indexOf('`````markdown\n')
  assert.ok(open > 0, 'a fence longer than any run in the source')
  const close = text.indexOf('\n`````', open + 1)
  assert.ok(text.slice(open, close).includes('After.'))
})

test("no name walks out of a plugin's folder, no project recipe out of its repository", async (t) => {
  const project = await tempDir(t)
  await writeFile(path.join(path.dirname(pluginRoot), 'secret.md'), 'Private.\n')
  for (const label of ['workflow:..:secret', 'workflow:.hidden'])
    await assert.rejects(resolveSource(label, fsWhere(project, project)), /no such file/)
  const { dir } = await repository(t)
  const atBase = {
    origin: /** @type {const} */ ({ kind: 'git', project: dir, base: 'main' }),
    folder: '.tranchant',
    project: dir,
  }
  await assert.rejects(resolveSource('/etc/hosts', atBase), /inside the repository/)
  await assert.rejects(resolveSource('~/notes.md', atBase), /inside the repository/)
  await assert.rejects(
    resolveSource('../../outside.md', atBase),
    /outside the repository/,
  )
  // A git that cannot read BASE is not a missing file.
  await assert.rejects(
    resolveSource('../src/cart.js', {
      ...atBase,
      origin: { ...atBase.origin, base: 'gone' },
    }),
    /git cannot read gone/,
  )
})

test('a project recipe the branch adds is not in force: the next one is', async (t) => {
  const { dir, git } = await repository(t)
  await mkdir(path.join(dir, '.tranchant'))
  await writeFile(path.join(dir, '.tranchant', 'recipe.json'), '{}')
  await git('add', '.')
  await git('commit', '-q', '-m', 'a recipe of its own')
  const ref = await findRecipe({ project: dir, base: 'main', settings: null })
  assert.equal(ref.from, 'plugin')
})

test("an add-on keeps its lens's paths; extends puts Tranchant's lenses first, 12 at most", async () => {
  const lenses = await expandRecipe({
    version: 1,
    extends: 'tranchant',
    lenses: [
      { name: 'security', use: 'tranchant:security', add: './money.md' },
      { name: 'abac', source: 'workflow:code-reviewer-abac' },
    ],
  })
  assert.equal(lenses.length, 11)
  assert.equal(lenses.at(-1)?.name, 'abac')
  assert.equal(lenses.filter((lens) => lens.name === 'security').length, 1)
  const security = lenses.find((lens) => lens.name === 'security')
  assert.ok(security?.paths.includes('**/*.tsx'))
  assert.ok(!security?.paths.includes('**'))
  assert.equal(lenses[0]?.prompt, 'tranchant:correctness')
  await assert.rejects(
    expandRecipe({
      version: 1,
      extends: 'tranchant',
      lenses: ['a', 'b', 'c'].map((name) => ({ name, source: './x.md' })),
    }),
    /12 lenses at most, the plugin's included/,
  )
})

test('the store moves a review out of preparing once, and a refused one nowhere', async (t) => {
  const { dir } = await repository(t)
  /** A review imported as the hooks import it, still preparing. */
  const preparing = async () => {
    const prepared = await run(process.execPath, [PREPARE], { cwd: dir, env: env() })
    const inbox = prepared.stdout.split('\n')[0]?.replace(/^INBOX /, '') ?? ''
    const opened = await run(process.execPath, [OPEN, inbox, '--verify'], { env: env() })
    return createStore(opened.stdout.trim().replace(/^REVIEW /, ''))
  }
  const running = await preparing()
  await assert.rejects(running.complete(), /still building its lenses/)
  await running.prepared([])
  assert.equal((await running.readReview()).status, 'reviewing')
  await assert.rejects(running.prepared([]), /reviewing, not preparing/)
  await assert.rejects(
    running.refuse({ lens: 'a', source: 'b', reason: 'c' }),
    /reviewing, not preparing/,
  )
  const refused = await preparing()
  // What review.json would refuse to read is never written.
  await assert.rejects(
    refused.refuse({ lens: 'a', source: 'b', reason: 'x'.repeat(3000) }),
    /refusal/,
  )
  await refused.refuse({ lens: 'a', source: 'b', reason: 'c' })
  await assert.rejects(refused.complete(), /refused: it never ran/)
  await assert.rejects(refused.summarize({ summary: 'S' }), /the review is refused/)
})

test("lenses.mjs --abandon refuses a review still preparing, said as the step's", async (t) => {
  const { dir } = await repository(t)
  const prepared = await run(process.execPath, [PREPARE], { cwd: dir, env: env() })
  const inbox = prepared.stdout.split('\n')[0]?.replace(/^INBOX /, '') ?? ''
  const opened = await run(process.execPath, [OPEN, inbox, '--verify'], { env: env() })
  const folder = opened.stdout.trim().replace(/^REVIEW /, '')
  const ran = await run(
    process.execPath,
    [LENSES, '--review', folder, '--abandon', 'the server did not start'],
    { env: env() },
  )
  assert.equal(ran.code, 2)
  assert.match(ran.stdout, /^REVIEW_REFUSED lens Lenses step .*the server did not start/)
  const envelope = JSON.parse(await readFile(path.join(folder, 'review.json'), 'utf8'))
  assert.equal(envelope.status, 'refused')
  assert.match(envelope.refusal.fix, /run \/tranchant review again/)
})
