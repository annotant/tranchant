import { type ReactNode, useState } from 'react'
import { type SettingsChange, useAccount } from './api'
import {
  isChanged,
  KNOWN_MODELS,
  MAX_AGENTS,
  type SettingKey,
  type SettingsPayload,
  type SettingsValues,
  withSetting,
} from './settings'

interface Props {
  /** undefined while the settings load, or when the server cannot answer them. */
  settings: SettingsPayload | undefined
  /** The server is unreachable: the values show, nothing changes. */
  offline: boolean
  /** The server answers no settings (an older one): nothing to show. */
  unavailable?: boolean | undefined
  /** The server's last refusal of a change. */
  error?: string | undefined
  onDismiss: () => void
  /** Saves the file as `change` makes it from the file as it stands. */
  onSave: (change: SettingsChange) => void
}

/** A key whose value is a string the person types. */
type TextKey = 'fixModel' | 'reviewModel' | 'verifyModel' | 'recipe'
/** A key whose value is one of a few words, shown as a segment of buttons. */
type ChoiceKey = 'theme' | 'view' | 'summary' | 'postWith'
type CapKey = 'maxFixAgents' | 'maxReviewAgents'

/** Each choice key's values and their labels: a value is one the server accepts. */
const CHOICES: { [K in ChoiceKey]: readonly (readonly [SettingsValues[K], string])[] } = {
  theme: [
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['system', 'System'],
  ],
  view: [
    ['diff', 'Diff'],
    ['list', 'List'],
  ],
  summary: [
    ['open', 'Open'],
    ['closed', 'Closed'],
  ],
  postWith: [
    ['auto', 'From the remote'],
    ['glab', 'glab'],
    ['gh', 'gh'],
  ],
}

const KEYS: readonly SettingKey[] = [
  'theme',
  'view',
  'summary',
  'fixModel',
  'reviewModel',
  'verifyModel',
  'maxFixAgents',
  'maxReviewAgents',
  'recipe',
  'disabledLenses',
  'postWith',
]

const isChoiceKey = (key: SettingKey): key is ChoiceKey => Object.hasOwn(CHOICES, key)

const LABELS: Record<SettingKey, string> = {
  theme: 'Theme',
  view: 'Default view',
  summary: 'Summary at start',
  fixModel: 'Model for fixes',
  reviewModel: 'Model for reviewers',
  verifyModel: 'Model for verifiers',
  maxFixAgents: 'Fix agents at a time',
  maxReviewAgents: 'Review agents at a time',
  recipe: 'Default recipe',
  disabledLenses: 'Lenses',
  postWith: 'Posts with',
}

const HELP: Record<SettingKey, string> = {
  theme: "The page's colors. System follows the operating system.",
  view: 'The view a review opens in. The Diff / List toggle still switches it for the session.',
  summary: 'Whether the summary is open when a review opens.',
  fixModel: 'The agent that changes the working tree, one per finding.',
  reviewModel:
    'One per lens of the recipe; the summary agent and a discussion\u2019s too.',
  verifyModel: 'One per finding, re-reading the code. A cheaper model does well here.',
  maxFixAgents: 'The other fixes wait in the queue.',
  maxReviewAgents: 'Reviewers, verifiers and discussions together.',
  recipe:
    "A file in the recipe's shape, used when a run names none. --recipe on a run still wins.",
  disabledLenses: 'A lens turned off is not run: its findings are not made.',
  postWith:
    'The CLI that opens issues when the remote does not say which forge it is on.',
}

const SESSION_MODEL = "The session's model"
const PLUGIN_RECIPE = "The plugin's (agents/review/recipe.json)"

/** What the default of `key` reads as, under its control. */
function defaultText(key: SettingKey, defaults: SettingsValues, lenses: number): string {
  if (isChoiceKey(key)) {
    const choices: readonly (readonly [string, string])[] = CHOICES[key]
    return choices.find(([value]) => value === defaults[key])?.[1] ?? defaults[key]
  }
  if (key === 'disabledLenses') return lenses ? `all ${lenses}` : 'all'
  if (key === 'recipe') return "the plugin's"
  if (key === 'fixModel' || key === 'reviewModel' || key === 'verifyModel')
    return "the session's"
  return String(defaults[key])
}

const LOCK = (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </g>
  </svg>
)

/**
 * A text or number the person types, kept until Enter or the field loses
 * focus. Mounted anew (its key) when the server's value changes.
 */
function Field({
  id,
  labelledBy,
  type,
  value,
  placeholder,
  list,
  min,
  max,
  disabled,
  onCommit,
}: {
  id: string
  labelledBy: string
  type: 'text' | 'number'
  value: string
  placeholder?: string | undefined
  list?: string | undefined
  min?: number | undefined
  max?: number | undefined
  disabled: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  // Back to the value in force: a change accepted mounts the field anew with the new one.
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim())
    setDraft(value)
  }
  return (
    <input
      id={id}
      type={type}
      className={`tr-input ${type === 'number' ? 'tr-number' : 'tr-text'}`}
      aria-labelledby={labelledBy}
      value={draft}
      placeholder={placeholder}
      list={list}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') setDraft(value)
      }}
    />
  )
}

export function SettingsView({
  settings,
  offline,
  unavailable = false,
  error,
  onDismiss,
  onSave,
}: Props) {
  if (!settings) {
    return (
      <main className="tr-settings" aria-labelledby="tr-settings-title">
        <Head />
        <p className="tr-muted">
          {offline
            ? 'The settings cannot be read while the server is unreachable.'
            : unavailable
              ? 'This server answers no settings: it runs an older Tranchant. /tranchant stop, then open the review again.'
              : 'Loading the settings…'}
        </p>
      </main>
    )
  }
  const { values, defaults, locked, lenses } = settings
  const stored = settings.settings
  // A file this Tranchant cannot read is never written over: read-only until mended.
  const frozen = offline || settings.problem !== undefined
  // From the file as it stands when the save runs: two quick changes both land.
  const set = <K extends SettingKey>(key: K, value: SettingsValues[K] | null) =>
    onSave((current) => withSetting(current, defaults, key, value))
  const lockedKeys = new Set<string>(KEYS.filter((key) => locked[key] !== undefined))
  // What the environment sets, the page cannot show: a reset leaves it as the file has it.
  const resetAll = () =>
    onSave((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => lockedKeys.has(key))),
    )
  const anyChanged = KEYS.some((key) => !locked[key] && isChanged(key, stored, defaults))

  function row(key: SettingKey, control: ReactNode) {
    const lock = locked[key]
    const changed = !lock && isChanged(key, stored, defaults)
    return (
      <div className="tr-setting" key={key}>
        <div>
          <div className="tr-setting-label" id={`tr-setting-${key}`}>
            {LABELS[key]}
          </div>
          <p className="tr-setting-help">{HELP[key]}</p>
        </div>
        <div className="tr-setting-control">
          {control}
          {lock ? (
            <span className="tr-setting-lock">
              {LOCK}
              Set by {lock} in this session: unset it to change it here.
            </span>
          ) : (
            <span className="tr-setting-default">
              Default: {defaultText(key, defaults, lenses.length)}
              {changed && (
                <button
                  type="button"
                  className="tr-btn tr-btn--link"
                  aria-label={`Reset ${LABELS[key]} to its default`}
                  disabled={frozen}
                  onClick={() => set(key, null)}
                >
                  Reset
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    )
  }

  const segment = (key: ChoiceKey) =>
    row(
      key,
      <div className="tr-segment" role="group" aria-labelledby={`tr-setting-${key}`}>
        {CHOICES[key].map(([value, label]) => {
          const pressed = values[key] === value
          return (
            <button
              key={value}
              type="button"
              className={`tr-btn tr-btn--small ${pressed ? 'tr-btn--primary' : ''}`}
              aria-pressed={pressed}
              disabled={frozen || !!locked[key]}
              onClick={() => set(key, value)}
            >
              {label}
            </button>
          )
        })}
      </div>,
    )

  const text = (key: TextKey, placeholder: string, list?: string) =>
    row(
      key,
      <Field
        key={values[key] ?? ''}
        id={`tr-field-${key}`}
        labelledBy={`tr-setting-${key}`}
        type="text"
        value={values[key] ?? ''}
        placeholder={placeholder}
        list={list}
        disabled={frozen || !!locked[key]}
        onCommit={(value) => set(key, value || null)}
      />,
    )

  const cap = (key: CapKey) =>
    row(
      key,
      <Field
        key={values[key]}
        id={`tr-field-${key}`}
        labelledBy={`tr-setting-${key}`}
        type="number"
        value={String(values[key])}
        min={1}
        max={MAX_AGENTS}
        disabled={frozen || !!locked[key]}
        onCommit={(value) => {
          const number = Number(value)
          // Out of range or not a number: the server would refuse it; the field shows the value kept.
          if (Number.isInteger(number) && number >= 1 && number <= MAX_AGENTS)
            set(key, number)
        }}
      />,
    )

  const off = new Set(values.disabledLenses)
  const lensesControl = settings.recipeProblem ? (
    <p className="tr-setting-value tr-error">
      The recipe cannot be read: {settings.recipeProblem}
    </p>
  ) : lenses.length ? (
    <div className="tr-checks" role="group" aria-labelledby="tr-setting-disabledLenses">
      {lenses.map((lens) => (
        <label key={lens}>
          <input
            type="checkbox"
            className="tr-check"
            checked={!off.has(lens)}
            disabled={frozen || !!locked.disabledLenses}
            onChange={(event) =>
              set(
                'disabledLenses',
                event.currentTarget.checked
                  ? values.disabledLenses.filter((one) => one !== lens)
                  : [...values.disabledLenses, lens],
              )
            }
          />
          {lens}
        </label>
      ))}
    </div>
  ) : (
    <p className="tr-setting-value tr-muted">The recipe names no lens.</p>
  )

  return (
    <main className="tr-settings" aria-labelledby="tr-settings-title">
      <Head />
      {settings.problem && (
        <p className="tr-notice" role="alert">
          The settings file cannot be read, so the defaults apply and nothing is written
          until it is mended or removed: {settings.problem}
        </p>
      )}
      {error && (
        <p className="tr-notice" role="status">
          The change was not kept: {error}
          <button type="button" className="tr-btn tr-btn--link" onClick={onDismiss}>
            dismiss
          </button>
        </p>
      )}
      <section className="tr-section" aria-labelledby="tr-settings-display">
        <h3 id="tr-settings-display">Display</h3>
        {segment('theme')}
        {segment('view')}
        {segment('summary')}
      </section>
      <section className="tr-section" aria-labelledby="tr-settings-agents">
        <h3 id="tr-settings-agents">Agents</h3>
        <datalist id="tr-models">
          {KNOWN_MODELS.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        {text('fixModel', SESSION_MODEL, 'tr-models')}
        {text('reviewModel', SESSION_MODEL, 'tr-models')}
        {text('verifyModel', SESSION_MODEL, 'tr-models')}
        {cap('maxFixAgents')}
        {cap('maxReviewAgents')}
      </section>
      <section className="tr-section" aria-labelledby="tr-settings-review">
        <h3 id="tr-settings-review">Review</h3>
        {text('recipe', PLUGIN_RECIPE)}
        {row('disabledLenses', lensesControl)}
      </section>
      <section className="tr-section" aria-labelledby="tr-settings-posting">
        <h3 id="tr-settings-posting">Posting</h3>
        {segment('postWith')}
        <AccountRow key={values.postWith} postWith={values.postWith} />
      </section>
      <div className="tr-settings-foot">
        <button
          type="button"
          className="tr-btn"
          disabled={frozen || !anyChanged}
          onClick={resetAll}
        >
          Reset everything to defaults
        </button>
        <span className="tr-muted">
          {offline
            ? 'Read-only while the server is unreachable: nothing you change here would be kept.'
            : `Kept in ${settings.path}, for every review on this machine.`}
        </span>
      </div>
    </main>
  )
}

/** Who the server posts as, asked again (its key) when the CLI changes. */
function AccountRow({ postWith }: { postWith: SettingsValues['postWith'] }) {
  const account = useAccount(true)
  const tool = account?.tool ?? (postWith === 'auto' ? 'glab' : postWith)
  return (
    <div className="tr-setting">
      <div>
        <div className="tr-setting-label" id="tr-setting-account">
          Posts as
        </div>
        <p className="tr-setting-help">
          The login of that CLI. Change it with glab auth login or gh auth login.
        </p>
      </div>
      <div className="tr-setting-control">
        <span className="tr-setting-value" aria-labelledby="tr-setting-account">
          {account === undefined
            ? 'Asking…'
            : account.username
              ? `${account.username} · ${tool}`
              : `Not logged in, or ${tool} is not installed`}
        </span>
      </div>
    </div>
  )
}

function Head() {
  return (
    <div className="tr-settings-head">
      <a className="tr-btn tr-btn--link tr-settings-back" href="#">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M15 6l-6 6 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back to the review
      </a>
      <h2 id="tr-settings-title">Settings</h2>
      <p className="tr-muted">
        A change applies to the next agent, review or post. Agents already running keep
        the settings they started with.
      </p>
    </div>
  )
}
