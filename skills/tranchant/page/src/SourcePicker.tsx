import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
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

/** What a pick fills Source with, and what the field's help says of it. */
export interface Picked {
  source: string
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

/**
 * The source's picker, under the field: the installed plugins' skills,
 * agents and commands, the project's `.claude` and the user's, and a file
 * browser over the folders the server may list. Names only: no file is
 * read before it is added as a lens. A pick fills Source; the field stays
 * the user's to edit.
 */
export function SourcePicker({
  id,
  onPick,
  onClose,
}: {
  id: string
  onPick: (picked: Picked) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('plugins')
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<Load<LensCatalog>>({ state: 'loading' })
  const [folder, setFolder] = useState<Load<LensFolder>>()
  const [refused, setRefused] = useState<{ path: string; error: string }>()
  const [goTo, setGoTo] = useState('')
  // Only the last folder asked shows: a slow answer never replaces a later one.
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
      try {
        const answer = await fetchLensFolder(where)
        if (turn !== asked.current) return
        setRefused(undefined)
        setFolder({ state: 'done', answer })
      } catch (error) {
        if (turn !== asked.current) return
        // A folder typed and refused leaves the one open as it is.
        if ('go' in where) setRefused({ path: where.go, error: message(error) })
        else setFolder({ state: 'error', error: message(error) })
      }
    },
    [],
  )

  const select = (one: Tab) => {
    setTab(one)
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

  const pick = (
    item: { source: string; already?: LensMatch['already'] },
    off?: boolean,
  ) =>
    onPick({
      source: item.source,
      ...(item.already?.length && { already: item.already }),
      ...(off && { off }),
    })

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
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Inside Add a lens's form: Enter searches, it never imports.
            if (event.key === 'Enter') event.preventDefault()
          }}
        />
        {query && (
          <button
            type="button"
            className="tr-btn tr-btn--link"
            onClick={() => setQuery('')}
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
            {pluginItems
              .filter((plugin) => plugin.items.length)
              .map((plugin) => (
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
                  </div>
                  {plugin.items.map((item) => (
                    <ItemButton
                      key={item.source}
                      item={item}
                      off={!plugin.enabled}
                      onPick={() => pick(item, !plugin.enabled)}
                    />
                  ))}
                </div>
              ))}
            {!counts.plugins && (
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
                    <ItemButton key={item.source} item={item} onPick={() => pick(item)} />
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
            onPick={(entry) => entry.source && pick({ ...entry, source: entry.source })}
          />
        )}
      </div>
      <p className="tr-picker-foot">
        Names only: Tranchant reads a file once you add it as a lens. Hidden files and
        links that leave these folders are shown, never opened. Tranchant&apos;s own
        lenses are built in: not listed.
      </p>
    </section>
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
  const aside = item.already?.length
    ? alreadyText(item.already)
    : off
      ? 'plugin off here: the lens would not build'
      : ''
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
          return (
            <button
              key={entry.name}
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
