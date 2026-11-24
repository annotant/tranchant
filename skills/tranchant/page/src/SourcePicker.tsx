import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  fetchLensCatalog,
  fetchLensFolder,
  type FolderEntry,
  type LensCatalog,
  type LensFolder,
  type LensMatch,
  type PickerItem,
  type PickerRoot,
} from './api'
import { lensNameOf } from './LensGlob'

/** What a pick fills Source with, and what the field's help says of it. */
export interface Picked {
  source: string
  /** The lens name it gets, as the server derives it. */
  name: string
  kind?: PickerItem['kind']
  already?: LensMatch['already']
  /** Its plugin is turned off for this project: the lens would not build. */
  off?: boolean
}

type ListTab = 'plugins' | 'project' | 'user'
type Tab = ListTab | 'files'

const LISTS: [ListTab, string][] = [
  ['plugins', 'Plugins'],
  ['project', 'This project'],
  ['user', '~/.claude'],
]

const TABS: [Tab, string][] = [...LISTS, ['files', 'Files']]

const ROOTS: [PickerRoot, string][] = [
  ['project', 'This project'],
  ['user', '~/.claude'],
  ['plugins', 'Plugins'],
]

const KIND_GROUPS: [PickerItem['kind'], string, string][] = [
  ['agent', 'Agents', 'agents'],
  ['skill', 'Skills', 'skills'],
  ['command', 'Commands', 'commands'],
]

type Load<T> =
  { state: 'loading' } | { state: 'error'; error: string } | { state: 'done'; answer: T }

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const scopeWord = (scope: 'local' | 'global') =>
  scope === 'local' ? 'this project' : 'global'

/** The lenses a file is the source of already, as an item's aside says it. */
export function alreadyText(already: NonNullable<LensMatch['already']>) {
  const adding = already.filter((one) => one.adding)
  const added = already.filter((one) => !one.adding)
  return [
    added.length &&
      `already lens ${added.map((one) => `${one.name} · ${scopeWord(one.scope)}`).join(', ')}`,
    adding.length && `being added as ${adding.map((one) => one.name).join(', ')}`,
  ]
    .filter(Boolean)
    .join('; ')
}

const matches = (q: string, ...texts: string[]) =>
  !q || texts.some((text) => text.toLowerCase().includes(q))

/** An item that can be checked, in the list's order as shown: a Shift range runs over these. */
interface Checkable {
  picked: Picked
  label: string
  /** Its file is a lens already, or being added: its box stays off, a range skips it. */
  lens: boolean
}

const pickedOf = (item: PickerItem, off?: boolean): Picked => ({
  source: item.source,
  name: lensNameOf(item.name.replace(/\.md$/i, '')),
  kind: item.kind,
  ...(item.already?.length && { already: item.already }),
  ...(off && { off }),
})

const checkable = (item: PickerItem, off?: boolean): Checkable => ({
  picked: pickedOf(item, off),
  label: item.name,
  lens: Boolean(item.already?.length),
})

/** A file's lens name, as the server's nameOfSource gives it: a plugin's own after its name, a skill's SKILL.md after its folder. */
const fileName = (entry: FolderEntry & { source: string }) => {
  const plugin = /^[\w-][\w.-]*:([^:/\\]+)$/.exec(entry.source)?.[1]
  if (plugin) return plugin
  if (/^SKILL\.md$/i.test(entry.name))
    return entry.source.split(/[/\\]/).at(-2) ?? entry.name
  return entry.name.replace(/\.[^.]+$/, '')
}

const entryPicked = (entry: FolderEntry & { source: string }): Picked => ({
  source: entry.source,
  name: lensNameOf(fileName(entry)),
  ...(entry.already?.length && { already: entry.already }),
})

const lensWord = (labels: string[]) =>
  `${labels.join(', ')} ${labels.length > 1 ? 'are lenses' : 'is a lens'} already: skipped.`

/**
 * The source's picker, under the field: the installed plugins' skills,
 * agents and commands, the project's `.claude` and the user's, and a file
 * browser over the folders the server may list. Names only while
 * browsing: a pick fills Source, which reads the file's first lines for the
 * agents it starts; the field stays the user's to edit.
 */
export function SourcePicker({
  id,
  checked: initial,
  onPick,
  onAdd,
  onChecked,
  onClose,
}: {
  id: string
  /** The sources checked when it opens: those a batch picked before. */
  checked?: Picked[] | undefined
  onPick: (picked: Picked) => void
  /** Several checked, added at once. */
  onAdd: (picked: Picked[]) => void
  /** The checks as they change: closed and opened again, the picker starts from them. */
  onChecked?: ((picked: Picked[]) => void) | undefined
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('plugins')
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<Load<LensCatalog>>({ state: 'loading' })
  const [folder, setFolder] = useState<Load<LensFolder>>()
  const [refused, setRefused] = useState<{ path: string; error: string }>()
  const [goTo, setGoTo] = useState('')
  const [checks, keepChecks] = useState<Picked[]>(initial ?? [])
  const setChecks = (next: Picked[]) => {
    keepChecks(next)
    onChecked?.(next)
  }
  // The last box clicked: a Shift-click checks from it.
  const [anchor, setAnchor] = useState<string>()
  // What the last Shift range did, said in the footer until something else changes.
  const [status, setStatus] = useState('')
  // The last folder asked wins over a slower one.
  const asked = useRef(0)
  const q = query.trim().toLowerCase()

  useEffect(() => {
    let disposed = false
    fetchLensCatalog().then(
      (answer) => !disposed && setCatalog({ state: 'done', answer }),
      (error: unknown) =>
        !disposed && setCatalog({ state: 'error', error: message(error) }),
    )
    return () => {
      disposed = true
    }
  }, [])

  const open = useCallback(
    async (where: { root: PickerRoot; path: string } | { go: string }) => {
      const turn = ++asked.current
      const last = () => turn === asked.current
      try {
        const answer = await fetchLensFolder(where)
        // A slow answer never replaces a later one, but fills a tab still empty.
        setFolder((shown) =>
          last() || shown?.state !== 'done' ? { state: 'done', answer } : shown,
        )
        if (last()) setRefused(undefined)
      } catch (error) {
        if (!last()) return
        // A folder typed and refused leaves the one open as it is.
        if ('go' in where) {
          setRefused({ path: where.go, error: message(error) })
          setFolder((shown) =>
            shown?.state === 'loading'
              ? { state: 'error', error: 'No folder open: pick a root above.' }
              : shown,
          )
        } else setFolder({ state: 'error', error: message(error) })
      }
    },
    [],
  )

  const select = (one: Tab) => {
    setTab(one)
    setAnchor(undefined)
    setStatus('')
    if (one === 'files' && !folder) {
      setFolder({ state: 'loading' })
      void open({ root: 'project', path: '' })
    }
  }

  const listed = catalog.state === 'done' ? catalog.answer : undefined
  const pluginItems = (listed?.plugins ?? []).map((plugin) => ({
    ...plugin,
    items: plugin.items.filter((item) => matches(q, item.name, item.source)),
  }))
  const ownItems = (which: 'project' | 'user') =>
    (listed?.[which].items ?? []).filter((item) => matches(q, item.name, item.source))
  const counts: Record<ListTab, number> = {
    plugins: pluginItems.reduce((sum, plugin) => sum + plugin.items.length, 0),
    project: ownItems('project').length,
    user: ownItems('user').length,
  }
  const entries =
    folder?.state === 'done'
      ? folder.answer.entries.filter((entry) => matches(q, entry.name))
      : []

  const shownPlugins = pluginItems.filter(
    (plugin) => plugin.items.length || (!q && plugin.problem),
  )
  // The list as shown: this tab, after the search, groups in their order.
  const visible: Checkable[] =
    tab === 'plugins'
      ? shownPlugins.flatMap((plugin) =>
          plugin.items.map((item) => checkable(item, !plugin.enabled)),
        )
      : tab === 'files'
        ? entries.flatMap((entry) =>
            entry.kind === 'file' && entry.source
              ? [
                  {
                    picked: entryPicked({ ...entry, source: entry.source }),
                    label: entry.name,
                    lens: Boolean(entry.already?.length),
                  },
                ]
              : [],
          )
        : KIND_GROUPS.flatMap(([kind]) =>
            ownItems(tab)
              .filter((item) => item.kind === kind)
              .map((item) => checkable(item)),
          )

  const isChecked = (source: string) => checks.some((one) => one.source === source)

  /** One box clicked: Shift from the last one clicked checks or unchecks the range, as the clicked one goes. */
  const toggle = (one: Checkable, shift: boolean) => {
    const on = !isChecked(one.picked.source)
    const from = visible.findIndex((item) => item.picked.source === anchor)
    const to = visible.findIndex((item) => item.picked.source === one.picked.source)
    setAnchor(one.picked.source)
    if (!shift || from === -1 || to === -1 || from === to) {
      setChecks(
        on
          ? [...checks, one.picked]
          : checks.filter((item) => item.source !== one.picked.source),
      )
      setStatus('')
      return
    }
    const span = visible.slice(Math.min(from, to), Math.max(from, to) + 1)
    const range = span.filter((item) => !item.lens)
    const skipped = span.filter((item) => item.lens).map((item) => item.label)
    const sources = new Set(range.map((item) => item.picked.source))
    setChecks(
      on
        ? [
            ...checks,
            ...range
              .filter((item) => !isChecked(item.picked.source))
              .map((i) => i.picked),
          ]
        : checks.filter((item) => !sources.has(item.source)),
    )
    setStatus(
      [
        `Shift-click ${on ? 'checked' : 'unchecked'} ${visible[from]?.label} to ${one.label}: ${range.length}.`,
        skipped.length && lensWord(skipped),
        q && 'The ones the search hides are left as they were.',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  const box = (one: Checkable): Box => ({
    checked: isChecked(one.picked.source),
    lens: one.lens,
    label: one.label,
    onToggle: (shift: boolean) => toggle(one, shift),
  })

  // A source listed in a tab counts there, even checked in Files; any other, in Files.
  const tabOf = (source: string): Tab =>
    LISTS.find(([list]) =>
      list === 'plugins'
        ? listed?.plugins.some((plugin) =>
            plugin.items.some((item) => item.source === source),
          )
        : listed?.[list].items.some((item) => item.source === source),
    )?.[0] ?? 'files'
  const checkedIn = (one: Tab) =>
    checks.filter((item) => tabOf(item.source) === one).length

  const pick = (picked: Picked) => onPick(picked)
  const add = () => {
    const [first] = checks
    if (checks.length === 1 && first) onPick(first)
    else if (checks.length > 1) onAdd(checks)
  }
  const names = checks.map((one) => one.name)
  const countText = !checks.length
    ? 'Check several to add them at once; Shift-click checks a range.'
    : status ||
      `${checks.length} checked: ${names.slice(0, 3).join(', ')}${
        checks.length > 3 ? ` and ${checks.length - 3} more` : ''
      }.`

  const elsewhere = LISTS.filter(([other]) => other !== tab && counts[other] > 0).map(
    ([other, label]) => `${counts[other]} in ${label}`,
  )

  return (
    <section
      className="tr-picker"
      id={id}
      aria-label="Pick a source"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="tr-picker-search">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
        <label className="tr-sr" htmlFor={`${id}-q`}>
          Search by name
        </label>
        <input
          id={`${id}-q`}
          className="tr-input"
          type="search"
          value={query}
          placeholder="Search by name: skills, agents, commands, files"
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setStatus('')
          }}
          onKeyDown={(event) => {
            // Inside Add a lens's form: Enter never imports; the search is live.
            if (event.key === 'Enter') event.preventDefault()
          }}
        />
        {query && (
          <button
            type="button"
            className="tr-btn tr-btn--link"
            onClick={() => {
              setQuery('')
              setStatus('')
            }}
          >
            Clear
          </button>
        )}
      </div>
      <div className="tr-tabs" role="tablist" aria-label="Where to look">
        {TABS.map(([one, label]) => (
          <button
            key={one}
            type="button"
            role="tab"
            className="tr-tab"
            id={`${id}-tab-${one}`}
            aria-selected={one === tab}
            aria-controls={`${id}-panel`}
            onClick={() => select(one)}
          >
            {label}
            {one !== 'files' && listed && (
              <span className="tr-tab-count">{counts[one]}</span>
            )}
            {one !== tab && checkedIn(one) > 0 && (
              <span className="tr-tab-checked">{checkedIn(one)} checked</span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
        {tab !== 'files' && catalog.state === 'loading' && (
          <p className="tr-picker-empty">Listing what is installed…</p>
        )}
        {tab !== 'files' && catalog.state === 'error' && (
          <p className="tr-picker-empty" role="alert">
            The list cannot be read: {catalog.error}. A source typed in the field still
            works.
          </p>
        )}
        {tab === 'plugins' && listed && (
          <div className="tr-picker-body">
            {listed.pluginsError && (
              <p className="tr-picker-refused" role="alert">
                Claude Code&apos;s plugins cannot be listed: {listed.pluginsError}.
              </p>
            )}
            {shownPlugins.map((plugin) => (
              <div className="tr-picker-group" key={plugin.name}>
                <div className="tr-picker-group-head">
                  <strong>{plugin.name}</strong>
                  <span className="tr-muted">
                    {[plugin.version, plugin.folder].filter(Boolean).join(' · ')}
                  </span>
                  {!plugin.enabled && (
                    <span className="tr-chip tr-chip--warn">
                      turned off for this project
                    </span>
                  )}
                  {plugin.problem && (
                    <span className="tr-chip tr-chip--warn">{plugin.problem}</span>
                  )}
                </div>
                {plugin.items.map((item) => (
                  <CheckRow key={item.source} {...box(checkable(item, !plugin.enabled))}>
                    <ItemButton
                      item={item}
                      off={!plugin.enabled}
                      onPick={() => pick(pickedOf(item, !plugin.enabled))}
                    />
                  </CheckRow>
                ))}
                <More count={plugin.more} />
              </div>
            ))}
            {!counts.plugins && !pluginItems.some((plugin) => plugin.problem) && (
              <Empty
                q={query}
                elsewhere={elsewhere}
                none="No plugin installed here has a skill, an agent or a command, Tranchant's own aside: its lenses are built in."
              />
            )}
          </div>
        )}
        {(tab === 'project' || tab === 'user') && listed && (
          <div className="tr-picker-body">
            {listed[tab].problem && (
              <p className="tr-picker-refused" role="alert">
                Some of {listed[tab].folder} cannot be listed: {listed[tab].problem}.
              </p>
            )}
            <More count={listed[tab].more} />
            {KIND_GROUPS.map(([kind, title, dir]) => {
              const items = ownItems(tab).filter((item) => item.kind === kind)
              if (!items.length) return null
              return (
                <div className="tr-picker-group" key={kind}>
                  <div className="tr-picker-group-head">
                    <strong>{title}</strong>
                    <span className="tr-muted">
                      {listed[tab].folder}
                      {dir}/
                    </span>
                  </div>
                  {items.map((item) => (
                    <CheckRow key={item.source} {...box(checkable(item))}>
                      <ItemButton item={item} onPick={() => pick(pickedOf(item))} />
                    </CheckRow>
                  ))}
                </div>
              )
            })}
            {!counts[tab] && (
              <Empty
                q={query}
                elsewhere={elsewhere}
                none={`No agent, skill or command in ${listed[tab].folder}.`}
              />
            )}
          </div>
        )}
        {tab === 'files' && (
          <Files
            id={id}
            folder={folder}
            entries={entries}
            query={query}
            refused={refused}
            roots={listed?.roots}
            goTo={goTo}
            onGoTo={setGoTo}
            onOpen={(where) => void open(where)}
            boxOf={(entry) => {
              const one = visible.find((item) => item.picked.source === entry.source)
              return one && box(one)
            }}
            onPick={(entry) =>
              entry.source && pick(entryPicked({ ...entry, source: entry.source }))
            }
          />
        )}
      </div>
      <div className="tr-picker-actions">
        <span className="tr-picker-count" role="status" aria-live="polite">
          {countText}
        </span>
        {checks.length > 0 && (
          <button
            type="button"
            className="tr-btn tr-btn--link"
            onClick={() => {
              setChecks([])
              setAnchor(undefined)
              setStatus('')
            }}
          >
            Uncheck all
          </button>
        )}
        <button
          type="button"
          className="tr-btn tr-btn--small tr-btn--primary"
          disabled={!checks.length}
          onClick={add}
        >
          {checks.length ? `Add ${checks.length}` : 'Add'}
        </button>
      </div>
      <p className="tr-picker-foot">
        Names only while you browse: once picked, Source reads a file&apos;s first lines
        for the agents it starts, and the cleaning agent reads it whole when you add it.
        Click a name to pick that one alone; a source that is a lens already cannot be
        checked, its name still picks it. Hidden files and links that leave these folders
        are shown, never opened. Tranchant&apos;s own lenses are built in: not listed.
      </p>
    </section>
  )
}

/** An item's box, as its row shows it. */
interface Box {
  checked: boolean
  lens: boolean
  label: string
  onToggle: (shift: boolean) => void
}

/** An item's box and its name: the box checks it, the name picks it alone. */
function CheckRow({
  checked,
  lens,
  label,
  onToggle,
  children,
}: Box & { children: ReactNode }) {
  return (
    <div className={`tr-picker-row${checked ? ' tr-picker-row--checked' : ''}`}>
      <label
        className="tr-picker-box"
        title={
          lens
            ? 'A lens already: its name still picks it'
            : 'Shift-click to check a range'
        }
      >
        <input
          type="checkbox"
          className="tr-check"
          checked={checked}
          disabled={lens}
          aria-label={`Check ${label}`}
          // onClick, not onChange: only a mouse event says whether Shift was held.
          readOnly
          onClick={(event: MouseEvent<HTMLInputElement>) => onToggle(event.shiftKey)}
        />
      </label>
      {children}
    </div>
  )
}

function ItemButton({
  item,
  off,
  onPick,
}: {
  item: PickerItem
  off?: boolean
  onPick: () => void
}) {
  const aside = [
    item.already?.length && alreadyText(item.already),
    off && 'plugin off here: the lens would not build',
  ]
    .filter(Boolean)
    .join('; ')
  return (
    <button
      type="button"
      className={`tr-picker-item${off ? ' tr-picker-item--off' : ''}`}
      title={item.source}
      onClick={onPick}
    >
      <span className="tr-kind">{item.kind}</span>
      <code>{item.name}</code>
      <span
        className={`tr-picker-aside${
          item.already?.length
            ? ' tr-picker-aside--lens'
            : off
              ? ' tr-picker-aside--warn'
              : ''
        }`}
      >
        {aside}
      </span>
    </button>
  )
}

/** The items a folder holds past the most listed: typed in Source, they still work. */
function More({ count }: { count: number | undefined }) {
  if (!count) return null
  return (
    <p className="tr-picker-empty">
      {count} more left out of this list: type one&apos;s name or path in Source.
    </p>
  )
}

function Empty({ q, elsewhere, none }: { q: string; elsewhere: string[]; none: string }) {
  return (
    <p className="tr-picker-empty">
      {q.trim()
        ? `Nothing named “${q.trim()}” here${elsewhere.length ? `: ${elsewhere.join(', ')}` : ''}.`
        : none}
    </p>
  )
}

const ENTRY_KIND: Record<FolderEntry['kind'], string> = {
  folder: 'folder',
  file: 'file',
  hidden: 'hidden',
  link: 'link',
  unreadable: 'folder',
  other: 'file',
}

/** The Files tab: three roots, a breadcrumb, the folder's entries, Go to a folder. */
function Files({
  id,
  folder,
  entries,
  query,
  refused,
  roots,
  goTo,
  onGoTo,
  onOpen,
  boxOf,
  onPick,
}: {
  id: string
  folder: Load<LensFolder> | undefined
  entries: FolderEntry[]
  query: string
  refused: { path: string; error: string } | undefined
  roots: string[] | undefined
  goTo: string
  onGoTo: (text: string) => void
  onOpen: (where: { root: PickerRoot; path: string } | { go: string }) => void
  boxOf: (entry: FolderEntry) => Box | undefined
  onPick: (entry: FolderEntry) => void
}) {
  const shown = folder?.state === 'done' ? folder.answer : undefined
  const parts = shown?.path ? shown.path.split('/') : []
  const crumbs = [
    { label: ROOTS.find(([root]) => root === shown?.root)?.[1] ?? '', path: '' },
    ...parts.map((label, at) => ({ label, path: parts.slice(0, at + 1).join('/') })),
  ]
  const go = () => {
    if (goTo.trim()) onOpen({ go: goTo.trim() })
  }
  return (
    <>
      <div className="tr-picker-crumbs">
        <div className="tr-segment" role="group" aria-label="Root">
          {ROOTS.map(([root, label]) => (
            <button
              key={root}
              type="button"
              className={`tr-btn tr-btn--small${shown?.root === root ? ' tr-btn--primary' : ''}`}
              aria-pressed={shown?.root === root}
              onClick={() => onOpen({ root, path: '' })}
            >
              {label}
            </button>
          ))}
        </div>
        {shown && (
          <nav className="tr-picker-path" aria-label="Folder" title={shown.label}>
            {crumbs.map((crumb, at) => (
              <Fragment key={crumb.path}>
                {at > 0 && (
                  <span className="tr-muted" aria-hidden="true">
                    /
                  </span>
                )}
                {at === crumbs.length - 1 ? (
                  <code aria-current="location">{crumb.label}</code>
                ) : (
                  <button
                    type="button"
                    className="tr-btn tr-btn--link"
                    onClick={() => onOpen({ root: shown.root, path: crumb.path })}
                  >
                    {crumb.label}
                  </button>
                )}
              </Fragment>
            ))}
          </nav>
        )}
      </div>
      {refused && (
        <p className="tr-picker-refused" role="alert">
          <strong>{refused.error}.</strong>{' '}
          {roots?.length ? `Tranchant may list ${roots.join(', ')}. ` : ''}To use a file
          elsewhere, type its path in Source: the cleaning agent reads it only once you
          add the lens.
        </p>
      )}
      <div className="tr-picker-body tr-picker-body--files">
        {(!folder || folder.state === 'loading') && (
          <p className="tr-picker-empty">Listing the folder…</p>
        )}
        {folder?.state === 'error' && (
          <p className="tr-picker-empty" role="alert">
            {folder.error}
          </p>
        )}
        {entries.map((entry) => {
          const pickable = entry.kind === 'file' && Boolean(entry.source)
          const opens = entry.kind === 'folder'
          const aside = entry.already?.length
            ? alreadyText(entry.already)
            : (entry.reason ?? '')
          const dimmed = !pickable && !opens
          const checks = pickable ? boxOf(entry) : undefined
          const button = (
            <button
              type="button"
              className={`tr-picker-item${dimmed ? ' tr-picker-item--off' : ''}`}
              disabled={dimmed}
              title={entry.source ?? entry.name}
              onClick={() =>
                opens && shown
                  ? onOpen({
                      root: shown.root,
                      path: [...parts, entry.name].join('/'),
                    })
                  : onPick(entry)
              }
            >
              <span className="tr-kind">{ENTRY_KIND[entry.kind]}</span>
              <code>
                {entry.name}
                {entry.kind === 'folder' || entry.kind === 'unreadable' ? '/' : ''}
              </code>
              <span
                className={`tr-picker-aside${
                  entry.already?.length
                    ? ' tr-picker-aside--lens'
                    : entry.kind === 'link' || entry.kind === 'unreadable'
                      ? ' tr-picker-aside--warn'
                      : ''
                }`}
              >
                {aside}
              </span>
            </button>
          )
          return checks ? (
            <CheckRow key={entry.name} {...checks}>
              {button}
            </CheckRow>
          ) : (
            <div key={entry.name} className="tr-picker-row">
              <span className="tr-picker-box" aria-hidden="true" />
              {button}
            </div>
          )
        })}
        {shown && !entries.length && (
          <p className="tr-picker-empty">
            {query.trim()
              ? `Nothing named “${query.trim()}” in this folder.`
              : 'Nothing in this folder.'}
          </p>
        )}
        {shown?.more ? (
          <p className="tr-picker-empty">
            {shown.more} more left out: go to a folder further down.
          </p>
        ) : null}
      </div>
      <div className="tr-picker-go">
        <label className="tr-sr" htmlFor={`${id}-go`}>
          Go to a folder
        </label>
        <input
          id={`${id}-go`}
          className="tr-input"
          value={goTo}
          placeholder="Go to a folder: docs/checklists, ~/.claude/agents"
          onChange={(event) => onGoTo(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              go()
            }
          }}
        />
        <button type="button" className="tr-btn tr-btn--small" onClick={go}>
          Go
        </button>
      </div>
    </>
  )
}
