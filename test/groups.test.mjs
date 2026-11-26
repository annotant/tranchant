// The groups of lenses: lib/groups.mjs keeps a project's in its settings
// folder, with its default group, and the global ones in one file every
// project offers; `/tranchant review --group <name>`
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
  groupsFile,
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

/**
 * The project's groups file and the global one, written whole: the global
 * one with none unless `global` names some.
 * @param {string} project
 * @param {{ default?: string, groups: object[] }} groups
 * @param {object[]} [global]
 */
async function writeGroups(project, groups, global = []) {
  const file = groupsFile(project)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ version: 1, ...groups }))
  await writeFile(GROUPS_FILE, JSON.stringify({ version: 1, groups: global }))
}

/** Both groups files removed: no group anywhere. @param {string} project */
const noGroups = (project) =>
  Promise.all([
    rm(GROUPS_FILE, { force: true }),
    rm(groupsFile(project), { force: true }),
  ])

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

const local = (/** @type {string} */ name) => ({
  scope: /** @type {const} */ ('local'),
  name,
})
const global = (/** @type {string} */ name) => ({
  scope: /** @type {const} */ ('global'),
  name,
})

test('a group is made where it is told, saved, renamed, made the default and deleted; its lenses one per name', async (t) => {
  const project = await realpath(await tempDir(t, 'tranchant-project-'))
  await noGroups(project)
  assert.deepEqual((await readGroups(project)).groups, { groups: [] })
  await assert.rejects(
    saveGroup(project, undefined, { name: 'nowhere', lenses: [member('js')] }),
    /scope: local/,
  )
  await saveGroup(project, undefined, {
    name: 'backend',
    scope: 'local',
    lenses: [member('js'), local('money')],
  })
  await assert.rejects(
    saveGroup(project, undefined, {
      name: 'backend',
      scope: 'local',
      lenses: [member('js')],
    }),
    /already named backend/,
  )
  // A global group: no lens of a project, and no name a group of this project has.
  await assert.rejects(
    saveGroup(project, undefined, {
      name: 'shared',
      scope: 'global',
      lenses: [member('js'), local('money')],
    }),
    /global and built-in lenses only, not money/,
  )
  await assert.rejects(
    saveGroup(project, undefined, {
      name: 'backend',
      scope: 'global',
      lenses: [member('js')],
    }),
    /a this project's group is already named backend/,
  )
  await saveGroup(project, undefined, {
    name: 'shared',
    scope: 'global',
    lenses: [member('js'), global('sql')],
  })
  await assert.rejects(
    saveGroup(project, undefined, {
      name: 'shared',
      scope: 'local',
      lenses: [member('js')],
    }),
    /a global group is already named shared/,
  )
  // A group keeps where it was made.
  await assert.rejects(
    saveGroup(project, 'shared', {
      name: 'shared',
      scope: 'local',
      lenses: [member('js')],
    }),
    /keeps where it was made/,
  )
  await assert.rejects(
    saveGroup(project, 'shared', { name: 'shared', lenses: [local('money')] }),
    /global and built-in lenses only/,
  )
  await assert.rejects(
    saveGroup(project, undefined, {
      name: 'twice',
      scope: 'local',
      lenses: [member('js'), local('js')],
    }),
    /one lens per name/,
  )
  await assert.rejects(
    saveGroup(project, undefined, { name: 'empty', scope: 'local', lenses: [] }),
    /at least one/,
  )
  await assert.rejects(
    saveGroup(project, undefined, {
      name: '../x',
      scope: 'local',
      lenses: [member('js')],
    }),
    /letters, digits/,
  )
  await setDefaultGroup(project, 'backend')
  await assert.rejects(setDefaultGroup(project, 'nope'), /no group nope/)
  // Renamed, it stays the default.
  await saveGroup(project, 'backend', { name: 'api', lenses: [member('api')] })
  let { groups } = await readGroups(project)
  assert.deepEqual(groups, {
    default: 'api',
    groups: [
      { name: 'api', scope: 'local', lenses: [member('api')] },
      { name: 'shared', scope: 'global', lenses: [member('js'), global('sql')] },
    ],
  })
  // Deleted, the default is every lens that is on again; its lenses stay where they are.
  await removeGroup(project, 'api')
  ;({ groups } = await readGroups(project))
  assert.deepEqual(groups.default, undefined)
  assert.deepEqual(
    groups.groups.map((group) => group.name),
    ['shared'],
  )
  await assert.rejects(removeGroup(project, 'api'), /no group api/)
  // A file it cannot read is never written over.
  await writeFile(groupsFile(project), '{ not json')
  assert.match((await readGroups(project)).problem ?? '', /is not JSON/)
  await assert.rejects(
    saveGroup(project, undefined, { name: 'a', scope: 'global', lenses: [member('js')] }),
    /the groups are not changed/,
  )
  assert.equal(await readFile(groupsFile(project), 'utf8'), '{ not json')
  // A global file holding a project's lens is not one this Tranchant reads.
  await writeGroups(project, { groups: [] }, [{ name: 'bad', lenses: [local('money')] }])
  assert.match(
    (await readGroups(project)).problem ?? '',
    /global and built-in lenses only/,
  )
})

test('a global lens removed leaves every group here, said until a review runs; renamed or moved, it stays in them', async (t) => {
  const project = await realpath(await tempDir(t, 'tranchant-project-'))
  const money = global('money')
  await writeGroups(
    project,
    {
      groups: [
        { name: 'A', lenses: [member('js'), money] },
        { name: 'C', lenses: [member('api')] },
      ],
    },
    [{ name: 'B', lenses: [money] }],
  )
  // Renamed: the same lens in A and B.
  const cents = global('cents')
  const js = global('js')
  assert.deepEqual(await moveLens(project, money, cents), ['A', 'B'])
  let { groups } = await readGroups(project)
  assert.deepEqual(groups.groups[0]?.lenses, [member('js'), cents])
  // Renamed to the name of another of the group's lenses: that one leaves it, recorded.
  await moveLens(project, cents, js)
  ;({ groups } = await readGroups(project))
  assert.deepEqual(groups.groups[0]?.lenses, [js])
  assert.deepEqual(groups.groups[0]?.removed, [member('js')])
  // Removed: out of every group it was in, the project's and the global ones.
  assert.deepEqual(await forgetLens(project, js), ['A', 'B'])
  ;({ groups } = await readGroups(project))
  assert.deepEqual(
    groups.groups.map((group) => [group.name, group.lenses.length]),
    [
      ['A', 0],
      ['C', 1],
      ['B', 0],
    ],
  )
  assert.deepEqual(groups.groups[0]?.removed, [member('js'), js])
  assert.deepEqual(groups.groups[2]?.removed, [js])
  // A review of A ran and said them: forgotten, those said only.
  await forgetRemoved(project, 'A', [member('js')])
  ;({ groups } = await readGroups(project))
  assert.deepEqual(groups.groups[0]?.removed, [js])
  await forgetRemoved(project, 'B', [js])
  ;({ groups } = await readGroups(project))
  assert.equal(groups.groups[2]?.removed, undefined)
  assert.deepEqual(await forgetLens(project, member('nope')), [])
  // Saving the switches of a review: off leaves, on joins in place of its name's.
  await switchLenses(project, 'C', [
    { member: member('js'), on: true },
    { member: local('api'), on: true },
  ])
  ;({ groups } = await readGroups(project))
  assert.deepEqual(groups.groups[1]?.lenses, [member('js'), local('api')])
  await assert.rejects(
    switchLenses(project, 'C', [
      { member: member('js'), on: false },
      { member: local('api'), on: false },
    ]),
    /no lens left/,
  )
  // A lens of this project turned on does not join a global group; the others' switches are saved.
  await switchLenses(project, 'B', [
    { member: local('api'), on: true },
    { member: member('all'), on: true },
  ])
  ;({ groups } = await readGroups(project))
  assert.deepEqual(groups.groups[2]?.lenses, [member('all')])
  await assert.rejects(switchLenses(project, 'gone', []), /no group gone any more/)
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
  const own = path.join(projectSettingsDir(project), 'lenses', 'js')
  await mkdir(own, { recursive: true })
  await writeFile(path.join(own, 'lens.md'), 'Project JS.\n')
  await writeFile(
    path.join(own, 'lens.json'),
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

test('a global group is offered in every project, each keeping its own default; one of its name hides it', async (t) => {
  const one = await realpath(await tempDir(t, 'tranchant-project-'))
  const two = await realpath(await tempDir(t, 'tranchant-project-'))
  await Promise.all([noGroups(one), noGroups(two)])
  await saveGroup(one, undefined, {
    name: 'shared',
    scope: 'global',
    lenses: [member('js')],
  })
  assert.deepEqual((await readGroups(two)).groups, {
    groups: [{ name: 'shared', scope: 'global', lenses: [member('js')] }],
  })
  await setDefaultGroup(one, 'shared')
  await setDefaultGroup(two, 'shared')
  assert.equal((await readGroups(one)).groups.default, 'shared')
  // Renamed in one, it stays its default; the other's names a group gone, said.
  await saveGroup(one, 'shared', { name: 'both', lenses: [member('js')] })
  assert.equal((await readGroups(one)).groups.default, 'both')
  const other = await readGroups(two)
  assert.equal(other.groups.default, undefined)
  assert.deepEqual(other.notes, [
    'the default group shared is gone: a review runs every lens that is on',
  ])
  await removeGroup(one, 'both')
  assert.equal((await readGroups(one)).groups.default, undefined)
  // A group of this project of a global group's name: the global one is hidden here only.
  await saveGroup(one, undefined, {
    name: 'web',
    scope: 'global',
    lenses: [member('js')],
  })
  await writeFile(
    groupsFile(two),
    JSON.stringify({ version: 1, groups: [{ name: 'web', lenses: [local('money')] }] }),
  )
  const hidden = await readGroups(two)
  assert.deepEqual(
    hidden.groups.groups.map((group) => [group.name, group.scope]),
    [['web', 'local']],
  )
  assert.deepEqual(hidden.notes, [
    "the global group web is hidden here by this project's group of its name: rename one",
  ])
  assert.deepEqual(
    (await readGroups(one)).groups.groups.map((group) => [group.name, group.scope]),
    [['web', 'global']],
  )
  // The project's group that hides it is saved still; made under that name, refused.
  await saveGroup(two, 'web', { name: 'web', lenses: [member('js')] })
  await assert.rejects(
    saveGroup(one, undefined, { name: 'web', scope: 'local', lenses: [member('js')] }),
    /a global group is already named web/,
  )
})

test('a lens of this project: removed or renamed, its groups follow; a global one moved into it leaves the global groups', async (t) => {
  const dir = await repository(t)
  await recipe(t)
  const money = local('money')
  const sql = global('sql')
  await writeGroups(
    dir,
    { groups: [{ name: 'A', lenses: [member('js'), money, sql] }] },
    [{ name: 'G', lenses: [member('js'), sql] }],
  )
  const cents = local('cents')
  assert.deepEqual(await moveLens(dir, money, cents), ['A'])
  assert.deepEqual((await readGroups(dir)).groups.groups[0]?.lenses, [
    member('js'),
    cents,
    sql,
  ])
  assert.deepEqual(await forgetLens(dir, cents), ['A'])
  let { groups } = await readGroups(dir)
  assert.deepEqual(groups.groups[0]?.lenses, [member('js'), sql])
  assert.deepEqual(groups.groups[0]?.removed, [cents])
  // Moved into the project: it follows in the project's groups, leaves the global ones.
  assert.deepEqual(await moveLens(dir, sql, local('sql')), ['A', 'G'])
  ;({ groups } = await readGroups(dir))
  assert.deepEqual(groups.groups[0]?.lenses, [member('js'), local('sql')])
  assert.deepEqual(groups.groups[1]?.lenses, [member('js')])
  assert.deepEqual(groups.groups[1]?.removed, [sql])
  const ran = await prepare(dir, ['--group', 'G'])
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  assert.deepEqual(names(ran.plan), ['js'])
  assert.deepEqual(ran.plan.notes, [
    'lens sql (global) was removed: group G runs without it',
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
  // A lens and the groups the worktree's own path kept, before.
  const folder = path.join(PROJECTS_DIR, hashOf(await realpath(worktree)))
  const before = path.join(folder, 'lenses', 'js')
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
  await writeFile(
    path.join(folder, 'groups.json'),
    JSON.stringify({
      version: 1,
      default: 'mine',
      groups: [{ name: 'mine', lenses: [local('js')] }],
    }),
  )
  // A lens of a name both folders have stays where it is: the home's runs.
  const twin = path.join(path.dirname(before), 'api')
  const home = path.join(projectSettingsDir(dir), 'lenses', 'api')
  for (const one of [twin, home]) {
    await mkdir(one, { recursive: true })
    await writeFile(path.join(one, 'lens.md'), `${one}\n`)
  }
  await noGroups(dir)
  const there = await prepare(worktree)
  assert.equal(there.code, 0, there.stdout + there.stderr)
  assert.equal(there.plan.group, 'mine')
  assert.equal(there.plan.lenses[0].added?.scope, 'local')
  assert.equal(projectSettingsDir(await realpath(worktree)), projectSettingsDir(dir))
  assert.ok(await reads(path.join(projectSettingsDir(dir), 'lenses', 'js', 'lens.json')))
  assert.equal(await reads(path.join(before, 'lens.json')), false)
  // The main worktree reads them too: one folder for the repository.
  assert.equal((await readGroups(dir)).groups.default, 'mine')
  assert.equal(await reads(path.join(folder, 'groups.json')), false)
  assert.equal(await readFile(path.join(twin, 'lens.md'), 'utf8'), `${twin}\n`)
  assert.equal(await readFile(path.join(home, 'lens.md'), 'utf8'), `${home}\n`)
  // A second worktree's own groups, the project's file there already: merged in, a name taken getting -2.
  const third = path.join(await tempDir(t, 'tranchant-worktree-'), 'third')
  const made = await run('git', [
    '-C',
    dir,
    'worktree',
    'add',
    '-q',
    third,
    '-b',
    'third',
  ])
  assert.equal(made.code, 0, made.stderr)
  const real = await realpath(third)
  const oldFile = path.join(PROJECTS_DIR, hashOf(real), 'groups.json')
  await mkdir(path.dirname(oldFile), { recursive: true })
  await writeFile(
    oldFile,
    JSON.stringify({
      version: 1,
      default: 'web',
      groups: [
        { name: 'mine', lenses: [member('api')] },
        { name: 'web', lenses: [member('all')] },
      ],
    }),
  )
  const merged = await readGroups(real)
  assert.deepEqual(
    merged.groups.groups.map((group) => group.name),
    ['mine', 'mine-2', 'web'],
  )
  assert.equal(merged.groups.default, 'mine')
  assert.equal(await reads(oldFile), false)
  assert.ok(await reads(`${oldFile}.moved`))
})
