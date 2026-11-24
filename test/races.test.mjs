// Several Tranchant instances at once: two sessions, in two worktrees of one
// repository, in two projects or in the same checkout, each run a server and
// scripts that write the files every instance shares. Each test runs two
// processes at once on one of those files and checks no write was lost.
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

const LIB = path.join(SCRIPTS, 'lib')

/**
 * Runs `body` in two Node processes at once, `WHO` 'a' in one and 'b' in the
 * other, after the same instant: started together, they overlap. Each answers
 * what its body printed.
 * @param {Record<string, string>} env
 * @param {string} body An ES module's body; `lib(name)` imports lib/<name>.mjs.
 */
async function twice(env, body) {
  const go = Date.now() + 400
  const source = `
    const lib = (name) => import(${JSON.stringify(`${LIB}/`)} + name + '.mjs')
    const WHO = process.env.WHO
    while (Date.now() < ${go}) {}
    ${body}
  `
  const both = await Promise.all(
    ['a', 'b'].map((who) =>
      run(process.execPath, ['--input-type=module', '-e', source], {
        env: { ...env, WHO: who },
      }),
    ),
  )
  for (const one of both) assert.equal(one.code, 0, one.stderr)
  return both.map((one) => one.stdout.trim())
}

/**
 * A state folder and a settings folder of their own, for each test.
 * @param {any} t
 */
async function folders(t) {
  const state = await tempDir(t)
  const config = await tempDir(t, 'tranchant-config-')
  return {
    state,
    config,
    env: { TRANCHANT_STATE_DIR: state, XDG_CONFIG_HOME: config },
  }
}

test('two servers saving Remember these choices at once keep both choices', async (t) => {
  // The servers of two projects (or two worktrees) write the one settings file.
  const { config, env } = await folders(t)
  const rounds = 20
  await twice(
    env,
    `const { updateSettings } = await lib('settings')
    for (let i = 0; i < ${rounds}; i++)
      await updateSettings((settings) => ({
        ...settings,
        disabledLenses: [...(settings.disabledLenses ?? []), WHO + '-' + i],
      }))`,
  )
  const written = JSON.parse(
    await readFile(path.join(config, 'tranchant', 'settings.json'), 'utf8'),
  )
  assert.equal(written.disabledLenses.length, rounds * 2)
})

/**
 * A global lens, as a cleaning adds it: every project's.
 * @param {string} config
 * @param {string} name
 */
async function globalLens(config, name) {
  const dir = path.join(config, 'tranchant', 'lenses', name)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'lens.json'),
    JSON.stringify({
      version: 1,
      name,
      source: '/team/review.md',
      on: true,
      paths: ['**'],
      rules: '',
      cleaned: {
        at: '2026-11-01T00:00:00.000Z',
        sourceHash: 'abc',
        removed: [],
        added: [],
      },
    }),
  )
  return dir
}

test('two projects changing one global lens at once keep both changes', async (t) => {
  const { config, env } = await folders(t)
  const dir = await globalLens(config, 'shared')
  const one = await tempDir(t, 'tranchant-project-')
  const other = await tempDir(t, 'tranchant-project-')
  // Project a's page picks the lens's model, project b's edits its rules, over and over.
  await twice(
    { ...env, ONE: one, OTHER: other },
    `const { updateUserLens } = await lib('userlens')
    for (let i = 0; i < 25; i++)
      await updateUserLens(
        WHO === 'a' ? process.env.ONE : process.env.OTHER,
        'global',
        'shared',
        WHO === 'a' ? { model: 'model-' + i } : { rules: 'rule ' + i },
      )`,
  )
  const lens = JSON.parse(await readFile(path.join(dir, 'lens.json'), 'utf8'))
  assert.equal(lens.model, 'model-24')
  assert.equal(lens.rules, 'rule 24')
})

/**
 * A cleaning the page queued, waiting for the hooks to start its agent.
 * @param {string} state
 * @param {string} project
 * @param {string} id
 */
async function queuedCleaning(state, project, id) {
  const { hashOf } = await import(path.join(LIB, 'project.mjs'))
  const dir = path.join(state, hashOf(project), 'cleanings', id)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'cleaning.json'),
    JSON.stringify({
      id,
      createdAt: new Date().toISOString(),
      project,
      name: 'abac',
      scope: 'local',
      again: false,
      source: '.claude/agents/abac.md',
      file: path.join(project, '.claude/agents/abac.md'),
      folder: path.join(project, '.claude/agents'),
      sourceHash: 'abc',
      state: 'cleaning',
      queued: true,
    }),
  )
  return dir
}

test('two sessions with the page open start a queued cleaning’s agent once', async (t) => {
  // Same checkout, two sessions: each one's hooks run clean.mjs --start on the CLEAN line.
  const { state, env } = await folders(t)
  const project = await tempDir(t, 'tranchant-project-')
  const ids = Array.from({ length: 8 }, (_, i) => `cln0000${i}-aaaa`)
  for (const id of ids) await queuedCleaning(state, project, id)
  const said = await twice(
    { ...env, PROJECT: project, IDS: ids.join(' ') },
    `const { startedCleaning } = await lib('cleaning')
    const started = []
    for (const id of process.env.IDS.split(' '))
      await startedCleaning(process.env.PROJECT, id).then(
        () => started.push(id),
        (error) => { if (!/started already/.test(error.message)) throw error },
      )
    console.log(started.join(' '))`,
  )
  const started = said.flatMap((line) => (line ? line.split(' ') : []))
  assert.deepEqual(started.toSorted(), ids)
})

test('a cleaning discarded meanwhile is refused, its folder never made again', async (t) => {
  const { state, env } = await folders(t)
  const project = await tempDir(t, 'tranchant-project-')
  const dir = await queuedCleaning(state, project, 'cln0gone-aaaa')
  const said = await twice(
    { ...env, PROJECT: project, DIR: dir },
    `const { checkCleaning } = await lib('cleaning')
    const { rm } = await import('node:fs/promises')
    if (WHO === 'a') await rm(process.env.DIR, { recursive: true, force: true })
    else await new Promise((resolve) => setTimeout(resolve, 100))
    if (WHO === 'b')
      await checkCleaning(process.env.DIR).then(
        () => console.log('checked'),
        (error) => console.log(error.constructor.name + ': ' + error.message),
      )`,
  )
  assert.equal(said[1], 'CleaningRefusal: no cleaning cln0gone-aaaa')
  assert.deepEqual(await readdir(path.dirname(dir)), [])
})
