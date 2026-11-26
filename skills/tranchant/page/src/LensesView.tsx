import { useEffect, useState } from 'react'
import {
  fetchLensPrompt,
  type LensDone,
  type LensMatch,
  type LensRoute,
  type SettingsChange,
} from './api'
import { TOPICS } from './domain'
import { GroupsTab, groupsOf } from './LensGroups'
import {
  GlobMatches,
  InsideMatches,
  MAX_BATCH,
  InsideUnread,
  MatchList,
  MatchesHead,
  ReadingSource,
  isGlob,
  nameProblem,
  noteRows,
  PickedMatches,
  shortName,
  useGlob,
  useInside,
  usePick,
} from './LensGlob'
import { alreadyText, type Picked, SourcePicker } from './SourcePicker'
import {
  AUTO_MODEL,
  type CleaningEntry,
  type Detected,
  type GroupsPayload,
  KNOWN_MODELS,
  type LensEntry,
  type LensScope,
  type RecipeFrom,
  type SettingsPayload,
  withSetting,
} from './settings'
import { lensHistoryOf } from './tokens'

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
  onLens: (route: LensRoute, body: Record<string, unknown>) => Promise<LensDone>
  /**
   * The lens whose editor opens first, `<scope>:<name>`: a link from a
   * refused review; `groups` opens the Groups tab, `group:<name>` that
   * group's editor.
   */
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

const SCOPE_HELP_MANY: Record<Added, string> = {
  local: 'This project: on this machine only, never in the repository.',
  global: 'Global: they run on every project on this machine, never in a repository.',
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

/** Settings › Lenses with this lens's editor open: the key LensesView gives it. */
export const lensHref = (row: { name: string; scope?: LensScope | undefined }) =>
  `#settings/lenses/${encodeURIComponent(`${row.scope ?? 'recipe'}:${row.name}`)}`

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

/** Where a lens comes from: the recipe's, or one added from an agent, a skill or a command, or from another file. */
type Origin = 'built-in' | NonNullable<LensEntry['origin']>

const ORIGINS: { value: Origin | undefined; label: string; help: string }[] = [
  { value: undefined, label: 'All', help: 'Every lens' },
  { value: 'built-in', label: 'Built-in', help: "The recipe's lenses" },
  {
    value: 'picked',
    label: 'Picked up',
    help: "Added from an existing agent, skill or command: a plugin's, or a file in an agents or commands folder, or a skill's",
  },
  {
    value: 'custom',
    label: 'Custom',
    help: 'Added from any other file: a checklist written for Tranchant',
  },
]

/** Undefined for an added lens that cannot be read. */
const originOf = (lens: LensEntry): Origin | undefined =>
  lens.scope === 'recipe' ? 'built-in' : lens.origin

/** What a lens's row says of where it comes from. */
function originText(lens: LensEntry) {
  switch (originOf(lens)) {
    case 'built-in':
      return 'built-in'
    case 'picked':
      return lens.sourceKind ? `picked up · ${lens.sourceKind}` : 'picked up'
    case 'custom':
      return 'custom · checklist'
    default:
      return undefined
  }
}

interface Filter {
  name: string
  origin: Origin | undefined
  kind: string
  /** A group's name: its lenses only. */
  group: string
}

const NO_FILTER: Filter = { name: '', origin: undefined, kind: '', group: '' }

const isFiltering = (filter: Filter) =>
  Boolean(filter.name.trim() || filter.origin || filter.kind || filter.group)

function matches(lens: LensEntry, filter: Filter, groups: GroupsPayload | undefined) {
  const name = filter.name.trim().toLowerCase()
  return (
    (!name || lens.name.toLowerCase().includes(name)) &&
    (!filter.origin || originOf(lens) === filter.origin) &&
    // A lens that declares no topic files its findings under any.
    (!filter.kind || !lens.topics?.length || lens.topics.includes(filter.kind)) &&
    (!filter.group || groupsOf(groups?.list ?? [], lens).includes(filter.group))
  )
}

/** The filters set, in a line: name "co" · built-in · Bugs · in frontend. */
function filterWords(filter: Filter) {
  return [
    filter.name.trim() && `name “${filter.name.trim()}”`,
    filter.origin &&
      ORIGINS.find((one) => one.value === filter.origin)?.label.toLowerCase(),
    filter.kind,
    filter.group && `in ${filter.group}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** What a lens's row says of it, in one line: where it runs, its topics. */
function facts(lens: LensEntry) {
  const on = lens.otherwise
    ? 'the files no other lens takes'
    : lens.paths.join(', ') || '**'
  return [on, lens.topics?.length ? lens.topics.join(', ') : undefined]
    .filter(Boolean)
    .join(' · ')
}

/** The reviewers' model (Settings › Agents), and TRANCHANT_MODEL's when it is set. */
interface Models {
  review: string | null
  forced: string | undefined
}

const SESSION_MODEL = "the session's model"

/** The model a review would run a lens's reviewer on, and whether its source asks for one it cannot run. */
function modelFact(lens: LensEntry, models: Models) {
  if (models.forced) return { text: `TRANCHANT_MODEL · ${models.forced}`, warn: false }
  if (lens.model === AUTO_MODEL)
    return {
      text: `auto · ${lens.detected?.why === 'source' ? lens.detected.id : SESSION_MODEL}`,
      warn: lens.detected?.why === 'foreign' || lens.detected?.why === 'unreadable',
    }
  if (lens.model) return { text: lens.model, warn: false }
  return { text: `reviewers' · ${models.review ?? SESSION_MODEL}`, warn: false }
}

/** What a model choice resolves to, and why, in one line beside its select. */
function resolvesTo(value: string, detected: Detected | undefined, models: Models) {
  if (models.forced)
    return {
      text: `TRANCHANT_MODEL is set: every reviewer runs on ${models.forced}, whatever this says.`,
      warn: false,
    }
  if (value === AUTO_MODEL) {
    if (!detected)
      return { text: `→ its source's model, else ${SESSION_MODEL}`, warn: false }
    const { file } = detected
    switch (detected.why) {
      case 'source':
        return {
          text: `→ ${file} asks for model: ${detected.asked} → ${detected.id}`,
          warn: false,
        }
      case 'inherit':
        return { text: `→ ${file} says model: inherit → ${SESSION_MODEL}`, warn: false }
      case 'foreign':
        return {
          text: `→ ${file} asks for model: ${detected.asked}, not a Claude model → ${SESSION_MODEL}`,
          warn: true,
        }
      case 'unreadable':
        return {
          text: `→ ${file}'s frontmatter cannot be read (${detected.problem}) → ${SESSION_MODEL}`,
          warn: true,
        }
      case 'none':
        return { text: `→ ${file} names no model → ${SESSION_MODEL}`, warn: false }
    }
  }
  if (!value)
    return { text: `→ Settings › Agents: ${models.review ?? SESSION_MODEL}`, warn: false }
  return undefined
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
  // The matches of a glob the server did not clean, with why: the others are under way.
  const [refused, setRefused] = useState<NonNullable<LensDone['refused']>>([])
  const toGroups = focus === 'groups' || focus?.startsWith('group:') === true
  const [tab, setTab] = useState<'lenses' | 'groups'>(toGroups ? 'groups' : 'lenses')
  // The group whose editor a chip opens; GroupsTab starts again on it.
  const [groupFocus, setGroupFocus] = useState(
    focus?.startsWith('group:') ? focus.slice('group:'.length) : undefined,
  )
  const [open, setOpen] = useState(toGroups ? undefined : focus)
  // The lens the link names, followed when it is renamed or moved: else it reads as one removed.
  const [pointed, setPointed] = useState(toGroups ? undefined : focus)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  // A lens removed: the groups it left, said once.
  const [left, setLeft] = useState('')
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
  const { lensSet, values, defaults, groups } = settings
  const models: Models = {
    review: values.reviewModel,
    forced: settings.locked.reviewModel ? (values.reviewModel ?? undefined) : undefined,
  }
  const groupList = groups?.list ?? []
  const frozen = offline || settings.problem !== undefined
  const cleanings = (settings.cleanings ?? []).filter((one) => !one.again)
  const recleaning = new Set(
    (settings.cleanings ?? [])
      .filter((one) => one.again && one.state === 'cleaning')
      .map((one) => `${one.scope}:${one.name}`),
  )
  const runs = lensSet.lenses.filter((lens) => lens.runs).length
  const filtering = isFiltering(filter)
  const matched = lensSet.lenses.filter((lens) => matches(lens, filter, groups))
  // The lens being edited stays shown, never counted: hidden, its editor would drop what is typed.
  const shown = lensSet.lenses.filter(
    (lens) => matched.includes(lens) || `${lens.scope}:${lens.name}` === open,
  )
  const sections: { scope: LensScope; title: string; where: string; empty?: string }[] = [
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
        const byLens = { ...stored.lensModels }
        if (change.model) byLens[name] = change.model
        else delete byLens[name]
        next = withSetting(next, defaults, 'lensModels', byLens)
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
      {groups && (
        <div
          className="tr-tabs tr-lns-tabs"
          role="tablist"
          aria-label="Lenses and groups"
        >
          {(
            [
              ['lenses', 'Lenses', lensSet.lenses.length],
              ['groups', 'Groups', groupList.length],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              className="tr-tab"
              aria-selected={tab === value}
              onClick={() => {
                setTab(value)
                setGroupFocus(undefined)
              }}
            >
              {label}
              <span className="tr-tab-count">{count}</span>
            </button>
          ))}
        </div>
      )}
      {groups && tab === 'groups' && (
        <GroupsTab
          key={groupFocus ?? ''}
          lenses={lensSet.lenses}
          groups={groups}
          frozen={frozen}
          titles={{
            local: 'This project',
            global: 'Global',
            recipe: 'Built-in',
          }}
          originText={originText}
          onLens={onLens}
          focus={groupFocus}
        />
      )}
      {(!groups || tab === 'lenses') && (
        <section
          className="tr-section tr-lns"
          aria-labelledby="tr-lenses-title"
          {...(groups && { role: 'tabpanel' })}
        >
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
            A lens of this project wins over a global one of the same name, which wins
            over the recipe&rsquo;s; turned off, the next one runs.
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
              cap={values.maxReviewAgents}
              builtIn={lensSet.lenses
                .filter((lens) => lens.scope === 'recipe')
                .map((lens) => lens.name)}
              onCancel={() => setAdding(false)}
              onImport={async (body) => {
                const done = await onLens('import', body)
                setAdding(false)
                setRefused(done.refused ?? [])
              }}
            />
          )}
          {refused.length > 0 && (
            <div className="tr-notice" role="status">
              <p>
                {refused.length === 1
                  ? 'One match was not added:'
                  : `${refused.length} matches were not added:`}
              </p>
              <ul>
                {refused.map((one) => (
                  <li key={one.source}>
                    <code>{one.source}</code>: {one.reason}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="tr-btn tr-btn--link"
                onClick={() => setRefused([])}
              >
                dismiss
              </button>
            </div>
          )}
          {cleanings.length > 0 && (
            <BeingAdded
              cleanings={cleanings}
              lenses={lensSet.lenses}
              frozen={frozen}
              cap={values.maxReviewAgents}
              onLens={onLens}
              onRefused={setRefused}
            />
          )}
          {left && (
            <p className="tr-notice" role="status">
              {left}
              <button
                type="button"
                className="tr-btn tr-btn--link"
                onClick={() => setLeft('')}
              >
                dismiss
              </button>
            </p>
          )}
          <LensFilter
            filter={filter}
            shown={matched.length}
            total={lensSet.lenses.length}
            groups={groupList.map((group) => group.name)}
            onChange={setFilter}
          />
          {filtering && !matched.length && (
            <p className="tr-lns-empty">
              No lens matches {filterWords(filter)}.{' '}
              <button
                type="button"
                className="tr-btn tr-btn--link"
                onClick={() => setFilter(NO_FILTER)}
              >
                Clear the filters
              </button>
            </p>
          )}
          {sections.map((group) => {
            const all = lensSet.lenses.filter((lens) => lens.scope === group.scope)
            const lenses = shown.filter((lens) => lens.scope === group.scope)
            // While filtering, a group with no match hides, even one that says it is empty.
            if (filtering ? !lenses.length : !lenses.length && !group.empty) return null
            return (
              <div className="tr-lns-group" key={group.scope}>
                <div className="tr-lns-group-head">
                  <strong id={`tr-lns-${group.scope}`}>{group.title}</strong>
                  <code className="tr-muted">{group.where}</code>
                  {filtering && (
                    <span className="tr-lns-group-count">
                      {matched.filter((lens) => lens.scope === group.scope).length} of{' '}
                      {all.length}
                    </span>
                  )}
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
                          onMoved={(to) => {
                            const next = `${to.scope}:${to.name}`
                            // The save answers late: another lens opened since stays open.
                            setOpen((now) => (now === key ? next : now))
                            if (pointed !== key) return
                            setPointed(next)
                            // A page left since keeps its own link.
                            if (location.hash === lensHref(lens))
                              history.replaceState(null, '', lensHref(to))
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
                          onLens={async (route, body) => {
                            const done = await onLens(route, body)
                            if (done.groupsProblem) setLeft(done.groupsProblem)
                            else if (route === 'remove' && done.removedFrom?.length)
                              setLeft(
                                `${lens.name} removed: it left ${done.removedFrom.length === 1 ? 'the group' : 'the groups'} ${done.removedFrom.join(', ')}, whose next review says so.`,
                              )
                            return done
                          }}
                          modelOf={values.lensModels[lens.name]}
                          models={models}
                          groups={groups ? groupsOf(groupList, lens) : undefined}
                          onGroup={(name) => {
                            setTab('groups')
                            setGroupFocus(name)
                          }}
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
      )}
    </main>
  )
}

/** The filter above the groups: a name, an origin, a finding kind; they combine. */
function LensFilter({
  filter,
  shown,
  total,
  groups,
  onChange,
}: {
  filter: Filter
  shown: number
  total: number
  /** The project's groups, by name: a select when there are some. */
  groups: string[]
  onChange: (filter: Filter) => void
}) {
  const filtering = isFiltering(filter)
  return (
    <div className="tr-lns-filter" role="search" aria-label="Filter the lenses">
      <span className="tr-lns-filter-search" aria-hidden="true">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
      </span>
      <label className="tr-sr" htmlFor="tr-lns-filter-name">
        Filter by name
      </label>
      <input
        id="tr-lns-filter-name"
        className="tr-input tr-text"
        type="search"
        value={filter.name}
        placeholder="Filter by name"
        onChange={(event) => onChange({ ...filter, name: event.currentTarget.value })}
      />
      <div className="tr-segment" role="group" aria-label="Origin">
        {ORIGINS.map((one) => (
          <button
            key={one.label}
            type="button"
            className={`tr-btn tr-btn--small ${filter.origin === one.value ? 'tr-btn--primary' : ''}`}
            aria-pressed={filter.origin === one.value}
            title={one.help}
            onClick={() => onChange({ ...filter, origin: one.value })}
          >
            {one.label}
          </button>
        ))}
      </div>
      <label className="tr-sr" htmlFor="tr-lns-filter-kind">
        Finding kind
      </label>
      <select
        id="tr-lns-filter-kind"
        className="tr-input tr-select"
        value={filter.kind}
        onChange={(event) => onChange({ ...filter, kind: event.currentTarget.value })}
      >
        <option value="">Any finding kind</option>
        {TOPICS.map((topic) => (
          <option key={topic} value={topic}>
            {topic}
          </option>
        ))}
      </select>
      {groups.length > 0 && (
        <>
          <label className="tr-sr" htmlFor="tr-lns-filter-group">
            Group
          </label>
          <select
            id="tr-lns-filter-group"
            className="tr-input tr-select"
            value={groups.includes(filter.group) ? filter.group : ''}
            onChange={(event) =>
              onChange({ ...filter, group: event.currentTarget.value })
            }
          >
            <option value="">Any group</option>
            {groups.map((name) => (
              <option key={name} value={name}>
                In {name}
              </option>
            ))}
          </select>
        </>
      )}
      <span className="tr-lns-filter-count">
        <span aria-live="polite" className="tr-lns-filter-total">
          {filtering
            ? `${shown} of ${plural(total, 'lens', 'lenses')}`
            : plural(total, 'lens', 'lenses')}
        </span>
        {filtering && (
          <button
            type="button"
            className="tr-btn tr-btn--link"
            onClick={() => onChange(NO_FILTER)}
          >
            Clear the filters
          </button>
        )}
      </span>
    </div>
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

const MODEL_HELP =
  "Auto-detect: the model its source's frontmatter names (model:), else the model of the session that runs /tranchant review. The source is read again at each review."

/** A lens's Model field: Auto-detect, the reviewers', or an id; beside it, what it resolves to. */
function ModelField({
  id,
  value,
  disabled,
  detected,
  models,
  onChange,
}: {
  id: string
  value: string
  disabled: boolean
  detected: Detected | undefined
  models: Models
  onChange: (model: string) => void
}) {
  const ids =
    value && value !== AUTO_MODEL && !KNOWN_MODELS.includes(value)
      ? [value, ...KNOWN_MODELS]
      : KNOWN_MODELS
  const line = resolvesTo(value, detected, models)
  return (
    <Field id={id} label="Model" help={MODEL_HELP}>
      <span className="tr-lns-model">
        <select
          id={id}
          className="tr-input tr-select"
          value={value}
          disabled={disabled || models.forced !== undefined}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value={AUTO_MODEL}>Auto-detect</option>
          <option value="">The reviewers&rsquo; (Settings › Agents)</option>
          {ids.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        {line && (
          <span className={`tr-lns-resolves${line.warn ? ' tr-warn' : ''}`}>
            {line.text}
          </span>
        )}
      </span>
    </Field>
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
  error,
  children,
}: {
  id: string
  label: string
  help?: string | undefined
  /** What is wrong with the value, said in place of the help. */
  error?: string | undefined
  children: React.ReactNode
}) {
  return (
    <div className="tr-field">
      <label className="tr-field-label" id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <div className="tr-field-body">
        {children}
        {error ? (
          <span className="tr-field-help tr-field-error" role="alert">
            {error}
          </span>
        ) : (
          help && <span className="tr-field-help">{help}</span>
        )}
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

/** A name's lenses: whether a lens of it, added to `scope`, runs as one more. */
function addsOne(lenses: LensEntry[], scope: Added, name: string) {
  // The first lens that is on runs under a name: the project's, then a global one.
  const named = lenses.filter((lens) => lens.name === name)
  const shadowed =
    scope === 'global' && named.some((lens) => lens.scope === 'local' && lens.on)
  return !shadowed && !named.some((lens) => lens.runs)
}

/**
 * The lenses being added. Several at once: a bar of how many are cleaned,
 * the ones still waiting or cleaning folded behind Show the details; those
 * to check and those that failed stay listed, each waits for the person.
 */
function BeingAdded({
  cleanings,
  lenses,
  frozen,
  cap,
  onLens,
  onRefused,
}: {
  cleanings: CleaningEntry[]
  lenses: LensEntry[]
  frozen: boolean
  cap: number
  onLens: Props['onLens']
  onRefused: (refused: { source: string; reason: string }[]) => void
}) {
  const [details, setDetails] = useState(false)
  const many = cleanings.length > 1
  const busy = cleanings.filter((one) => one.state === 'cleaning')
  const done = cleanings.length - busy.length
  const shown =
    many && !details ? cleanings.filter((one) => one.state !== 'cleaning') : cleanings
  return (
    <div className="tr-lns-group">
      <div className="tr-lns-group-head">
        <strong id="tr-lns-adding">Lenses being added</strong>
        <span className="tr-muted" role="status">
          {batchLine(cleanings)}
        </span>
      </div>
      {many && busy.length > 0 && (
        <div className="tr-lns-batch">
          <span
            className="tr-progress-bar"
            role="progressbar"
            aria-label="Lenses cleaned"
            aria-valuemin={0}
            aria-valuemax={cleanings.length}
            aria-valuenow={done}
          >
            <span style={{ width: `${Math.round((done / cleanings.length) * 100)}%` }} />
          </span>
          <span>
            {done} of {cleanings.length} cleaned
          </span>
          <button
            type="button"
            className="tr-btn tr-btn--link"
            aria-expanded={details}
            onClick={() => setDetails(!details)}
          >
            {details ? 'Hide the details' : 'Show the details'}
          </button>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="tr-lns-list" aria-labelledby="tr-lns-adding">
          {shown.map((one) => (
            <CleaningCard
              key={one.id}
              one={one}
              lenses={lenses}
              frozen={frozen}
              cap={cap}
              onLens={onLens}
              onRefused={onRefused}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** The batch being added, in a line: its glob, then how many stand where. */
function batchLine(cleanings: CleaningEntry[]) {
  const counts = { ready: 0, process: 0, cleaning: 0, waiting: 0, failed: 0 }
  for (const one of cleanings)
    counts[one.state === 'cleaning' && one.waiting ? 'waiting' : one.state] += 1
  const parts = [
    counts.ready && `${counts.ready} to check`,
    counts.process && `${counts.process} to pick from`,
    counts.cleaning && `${counts.cleaning} cleaning`,
    counts.waiting && `${counts.waiting} waiting`,
    counts.failed && `${counts.failed} failed`,
  ].filter(Boolean)
  const from = cleanings[0]?.from
  const one = cleanings.length > 1 && from && cleanings.every((c) => c.from === from)
  return `${one ? `${cleanings.length} from ${from} · ` : ''}${parts.join(', ')}`
}

/**
 * Add a lens: its source, its name, where it lives; then the cleaning agent.
 * A source with a `*` or a `?` is a glob: its matches replace the name, one
 * cleaning agent each. A source typed whole is read
 * first: a command, or one that starts agents, lists them in its place.
 */
function AddLens({
  frozen,
  lenses,
  cap,
  builtIn,
  onCancel,
  onImport,
}: {
  frozen: boolean
  /** The lenses as they stand, this one not among them. */
  lenses: LensEntry[]
  /** The cleaning agents at a time: the settings' review agents. */
  cap: number
  builtIn: string[]
  onCancel: () => void
  onImport: (body: Record<string, unknown>) => Promise<unknown>
}) {
  const [source, setSource] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [picked, setPicked] = useState<Picked>()
  // Several sources checked in Browse: one row each, in place of Source.
  const [batch, setBatch] = useState<Picked[]>()
  // Checked in Browse and not added yet: Browse closed and opened again finds them.
  const [draft, setDraft] = useState<Picked[]>([])
  // Undefined until typed in, and again once the source changes: the field shows the source's name.
  const [name, setName] = useState<string>()
  const [scope, setScope] = useState<Added>('global')
  const [busy, setBusy] = useState(false)
  const typed = source.trim()
  const glob = isGlob(typed)
  const globLook = useGlob(glob ? typed : '')
  const insideLook = useInside(glob ? '' : typed)
  // A source typed whole is read first: a command, or one that starts agents, lists them instead.
  const reading =
    !glob &&
    Boolean(typed) &&
    (insideLook.state === 'idle' || insideLook.state === 'loading')
  const inside =
    !glob && insideLook.state === 'done'
      ? (insideLook.answer.inside ?? undefined)
      : undefined
  // Its read found none: one source, whose cleaning agent looks.
  const empty = inside !== undefined && !inside.starts.length
  const many = Boolean(batch) || glob || (inside !== undefined && !empty)
  const entries = batch
    ? batch.map((one): LensMatch => ({
        source: one.source,
        name: one.name,
        ...(one.kind && { kind: one.kind }),
        ...(one.already && { already: one.already }),
      }))
    : glob
      ? globLook.state === 'done'
        ? globLook.answer.matches
        : []
      : (inside?.starts ?? [])
  const pick = usePick(
    entries,
    batch
      ? `browse:${batch.map((one) => one.source).join('\n')}`
      : glob
        ? `glob:${typed}`
        : `inside:${typed}`,
  )
  const off = new Set(batch?.filter((one) => one.off).map((one) => one.source))
  // A source of a plugin turned off says so, as a single pick's help does, unless its row says more.
  const rows = noteRows(pick.rows, scope, lenses).map((row) =>
    !row.note && off.has(row.source)
      ? {
          ...row,
          note: {
            tag: 'plugin off',
            tone: 'warn' as const,
            text: 'Its plugin is turned off for this project: the lens would not build until it is turned on (/plugin).',
          },
        }
      : row,
  )
  const checked = rows.filter((row) => row.checked)
  const blocked = checked.some((row) => row.note?.name)
  const derived =
    !glob && insideLook.state === 'done' && (!insideLook.answer.inside || empty)
      ? (insideLook.answer.name ?? '')
      : ''
  const shownName = name ?? derived
  // Emptied, the name is the source's again, as the server gives it.
  const lensName = shownName.trim() || derived
  const problem = lensName ? nameProblem(lensName, scope, lenses) : undefined
  const replaces = builtIn.includes(lensName)
  const runs = lenses.filter((lens) => lens.runs).length
  const after = many
    ? runs + checked.filter((row) => addsOne(lenses, scope, row.name.trim())).length
    : runs + (addsOne(lenses, scope, lensName) ? 1 : 0)
  const ready = many
    ? (glob ? globLook.state === 'done' : true) &&
      checked.length > 0 &&
      checked.length <= MAX_BATCH &&
      !blocked
    : !reading && !problem
  return (
    <form
      className="tr-lns-add"
      aria-labelledby="tr-lns-add-title"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        setBusy(true)
        onImport({
          ...(many
            ? {
                sources: checked.map((row) => ({
                  source: row.source,
                  name: row.name.trim(),
                })),
                ...(!batch && { from: typed }),
              }
            : {
                source: source.trim(),
                ...(lensName && { name: lensName }),
              }),
          scope,
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
        help={
          batch
            ? undefined
            : picked
              ? pickedHelp(picked)
              : "A reviewer: a plugin's skill, agent or command, or a path to one or to a checklist; a glob (*, ?) adds every file it matches, from the project's root or ~/. Browse lists what is installed and the files Tranchant may list: check several there to add them at once. A source that starts the agents it names lists them, and each one can become a lens. An agent cleans each one first: it keeps its review and leaves its orchestration and its output out; a whole review process, it lists the reviewers it starts, for you to pick."
        }
      >
        <div className="tr-source-row">
          {batch ? (
            <span className="tr-source-many" id="tr-lns-add-source" role="status">
              <strong>{batch.length} sources</strong> picked in Browse
            </span>
          ) : (
            <input
              id="tr-lns-add-source"
              className="tr-input tr-text"
              value={source}
              placeholder="plugin:name, a path, or a glob"
              required
              onChange={(event) => {
                setSource(event.currentTarget.value)
                setPicked(undefined)
                setName(undefined)
              }}
            />
          )}
          <button
            type="button"
            className="tr-btn"
            aria-expanded={browsing}
            aria-controls="tr-lns-add-picker"
            disabled={frozen}
            onClick={() => setBrowsing(!browsing)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            {browsing ? 'Close' : 'Browse…'}
          </button>
          {batch && (
            <button
              type="button"
              className="tr-btn tr-btn--link"
              onClick={() => {
                setBatch(undefined)
                setBrowsing(false)
              }}
            >
              Type a source instead
            </button>
          )}
        </div>
        {browsing && (
          <SourcePicker
            id="tr-lns-add-picker"
            checked={
              batch
                ? batch.filter((one) => checked.some((row) => row.source === one.source))
                : draft
            }
            onChecked={batch ? undefined : setDraft}
            onPick={(one) => {
              setBatch(undefined)
              setDraft([])
              setSource(one.source)
              setPicked(one)
              setName(undefined)
              setBrowsing(false)
            }}
            onAdd={(several) => {
              setDraft([])
              // A row renamed under Picked keeps its name when Browse adds more.
              setBatch(
                several.map((one) => ({
                  ...one,
                  name: rows.find((row) => row.source === one.source)?.name ?? one.name,
                })),
              )
              setSource('')
              setPicked(undefined)
              setName(undefined)
              setBrowsing(false)
            }}
            onClose={() => setBrowsing(false)}
          />
        )}
      </Field>
      {!many && (
        <Field
          id="tr-lns-add-name"
          label="Name"
          error={problem?.text}
          help={nameHelp({
            replaces,
            lensName,
            derived,
            typed: name,
            unread: insideLook.state === 'error',
          })}
        >
          <input
            id="tr-lns-add-name"
            className="tr-input tr-text"
            value={shownName}
            placeholder={derived}
            aria-invalid={problem ? true : undefined}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
      )}
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
          <span className="tr-field-help">
            {many
              ? `${SCOPE_HELP_MANY[scope]} The same for every ${batch ? 'one picked' : 'match'}.`
              : SCOPE_HELP[scope]}
          </span>
        </div>
      </div>
      {reading && <ReadingSource source={typed} />}
      {!glob && insideLook.state === 'error' && (
        <InsideUnread source={typed} error={insideLook.error} />
      )}
      {batch && (
        <PickedMatches
          rows={rows}
          slots={pick.slots}
          frozen={frozen}
          onToggle={pick.toggle}
          onSetChecked={pick.setChecked}
          onRename={pick.rename}
          onCheckAll={pick.checkAll}
          onCheckNone={pick.checkNone}
        />
      )}
      {glob && (
        <GlobMatches
          look={globLook}
          rows={rows}
          slots={pick.slots}
          frozen={frozen}
          onToggle={pick.toggle}
          onSetChecked={pick.setChecked}
          onRename={pick.rename}
          onCheckAll={pick.checkAll}
          onCheckNone={pick.checkNone}
        />
      )}
      {inside && (
        <InsideMatches
          inside={inside}
          rows={rows}
          slots={pick.slots}
          frozen={frozen}
          onToggle={pick.toggle}
          onSetChecked={pick.setChecked}
          onRename={pick.rename}
          onCheckAll={pick.checkAll}
          onCheckNone={pick.checkNone}
        />
      )}
      <div className="tr-lns-foot">
        <button
          type="submit"
          className="tr-btn tr-btn--primary"
          disabled={frozen || busy || !(typed || batch) || !ready}
        >
          {empty
            ? 'Ask an agent to look'
            : !many
              ? 'Import and clean'
              : checked.length === 1
                ? 'Add the lens'
                : checked.length
                  ? `Add the ${checked.length} lenses`
                  : 'Add the lenses'}
        </button>
        <button type="button" className="tr-btn" onClick={onCancel}>
          Cancel
        </button>
        <span className="tr-muted">
          {many
            ? `One cleaning agent per lens, ${cap} at a time (Review agents at a time). Nothing runs in a review until you add each one.`
            : 'An agent reads the source and writes the lens; nothing runs until you add it.'}
        </span>
      </div>
    </form>
  )
}

/** What Name's help says: whose the name is, the source's or the person's. */
function nameHelp({
  replaces,
  lensName,
  derived,
  typed,
  unread,
}: {
  replaces: boolean
  lensName: string
  derived: string
  typed: string | undefined
  unread: boolean
}) {
  if (replaces) return `Replaces the built-in ${lensName} where it lives.`
  if (typed?.trim())
    return derived && typed.trim() !== derived
      ? `Yours; empty, it is ${derived}, from its source.`
      : 'Yours.'
  if (derived)
    return typed === undefined
      ? 'From its source: change it to name the lens otherwise.'
      : `Empty: ${derived}, from its source.`
  return unread
    ? 'Its source could not be read here: empty, the import names it after its source.'
    : 'From its source, shown once it is read.'
}

/** What Source's help says of a source picked from the list. */
function pickedHelp(picked: Picked) {
  return [
    `Picked ${picked.source}`,
    picked.already?.length &&
      `: it is ${alreadyText(picked.already).replace(/^already lens/, 'already the source of lens')}. Adding it again makes a second lens from it`,
    picked.off &&
      `${picked.already?.length ? '. Its' : ': its'} plugin is turned off for this project, so the lens would not build until it is turned on (/plugin)`,
    '. The field stays yours to edit.',
  ]
    .filter(Boolean)
    .join('')
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

/** A lens being added: its cleaning at work, its result to check and add, a process's reviewers to pick, or why it failed. */
function CleaningCard({
  one,
  lenses,
  frozen,
  cap,
  onLens,
  onRefused,
}: {
  one: CleaningEntry
  lenses: LensEntry[]
  frozen: boolean
  /** The cleaning agents at a time, which a waiting one says. */
  cap: number
  onLens: Props['onLens']
  onRefused: (refused: { source: string; reason: string }[]) => void
}) {
  const waiting = one.state === 'cleaning' && one.waiting === true
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
        {one.state === 'cleaning' && !waiting ? (
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
            {one.reviewer && ` › ${one.reviewer}`}
            {one.version && ` ${one.version}`}
          </code>
          <span className="tr-lns-facts">
            {one.scope === 'global' ? 'global' : 'this project'}
          </span>
        </span>
        <span
          className={`tr-lns-state tr-lns-state--${one.state === 'failed' ? 'danger' : waiting ? 'muted' : 'accent'}`}
        >
          {waiting
            ? `waits for a cleaning agent: ${cap} at a time`
            : one.state === 'cleaning'
              ? 'the cleaning agent reads it…'
              : one.state === 'ready'
                ? 'cleaned: check it, then add it'
                : one.state === 'process'
                  ? 'a whole process: pick its lenses'
                  : 'cleaning failed'}
        </span>
      </div>
      {waiting && (
        <div className="tr-lns-edit">
          <div className="tr-lns-foot">{discard}</div>
        </div>
      )}
      {one.state === 'failed' && (
        <div className="tr-lns-edit">
          <p className="tr-recipe-problem">{one.reason}</p>
          <div className="tr-lns-foot">{discard}</div>
        </div>
      )}
      {one.state === 'process' && (
        <ProcessForm
          one={one}
          lenses={lenses}
          frozen={frozen}
          labelledBy={id}
          onLens={onLens}
          onRefused={onRefused}
        >
          {discard}
        </ProcessForm>
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
 * A whole process's reviewers, as its cleaning agent found them: one
 * checkbox each, its name editable, one that is a lens already locked; a
 * path Tranchant refuses said with why. Add the checked ones starts one
 * cleaning each, as if each had been added on its own.
 */
function ProcessForm({
  one,
  lenses,
  frozen,
  labelledBy,
  onLens,
  onRefused,
  children,
}: {
  one: CleaningEntry
  lenses: LensEntry[]
  frozen: boolean
  labelledBy: string
  onLens: Props['onLens']
  onRefused: (refused: { source: string; reason: string }[]) => void
  children: React.ReactNode
}) {
  const reviewers = one.reviewers ?? []
  // Keyed as a match is, by source: an inline one is written in the process's own.
  const offered = reviewers.flatMap((reviewer, index) =>
    reviewer.kind === 'refused'
      ? []
      : [
          {
            index,
            match: {
              source:
                reviewer.kind === 'file'
                  ? reviewer.source
                  : `${one.source} › ${reviewer.name}`,
              name: reviewer.name,
              ...(reviewer.already && { already: reviewer.already }),
            },
          },
        ],
  )
  const pick = usePick(
    offered.map((entry) => entry.match),
    `process:${one.id}`,
  )
  const rows = noteRows(pick.rows, one.scope, lenses)
  const checked = rows.filter((row) => row.checked)
  const blocked = checked.some((row) => row.note?.name)
  const refused = reviewers.flatMap((reviewer) =>
    reviewer.kind === 'refused' ? [reviewer] : [],
  )
  const count = reviewers.length + (one.more ?? 0)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="tr-lns-edit"
      onSubmit={(event) => {
        event.preventDefault()
        if (!checked.length || blocked) return
        setBusy(true)
        const indexOf = new Map(offered.map((entry) => [entry.match.source, entry.index]))
        void onLens('reviewers', {
          id: one.id,
          picks: checked.map((row) => ({
            index: indexOf.get(row.source),
            name: row.name.trim(),
          })),
        })
          .then((done) => onRefused(done.refused ?? []))
          .catch(() => undefined)
          .finally(() => setBusy(false))
      }}
    >
      {one.process && <p className="tr-field-help">{one.process}</p>}
      <div className="tr-matches">
        <MatchesHead
          title={`${shortName(one.source)} starts ${count === 1 ? '1 reviewer' : `${count} reviewers`}: pick the lenses to make`}
          checked={checked.length}
          frozen={frozen}
          onCheckAll={pick.checkAll}
          onCheckNone={pick.checkNone}
        />
        {offered.length > 0 && (
          <MatchList
            label={labelledBy}
            rows={rows}
            slots={pick.slots}
            frozen={frozen}
            onToggle={pick.toggle}
            onSetChecked={pick.setChecked}
            onRename={pick.rename}
          />
        )}
        {refused.length > 0 && (
          <ul className="tr-lns-refused">
            {refused.map((reviewer) => (
              <li key={`${reviewer.name}:${reviewer.file}:${reviewer.reason}`}>
                <code>{reviewer.file}</code>: {reviewer.reason}. Not offered as a file.
              </li>
            ))}
          </ul>
        )}
        <span className="tr-field-help">
          {one.more ? `${one.more} more it starts, left out. ` : ''}
          Each checked one is cleaned into a lens of its own; {shortName(one.source)}{' '}
          itself is none. One written in it stays tied to it: cleaned again when it
          changes.
        </span>
      </div>
      <div className="tr-lns-foot">
        <button
          type="submit"
          className="tr-btn tr-btn--primary"
          disabled={frozen || busy || !checked.length || blocked}
        >
          Add the checked ones
        </button>
        {children}
      </div>
    </form>
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
  models,
  groups,
  onGroup,
}: {
  lens: LensEntry
  frozen: boolean
  recleaning: boolean
  open: boolean
  onOpen: () => void
  /** Its save renamed it or moved it to another scope. */
  onMoved: (to: { scope: Added; name: string }) => void
  onSwitch: (on: boolean) => void
  onRecipeModel: (model: string | null) => void
  onLens: Props['onLens']
  modelOf: string | undefined
  models: Models
  /** The groups it is in; undefined from a server that has none. */
  groups: string[] | undefined
  /** Opens a group's editor, on the Groups tab. */
  onGroup: (name: string) => void
}) {
  const builtIn = lens.scope === 'recipe'
  const state = recleaning
    ? { text: 'being cleaned again…', tone: 'accent' }
    : standing(lens)
  // Not saved yet: a closed editor, or a blank name, shows the saved one.
  const [draft, setDraft] = useState<string>()
  const name = (open && draft?.trim()) || lens.name
  const id = `tr-lns-${lens.scope}-${lens.name}`
  const model = modelFact(lens, models)
  const history = lensHistoryOf(lens.history)
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
          {originText(lens) && <span className="tr-lns-origin">{originText(lens)}</span>}
          {lens.replaces && lens.runs && (
            <span className="tr-chip">replaces the {builtIn ? 'next' : 'built-in'}</span>
          )}
          <span className="tr-lns-facts">
            {facts(lens)} ·{' '}
            <span className={model.warn ? 'tr-warn' : undefined}>{model.text}</span>
          </span>
          {groups && groups.length > 0 && (
            <span
              className="tr-grp-in"
              aria-label={`${lens.name} is in ${groups.join(', ')}`}
            >
              {groups.map((group) => (
                <button
                  key={group}
                  type="button"
                  className="tr-chip tr-grp-chip"
                  title={`In the group ${group}: open it`}
                  onClick={() => onGroup(group)}
                >
                  {group}
                </button>
              ))}
            </span>
          )}
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
        {history && (
          <p className="tr-lns-history" title={history.title}>
            {history.text}
          </p>
        )}
      </div>
      {open && (
        <div className="tr-lns-edit" id={`${id}-edit`} role="region" aria-labelledby={id}>
          {builtIn ? (
            <RecipeLens
              lens={lens}
              frozen={frozen}
              model={modelOf}
              models={models}
              onModel={onRecipeModel}
            />
          ) : (
            <AddedLens
              key={lens.cleaned?.at}
              groups={groups ?? []}
              lens={lens}
              frozen={frozen}
              models={models}
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
          : "Tranchant's contract, the lens's domain as it was cleaned, and its added instructions: what the reviewer is given, whole."}
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
  models,
  onModel,
}: {
  lens: LensEntry
  frozen: boolean
  model: string | undefined
  models: Models
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
          <ModelField
            id={`${id}-model`}
            value={model ?? ''}
            disabled={frozen}
            detected={lens.detected}
            models={models}
            onChange={(next) => onModel(next || null)}
          />
        </div>
      )}
    </>
  )
}

/** A lens the user added: every setting editable, saved together. */
function AddedLens({
  lens,
  groups,
  frozen,
  models,
  onLens,
  onName,
  onMoved,
}: {
  lens: LensEntry
  /** The groups it is in: removed, it leaves them. */
  groups: string[]
  frozen: boolean
  models: Models
  onLens: Props['onLens']
  /** The name as it is typed, for the row to show it. */
  onName: (name: string) => void
  onMoved: (to: { scope: Added; name: string }) => void
}) {
  const scope = lens.scope === 'global' ? 'global' : 'local'
  const [tab, setTab] = useState<'settings' | 'reads'>('settings')
  const [name, setName] = useState(lens.name)
  const [where, setWhere] = useState<Added>(scope)
  const [paths, setPaths] = useState(lens.otherwise ? '' : lens.paths.join(', '))
  const [otherwise, setOtherwise] = useState(lens.otherwise === true)
  const [topics, setTopics] = useState<string[]>(lens.topics ?? [])
  const [model, setModel] = useState(lens.model ?? '')
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
            const to = { scope: where, name: name.trim() }
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
                ...(rules !== (lens.rules ?? '') && { rules }),
              },
            }).then(
              () => (to.scope !== scope || to.name !== lens.name) && onMoved(to),
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
              {lens.frontmatter && (
                <span
                  className="tr-field-help"
                  title="Its frontmatter, read at each review"
                >
                  {Object.entries(lens.frontmatter)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(' · ')}
                </span>
              )}
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
          <ModelField
            id={`${id}-model`}
            value={model}
            disabled={frozen}
            detected={lens.detected}
            models={models}
            onChange={setModel}
          />
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
                {groups.length > 0 && (
                  <span className="tr-muted">
                    It leaves {groups.length === 1 ? 'the group' : 'the groups'}{' '}
                    {groups.join(', ')}.
                  </span>
                )}
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
