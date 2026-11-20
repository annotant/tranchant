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
  /** By lens of the recipe, its reviewer's model. */
  lensModels: Record<string, string>
  postWith: PostWith
  /** Whether `/tranchant review` starts its reviewers once the lenses are built. */
  startReview: boolean
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
  /** Every lens that could run on the project: the project's, the global ones, the recipe's. */
  lensSet?: LensSet
  /** The lenses being cleaned, or cleaned and waiting to be added. */
  cleanings?: CleaningEntry[]
  /** Why the file reads as none: not JSON, another version, a wrong value. The server then writes nothing. */
  problem?: string
}

export type RecipeFrom = 'run' | 'local' | 'project' | 'settings' | 'plugin'

/** Where a lens comes from: the project's, every project's, or the recipe in force. */
export type LensScope = 'local' | 'global' | 'recipe'

/** What a cleaning removed from its source and added for Tranchant. */
interface Cleaned {
  at: string
  sourceHash: string
  contextHash?: string
  version?: string
  removed: { what: string; why: string }[]
  added: string[]
}

/** One lens of the set, as Settings › Lenses shows it. */
export interface LensEntry {
  name: string
  scope: LensScope
  on: boolean
  /** It is the one that runs under its name. */
  runs: boolean
  /** It runs in place of a lens of the same name below it. */
  replaces?: boolean
  source: string
  version?: string
  paths: string[]
  otherwise?: boolean
  topics?: string[]
  model?: string
  /** An added lens's. */
  context?: string
  rules?: string
  rulesEdited?: boolean
  cleaned?: Cleaned
  failedCleaning?: { at: string; reason: string }
  /** Its source changed since its last cleaning; `failed` when cleaning it again failed on that source. */
  stale?: 'stale' | 'failed'
  /** Why it cannot be built now, and what fixes it. */
  problem?: string
  fix?: string
}

interface LensSet {
  /** The folders the added lenses live in: every project's, and this one's. */
  dirs: { global: string; local: string }
  lenses: LensEntry[]
}

/** A lens's cleaning: being cleaned, cleaned and waiting to be added, or failed. */
export interface CleaningEntry {
  id: string
  createdAt: string
  name: string
  scope: 'global' | 'local'
  /** It cleans a stored lens again. */
  again: boolean
  source: string
  version?: string
  context?: string
  state: 'cleaning' | 'ready' | 'failed'
  reason?: string
  /** A whole process's reviewers, to add one by one. */
  instead?: string[]
  /** With `ready`: what the agent found, and the lens's domain. */
  report?: {
    paths: string[]
    otherwise?: boolean
    topics?: string[]
    rules: string
    removed: { what: string; why: string }[]
    added: string[]
  }
  domain?: string
}

/** The most agents of a kind the settings allow at a time. */
export const MAX_AGENTS = 8

/** Model ids the page suggests; any id or alias Claude Code takes may be typed. */
export const KNOWN_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

/** Whether `value` is `key`'s default: a list by its content, in any order; a map by its entries. */
function isDefault<K extends SettingKey>(
  key: K,
  value: SettingsValues[K] | null | undefined,
  defaults: SettingsValues,
): boolean {
  if (value === undefined || value === null) return true
  const base = defaults[key]
  if (Array.isArray(value) && Array.isArray(base))
    return value.length === base.length && value.every((one) => base.includes(one))
  if (
    typeof value === 'object' &&
    base &&
    typeof base === 'object' &&
    !Array.isArray(value)
  ) {
    const entries = Object.entries(value)
    return (
      entries.length === Object.keys(base).length &&
      entries.every(([one, model]) => Reflect.get(base, one) === model)
    )
  }
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
