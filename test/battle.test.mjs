// A battle review: two groups of lenses on one change at once
// (lib/battle.mjs). prepare.mjs --battle A,B plans both groups' lenses, the
// shared ones once; lenses.mjs plans the battle the page picks, and records
// it in review.json; the review's battle.json keeps the pairs split.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

// Read once, when lib/settings.mjs loads: set before the modules are imported.
const configDir = await mkdtemp(path.join(os.tmpdir(), 'tranchant-config-'))
const stateDir = await mkdtemp(path.join(os.tmpdir(), 'tranchant-state-'))
process.env.XDG_CONFIG_HOME = configDir
after(() =>
  Promise.all([
    rm(configDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]),
)
const { groupsFile } = await import('../skills/tranchant/scripts/lib/groups.mjs')
const { BattleRefusal, mergeBattle, parseBattle, readSplits, writeSplit } =
  await import('../skills/tranchant/scripts/lib/battle.mjs')
const { identityOf, validateEnvelope } =
  await import('../skills/tranchant/scripts/lib/format.mjs')

const PREPARE = path.join(SCRIPTS, 'prepare.mjs')
const OPEN = path.join(SCRIPTS, 'open.mjs')
const LENSES = path.join(SCRIPTS, 'lenses.mjs')

const env = () => ({
  TRANCHANT_STATE_DIR: stateDir,
  TRANCHANT_GLAB: path.join(stateDir, 'no-glab'),
  XDG_CONFIG_HOME: configDir,
})

/** A repository with `main` and, checked out, `feature/cart` changing `src/cart.js`. @param {import('node:test').TestContext} t */
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
  }
  await git('init', '-q', '-b', 'main')
  await mkdir(path.join(dir, 'src'))
  await writeFile(path.join(dir, 'src', 'cart.js'), 'export const total = () => 0\n')
  await git('add', '.')
  await git('commit', '-q', '-m', 'base')
  await git('switch', '-q', '-c', 'feature/cart')
  await writeFile(path.join(dir, 'src', 'cart.js'), 'export const total = () => 1\n')
  await git('commit', '-q', '-am', 'change')
  return dir
}

/** A recipe of four lenses reading the change, and the settings naming it. @param {import('node:test').TestContext} t */
async function recipe(t) {
  const dir = await tempDir(t, 'tranchant-recipe-')
  for (const name of ['js', 'api', 'all', 'css'])
    await writeFile(path.join(dir, `${name}.md`), `The ${name} lens.\n`)
  const file = path.join(dir, 'recipe.json')
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      lenses: [
        { name: 'js', prompt: 'js.md', paths: ['src/**'] },
        { name: 'api', prompt: 'api.md', paths: ['src/**'] },
        { name: 'all', prompt: 'all.md' },
        { name: 'css', prompt: 'css.md', paths: ['**/*.css'] },
      ],
    }),
  )
  const settingsFile = path.join(configDir, 'tranchant', 'settings.json')
  await mkdir(path.dirname(settingsFile), { recursive: true })
  await writeFile(settingsFile, JSON.stringify({ version: 1, recipe: file }))
  t.after(() => rm(settingsFile, { force: true }))
  return file
}

const member = (/** @type {string} */ name) => ({
  scope: /** @type {const} */ ('recipe'),
  name,
})

/** Groups A (js, api), B (js, all) and C (css, which reads none of the change). @param {string} project */
async function writeGroups(project) {
  const file = groupsFile(await realpath(project))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      groups: [
        { name: 'A', lenses: [member('js'), member('api')] },
        { name: 'B', lenses: [member('js'), member('all')] },
        { name: 'C', lenses: [member('css')] },
      ],
    }),
  )
}

/** prepare.mjs in `cwd`: what it printed, and its plan when it wrote one. */
async function prepare(/** @type {string} */ cwd, /** @type {string[]} */ args = []) {
  const ran = await run(process.execPath, [PREPARE, ...args], { cwd, env: env() })
  const planLine = ran.stdout.split('\n').find((line) => line.startsWith('PLAN '))
  const inboxLine = ran.stdout.split('\n').find((line) => line.startsWith('INBOX '))
  return {
    ...ran,
    inbox: inboxLine?.slice('INBOX '.length),
    planFile: planLine?.slice('PLAN '.length),
    plan: planLine
      ? JSON.parse(await readFile(planLine.slice('PLAN '.length), 'utf8'))
      : undefined,
  }
}

const sides = (/** @type {{ lenses: { name: string, side?: string }[] }} */ plan) =>
  plan.lenses.map((lens) => [lens.name, lens.side])

/** @param {string} name @param {string[]} paths @param {object} [more] */
const planned = (name, paths = ['src/**'], more = {}) => ({
  name,
  paths,
  prompt: `${name}.md`,
  files: 1,
  ...more,
})

test('a battle runs the shared lenses once, first, then A and B in turn', () => {
  const merged = mergeBattle(
    [planned('bugs'), planned('correctness'), planned('conventions')],
    [planned('bugs'), planned('money'), planned('tests')],
    false,
  )
  assert.deepEqual(sides({ lenses: merged }), [
    ['bugs', 'both'],
    ['correctness', 'a'],
    ['money', 'b'],
    ['conventions', 'a'],
    ['tests', 'b'],
  ])
  // Twice: the shared lens once per group, each under its own name.
  const twice = mergeBattle([planned('bugs')], [planned('bugs')], true)
  assert.deepEqual(
    twice.map((lens) => [lens.name, lens.side, lens.of]),
    [
      ['bugs-a', 'a', 'bugs'],
      ['bugs-b', 'b', 'bugs'],
    ],
  )
})

test('two lenses under one name but not the same lens run each under its own', () => {
  // The same name, another scope: not shared.
  const scoped = mergeBattle(
    [planned('money')],
    [planned('money', ['src/**'], { added: { scope: 'local', dir: '/x' } })],
    false,
  )
  assert.deepEqual(
    scoped.map((lens) => [lens.name, lens.side]),
    [
      ['money-a', 'a'],
      ['money-b', 'b'],
    ],
  )
  // The same lens reading other files (an otherwise lens): not shared either.
  const otherwise = mergeBattle(
    [planned('rest', ['a.js'], { otherwise: true })],
    [planned('rest', ['b.js'], { otherwise: true })],
    false,
  )
  assert.deepEqual(
    otherwise.map((lens) => lens.name),
    ['rest-a', 'rest-b'],
  )
  // A long name keeps to 40 characters with its suffix.
  const long = 'x'.repeat(40)
  const cut = mergeBattle([planned(long)], [planned(long)], true)
  assert.equal(cut[0]?.name, `${'x'.repeat(38)}-a`)
  // A renamed lens that takes another's name: refused, never two reviewers under one name.
  assert.throws(
    () => mergeBattle([planned('bugs'), planned('bugs-a')], [planned('bugs')], true),
    (error) => error instanceof BattleRefusal && /run as bugs-a/.test(error.message),
  )
})

test('--battle takes two different groups', () => {
  assert.deepEqual(parseBattle('A,B'), { a: 'A', b: 'B' })
  assert.deepEqual(parseBattle(' A , B '), { a: 'A', b: 'B' })
  /** @type {[string, RegExp][]} */
  const refused = [
    ['A', /two groups/],
    ['A,B,C', /two groups/],
    ['A,', /two groups/],
    ['A,A', /two different groups/],
    ['A,../x', /not a group name/],
  ]
  for (const [value, words] of refused) assert.throws(() => parseBattle(value), words)
})

test('prepare.mjs --battle plans both groups, waiting for Start the battle', async (t) => {
  const dir = await repository(t)
  await recipe(t)
  await writeGroups(dir)
  const battle = await prepare(dir, ['--battle', 'A,B'])
  assert.equal(battle.code, 0, battle.stdout + battle.stderr)
  assert.deepEqual(battle.plan.battle, { a: 'A', b: 'B' })
  assert.equal(battle.plan.wait, 'battle')
  assert.deepEqual(battle.plan.others, [])
  assert.equal(battle.plan.group, undefined)
  assert.deepEqual(sides(battle.plan), [
    ['js', 'both'],
    ['api', 'a'],
    ['all', 'b'],
  ])
  // --start: no wait.
  const started = await prepare(dir, ['--battle', 'A,B', '--start'])
  assert.equal(started.code, 0, started.stdout + started.stderr)
  assert.equal(started.plan.wait, undefined)
  /** @type {[string[], RegExp][]} */
  const refusals = [
    [['--battle', 'A,B', '--group', 'A'], /--battle alone/],
    [['--battle', 'A,A'], /two different groups/],
    [['--battle', 'A,Z'], /no group Z in this project/],
    [['--battle', 'A,C'], /no lens of group C applies/],
  ]
  for (const [args, words] of refusals) {
    const refused = await prepare(dir, args)
    assert.equal(refused.code, 2, String(args))
    assert.match(refused.stdout, words)
  }
})

test('a waiting review plans the battle the page picks, records it, and runs its lenses', async (t) => {
  const dir = await repository(t)
  await recipe(t)
  await writeGroups(dir)
  const waiting = await prepare(dir, ['--no-start'])
  assert.equal(waiting.code, 0, waiting.stdout + waiting.stderr)
  const opened = await run(process.execPath, [OPEN, String(waiting.inbox), '--verify'], {
    env: env(),
  })
  const review = opened.stdout.trim().replace(/^REVIEW /, '')
  const step = async (/** @type {string} */ mode, /** @type {object} */ choices) => {
    await writeFile(path.join(review, 'choices.json'), JSON.stringify(choices))
    const ran = await run(
      process.execPath,
      [LENSES, '--review', review, '--plan', String(waiting.planFile), mode],
      { env: env() },
    )
    assert.equal(ran.code, 0, ran.stdout + ran.stderr)
    return {
      said: ran.stdout,
      progress: JSON.parse(await readFile(path.join(review, 'lenses.json'), 'utf8')),
    }
  }
  const battle = { a: 'A', b: 'B' }
  const picked = await step('--replan', { lenses: {}, remember: false, battle })
  assert.deepEqual(picked.progress.battle, battle)
  assert.deepEqual(
    picked.progress.lenses.map((/** @type {any} */ row) => [row.name, row.side]),
    [
      ['js', 'both'],
      ['api', 'a'],
      ['all', 'b'],
    ],
  )
  // The shared lens twice, once per group.
  const twice = await step('--replan', {
    lenses: {},
    remember: false,
    battle: { ...battle, twice: true },
  })
  assert.deepEqual(twice.progress.battle, { ...battle, twice: true })
  assert.deepEqual(
    twice.progress.lenses.map((/** @type {any} */ row) => [row.name, row.of]),
    [
      ['js-a', 'js'],
      ['js-b', 'js'],
      ['api', undefined],
      ['all', undefined],
    ],
  )
  // Back to one group: no battle any more.
  const back = await step('--replan', {
    lenses: {},
    remember: false,
    battle: null,
    group: 'A',
  })
  assert.equal(back.progress.battle, undefined)
  assert.equal(back.progress.group, 'A')
  // A switch turned off does not apply to a battle.
  await step('--replan', { lenses: {}, remember: false, battle })
  const started = await step('--start', {
    lenses: { js: false },
    remember: false,
    battle,
  })
  const lines = started.said
    .split('\n')
    .filter((line) => line.startsWith('LENS '))
    .map((line) => JSON.parse(line.slice('LENS '.length)).name)
  assert.deepEqual(lines, ['js', 'api', 'all'])
  const envelope = JSON.parse(await readFile(path.join(review, 'review.json'), 'utf8'))
  assert.equal(envelope.status, 'reviewing')
  assert.equal(envelope.group, undefined)
  assert.deepEqual(envelope.battle, {
    a: 'A',
    b: 'B',
    lenses: { js: 'both', api: 'a', all: 'b' },
  })
})

test('the pairs split are kept, in one order, and paired again', async (t) => {
  const dir = await tempDir(t, 'tranchant-battle-')
  assert.deepEqual(await readSplits(dir), [])
  assert.deepEqual(await writeSplit(dir, 'money-1', 'bugs-2', true), [
    ['bugs-2', 'money-1'],
  ])
  // Split again: still once.
  assert.deepEqual(await writeSplit(dir, 'bugs-2', 'money-1', true), [
    ['bugs-2', 'money-1'],
  ])
  assert.deepEqual(await writeSplit(dir, 'a-1', 'b-1', true), [
    ['bugs-2', 'money-1'],
    ['a-1', 'b-1'],
  ])
  assert.deepEqual(await writeSplit(dir, 'money-1', 'bugs-2', false), [['a-1', 'b-1']])
  assert.deepEqual(await readSplits(dir), [['a-1', 'b-1']])
  // One it cannot read reads as none, and is never written over: its pairs would be lost.
  for (const text of [
    '{ nope',
    JSON.stringify({ version: 2, splits: [['a-1', 'b-1']] }),
  ]) {
    await writeFile(path.join(dir, 'battle.json'), text)
    assert.deepEqual(await readSplits(dir), [])
    await assert.rejects(
      writeSplit(dir, 'a-1', 'b-2', true),
      (error) => error instanceof BattleRefusal && /cannot be read/.test(error.message),
    )
    assert.equal(await readFile(path.join(dir, 'battle.json'), 'utf8'), text)
  }
})

test("review.json's battle is checked, and leaves the review's identity alone", async () => {
  const envelope = {
    version: 1,
    id: 'b96fae58-5cc3-426b-9632-77f3a7f8f866',
    createdAt: '2026-11-23T10:00:00.000Z',
    project: '/x',
    branch: 'feature/x',
    base: 'main',
    headSha: 'a'.repeat(40),
    ownership: 'ours',
    title: 'X',
    summary: '',
    strengths: [],
    findings: [],
    status: 'reviewing',
  }
  const battle = { a: 'A', b: 'B', lenses: { bugs: 'both', money: 'b' } }
  assert.deepEqual(validateEnvelope({ ...envelope, battle }), [])
  assert.deepEqual(
    validateEnvelope({ ...envelope, battle: { ...battle, twice: true } }),
    [],
  )
  for (const wrong of [
    { ...battle, b: 'A' },
    { ...battle, lenses: { bugs: 'c' } },
    { ...battle, twice: false },
    { ...battle, a: '../x' },
    { a: 'A', b: 'B' },
  ])
    assert.ok(
      validateEnvelope({ ...envelope, battle: wrong }).some((one) =>
        one.startsWith('battle:'),
      ),
      JSON.stringify(wrong),
    )
  assert.equal(identityOf({ ...envelope, battle }), identityOf(envelope))
})

test('a battle that cannot be planned keeps the last plan, waiting, and says why', async (t) => {
  const dir = await repository(t)
  await recipe(t)
  await writeGroups(dir)
  const waiting = await prepare(dir, ['--battle', 'A,B'])
  assert.equal(waiting.code, 0, waiting.stdout + waiting.stderr)
  const opened = await run(process.execPath, [OPEN, String(waiting.inbox), '--verify'], {
    env: env(),
  })
  const review = opened.stdout.trim().replace(/^REVIEW /, '')
  await writeFile(
    path.join(review, 'choices.json'),
    JSON.stringify({ lenses: {}, remember: false, battle: { a: 'A', b: 'C' } }),
  )
  const ran = await run(
    process.execPath,
    [LENSES, '--review', review, '--plan', String(waiting.planFile), '--replan'],
    { env: env() },
  )
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  const progress = JSON.parse(await readFile(path.join(review, 'lenses.json'), 'utf8'))
  assert.equal(progress.state, 'waiting')
  assert.match(progress.problem, /no lens of group C applies/)
  assert.deepEqual(progress.battle, { a: 'A', b: 'B' })
})

test('a battle that runs its shared lenses twice records each, its prompt naming the ids it adds', async (t) => {
  const dir = await repository(t)
  await recipe(t)
  await writeGroups(dir)
  const waiting = await prepare(dir, ['--battle', 'A,B'])
  const opened = await run(process.execPath, [OPEN, String(waiting.inbox), '--verify'], {
    env: env(),
  })
  const review = opened.stdout.trim().replace(/^REVIEW /, '')
  const battle = { a: 'A', b: 'B', twice: true }
  await writeFile(
    path.join(review, 'choices.json'),
    JSON.stringify({ lenses: {}, remember: false, battle }),
  )
  const ran = await run(
    process.execPath,
    [LENSES, '--review', review, '--plan', String(waiting.planFile), '--start'],
    { env: env() },
  )
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  const envelope = JSON.parse(await readFile(path.join(review, 'review.json'), 'utf8'))
  assert.deepEqual(envelope.battle, {
    ...battle,
    lenses: { 'js-a': 'a', 'js-b': 'b', api: 'a', all: 'b' },
  })
  const lines = ran.stdout
    .split('\n')
    .filter((line) => line.startsWith('LENS '))
    .map((line) => JSON.parse(line.slice('LENS '.length)))
  const prompt = async (/** @type {string} */ name) =>
    readFile(lines.find((one) => one.name === name)?.prompt, 'utf8')
  // Two reviewers of one prompt would add the same ids: each is told its own.
  assert.match(await prompt('js-a'), /number its findings `js-a-1`/)
  assert.match(await prompt('js-b'), /number its findings `js-b-1`/)
  assert.doesNotMatch(await prompt('api'), /This review runs this lens as/)
})
