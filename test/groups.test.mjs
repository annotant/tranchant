// The groups of lenses: lib/groups.mjs keeps them in one file of the
// settings folder, every project's, and each project's default group;
// `/tranchant review --group <name>`
// (prepare.mjs) runs a group's lenses whatever their switches, the default
// group with no --group; lenses.mjs records the group and plans another one
// the page picks.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

// Read once, when lib/settings.mjs loads: set before the groups' module is imported.
const configDir = await mkdtemp(path.join(os.tmpdir(), 'tranchant-config-'))
const stateDir = await mkdtemp(path.join(os.tmpdir(), 'tranchant-state-'))
process.env.XDG_CONFIG_HOME = configDir
after(() =>
  Promise.all([
    rm(configDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]),
)
const {
  GROUPS_FILE,
  forgetLens,
  moveLens,
  readGroups,
  removeGroup,
  saveGroup,
  setDefaultGroup,
  switchLenses,
  forgetRemoved,
} = await import('../skills/tranchant/scripts/lib/groups.mjs')
const { PROJECTS_DIR, projectSettingsDir } =
  await import('../skills/tranchant/scripts/lib/settings.mjs')
const { hashOf } = await import('../skills/tranchant/scripts/lib/project.mjs')

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

/** A recipe of three lenses, `js`, `api` and `all`, every one reading the change, and the settings naming it. @param {import('node:test').TestContext} t */
async function recipe(t, /** @type {object} */ more = {}) {
  const dir = await tempDir(t, 'tranchant-recipe-')
  for (const name of ['js', 'api', 'all'])
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
      ],
    }),
  )
  const settingsFile = path.join(configDir, 'tranchant', 'settings.json')
  await mkdir(path.dirname(settingsFile), { recursive: true })
  await writeFile(settingsFile, JSON.stringify({ version: 1, recipe: file, ...more }))
  t.after(() => rm(settingsFile, { force: true }))
  return file
}

/** The project's key in the groups file: its settings folder's name. @param {string} project */
const keyOf = (project) => path.basename(projectSettingsDir(project))

/**
 * The groups file, written whole; `default`, the project's.
 * @param {string} project
 * @param {{ default?: string, groups: object[] }} groups
 */
async function writeGroups(project, { default: own, ...groups }) {
  await mkdir(path.dirname(GROUPS_FILE), { recursive: true })
  await writeFile(
    GROUPS_FILE,
    JSON.stringify({
      version: 1,
      ...groups,
      ...(own && { defaults: { [keyOf(project)]: own } }),
    }),
  )
}

/** Whether `file` reads: read, not checked, the file being written next. @param {string} file */
const reads = (file) =>
  readFile(file).then(
    () => true,
    () => false,
  )

const member = (/** @type {string} */ name) => ({
  scope: /** @type {const} */ ('recipe'),
  name,
})

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

const rows = (/** @type {any} */ progress) =>
  progress.lenses.map((/** @type {any} */ row) => [row.name, row.off ?? false])

const names = (/** @type {any} */ plan) =>
  plan.lenses.map((/** @type {any} */ lens) => lens.name)

test('a group is saved, renamed, made the default and deleted; its lenses one per name', async (t) => {
  const project = await realpath(await tempDir(t, 'tranchant-project-'))
  await rm(GROUPS_FILE, { force: true })
  assert.deepEqual((await readGroups(project)).groups, { groups: [] })
  await saveGroup(undefined, {
    name: 'backend',
    lenses: [member('js'), { scope: 'local', name: 'money' }],
  })
  await assert.rejects(
    saveGroup(undefined, { name: 'backend', lenses: [member('js')] }),
    /already named backend/,
  )
  await assert.rejects(
    saveGroup(undefined, {
      name: 'twice',
      lenses: [member('js'), { scope: 'local', name: 'js' }],
    }),
    /one lens per name/,
  )
  await assert.rejects(
    saveGroup(undefined, { name: 'empty', lenses: [] }),
    /at least one/,
  )
  await assert.rejects(
    saveGroup(undefined, { name: '../x', lenses: [member('js')] }),
    /letters, digits/,
  )
  await setDefaultGroup(project, 'backend')
  await assert.rejects(setDefaultGroup(project, 'nope'), /no group nope/)
  // Renamed, it stays the default.
  await saveGroup('backend', { name: 'api', lenses: [member('api')] })
  let { groups } = await readGroups(project)
  assert.deepEqual(groups, {
    default: 'api',
    groups: [{ name: 'api', lenses: [member('api')] }],
  })
  // Deleted, the default is every lens that is on again; its lenses stay where they are.
  await removeGroup('api')
  ;({ groups } = await readGroups(project))
  assert.deepEqual(groups, { groups: [] })
  await assert.rejects(removeGroup('api'), /no group api/)
  // A file it cannot read is never written over.
  await writeFile(GROUPS_FILE, '{ not json')
  assert.match((await readGroups(project)).problem ?? '', /is not JSON/)
  await assert.rejects(
    saveGroup(undefined, { name: 'a', lenses: [member('js')] }),
    /the groups are not changed/,
  )
  assert.equal(await readFile(GROUPS_FILE, 'utf8'), '{ not json')
})

test('a lens removed leaves every group, said until a review runs; renamed or moved, it stays in them', async (t) => {
  const project = await realpath(await tempDir(t, 'tranchant-project-'))
  const money = { scope: /** @type {const} */ ('global'), name: 'money' }
  await writeGroups(project, {
    groups: [
      { name: 'A', lenses: [member('js'), money] },
      { name: 'B', lenses: [money] },
      { name: 'C', lenses: [member('api')] },
    ],
  })
  // Renamed: the same lens in A and B.
  const cents = { scope: /** @type {const} */ ('global'), name: 'cents' }
  const js = { scope: /** @type {const} */ ('global'), name: 'js' }
  assert.deepEqual(await moveLens(money, cents), ['A', 'B'])
  let { groups } = await readGroups(project)
  assert.deepEqual(groups.groups[0]?.lenses, [
    member('js'),
    { scope: 'global', name: 'cents' },
  ])
  // Renamed to the name of another of the group's lenses: that one leaves it, recorded.
  await moveLens(cents, js)
  ;({ groups } = await readGroups(project))
  assert.deepEqual(groups.groups[0]?.lenses, [{ scope: 'global', name: 'js' }])
  assert.deepEqual(groups.groups[0]?.removed, [member('js')])
  // Removed: out of every group it was in.
  assert.deepEqual(await forgetLens(js), ['A', 'B'])
  ;({ groups } = await readGroups(project))
  assert.deepEqual(
    groups.groups.map((group) => [group.name, group.lenses.length]),
    [
      ['A', 0],
      ['B', 0],
      ['C', 1],
    ],
  )
  assert.deepEqual(groups.groups[0]?.removed, [member('js'), js])
  // A review of A ran and said them: forgotten, those said only.
  await forgetRemoved('A', [member('js')])
  ;({ groups } = await readGroups(project))
  assert.deepEqual(groups.groups[0]?.removed, [js])
  await forgetRemoved('A', [js])
  ;({ groups } = await readGroups(project))
  assert.equal(groups.groups[0]?.removed, undefined)
  assert.deepEqual(await forgetLens(member('nope')), [])
  // Saving the switches of a review: off leaves, on joins in place of its name's.
  await switchLenses('C', [
    { member: member('js'), on: true },
    { member: { scope: /** @type {const} */ ('local'), name: 'api' }, on: true },
  ])
  ;({ groups } = await readGroups(project))
  assert.deepEqual(groups.groups[2]?.lenses, [
    member('js'),
    { scope: 'local', name: 'api' },
  ])
  await assert.rejects(
    switchLenses('C', [
      { member: member('js'), on: false },
      { member: { scope: /** @type {const} */ ('local'), name: 'api' }, on: false },
    ]),
    /no lens left/,
  )
})

test('--group runs its lenses whatever their switches; two groups sharing a lens both run it', async (t) => {
  const dir = await repository(t)
  await recipe(t, { disabledLenses: ['api'] })
  await writeGroups(dir, {
    groups: [
      { name: 'backend', lenses: [member('js'), member('api')] },
      { name: 'frontend', lenses: [member('js'), member('all')] },
    ],
  })
  const backend = await prepare(dir, ['--group', 'backend'])
  assert.equal(backend.code, 0, backend.stdout + backend.stderr)
  assert.deepEqual(names(backend.plan), ['js', 'api'])
  assert.equal(backend.plan.group, 'backend')
  // Off in the settings, run by the group: said on its lens.
  assert.equal(backend.plan.lenses[1].offInSettings, true)
  const frontend = await prepare(dir, ['--group', 'frontend'])
  assert.equal(frontend.code, 0, frontend.stdout + frontend.stderr)
  assert.deepEqual(names(frontend.plan), ['js', 'all'])
  // No --group, no default: every lens that is on, as before.
  const switches = await prepare(dir)
  assert.equal(switches.code, 0, switches.stdout + switches.stderr)
  assert.deepEqual(names(switches.plan), ['js', 'all'])
  assert.equal(switches.plan.group, undefined)
  // The default group runs with no --group.
  await writeGroups(dir, {
    default: 'backend',
    groups: [{ name: 'backend', lenses: [member('api')] }],
  })
  const byDefault = await prepare(dir)
  assert.equal(byDefault.code, 0, byDefault.stdout + byDefault.stderr)
  assert.deepEqual(names(byDefault.plan), ['api'])
  assert.equal(byDefault.plan.group, 'backend')
  // A group the project has not, or --group with --recipe: refused, saying why.
  const unknown = await prepare(dir, ['--group', 'nope'])
  assert.equal(unknown.code, 2)
  assert.match(unknown.stdout, /^REVIEW_REFUSED no group nope \(Settings.*: backend$/m)
  const both = await prepare(dir, ['--group', 'backend', '--recipe', 'x.json'])
  assert.equal(both.code, 2)
  assert.match(both.stdout, /REVIEW_REFUSED give --recipe or --group, not both/)
  // A groups file it cannot read: the default reads as none, said; --group is refused.
  await writeFile(GROUPS_FILE, '{ not json')
  const unread = await prepare(dir)
  assert.equal(unread.code, 0, unread.stdout + unread.stderr)
  assert.match(unread.stderr, /^groups: .*is not JSON/m)
  assert.deepEqual(names(unread.plan), ['js', 'all'])
  assert.equal((await prepare(dir, ['--group', 'backend'])).code, 2)
})

test("a group's reviews say the lenses removed until one runs, and those gone; the review records its group", async (t) => {
  const dir = await repository(t)
  await recipe(t)
  await writeGroups(dir, {
    groups: [
      {
        name: 'A',
        lenses: [member('js'), member('gone')],
        removed: [{ scope: /** @type {const} */ ('local'), name: 'money' }],
      },
    ],
  })
  const first = await prepare(dir, ['--group', 'A'])
  assert.equal(first.code, 0, first.stdout + first.stderr)
  assert.deepEqual(names(first.plan), ['js'])
  assert.deepEqual(first.plan.notes, [
    "lens money (this project's) was removed: group A runs without it",
    'lens gone (built-in) of group A is gone: not run',
  ])
  assert.match(first.stderr, /^group: lens money \(this project's\) was removed/m)
  // No review of A ran yet: said again.
  const second = await prepare(dir, ['--group', 'A'])
  assert.deepEqual(second.plan.notes, first.plan.notes)
  // Built, the review records the group it ran, and lenses.json names it.
  const opened = await run(process.execPath, [OPEN, String(second.inbox), '--verify'], {
    env: env(),
  })
  const review = opened.stdout.trim().replace(/^REVIEW /, '')
  const ran = await run(
    process.execPath,
    [LENSES, '--review', review, '--plan', String(second.planFile)],
    { env: env() },
  )
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  const envelope = JSON.parse(await readFile(path.join(review, 'review.json'), 'utf8'))
  assert.equal(envelope.status, 'reviewing')
  assert.equal(envelope.group, 'A')
  const progress = JSON.parse(await readFile(path.join(review, 'lenses.json'), 'utf8'))
  assert.equal(progress.group, 'A')
  assert.deepEqual(progress.notes, second.plan.notes)
  // That review ran: the removed lens said, forgotten; the lens gone still said.
  const third = await prepare(dir, ['--group', 'A'])
  assert.deepEqual(third.plan.notes, ['lens gone (built-in) of group A is gone: not run'])
})

test('an emptied group refuses its review with why; a group runs the lens it names, not another of its name', async (t) => {
  const dir = await repository(t)
  await recipe(t)
  // A lens of the project named js, off, beside the recipe's js.
  const project = await realpath(dir)
  const local = path.join(projectSettingsDir(project), 'lenses', 'js')
  await mkdir(local, { recursive: true })
  await writeFile(path.join(local, 'lens.md'), 'Project JS.\n')
  await writeFile(
    path.join(local, 'lens.json'),
    JSON.stringify({
      version: 1,
      name: 'js',
      source: 'js.md',
      on: false,
      paths: ['src/**'],
      rules: '',
      cleaned: { at: '2026-11-18T09:12:00Z', sourceHash: 'x', removed: [], added: [] },
    }),
  )
  await writeGroups(dir, {
    groups: [
      { name: 'builtin', lenses: [member('js')] },
      { name: 'mine', lenses: [{ scope: 'local', name: 'js' }] },
      { name: 'empty', lenses: [], removed: [{ scope: 'local', name: 'money' }] },
    ],
  })
  const builtin = await prepare(dir, ['--group', 'builtin'])
  assert.equal(builtin.code, 0, builtin.stdout + builtin.stderr)
  assert.equal(builtin.plan.lenses[0].added, undefined)
  const mine = await prepare(dir, ['--group', 'mine'])
  assert.equal(mine.code, 0, mine.stdout + mine.stderr)
  assert.equal(mine.plan.lenses[0].added?.scope, 'local')
  assert.equal(mine.plan.lenses[0].offInSettings, true)
  const empty = await prepare(dir, ['--group', 'empty'])
  assert.equal(empty.code, 2)
  assert.match(
    empty.stdout,
    /REVIEW_REFUSED group empty has no lens that can run .*: lens money \(this project's\) was removed/,
  )
})

test('a review waiting to start plans the group the page picks, and every lens that is on again', async (t) => {
  const dir = await repository(t)
  await recipe(t)
  await writeGroups(dir, { groups: [{ name: 'A', lenses: [member('api')] }] })
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
    return JSON.parse(await readFile(path.join(review, 'lenses.json'), 'utf8'))
  }
  const first = await step('--replan', { lenses: {}, remember: false })
  assert.equal(first.group, undefined)
  assert.deepEqual(rows(first), [
    ['js', false],
    ['api', false],
    ['all', false],
  ])
  // Group A picked: its lens on, the others not in it.
  const inA = await step('--replan', { lenses: {}, remember: false, group: 'A' })
  assert.equal(inA.group, 'A')
  assert.deepEqual(rows(inA), [
    ['api', false],
    ['js', true],
    ['all', true],
  ])
  // Back to every lens that is on.
  const back = await step('--replan', { lenses: {}, remember: false, group: null })
  assert.equal(back.group, undefined)
  // A group gone meanwhile: the last plan stands, said.
  const gone = await step('--replan', { lenses: {}, remember: false, group: 'B' })
  assert.match(gone.problem, /no group B/)
  // Started on A, the review records it.
  await step('--replan', { lenses: {}, remember: false, group: 'A' })
  await step('--start', { lenses: {}, remember: false, group: 'A' })
  const envelope = JSON.parse(await readFile(path.join(review, 'review.json'), 'utf8'))
  assert.equal(envelope.group, 'A')
  assert.deepEqual(
    envelope.lenses.map((/** @type {any} */ lens) => lens.name),
    ['api'],
  )
})

test('a waiting review of the default group starts on it when the page picked no group', async (t) => {
  const dir = await repository(t)
  await recipe(t)
  await writeGroups(dir, {
    default: 'A',
    groups: [{ name: 'A', lenses: [member('api')] }],
  })
  const waiting = await prepare(dir, ['--no-start'])
  assert.equal(waiting.code, 0, waiting.stdout + waiting.stderr)
  assert.equal(waiting.plan.group, 'A')
  const opened = await run(process.execPath, [OPEN, String(waiting.inbox), '--verify'], {
    env: env(),
  })
  const review = opened.stdout.trim().replace(/^REVIEW /, '')
  await writeFile(
    path.join(review, 'choices.json'),
    JSON.stringify({ lenses: {}, remember: false }),
  )
  const ran = await run(
    process.execPath,
    [LENSES, '--review', review, '--plan', String(waiting.planFile), '--start'],
    { env: env() },
  )
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  const envelope = JSON.parse(await readFile(path.join(review, 'review.json'), 'utf8'))
  assert.equal(envelope.group, 'A')
  assert.deepEqual(
    envelope.lenses.map((/** @type {any} */ lens) => lens.name),
    ['api'],
  )
})

test('a group made in one project is offered in another; each project keeps its own default', async (t) => {
  const one = await realpath(await tempDir(t, 'tranchant-project-'))
  const two = await realpath(await tempDir(t, 'tranchant-project-'))
  await rm(GROUPS_FILE, { force: true })
  await saveGroup(undefined, { name: 'shared', lenses: [member('js')] })
  assert.deepEqual((await readGroups(two)).groups, {
    groups: [{ name: 'shared', lenses: [member('js')] }],
  })
  await setDefaultGroup(one, 'shared')
  assert.equal((await readGroups(one)).groups.default, 'shared')
  assert.equal((await readGroups(two)).groups.default, undefined)
  // Renamed, it stays the default where it was; deleted, it is no project's.
  await saveGroup('shared', { name: 'both', lenses: [member('js')] })
  assert.equal((await readGroups(one)).groups.default, 'both')
  await removeGroup('both')
  assert.equal((await readGroups(one)).groups.default, undefined)
})

test("a project's lens removed stays in the groups; a project without it runs the group without it, said", async (t) => {
  const dir = await repository(t)
  await recipe(t)
  const money = { scope: /** @type {const} */ ('local'), name: 'money' }
  await writeGroups(dir, { groups: [{ name: 'A', lenses: [member('js'), money] }] })
  assert.deepEqual(await forgetLens(money), [])
  assert.deepEqual((await readGroups(dir)).groups.groups[0]?.lenses, [
    member('js'),
    money,
  ])
  const ran = await prepare(dir, ['--group', 'A'])
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  assert.deepEqual(names(ran.plan), ['js'])
  assert.deepEqual(ran.plan.notes, [
    "lens money (a project's) of group A is not among this project's lenses: not run",
  ])
  // Renamed here, it joins the groups beside its old name, another project's maybe; moved under its name, it takes its place.
  const cents = { scope: /** @type {const} */ ('local'), name: 'cents' }
  assert.deepEqual(await moveLens(money, cents), ['A'])
  assert.deepEqual((await readGroups(dir)).groups.groups[0]?.lenses, [
    member('js'),
    money,
    cents,
  ])
  await moveLens(cents, { scope: 'global', name: 'cents' })
  assert.deepEqual((await readGroups(dir)).groups.groups[0]?.lenses, [
    member('js'),
    money,
    { scope: 'global', name: 'cents' },
  ])
})

test('another worktree of the repository has its groups, its default and its lenses, those of its own path moved in', async (t) => {
  const dir = await repository(t)
  await recipe(t)
  const worktree = path.join(await tempDir(t, 'tranchant-worktree-'), 'other')
  const added = await run('git', [
    '-C',
    dir,
    'worktree',
    'add',
    '-q',
    worktree,
    '-b',
    'other',
  ])
  assert.equal(added.code, 0, added.stderr)
  // A lens the worktree's own path kept, before.
  const before = path.join(PROJECTS_DIR, hashOf(await realpath(worktree)), 'lenses', 'js')
  await mkdir(before, { recursive: true })
  await writeFile(path.join(before, 'lens.md'), 'Project JS.\n')
  await writeFile(
    path.join(before, 'lens.json'),
    JSON.stringify({
      version: 1,
      name: 'js',
      source: 'js.md',
      on: true,
      paths: ['src/**'],
      rules: '',
      cleaned: { at: '2026-11-18T09:12:00Z', sourceHash: 'x', removed: [], added: [] },
    }),
  )
  // A lens of a name both folders have stays where it is: the home's runs.
  const twin = path.join(path.dirname(before), 'api')
  const home = path.join(projectSettingsDir(dir), 'lenses', 'api')
  for (const folder of [twin, home]) {
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, 'lens.md'), `${folder}\n`)
  }
  await writeGroups(dir, {
    default: 'mine',
    groups: [{ name: 'mine', lenses: [{ scope: 'local', name: 'js' }] }],
  })
  const there = await prepare(worktree)
  assert.equal(there.code, 0, there.stdout + there.stderr)
  assert.equal(there.plan.group, 'mine')
  assert.equal(there.plan.lenses[0].added?.scope, 'local')
  assert.equal(projectSettingsDir(await realpath(worktree)), projectSettingsDir(dir))
  assert.ok(await reads(path.join(projectSettingsDir(dir), 'lenses', 'js', 'lens.json')))
  assert.equal(await reads(path.join(before, 'lens.json')), false)
  assert.equal(await readFile(path.join(twin, 'lens.md'), 'utf8'), `${twin}\n`)
  assert.equal(await readFile(path.join(home, 'lens.md'), 'utf8'), `${home}\n`)
})

test('the groups of each project folder move into the groups file, merged by name, their defaults kept', async (t) => {
  const project = await realpath(await tempDir(t, 'tranchant-project-'))
  await rm(GROUPS_FILE, { force: true })
  await rm(PROJECTS_DIR, { recursive: true, force: true })
  const old = async (/** @type {string} */ key, /** @type {string} */ text) => {
    await mkdir(path.join(PROJECTS_DIR, key), { recursive: true })
    await writeFile(path.join(PROJECTS_DIR, key, 'groups.json'), text)
    return path.join(PROJECTS_DIR, key, 'groups.json')
  }
  const first = await old(
    'aaaaaaaaaaaa',
    JSON.stringify({
      version: 1,
      default: 'A',
      groups: [{ name: 'A', lenses: [member('js')] }],
    }),
  )
  const second = await old(
    'bbbbbbbbbbbb',
    JSON.stringify({
      version: 1,
      default: 'A',
      groups: [
        { name: 'A', lenses: [member('api')] },
        { name: 'B', lenses: [member('all')] },
      ],
    }),
  )
  const broken = await old('cccccccccccc', '{ not json')
  const read = await readGroups(project)
  assert.deepEqual(
    read.groups.groups.map((group) => [group.name, group.lenses[0]?.name]),
    [
      ['A', 'js'],
      ['A-2', 'api'],
      ['B', 'all'],
    ],
  )
  assert.deepEqual(read.moving, [`${broken} is not moved into ${GROUPS_FILE}: not JSON`])
  const stored = JSON.parse(await readFile(GROUPS_FILE, 'utf8'))
  assert.deepEqual(stored.defaults, { aaaaaaaaaaaa: 'A', bbbbbbbbbbbb: 'A-2' })
  assert.equal(await reads(first), false)
  assert.ok(await reads(`${second}.moved`))
  // Moved again, as after a crash before the rename: nothing added twice.
  await writeFile(first, await readFile(`${first}.moved`, 'utf8'))
  assert.equal((await readGroups(project)).groups.groups.length, 3)
  // A groups file it cannot read: nothing moved nor renamed, said.
  await writeFile(GROUPS_FILE, '{ not json')
  await writeFile(first, await readFile(`${first}.moved`, 'utf8'))
  const unread = await readGroups(project)
  assert.match(unread.problem ?? '', /is not JSON/)
  assert.match(unread.moving?.[0] ?? '', /once it is mended or removed/)
  assert.equal(await readFile(GROUPS_FILE, 'utf8'), '{ not json')
  assert.ok(await reads(first))
  // Merged past the most groups a file holds: refused whole, the folders' files left.
  const many = Array.from({ length: 101 }, (_, i) => ({
    name: `g${i}`,
    lenses: [member('js')],
  }))
  await rm(GROUPS_FILE, { force: true })
  await writeFile(first, JSON.stringify({ version: 1, groups: many.slice(0, 60) }))
  await writeFile(second, JSON.stringify({ version: 1, groups: many.slice(60) }))
  await rm(broken, { force: true })
  const full = await readGroups(project)
  assert.match(
    full.moving?.[0] ?? '',
    /stay where they are, merged they are refused: groups: a list of 100/,
  )
  assert.ok((await reads(first)) && (await reads(second)))
  assert.equal(await reads(GROUPS_FILE), false)
})
