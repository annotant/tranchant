// The settings the page shows and changes: what /api/settings answers
// (lib/settings.mjs is the reference) and what a change to them means.

export type Theme = 'light' | 'dark' | 'system'
export type View = 'diff' | 'list'
type PostWith = 'auto' | 'glab' | 'gh'

/** The settings in force: every key set, `null` where nothing is chosen. */
export interface SettingsValues {
  theme: Theme
  view: View
  summary: 'open' | 'closed'
  fixModel: string | null
  reviewModel: string | null
  verifyModel: string | null
  maxFixAgents: number
  maxReviewAgents: number
  recipe: string | null
  disabledLenses: string[]
  postWith: PostWith
}

export type SettingKey = keyof SettingsValues

/** The settings file as it stands: only the keys it sets. */
export type StoredSettings = Partial<SettingsValues>

/** What `GET /api/settings` (and a `PUT`) answers. */
export interface SettingsPayload {
  /** The settings file. */
  path: string
  settings: StoredSettings
  values: SettingsValues
  defaults: SettingsValues
  /** By key, the environment variable that sets it, which the file cannot change. */
  locked: Partial<Record<SettingKey, string>>
  /** The recipe in force, and its lenses' names; `recipeProblem` when it cannot be read. */
  recipe: string
  lenses: string[]
  recipeProblem?: string
  /** Where the recipe in force comes from: the local recipe, the project's, the settings', the plugin's. */
  recipeFrom?: RecipeFrom
  /** Its lenses, each with its source and, when it cannot be built now, why. */
  recipeLenses?: RecipeLens[]
  /** The recipes `/tranchant import` wrote for this project, not used yet. */
  imports?: ImportedRecipe[]
  /** Why the file reads as none: not JSON, another version, a wrong value. The server then writes nothing. */
  problem?: string
}

export type RecipeFrom = 'run' | 'local' | 'project' | 'settings' | 'plugin'

/** A lens of the recipe in force: its source, and why it cannot be built, when it cannot. */
interface RecipeLens {
  name: string
  source: string
  problem?: string
  fix?: string
}

/** A recipe `/tranchant import` wrote: its lenses and what it left out, shown before it is used. */
export interface ImportedRecipe {
  id: string
  createdAt: string
  source: string
  version?: string
  to: 'project' | 'local'
  target: string
  state: 'importing' | 'ready' | 'failed'
  reason?: string
  extends: boolean
  lenses: { name: string; source: string; skills?: string[]; paths: string[] }[]
  leftOut: { what: string; why: string }[]
}

/** The most agents of a kind the settings allow at a time. */
export const MAX_AGENTS = 8

/** Model ids the page suggests; any id or alias Claude Code takes may be typed. */
export const KNOWN_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

/** Whether `value` is `key`'s default: a list by its content, in any order. */
function isDefault<K extends SettingKey>(
  key: K,
  value: SettingsValues[K] | null | undefined,
  defaults: SettingsValues,
): boolean {
  if (value === undefined || value === null) return true
  const base = defaults[key]
  if (Array.isArray(value) && Array.isArray(base))
    return value.length === base.length && value.every((one) => base.includes(one))
  return value === base
}

/** Whether `stored` sets `key` to something other than its default. */
export const isChanged = (
  key: SettingKey,
  stored: StoredSettings,
  defaults: SettingsValues,
): boolean => !isDefault(key, stored[key], defaults)

/** `stored` with `key` set to `value`, or unset when `value` is its default. */
export function withSetting<K extends SettingKey>(
  stored: StoredSettings,
  defaults: SettingsValues,
  key: K,
  value: SettingsValues[K] | null,
): StoredSettings {
  const next = { ...stored }
  if (isDefault(key, value, defaults) || value === null) delete next[key]
  else next[key] = value
  return next
}
