// lib/settings.mjs: the settings file's validation, its reading and writing,
// and the precedence of the environment over it.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  DEFAULTS,
  SettingsRefusal,
  effectiveSettings,
  expandHome,
  readSettings,
  validateSettings,
  writeSettings,
} from '../skills/tranchant/scripts/lib/settings.mjs'
import { tempDir } from './helpers.mjs'

/** Asserts validateSettings refuses `input` for `reason`. */
const refused = (/** @type {unknown} */ input, /** @type {string | RegExp} */ reason) =>
  assert.throws(
    () => validateSettings(input),
    (error) =>
      error instanceof SettingsRefusal &&
      (typeof reason === 'string'
        ? error.message === reason
        : reason.test(error.message)),
    `${JSON.stringify(input)} should be refused: ${reason}`,
  )

test('validateSettings keeps the keys set, drops null ones, and refuses the rest with the key', () => {
  assert.deepEqual(
    validateSettings({
      version: 1,
      theme: 'dark',
      view: null,
      maxFixAgents: 2,
      recipe: ' ~/recipes/mine.json ',
      disabledLenses: ['tests', 'tests', 'security'],
      postWith: 'gh',
    }),
    {
      theme: 'dark',
      maxFixAgents: 2,
      recipe: '~/recipes/mine.json',
      disabledLenses: ['tests', 'security'],
      postWith: 'gh',
    },
  )
  assert.deepEqual(validateSettings({}), {})
  refused(null, 'the settings are not an object')
  refused('dark', 'the settings are not an object')
  refused({ version: 2 }, 'version: 1 is the only one read')
  refused({ theme: 'sepia' }, 'theme: one of light, dark, system')
  refused({ summary: true }, 'summary: one of open, closed')
  refused({ fixModel: '' }, /^fixModel: a model id/)
  refused({ reviewModel: 'a'.repeat(81) }, /^reviewModel: a model id/)
  refused({ maxReviewAgents: '3' }, 'maxReviewAgents: a whole number from 1 to 8')
  refused({ maxFixAgents: 9 }, 'maxFixAgents: a whole number from 1 to 8')
  refused({ recipe: 'mine.json' }, /^recipe: an absolute path/)
  refused({ recipe: '' }, /^recipe: an absolute path/)
  refused({ disabledLenses: 'tests' }, /^disabledLenses: up to 12 lens names/)
  refused({ disabledLenses: ['a b'] }, /^disabledLenses: up to 12 lens names/)
  refused(
    { disabledLenses: Array.from({ length: 13 }, (_, i) => `l${i}`) },
    /^disabledLenses/,
  )
  refused({ postWith: 'curl' }, 'postWith: one of auto, glab, gh')
  refused({ colour: 'red' }, 'colour: not a setting')
})

test('expandHome reads ~ as the home folder, nothing else', () => {
  assert.equal(expandHome('~/x/recipe.json'), path.join(os.homedir(), 'x/recipe.json'))
  assert.equal(expandHome('~'), os.homedir())
  assert.equal(expandHome('~user/x'), '~user/x')
  assert.equal(expandHome('/abs/x'), '/abs/x')
})

test('readSettings reads none for a missing file, and says why an unreadable one reads as none', async (t) => {
  const dir = await tempDir(t)
  const file = path.join(dir, 'tranchant', 'settings.json')
  assert.deepEqual(await readSettings(file), { settings: {} })
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, '{ not json')
  const notJson = await readSettings(file)
  assert.deepEqual(notJson.settings, {})
  assert.match(notJson.problem ?? '', new RegExp(`^${file} is not JSON: `))
  await writeFile(file, JSON.stringify({ version: 1, maxFixAgents: 42 }))
  assert.deepEqual(await readSettings(file), {
    settings: {},
    problem: `${file}: maxFixAgents: a whole number from 1 to 8`,
  })
  await writeFile(file, JSON.stringify({ version: 1, theme: 'light', postWith: 'glab' }))
  assert.deepEqual(await readSettings(file), {
    settings: { theme: 'light', postWith: 'glab' },
  })
})

test('writeSettings makes the folder, writes the file whole with its version, and refuses what is wrong', async (t) => {
  const dir = await tempDir(t)
  const file = path.join(dir, 'deep', 'tranchant', 'settings.json')
  assert.deepEqual(await writeSettings({ theme: 'dark', view: null }, file), {
    theme: 'dark',
  })
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    version: 1,
    theme: 'dark',
  })
  await assert.rejects(writeSettings({ theme: 'sepia' }, file), SettingsRefusal)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    version: 1,
    theme: 'dark',
  })
  assert.deepEqual(await writeSettings({}, file), {})
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1 })
})

test('effectiveSettings lays the file over the defaults, and the environment over both', () => {
  assert.deepEqual(effectiveSettings({}, {}), { values: DEFAULTS, locked: {} })
  const { values, locked } = effectiveSettings(
    { theme: 'dark', fixModel: 'claude-opus-5-5', maxReviewAgents: 1 },
    { TRANCHANT_MODEL: ' claude-haiku-5-5 ' },
  )
  assert.deepEqual(values, {
    ...DEFAULTS,
    theme: 'dark',
    fixModel: 'claude-haiku-5-5',
    reviewModel: 'claude-haiku-5-5',
    verifyModel: 'claude-haiku-5-5',
    maxReviewAgents: 1,
  })
  assert.deepEqual(locked, {
    fixModel: 'TRANCHANT_MODEL',
    reviewModel: 'TRANCHANT_MODEL',
    verifyModel: 'TRANCHANT_MODEL',
  })
  // A blank variable sets nothing.
  assert.deepEqual(effectiveSettings({ fixModel: 'opus' }, { TRANCHANT_MODEL: ' ' }), {
    values: { ...DEFAULTS, fixModel: 'opus' },
    locked: {},
  })
})
