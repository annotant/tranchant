import { useEffect, useState } from 'react'
import { fetchLensPrompt, type LensRoute, type SettingsChange } from './api'
import { TOPICS } from './domain'
import {
  type CleaningEntry,
  KNOWN_MODELS,
  type LensEntry,
  type LensScope,
  type RecipeFrom,
  type SettingsPayload,
  withSetting,
} from './settings'

interface Props {
  /** undefined while the settings load, or when the server cannot answer them. */
  settings: SettingsPayload | undefined
  /** The server is unreachable: the lenses show, nothing changes. */
  offline: boolean
  error?: string | undefined
  onDismiss: () => void
  /** Saves the settings file: a recipe lens's switch and model live there. */
  onSave: (change: SettingsChange) => void
  /** A change to the lenses the user added; rejects when the server refuses it. */
  onLens: (route: LensRoute, body: Record<string, unknown>) => Promise<unknown>
  /** The lens whose editor opens first, `<scope>:<name>`: a link from a refused review. */
  focus?: string | undefined
}

type Added = 'global' | 'local'

const RECIPE_WORDS: Record<RecipeFrom, string> = {
  run: "This run's recipe",
  local: 'Your local recipe',
  project: "The project's recipe, read at the review's base",
  settings: "The settings' recipe",
  plugin: "Built-in · the plugin's",
}

const SCOPE_HELP: Record<Added, string> = {
  local: 'This project: on this machine only, never in the repository.',
  global: 'Global: it runs on every project on this machine, never in a repository.',
}

/** Whether two lists hold the same texts, in the same order. */
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((one, i) => one === b[i])

/** Globs as the person types them: comma-separated. */
const globsOf = (text: string) =>
  text
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean)

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`

/** Past this many lenses that run, the page warns of their cost: no cap, a warning. */
export const MANY_LENSES = 12

/** Each lens that runs is one reviewer agent: said past MANY_LENSES. */
function ManyLenses({ count, adding }: { count: number; adding?: boolean }) {
  if (count <= MANY_LENSES) return null
  return (
    <p className="tr-notice" role="status">
      {adding
        ? `With this one, ${count} lenses are on for this project.`
        : `${count} lenses are on for this project.`}{' '}
      Each lens is one more reviewer agent on every review: more lenses use more tokens. A
      lens turned off costs nothing.
    </p>
  )
}

/** What a lens's row says of it, in one line: where it runs, its topics, its model. */
function facts(lens: LensEntry) {
  const on = lens.otherwise
    ? 'the files no other lens takes'
    : lens.paths.join(', ') || '**'
  return [
    on,
    lens.topics?.length ? lens.topics.join(', ') : undefined,
    lens.model ?? undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Where a lens stands, in a word or two. */
function standing(lens: LensEntry) {
  if (lens.problem) return { text: 'cannot be built', tone: 'danger' }
  if (lens.stale === 'stale')
    return {
      text: 'source changed · cleaned again by the next review that runs it',
      tone: 'accent',
    }
  if (lens.stale === 'failed')
    return { text: 'cleaning failed · its last version runs', tone: 'warn' }
  if (!lens.on) return { text: 'off', tone: 'muted' }
  if (!lens.runs) return { text: 'replaced', tone: 'muted' }
  return { text: 'runs', tone: 'muted' }
}

export function LensesView({
  settings,
  offline,
  error,
  onDismiss,
  onSave,
  onLens,
  focus,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(focus)
  // The lens the link names, followed when it is renamed: else it reads as one removed.
  const [pointed, setPointed] = useState(focus)
  const listed = settings?.lensSet !== undefined
  // Once the lenses are listed: on a page opened at the link, they load after the mount.
  useEffect(() => {
    const [scope, ...name] = (focus ?? '').split(':')
    if (listed && name.length)
      document
        .getElementById(`tr-lns-${scope}-${name.join(':')}`)
        ?.scrollIntoView?.({ block: 'center' })
  }, [focus, listed])
  if (!settings?.lensSet)
    return (
      <main className="tr-settings tr-settings--wide" aria-labelledby="tr-lenses-title">
        <Head />
        <p className="tr-muted">
          {offline
            ? 'The lenses cannot be read while the server is unreachable.'
            : settings
              ? 'This server answers no lenses: it runs an older Tranchant. /tranchant stop, then open the review again.'
              : 'Loading the lenses…'}
        </p>
      </main>
    )
  const { lensSet, values, defaults } = settings
  const frozen = offline || settings.problem !== undefined
  const cleanings = (settings.cleanings ?? []).filter((one) => !one.again)
  const recleaning = new Set(
    (settings.cleanings ?? [])
      .filter((one) => one.again && one.state === 'cleaning')
      .map((one) => `${one.scope}:${one.name}`),
  )
  const runs = lensSet.lenses.filter((lens) => lens.runs).length
  const groups: { scope: LensScope; title: string; where: string; empty?: string }[] = [
    {
      scope: 'local',
      title: 'This project',
      where: lensSet.dirs.local,
      empty: 'No lens of this project yet: Add a lens, and choose This project.',
    },
    {
      scope: 'global',
      title: 'Global · every project',
      where: lensSet.dirs.global,
      empty: 'No global lens yet.',
    },
    {
      scope: 'recipe',
      title: RECIPE_WORDS[settings.recipeFrom ?? 'plugin'],
      where: settings.recipe,
    },
  ]
  const setRecipe = (name: string, change: { on?: boolean; model?: string | null }) =>
    onSave((stored) => {
      let next = stored
      if (change.on !== undefined) {
        const off = new Set(stored.disabledLenses ?? [])
        if (change.on) off.delete(name)
        else off.add(name)
        next = withSetting(next, defaults, 'disabledLenses', [...off])
      }
      if (change.model !== undefined) {
        const models = { ...stored.lensModels }
        if (change.model) models[name] = change.model
        else delete models[name]
        next = withSetting(next, defaults, 'lensModels', models)
      }
      return next
    })
  return (
    <main className="tr-settings tr-settings--wide" aria-labelledby="tr-lenses-title">
      <Head />
      {pointed !== undefined &&
        !lensSet.lenses.some((lens) => `${lens.scope}:${lens.name}` === pointed) && (
          <p className="tr-notice" role="status">
            The lens {pointed.slice(pointed.indexOf(':') + 1)} is not among these: the
            review ran another recipe, or the lens was removed since.
          </p>
        )}
      {settings.problem && (
        <p className="tr-notice" role="alert">
          The settings file cannot be read, so nothing is written until it is mended or
          removed: {settings.problem}
        </p>
      )}
      {error && (
        <p className="tr-notice" role="alert">
          The change was not kept: {error}
          <button type="button" className="tr-btn tr-btn--link" onClick={onDismiss}>
            dismiss
          </button>
        </p>
      )}
      <section className="tr-section tr-lns" aria-labelledby="tr-lenses-title">
        <div className="tr-lns-intro">
          <p>
            Each lens is one reviewer agent on <code>/tranchant review</code>.{' '}
            {plural(runs, 'lens runs', 'lenses run')} on this project. A lens you add
            stays on this machine: Tranchant never writes it in the repository.
          </p>
          <button
            type="button"
            className="tr-btn tr-btn--primary"
            disabled={frozen || adding}
            onClick={() => setAdding(true)}
          >
            Add a lens
          </button>
        </div>
        <p className="tr-muted tr-lns-note">
          A lens of this project wins over a global one of the same name, which wins over
          the recipe&rsquo;s; turned off, the next one runs.
        </p>
        {!adding && <ManyLenses count={runs} />}
        {settings.recipeProblem && (
          <p className="tr-recipe-problem">
            The recipe cannot be read: {settings.recipeProblem}
          </p>
        )}
        {adding && (
          <AddLens
            frozen={frozen}
            lenses={lensSet.lenses}
            builtIn={lensSet.lenses
              .filter((lens) => lens.scope === 'recipe')
              .map((lens) => lens.name)}
            onCancel={() => setAdding(false)}
            onImport={(body) => onLens('import', body).then(() => setAdding(false))}
          />
        )}
        {cleanings.length > 0 && (
          <ul className="tr-lns-list" aria-label="Lenses being added">
            {cleanings.map((one) => (
              <CleaningCard key={one.id} one={one} frozen={frozen} onLens={onLens} />
            ))}
          </ul>
        )}
        {groups.map((group) => {
          const lenses = lensSet.lenses.filter((lens) => lens.scope === group.scope)
          if (!lenses.length && !group.empty) return null
          return (
            <div className="tr-lns-group" key={group.scope}>
              <div className="tr-lns-group-head">
                <strong id={`tr-lns-${group.scope}`}>{group.title}</strong>
                <code className="tr-muted">{group.where}</code>
              </div>
              {lenses.length ? (
                <ul className="tr-lns-list" aria-labelledby={`tr-lns-${group.scope}`}>
                  {lenses.map((lens) => {
                    const key = `${lens.scope}:${lens.name}`
                    return (
                      <LensRow
                        key={key}
                        lens={lens}
                        frozen={frozen}
                        recleaning={recleaning.has(key)}
                        open={open === key}
                        onOpen={() => setOpen(open === key ? undefined : key)}
                        onMoved={(next) => {
                          setOpen(next)
                          if (pointed !== key) return
                          setPointed(next)
                          history.replaceState(
                            null,
                            '',
                            `#settings/lenses/${encodeURIComponent(next)}`,
                          )
                        }}
                        onSwitch={(on) =>
                          lens.scope === 'recipe'
                            ? setRecipe(lens.name, { on })
                            : void onLens('save', {
                                scope: lens.scope,
                                name: lens.name,
                                lens: { on },
                              }).catch(() => undefined)
                        }
                        onRecipeModel={(model) => setRecipe(lens.name, { model })}
                        onLens={onLens}
                        modelOf={values.lensModels[lens.name]}
                      />
                    )
                  })}
                </ul>
              ) : (
                <p className="tr-muted tr-lns-empty">{group.empty}</p>
              )}
            </div>
          )
        })}
      </section>
    </main>
  )
}

function Head() {
  return (
    <div className="tr-settings-head">
      <a className="tr-btn tr-btn--link tr-settings-back" href="#settings">
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
        Back to the settings
      </a>
      <h2 id="tr-lenses-title">
        Lenses{' '}
        <span
          className="tr-chip tr-chip--warn tr-preview"
          title="Being tested: how it works may change before it is stable."
        >
          Preview
        </span>
      </h2>
    </div>
  )
}

/** A switch: a checkbox a screen reader reads as one. */
function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className="tr-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span aria-hidden="true" />
    </label>
  )
}

function ModelSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string
  value: string
  disabled: boolean
  onChange: (model: string) => void
}) {
  const models =
    value && !KNOWN_MODELS.includes(value) ? [value, ...KNOWN_MODELS] : KNOWN_MODELS
  return (
    <select
      id={id}
      className="tr-input tr-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <option value="">The reviewers&rsquo; (Settings › Agents)</option>
      {models.map((model) => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
    </select>
  )
}

function Topics({
  id,
  chosen,
  disabled,
  onChange,
}: {
  id: string
  chosen: readonly string[]
  disabled: boolean
  onChange: (topics: string[]) => void
}) {
  return (
    <div className="tr-checks" role="group" aria-labelledby={id}>
      {TOPICS.map((topic) => (
        <label key={topic}>
          <input
            type="checkbox"
            className="tr-check"
            checked={chosen.includes(topic)}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.currentTarget.checked
                  ? [...chosen, topic]
                  : chosen.filter((one) => one !== topic),
              )
            }
          />
          {topic}
        </label>
      ))}
    </div>
  )
}

/** One field of a form: its label, its control, its help. */
function Field({
  id,
  label,
  help,
  children,
}: {
  id: string
  label: string
  help?: string | undefined
  children: React.ReactNode
}) {
  return (
    <div className="tr-field">
      <label className="tr-field-label" id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <div className="tr-field-body">
        {children}
        {help && <span className="tr-field-help">{help}</span>}
      </div>
    </div>
  )
}

function ScopeSegment({
  id,
  scope,
  disabled,
  onChange,
}: {
  id: string
  scope: Added
  disabled: boolean
  onChange: (scope: Added) => void
}) {
  return (
    <div className="tr-segment" role="group" aria-labelledby={id} id={`${id}-group`}>
      {(
        [
          ['local', 'This project'],
          ['global', 'Global'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={`tr-btn tr-btn--small ${scope === value ? 'tr-btn--primary' : ''}`}
          aria-pressed={scope === value}
          disabled={disabled}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Add a lens: its source, its name, where it lives, its context skill; then the cleaning agent. */
function AddLens({
  frozen,
  lenses,
  builtIn,
  onCancel,
  onImport,
}: {
  frozen: boolean
  /** The lenses as they stand, this one not among them. */
  lenses: LensEntry[]
  builtIn: string[]
  onCancel: () => void
  onImport: (body: Record<string, unknown>) => Promise<unknown>
}) {
  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [scope, setScope] = useState<Added>('local')
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const replaces = builtIn.includes(name.trim())
  // The first lens that is on runs under a name: the project's, then a global one.
  const named = lenses.filter((lens) => lens.name === name.trim())
  const shadowed =
    scope === 'global' && named.some((lens) => lens.scope === 'local' && lens.on)
  const takesOver = named.some((lens) => lens.runs)
  const runs = lenses.filter((lens) => lens.runs).length
  const after = shadowed || takesOver ? runs : runs + 1
  return (
    <form
      className="tr-lns-add"
      aria-labelledby="tr-lns-add-title"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        onImport({
          source: source.trim(),
          scope,
          ...(name.trim() && { name: name.trim() }),
          ...(context.trim() && { context: context.trim() }),
        })
          .catch(() => undefined)
          .finally(() => setBusy(false))
      }}
    >
      <h3 id="tr-lns-add-title">Add a lens</h3>
      <ManyLenses count={after} adding={after > runs} />
      <Field
        id="tr-lns-add-source"
        label="Source"
        help="A reviewer: a plugin's skill or agent, or a path to a skill, an agent or a checklist. An agent cleans it first: it keeps its review and leaves its orchestration and its output out."
      >
        <input
          id="tr-lns-add-source"
          className="tr-input tr-text"
          value={source}
          placeholder="plugin:name, or a path"
          required
          onChange={(event) => setSource(event.currentTarget.value)}
        />
      </Field>
      <Field
        id="tr-lns-add-name"
        label="Name"
        help={
          replaces
            ? `Replaces the built-in ${name.trim()} where it lives.`
            : 'Optional: absent, one from its source.'
        }
      >
        <input
          id="tr-lns-add-name"
          className="tr-input tr-text"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </Field>
      <div className="tr-field">
        <span className="tr-field-label" id="tr-lns-add-scope">
          Where it lives
        </span>
        <div className="tr-field-body">
          <ScopeSegment
            id="tr-lns-add-scope"
            scope={scope}
            disabled={frozen}
            onChange={setScope}
          />
          <span className="tr-field-help">{SCOPE_HELP[scope]}</span>
        </div>
      </div>
      <Field
        id="tr-lns-add-context"
        label="Context skill"
        help="Optional. Frames the reviewer before its domain: the project's rules, its architecture. Given as data, never loaded as a skill."
      >
        <input
          id="tr-lns-add-context"
          className="tr-input tr-text"
          value={context}
          placeholder="plugin:skill, or a path"
          onChange={(event) => setContext(event.currentTarget.value)}
        />
      </Field>
      <div className="tr-lns-foot">
        <button
          type="submit"
          className="tr-btn tr-btn--primary"
          disabled={frozen || busy || !source.trim()}
        >
          Import and clean
        </button>
        <button type="button" className="tr-btn" onClick={onCancel}>
          Cancel
        </button>
        <span className="tr-muted">
          An agent reads the source and writes the lens; nothing runs until you add it.
        </span>
      </div>
    </form>
  )
}

/** What a cleaning removed from its source and added for Tranchant. */
function Changes({ removed, added }: { removed: Cleaning['removed']; added: string[] }) {
  return (
    <div className="tr-lns-diff">
      <div>
        <h4>Removed from the source</h4>
        {removed.length ? (
          <ul>
            {removed.map((one) => (
              <li key={one.what}>
                <strong>{one.what}</strong> <span className="tr-muted">{one.why}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tr-muted">Nothing.</p>
        )}
      </div>
      <div>
        <h4>Added for Tranchant</h4>
        {added.length ? (
          <ul>
            {added.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ul>
        ) : (
          <p className="tr-muted">Nothing.</p>
        )}
      </div>
    </div>
  )
}

type Cleaning = NonNullable<CleaningEntry['report']>

/** A lens being added: its cleaning at work, its result to check and add, or why it failed. */
function CleaningCard({
  one,
  frozen,
  onLens,
}: {
  one: CleaningEntry
  frozen: boolean
  onLens: Props['onLens']
}) {
  const report = one.report
  const id = `tr-clean-${one.id}`
  const discard = (
    <button
      type="button"
      className="tr-btn tr-btn--danger"
      disabled={frozen}
      onClick={() => void onLens('discard', { id: one.id }).catch(() => undefined)}
    >
      Discard
    </button>
  )
  return (
    <li className="tr-lns-item tr-lns-item--open" aria-labelledby={id}>
      <div className="tr-lns-row">
        {one.state === 'cleaning' ? (
          <span className="tr-spinner" role="img" aria-label="being cleaned" />
        ) : (
          <span aria-hidden="true" />
        )}
        <span className="tr-lns-name" id={id}>
          {one.name}
        </span>
        <span className="tr-lns-meta">
          <code className="tr-lns-source">
            {one.source}
            {one.version && ` ${one.version}`}
          </code>
          <span className="tr-lns-facts">
            {one.scope === 'global' ? 'global' : 'this project'}
          </span>
        </span>
        <span
          className={`tr-lns-state tr-lns-state--${one.state === 'failed' ? 'danger' : 'accent'}`}
        >
          {one.state === 'cleaning'
            ? 'the cleaning agent reads it…'
            : one.state === 'ready'
              ? 'cleaned: check it, then add it'
              : 'cleaning failed'}
        </span>
      </div>
      {one.state === 'failed' && (
        <div className="tr-lns-edit">
          <p className="tr-recipe-problem">{one.reason}</p>
          {one.instead?.length ? (
            <p className="tr-field-help">
              Add one of the reviewers it starts instead:{' '}
              {one.instead.map((source, i) => (
                <span key={source}>
                  {i > 0 && ', '}
                  <code>{source}</code>
                </span>
              ))}
              .
            </p>
          ) : null}
          <div className="tr-lns-foot">{discard}</div>
        </div>
      )}
      {one.state === 'ready' && report && (
        <ReadyForm one={one} report={report} frozen={frozen} onLens={onLens}>
          {discard}
        </ReadyForm>
      )}
    </li>
  )
}

/**
 * A cleaned lens to check, then add: mounted once its report is there, so
 * its fields start from what the agent found.
 */
function ReadyForm({
  one,
  report,
  frozen,
  onLens,
  children,
}: {
  one: CleaningEntry
  report: Cleaning
  frozen: boolean
  onLens: Props['onLens']
  children: React.ReactNode
}) {
  const [paths, setPaths] = useState(report.otherwise ? '' : report.paths.join(', '))
  const [topics, setTopics] = useState<string[]>(report.topics ?? [])
  const [rules, setRules] = useState(report.rules)
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const id = `tr-clean-${one.id}`
  return (
    <form
      className="tr-lns-edit"
      onSubmit={(event) => {
        event.preventDefault()
        setBusy(true)
        void onLens('add', {
          id: one.id,
          lens: {
            ...(paths.trim()
              ? { paths: globsOf(paths) }
              : report.otherwise
                ? { otherwise: true }
                : {}),
            topics,
            rules,
          },
        })
          .catch(() => undefined)
          .finally(() => setBusy(false))
      }}
    >
      <p>
        Check what the agent kept before you add it: the lens becomes a reviewer&rsquo;s
        instructions.
      </p>
      <Changes removed={report.removed} added={report.added} />
      <Field
        id={`${id}-paths`}
        label="Runs on"
        help="Globs, comma-separated, from the repository's root."
      >
        <input
          id={`${id}-paths`}
          className="tr-input tr-text"
          value={paths}
          placeholder={report.otherwise ? 'the files no other lens takes' : '**'}
          onChange={(event) => setPaths(event.currentTarget.value)}
        />
      </Field>
      <div className="tr-field">
        <span className="tr-field-label" id={`${id}-topics`}>
          Files its findings under
        </span>
        <div className="tr-field-body">
          <Topics
            id={`${id}-topics`}
            chosen={topics}
            disabled={frozen}
            onChange={setTopics}
          />
        </div>
      </div>
      <Field
        id={`${id}-rules`}
        label="Added instructions"
        help="Appended to the lens, after its domain: what counts as a finding here, which files it skips, when a finding is auto or for review, what it leaves to another lens. Yours to edit, and kept as they are when its source changes and the lens is cleaned again."
      >
        <textarea
          id={`${id}-rules`}
          className="tr-input tr-textarea"
          rows={5}
          value={rules}
          onChange={(event) => setRules(event.currentTarget.value)}
        />
      </Field>
      <div className="tr-field">
        <span className="tr-field-label">Its domain</span>
        <div className="tr-field-body">
          <button
            type="button"
            className="tr-btn tr-btn--link"
            aria-expanded={shown}
            onClick={() => setShown(!shown)}
          >
            {shown ? 'Hide the lens' : 'Show the lens, whole'}
          </button>
          {shown && <pre className="tr-lns-prompt">{one.domain}</pre>}
        </div>
      </div>
      <div className="tr-lns-foot">
        <button
          type="submit"
          className="tr-btn tr-btn--primary"
          disabled={frozen || busy}
        >
          Add this lens
        </button>
        {children}
      </div>
    </form>
  )
}

function LensRow({
  lens,
  frozen,
  recleaning,
  open,
  onOpen,
  onMoved,
  onSwitch,
  onRecipeModel,
  onLens,
  modelOf,
}: {
  lens: LensEntry
  frozen: boolean
  recleaning: boolean
  open: boolean
  onOpen: () => void
  /** Its save renamed or moved it: its key, `<scope>:<name>`, is now `next`. */
  onMoved: (next: string) => void
  onSwitch: (on: boolean) => void
  onRecipeModel: (model: string | null) => void
  onLens: Props['onLens']
  modelOf: string | undefined
}) {
  const builtIn = lens.scope === 'recipe'
  const state = recleaning
    ? { text: 'being cleaned again…', tone: 'accent' }
    : standing(lens)
  // The name typed in its open editor, shown on the row before it is saved.
  const [draft, setDraft] = useState<string>()
  const name = (open && draft?.trim()) || lens.name
  const id = `tr-lns-${lens.scope}-${lens.name}`
  return (
    <li className={`tr-lns-item${open ? ' tr-lns-item--open' : ''}`}>
      <div className="tr-lns-row">
        <Switch
          label={`${lens.name}: ${lens.on ? 'on' : 'off'}`}
          checked={lens.on}
          disabled={frozen || (!builtIn && !lens.cleaned)}
          onChange={onSwitch}
        />
        <span className="tr-lns-name" id={id}>
          {name}
        </span>
        <span className="tr-lns-meta">
          <code className="tr-lns-source" title="Its source">
            {lens.source}
            {lens.version && ` ${lens.version}`}
          </code>
          {lens.replaces && lens.runs && (
            <span className="tr-chip">replaces the {builtIn ? 'next' : 'built-in'}</span>
          )}
          <span className="tr-lns-facts">{facts(lens)}</span>
        </span>
        <span className={`tr-lns-state tr-lns-state--${state.tone}`}>
          {recleaning && <span className="tr-spinner" aria-hidden="true" />}
          {state.text}
        </span>
        <button
          type="button"
          className="tr-btn tr-btn--small"
          aria-expanded={open}
          aria-controls={`${id}-edit`}
          onClick={() => {
            setDraft(undefined)
            onOpen()
          }}
        >
          {open ? 'Close' : builtIn ? 'View' : 'Edit'}
        </button>
        {lens.problem && (
          <p className="tr-lns-reason">
            {lens.problem}
            {lens.fix && <span className="tr-muted">: {lens.fix}</span>}
          </p>
        )}
        {!lens.problem && lens.stale === 'failed' && lens.failedCleaning && (
          <p className="tr-lns-reason">{lens.failedCleaning.reason}</p>
        )}
      </div>
      {open && (
        <div className="tr-lns-edit" id={`${id}-edit`} role="region" aria-labelledby={id}>
          {builtIn ? (
            <RecipeLens
              lens={lens}
              frozen={frozen}
              model={modelOf}
              onModel={onRecipeModel}
            />
          ) : (
            <AddedLens
              key={lens.cleaned?.at}
              lens={lens}
              frozen={frozen}
              onLens={onLens}
              onName={setDraft}
              onMoved={onMoved}
            />
          )}
        </div>
      )}
    </li>
  )
}

/** The tabs of an open lens: its settings, and the prompt its reviewer reads. */
function Tabs({
  id,
  tab,
  onTab,
}: {
  id: string
  tab: 'settings' | 'reads'
  onTab: (tab: 'settings' | 'reads') => void
}) {
  return (
    <div className="tr-tabs" role="tablist">
      {(
        [
          ['settings', 'Settings'],
          ['reads', 'What the reviewer reads'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          id={`${id}-${value}`}
          className="tr-tab"
          aria-selected={tab === value}
          onClick={() => onTab(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** The prompt a lens's reviewer reads, asked of the server when shown. */
function Reads({ lens }: { lens: LensEntry }) {
  const [prompt, setPrompt] = useState<string>()
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    let live = true
    fetchLensPrompt(lens.scope, lens.name).then(
      (answer) => live && setPrompt(answer.prompt),
      (error: unknown) =>
        live && setProblem(error instanceof Error ? error.message : String(error)),
    )
    return () => {
      live = false
    }
  }, [lens.scope, lens.name])
  return (
    <div className="tr-lns-reads" role="tabpanel">
      {lens.cleaned && (
        <Changes removed={lens.cleaned.removed} added={lens.cleaned.added} />
      )}
      <p className="tr-field-help">
        {lens.scope === 'recipe'
          ? 'Its whole prompt, as the plugin ships it.'
          : "Tranchant's contract, the context skill, the lens's domain as it was cleaned, and its added instructions: what the reviewer is given, whole."}
      </p>
      {problem ? (
        <p className="tr-recipe-problem">It cannot be built: {problem}</p>
      ) : prompt === undefined ? (
        <p className="tr-muted">Building it…</p>
      ) : (
        <pre className="tr-lns-prompt">{prompt}</pre>
      )}
    </div>
  )
}

/** A lens of the recipe: read-only but its switch and its model. */
function RecipeLens({
  lens,
  frozen,
  model,
  onModel,
}: {
  lens: LensEntry
  frozen: boolean
  model: string | undefined
  onModel: (model: string | null) => void
}) {
  const [tab, setTab] = useState<'settings' | 'reads'>('settings')
  const id = `tr-lns-recipe-${lens.name}`
  return (
    <>
      <Tabs id={id} tab={tab} onTab={setTab} />
      {tab === 'reads' ? (
        <Reads lens={lens} />
      ) : (
        <div className="tr-lns-fields" role="tabpanel">
          <p className="tr-field-help">
            A lens of the recipe: its prompt follows each new version of it. Turn it off,
            change its model, or add a lens of the same name to replace it.
          </p>
          <div className="tr-field">
            <span className="tr-field-label">Runs on</span>
            <div className="tr-field-body">
              <code>
                {lens.otherwise ? 'the files no other lens takes' : lens.paths.join(', ')}
              </code>
            </div>
          </div>
          <div className="tr-field">
            <span className="tr-field-label">Files its findings under</span>
            <div className="tr-field-body">
              <span>{lens.topics?.join(', ') ?? 'any topic'}</span>
            </div>
          </div>
          <Field id={`${id}-model`} label="Model">
            <ModelSelect
              id={`${id}-model`}
              value={model ?? ''}
              disabled={frozen}
              onChange={(next) => onModel(next || null)}
            />
          </Field>
        </div>
      )}
    </>
  )
}

/** A lens the user added: every setting editable, saved together. */
function AddedLens({
  lens,
  frozen,
  onLens,
  onName,
  onMoved,
}: {
  lens: LensEntry
  frozen: boolean
  onLens: Props['onLens']
  /** The name as it is typed, for the row to show it. */
  onName: (name: string) => void
  onMoved: (next: string) => void
}) {
  const scope = lens.scope === 'global' ? 'global' : 'local'
  const [tab, setTab] = useState<'settings' | 'reads'>('settings')
  const [name, setName] = useState(lens.name)
  const [where, setWhere] = useState<Added>(scope)
  const [paths, setPaths] = useState(lens.otherwise ? '' : lens.paths.join(', '))
  const [otherwise, setOtherwise] = useState(lens.otherwise === true)
  const [topics, setTopics] = useState<string[]>(lens.topics ?? [])
  const [model, setModel] = useState(lens.model ?? '')
  const [context, setContext] = useState(lens.context ?? '')
  const [rules, setRules] = useState(lens.rules ?? '')
  const [removing, setRemoving] = useState(false)
  const id = `tr-lns-${scope}-${lens.name}`
  const target = { scope, name: lens.name }
  // A form reset by a new cleaning resets the row's name too.
  useEffect(() => onName(name), [name, onName])
  return (
    <>
      <Tabs id={id} tab={tab} onTab={setTab} />
      {tab === 'reads' ? (
        <Reads lens={lens} />
      ) : (
        <form
          className="tr-lns-fields"
          role="tabpanel"
          onSubmit={(event) => {
            event.preventDefault()
            const globs = globsOf(paths).length ? globsOf(paths) : ['**']
            const renamed = `${where}:${name.trim()}`
            // Only what changed: a field left as it was never overwrites a newer cleaning's.
            void onLens('save', {
              ...target,
              lens: {
                ...(name.trim() !== lens.name && { name: name.trim() }),
                ...(where !== scope && { scope: where }),
                ...(otherwise !== (lens.otherwise === true) ||
                (!otherwise && !same(globs, lens.paths))
                  ? otherwise
                    ? { otherwise: true }
                    : { paths: globs }
                  : {}),
                ...(!same(topics, lens.topics ?? []) && { topics }),
                ...(model !== (lens.model ?? '') && { model: model || null }),
                ...(context.trim() !== (lens.context ?? '') && {
                  context: context.trim() || null,
                }),
                ...(rules !== (lens.rules ?? '') && { rules }),
              },
            }).then(
              () => renamed !== `${scope}:${lens.name}` && onMoved(renamed),
              () => undefined,
            )
          }}
        >
          <Field
            id={`${id}-name`}
            label="Name"
            help={`Its findings' ids start with it: ${name.trim() || lens.name}-1, ${name.trim() || lens.name}-2…`}
          >
            <input
              id={`${id}-name`}
              className="tr-input tr-text"
              value={name}
              disabled={frozen}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>
          <div className="tr-field">
            <span className="tr-field-label" id={`${id}-scope`}>
              Where it lives
            </span>
            <div className="tr-field-body">
              <ScopeSegment
                id={`${id}-scope`}
                scope={where}
                disabled={frozen}
                onChange={setWhere}
              />
              <span className="tr-field-help">{SCOPE_HELP[where]}</span>
            </div>
          </div>
          <div className="tr-field">
            <span className="tr-field-label">Source</span>
            <div className="tr-field-body">
              <code>{lens.source}</code>
              {lens.cleaned && (
                <span className="tr-field-help">
                  Cleaned {new Date(lens.cleaned.at).toLocaleString()}. Its source is
                  hashed at each review: a changed source is cleaned again first.
                </span>
              )}
              <button
                type="button"
                className="tr-btn tr-btn--link"
                disabled={frozen}
                onClick={() => void onLens('clean', target).catch(() => undefined)}
              >
                Clean it again now
              </button>
            </div>
          </div>
          <Field
            id={`${id}-paths`}
            label="Runs on"
            help="Globs, comma-separated, from the repository's root. The lens runs when a changed file matches one, and reviews only those files."
          >
            <input
              id={`${id}-paths`}
              className="tr-input tr-text"
              value={otherwise ? '' : paths}
              placeholder="**"
              disabled={frozen || otherwise}
              onChange={(event) => setPaths(event.currentTarget.value)}
            />
            <label className="tr-inline-check">
              <input
                type="checkbox"
                className="tr-check"
                checked={otherwise}
                disabled={frozen}
                onChange={(event) => setOtherwise(event.currentTarget.checked)}
              />
              Only the files no other lens takes
            </label>
          </Field>
          <div className="tr-field">
            <span className="tr-field-label" id={`${id}-topics`}>
              Files its findings under
            </span>
            <div className="tr-field-body">
              <Topics
                id={`${id}-topics`}
                chosen={topics}
                disabled={frozen}
                onChange={setTopics}
              />
              <span className="tr-field-help">None checked: any topic.</span>
            </div>
          </div>
          <Field id={`${id}-model`} label="Model">
            <ModelSelect
              id={`${id}-model`}
              value={model}
              disabled={frozen}
              onChange={setModel}
            />
          </Field>
          <Field
            id={`${id}-context`}
            label="Context skill"
            help="Frames the reviewer before its domain: the project's rules, its architecture. Given as data, never loaded as a skill; its changes clean the lens again too."
          >
            <input
              id={`${id}-context`}
              className="tr-input tr-text"
              value={context}
              placeholder="plugin:skill, or a path"
              disabled={frozen}
              onChange={(event) => setContext(event.currentTarget.value)}
            />
          </Field>
          <Field
            id={`${id}-rules`}
            label="Added instructions"
            help="Appended to the lens, after its domain: what counts as a finding here, which files it skips, when a finding is auto or for review, what it leaves to another lens. Yours to edit, and kept as they are when its source changes and the lens is cleaned again."
          >
            <textarea
              id={`${id}-rules`}
              className="tr-input tr-textarea"
              rows={6}
              value={rules}
              disabled={frozen}
              onChange={(event) => setRules(event.currentTarget.value)}
            />
          </Field>
          <div className="tr-lns-foot">
            <button type="submit" className="tr-btn tr-btn--primary" disabled={frozen}>
              Save
            </button>
            {removing ? (
              <>
                <button
                  type="button"
                  className="tr-btn tr-btn--danger"
                  disabled={frozen}
                  onClick={() => void onLens('remove', target).catch(() => undefined)}
                >
                  Remove {lens.name} for good
                </button>
                <button
                  type="button"
                  className="tr-btn"
                  onClick={() => setRemoving(false)}
                >
                  Keep it
                </button>
              </>
            ) : (
              <button
                type="button"
                className="tr-btn tr-btn--danger"
                disabled={frozen}
                onClick={() => setRemoving(true)}
              >
                Remove the lens
              </button>
            )}
          </div>
        </form>
      )}
    </>
  )
}
