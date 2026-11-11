// The user's settings: ~/.config/tranchant/settings.json ($XDG_CONFIG_HOME
// when set), one file for every review on the machine, owned by the server
// and read by prepare.mjs, issue.mjs, hook.mjs and the hooks (hooks/register.ts
// reads it on its own, no Node module there). Described in docs/settings.md.
// Precedence: a run's flag (--recipe), then an environment variable, then
// this file, then the default; the recipe has the local and the project's
// between the flag and this file (lib/lens.mjs).
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { errorCode } from './errors.mjs'

/** The settings version this code reads and writes; any other is refused. */
const SETTINGS_VERSION = 1

/** The folder the settings file lies in: `$XDG_CONFIG_HOME/tranchant`, else `~/.config/tranchant`. */
export const SETTINGS_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'tranchant',
)
export const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json')

/** The most agents of a kind the hooks run at a time. */
const MAX_AGENTS = 8

/**
 * @typedef {object} Settings
 * @property {'light' | 'dark' | 'system'} [theme]
 * @property {'diff' | 'list'} [view] The view a review opens in.
 * @property {'open' | 'closed'} [summary] Whether the summary is open when a review opens.
 * @property {string} [fixModel] The model of each fix's agent.
 * @property {string} [reviewModel] The model of each lens's reviewer, the summary agent and a discussing agent.
 * @property {string} [verifyModel] The model of each finding's verifier.
 * @property {number} [maxFixAgents] Fix agents at a time, 1 to MAX_AGENTS.
 * @property {number} [maxReviewAgents] Review agents (reviewers, verifiers, discussers) at a time.
 * @property {string} [recipe] The recipe `/tranchant review` runs without `--recipe`: an absolute path, or `~/…`.
 * @property {string[]} [disabledLenses] The lenses of the recipe not run.
 * @property {'auto' | 'glab' | 'gh'} [postWith] The CLI that opens issues: `auto` reads the remote.
 */

/**
 * The settings in force: every key set, a `null` where nothing is chosen.
 * @typedef {object} Values
 * @property {'light' | 'dark' | 'system'} theme
 * @property {'diff' | 'list'} view
 * @property {'open' | 'closed'} summary
 * @property {string | null} fixModel
 * @property {string | null} reviewModel
 * @property {string | null} verifyModel
 * @property {number} maxFixAgents
 * @property {number} maxReviewAgents
 * @property {string | null} recipe
 * @property {string[]} disabledLenses
 * @property {'auto' | 'glab' | 'gh'} postWith
 */

/** @type {Readonly<Values>} */
export const DEFAULTS = Object.freeze({
  theme: 'system',
  view: 'diff',
  summary: 'open',
  fixModel: null,
  reviewModel: null,
  verifyModel: null,
  maxFixAgents: 3,
  maxReviewAgents: 3,
  recipe: null,
  disabledLenses: [],
  postWith: 'auto',
})

/** A settings file, or a change to it, this Tranchant refuses, and why. */
export class SettingsRefusal extends Error {}

const CHOICES = /** @type {const} */ ({
  theme: ['light', 'dark', 'system'],
  view: ['diff', 'list'],
  summary: ['open', 'closed'],
  postWith: ['auto', 'glab', 'gh'],
})
/** A model id or alias: `claude-opus-5-5`, `opus`, a Bedrock id with dots. */
const MODEL = /^[\w.:-]{1,80}$/
const LENS_NAME = /^[\w-]{1,40}$/
const MAX_LENSES = 12
const MAX_PATH = 1024

/** @param {string} key @returns {key is keyof typeof CHOICES} */
const isChoiceKey = (key) => Object.hasOwn(CHOICES, key)
/** @param {string} key @returns {key is 'fixModel' | 'reviewModel' | 'verifyModel'} */
const isModelKey = (key) =>
  key === 'fixModel' || key === 'reviewModel' || key === 'verifyModel'
/** @param {string} key @returns {key is 'maxFixAgents' | 'maxReviewAgents'} */
const isCapKey = (key) => key === 'maxFixAgents' || key === 'maxReviewAgents'
/** @param {unknown} value @returns {value is string[]} */
const isLensNames = (value) =>
  Array.isArray(value) &&
  value.length <= MAX_LENSES &&
  value.every((one) => typeof one === 'string' && LENS_NAME.test(one))

/** `~` and `~/…` as the user's home: what a person types in the page. */
export const expandHome = (/** @type {string} */ file) =>
  file === '~' || file.startsWith('~/') ? path.join(os.homedir(), file.slice(1)) : file

/**
 * `input` as settings: the keys it sets, each of the right type, nothing
 * else. A `null` leaves a key unset. Throws a SettingsRefusal saying what is
 * wrong, with the key.
 * @param {unknown} input
 * @returns {Settings}
 */
export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SettingsRefusal('the settings are not an object')
  /** @type {Settings} */
  const settings = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue
    if (key === 'version') {
      if (value !== SETTINGS_VERSION)
        throw new SettingsRefusal(`version: ${SETTINGS_VERSION} is the only one read`)
    } else if (isChoiceKey(key)) {
      /** @type {readonly string[]} */
      const choices = CHOICES[key]
      if (typeof value !== 'string' || !choices.includes(value))
        throw new SettingsRefusal(`${key}: one of ${choices.join(', ')}`)
      // One of the key's choices, as checked: the union is what the type says.
      Reflect.set(settings, key, value)
    } else if (isModelKey(key)) {
      if (typeof value !== 'string' || !MODEL.test(value))
        throw new SettingsRefusal(`${key}: a model id, letters, digits, . : - and _`)
      settings[key] = value
    } else if (isCapKey(key)) {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > MAX_AGENTS
      )
        throw new SettingsRefusal(`${key}: a whole number from 1 to ${MAX_AGENTS}`)
      settings[key] = value
    } else if (key === 'recipe') {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > MAX_PATH ||
        !path.isAbsolute(expandHome(value.trim()))
      )
        throw new SettingsRefusal('recipe: an absolute path to a recipe file, or ~/…')
      settings.recipe = value.trim()
    } else if (key === 'disabledLenses') {
      if (!isLensNames(value))
        throw new SettingsRefusal(
          `disabledLenses: up to ${MAX_LENSES} lens names, letters, digits, - and _`,
        )
      settings.disabledLenses = [...new Set(value)]
    } else throw new SettingsRefusal(`${key}: not a setting`)
  }
  return settings
}

/**
 * The settings file as it stands: empty when there is none; empty too, with
 * `problem` saying why, when the file is not one this Tranchant reads (not
 * JSON, another version, a wrong value), which is then never written over.
 * @param {string} [file]
 * @returns {Promise<{ settings: Settings, problem?: string }>}
 */
export async function readSettings(file = SETTINGS_FILE) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { settings: {} }
    return { settings: {}, problem: `${file} cannot be read: ${String(error)}` }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      settings: {},
      problem: `${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  try {
    return { settings: validateSettings(parsed) }
  } catch (error) {
    if (!(error instanceof SettingsRefusal)) throw error
    return { settings: {}, problem: `${file}: ${error.message}` }
  }
}

/**
 * Writes `settings`, validated, as the whole file: a temp file renamed over
 * it, so a reader never sees half of it.
 * @param {unknown} input
 * @param {string} [file]
 * @returns {Promise<Settings>} What was written.
 */
export async function writeSettings(input, file = SETTINGS_FILE) {
  const settings = validateSettings(input)
  await mkdir(path.dirname(file), { recursive: true })
  // A name of its own: two writes at once (two pages) never share a temp file.
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(
      temp,
      `${JSON.stringify({ version: SETTINGS_VERSION, ...settings }, null, 2)}\n`,
    )
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
  return settings
}

/**
 * The settings in force, and the keys an environment variable sets, which
 * the file cannot change: `TRANCHANT_MODEL` names every agent's model.
 * @param {Settings} settings
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ values: Values, locked: Partial<Record<keyof Values, string>> }}
 */
export function effectiveSettings(settings, env = process.env) {
  /** @type {Values} */
  // The list copied: DEFAULTS is frozen one level deep only.
  const values = { ...DEFAULTS, disabledLenses: [], ...settings }
  /** @type {Partial<Record<keyof Values, string>>} */
  const locked = {}
  const model = env.TRANCHANT_MODEL?.trim()
  if (model) {
    for (const key of /** @type {const} */ (['fixModel', 'reviewModel', 'verifyModel'])) {
      values[key] = model
      locked[key] = 'TRANCHANT_MODEL'
    }
  }
  return { values, locked }
}

/**
 * The settings file read and resolved in one call: what every script needs.
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function loadSettings(env = process.env) {
  const { settings, problem } = await readSettings()
  return { ...effectiveSettings(settings, env), settings, problem }
}
