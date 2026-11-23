import { useState } from 'react'
import type { LensDone, LensRoute } from './api'
import type {
  GroupMember,
  GroupsPayload,
  LensEntry,
  LensGroup,
  LensScope,
} from './settings'
import { groupHistoryOf } from './tokens'

/** A group's name, as a lens's: `--group <name>`. */
const GROUP_NAME = /^[\w-]{1,40}$/

/** Past this many lenses in a group, the editor warns of their cost, as the lenses' list does. */
const MANY = 12

/** How a row names a lens's scope after its name: `conventions of this project`. */
const SCOPE_WORDS: Record<LensScope, string> = {
  local: 'of this project',
  global: 'global',
  recipe: 'built-in',
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`

const keyOf = (one: GroupMember) => `${one.scope}:${one.name}`

const isMember = (members: readonly GroupMember[], one: GroupMember) =>
  members.some((member) => member.scope === one.scope && member.name === one.name)

/** The groups `lens` is in, by name. */
export const groupsOf = (groups: readonly LensGroup[], lens: GroupMember) =>
  groups.filter((group) => isMember(group.lenses, lens)).map((group) => group.name)

/** A member's chip: a built-in lens by its name, another with its scope. */
const chipOf = (one: GroupMember) =>
  one.scope === 'recipe'
    ? one.name
    : `${one.name} · ${one.scope === 'local' ? 'project' : 'global'}`

/** The lens of the same name as `lens`, another one, among `among`: one lens per name in a group. */
const twinOf = (lens: LensEntry, among: readonly GroupMember[]) =>
  among.find((one) => one.name === lens.name && !isMember([lens], one))

interface Draft {
  name: string
  members: GroupMember[]
}

interface Props {
  lenses: LensEntry[]
  groups: GroupsPayload
  frozen: boolean
  /** The titles of the lenses' scopes, as the Lenses tab heads them. */
  titles: Record<LensScope, string>
  originText: (lens: LensEntry) => string | undefined
  onLens: (route: LensRoute, body: Record<string, unknown>) => Promise<LensDone>
  /** The group whose editor opens first: a chip of the Lenses tab. */
  focus?: string | undefined
}

/**
 * Settings › Lenses › Groups: the project's groups of lenses, each one
 * review's lenses, their editor, and the default group.
 */
export function GroupsTab({
  lenses,
  groups,
  frozen,
  titles,
  originText,
  onLens,
  focus,
}: Props) {
  const opened = groups.list.find((group) => group.name === focus)
  // The group being edited, `new` for one being made; its draft.
  const [editing, setEditing] = useState<string | undefined>(opened?.name)
  const [draft, setDraft] = useState<Draft | undefined>(
    opened && { name: opened.name, members: [...opened.lenses] },
  )
  const [filter, setFilter] = useState('')
  const [note, setNote] = useState('')
  const [removed, setRemoved] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = frozen || groups.problem !== undefined || busy
  const known = (one: GroupMember) => lenses.some((lens) => isMember([lens], one))
  const open = (key: string, next: Draft) => {
    setEditing(key)
    setDraft(next)
    setFilter('')
    setNote('')
    setRemoved('')
  }
  const close = () => {
    setEditing(undefined)
    setDraft(undefined)
    setNote('')
  }
  const act = (route: LensRoute, body: Record<string, unknown>, after: () => void) => {
    setBusy(true)
    onLens(route, body)
      .then(after, () => undefined)
      .finally(() => setBusy(false))
  }
  const onCount = lenses.filter((lens) => lens.runs).length
  const rows: { group: LensGroup; existing: boolean }[] = [
    ...(editing === 'new' ? [{ group: { name: '', lenses: [] }, existing: false }] : []),
    ...groups.list.map((group) => ({ group, existing: true })),
  ]
  return (
    <section className="tr-section tr-lns" role="tabpanel" aria-label="Groups">
      <div className="tr-lns-intro">
        <p>
          A group is a set of lenses one review runs:{' '}
          <code>/tranchant review --group backend</code>, or the Group select before
          Start. A lens can be in several groups. Groups stay on this machine, with this
          project&rsquo;s lenses.
        </p>
        <button
          type="button"
          className="tr-btn tr-btn--primary"
          disabled={locked || editing !== undefined}
          onClick={() => open('new', { name: '', members: [] })}
        >
          New group
        </button>
      </div>
      {groups.problem && (
        <p className="tr-notice" role="alert">
          The groups file cannot be read, so nothing is written until it is mended or
          removed: {groups.problem}
        </p>
      )}
      <div className="tr-field">
        <label className="tr-field-label" htmlFor="tr-grp-default">
          Default group
        </label>
        <div className="tr-field-body">
          <select
            id="tr-grp-default"
            className="tr-input tr-select"
            value={groups.default ?? ''}
            disabled={locked}
            onChange={(event) =>
              act('group/default', { name: event.currentTarget.value || null }, () => {})
            }
          >
            <option value="">Every lens that is on · {onCount}</option>
            {groups.list.map((group) => (
              <option key={group.name} value={group.name}>
                {group.name} · {group.lenses.length}
              </option>
            ))}
          </select>
          <span className="tr-field-help">
            What <code>/tranchant review</code> runs with no <code>--group</code>.{' '}
            <em>Every lens that is on</em> follows the switches of the Lenses tab.
          </span>
        </div>
      </div>
      {!rows.length && (
        <div className="tr-lns-empty tr-grp-empty">
          <strong>No group yet.</strong>
          <span className="tr-muted">
            Every review runs every lens that is on. Make a group for a kind of change
            (backend, frontend), or two to compare (A and B): each review then runs the
            group you name.
          </span>
          <button
            type="button"
            className="tr-btn tr-btn--secondary tr-btn--small"
            disabled={locked}
            onClick={() => open('new', { name: '', members: [] })}
          >
            New group
          </button>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="tr-lns-list" aria-label="Groups">
          {rows.map(({ group, existing }) => {
            const key = existing ? group.name : 'new'
            const isOpen = editing === key && draft !== undefined
            const members = isOpen ? draft.members : group.lenses
            const gone = members.filter((one) => !known(one))
            // Its lenses' averages, as they stand in the draft while it is edited.
            const history = groupHistoryOf(
              members.flatMap((one) => {
                const lens = lenses.find((entry) => isMember([entry], one))
                return lens ? [lens.history] : []
              }),
            )
            const id = `tr-grp-${key}`
            return (
              <li
                key={key}
                className={`tr-lns-item${isOpen ? ' tr-lns-item--open' : ''}`}
              >
                <div className="tr-lns-row tr-grp-row">
                  <span className="tr-lns-name" id={id}>
                    {existing ? group.name : draft?.name.trim() || 'New group'}
                  </span>
                  <span className="tr-lns-meta">
                    <span className="tr-lns-facts">
                      {plural(members.length - gone.length, 'lens', 'lenses')}
                      {gone.length > 0 && ` · ${gone.length} gone`}
                    </span>
                    {existing && groups.default === group.name && (
                      <span className="tr-chip tr-chip--ready">default</span>
                    )}
                    <span className="tr-grp-members">
                      {members
                        .filter((one) => known(one))
                        .map((one) => (
                          <span
                            key={keyOf(one)}
                            className="tr-chip"
                            title={`${one.name} ${SCOPE_WORDS[one.scope]}`}
                          >
                            {chipOf(one)}
                          </span>
                        ))}
                    </span>
                  </span>
                  <code className="tr-lns-state">
                    {existing ? `--group ${group.name}` : ''}
                  </code>
                  <button
                    type="button"
                    className="tr-btn tr-btn--small"
                    aria-expanded={isOpen}
                    aria-controls={`${id}-edit`}
                    disabled={editing !== undefined && !isOpen}
                    onClick={() =>
                      isOpen
                        ? close()
                        : open(key, { name: group.name, members: [...group.lenses] })
                    }
                  >
                    {isOpen ? 'Close' : 'Edit'}
                  </button>
                  {history && (
                    <p className="tr-lns-history" title={history.title}>
                      {history.text}
                    </p>
                  )}
                </div>
                {isOpen && (
                  <GroupEditor
                    id={`${id}-edit`}
                    labelId={id}
                    draft={draft}
                    from={existing ? group.name : undefined}
                    taken={groups.list
                      .map((one) => one.name)
                      .filter((name) => !existing || name !== group.name)}
                    lenses={lenses}
                    titles={titles}
                    originText={originText}
                    filter={filter}
                    note={note}
                    locked={locked}
                    onFilter={setFilter}
                    onDraft={(next, said = '') => {
                      setDraft(next)
                      setNote(said)
                    }}
                    onSave={() =>
                      act(
                        'group/save',
                        {
                          ...(existing && { name: group.name }),
                          group: {
                            name: draft.name.trim(),
                            lenses: draft.members.filter((one) => known(one)),
                          },
                        },
                        close,
                      )
                    }
                    onCancel={close}
                    onDuplicate={() =>
                      open('new', {
                        name: `${group.name.slice(0, 35)}-copy`,
                        members: draft.members.filter((one) => known(one)),
                      })
                    }
                    onRemove={() =>
                      act('group/remove', { name: group.name }, () => {
                        close()
                        setRemoved(
                          `Group ${group.name} deleted: its lenses stay.${groups.default === group.name ? ' The default is Every lens that is on again.' : ''}`,
                        )
                      })
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
      {removed && (
        <p className="tr-muted" role="status">
          {removed}
        </p>
      )}
    </section>
  )
}

/** A group's editor: its name, and its lenses checked in one list laid out by scope. */
function GroupEditor({
  id,
  labelId,
  draft,
  from,
  taken,
  lenses,
  titles,
  originText,
  filter,
  note,
  locked,
  onFilter,
  onDraft,
  onSave,
  onCancel,
  onDuplicate,
  onRemove,
}: {
  id: string
  labelId: string
  draft: Draft
  /** The group's name as saved; undefined for a new one. */
  from: string | undefined
  /** The names of the other groups. */
  taken: string[]
  lenses: LensEntry[]
  titles: Record<LensScope, string>
  originText: (lens: LensEntry) => string | undefined
  filter: string
  note: string
  locked: boolean
  onFilter: (filter: string) => void
  /** The draft changed, with what the change says, when it says something. */
  onDraft: (draft: Draft, note?: string) => void
  onSave: () => void
  onCancel: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const name = draft.name.trim()
  const nameProblem = !name
    ? 'Give the group a name.'
    : !GROUP_NAME.test(name)
      ? 'Letters, digits, - and _ only, 40 at most.'
      : taken.includes(name)
        ? `A group is already named ${name}.`
        : ''
  const members = draft.members.filter((one) =>
    lenses.some((lens) => isMember([lens], one)),
  )
  const saveProblem = nameProblem || (members.length ? '' : 'Check at least one lens.')
  const query = filter.trim().toLowerCase()
  const shown = lenses.filter((lens) => !query || lens.name.toLowerCase().includes(query))
  // A lens left unchecked because its name is taken counts as done.
  const done = (lens: LensEntry) =>
    isMember(draft.members, lens) || twinOf(lens, draft.members) !== undefined
  const allShown = shown.length > 0 && shown.every(done)
  const toggle = (lens: LensEntry) => {
    const member = { scope: lens.scope, name: lens.name }
    if (isMember(draft.members, lens))
      return onDraft({
        ...draft,
        members: draft.members.filter((one) => keyOf(one) !== keyOf(member)),
      })
    const twin = twinOf(lens, draft.members)
    onDraft(
      {
        ...draft,
        members: [...draft.members.filter((one) => one !== twin), member],
      },
      twin
        ? `${lens.name} ${SCOPE_WORDS[lens.scope]} checked: the ${twin.name} ${SCOPE_WORDS[twin.scope]} is unchecked. One lens per name in a group.`
        : '',
    )
  }
  // Several at once, one lens per name: a name checked already stays, else the first in precedence wins.
  const checkMany = (some: LensEntry[]) => {
    const next = [...draft.members]
    const skipped: string[] = []
    for (const lens of some) {
      if (isMember(next, lens)) continue
      const twin = twinOf(lens, next)
      if (twin) {
        skipped.push(
          `${lens.name} ${SCOPE_WORDS[lens.scope]} (the ${twin.name} ${SCOPE_WORDS[twin.scope]} is checked)`,
        )
        continue
      }
      next.push({ scope: lens.scope, name: lens.name })
    }
    onDraft(
      { ...draft, members: next },
      skipped.length
        ? `Left unchecked, one lens per name in a group: ${skipped.join(', ')}.`
        : '',
    )
  }
  const uncheckMany = (some: LensEntry[]) =>
    onDraft({
      ...draft,
      members: draft.members.filter((one) => !some.some((lens) => isMember([lens], one))),
    })
  const scopes = (['local', 'global', 'recipe'] as const).flatMap((scope) => {
    const all = lenses.filter((lens) => lens.scope === scope)
    const items = shown.filter((lens) => lens.scope === scope)
    return items.length ? [{ scope, all, items }] : []
  })
  return (
    <div className="tr-lns-edit" id={id} role="region" aria-labelledby={labelId}>
      <form
        className="tr-lns-fields"
        onSubmit={(event) => {
          event.preventDefault()
          if (!saveProblem && !locked) onSave()
        }}
      >
        <div className="tr-field">
          <label className="tr-field-label" htmlFor={`${id}-name`}>
            Name
          </label>
          <div className="tr-field-body">
            <input
              id={`${id}-name`}
              className="tr-input tr-text"
              value={draft.name}
              placeholder="backend"
              disabled={locked}
              aria-describedby={`${id}-name-help`}
              onChange={(event) => onDraft({ ...draft, name: event.currentTarget.value })}
            />
            {draft.name !== '' && nameProblem && (
              <span className="tr-lns-reason" role="alert">
                {nameProblem}
              </span>
            )}
            <span id={`${id}-name-help`} className="tr-field-help">
              Letters, digits, <code>-</code> and <code>_</code>, 40 at most:{' '}
              <code>--group {name || 'backend'}</code>.
            </span>
          </div>
        </div>
        <div className="tr-field">
          <span className="tr-field-label" id={`${id}-lenses`}>
            Lenses
          </span>
          <div className="tr-field-body">
            <div className="tr-grp-pickhead">
              <label className="tr-sr" htmlFor={`${id}-filter`}>
                Filter the lenses by name
              </label>
              <input
                id={`${id}-filter`}
                className="tr-input tr-text"
                type="search"
                value={filter}
                placeholder="Filter by name"
                onChange={(event) => onFilter(event.currentTarget.value)}
              />
              {query && shown.length > 0 && (
                <button
                  type="button"
                  className="tr-btn tr-btn--small tr-btn--secondary"
                  disabled={locked}
                  onClick={() => (allShown ? uncheckMany(shown) : checkMany(shown))}
                >
                  {allShown
                    ? `Uncheck the ${shown.length} shown`
                    : `Check the ${shown.length} shown`}
                </button>
              )}
              <span role="status">
                {members.length} checked ·{' '}
                {plural(members.length, 'reviewer', 'reviewers')} at most
              </span>
            </div>
            {note && (
              <p className="tr-grp-note" role="status">
                {note}
              </p>
            )}
            {members.length > MANY && (
              <p className="tr-grp-note tr-grp-note--warn" role="note">
                <strong>{plural(members.length, 'reviewer', 'reviewers')}.</strong> Each
                one reads the change on its own: a review of this group spends many
                tokens.
              </p>
            )}
            {scopes.map(({ scope, all, items }) => {
              const sectionAll = items.every(done)
              const what = query
                ? `the ${items.length} shown of ${titles[scope]}`
                : `every lens of ${titles[scope]}`
              const label = sectionAll ? `Uncheck ${what}` : `Check ${what}`
              return (
                <div
                  key={scope}
                  className="tr-grp-pickgroup"
                  role="group"
                  aria-labelledby={`${id}-${scope}`}
                >
                  <div className="tr-lns-group-head tr-grp-pickgroup-head">
                    <label className="tr-inline-check">
                      <input
                        type="checkbox"
                        className="tr-check"
                        checked={sectionAll}
                        disabled={locked}
                        aria-label={label}
                        title={label}
                        onChange={() =>
                          sectionAll ? uncheckMany(items) : checkMany(items)
                        }
                      />
                      <strong id={`${id}-${scope}`}>{titles[scope]}</strong>
                    </label>
                    <span className="tr-muted">
                      {all.filter((lens) => isMember(draft.members, lens)).length} of{' '}
                      {all.length} checked
                    </span>
                  </div>
                  <ul className="tr-lns-list">
                    {items.map((lens) => {
                      const checked = isMember(draft.members, lens)
                      const twin = !checked && twinOf(lens, draft.members)
                      const noteId = `${id}-n-${lens.scope}-${lens.name}`
                      const said = twin
                        ? `the ${twin.name} ${SCOPE_WORDS[twin.scope]} is checked`
                        : lens.problem
                          ? `cannot be built: ${lens.problem}`
                          : !lens.on
                            ? 'off in your settings: runs in this group'
                            : !lens.runs
                              ? 'replaced outside groups, by a lens of the same name'
                              : ''
                      return (
                        <li
                          key={keyOf(lens)}
                          className={`tr-lns-item${checked ? ' tr-grp-item--on' : ''}`}
                        >
                          <label className="tr-grp-pick">
                            <input
                              type="checkbox"
                              className="tr-check"
                              checked={checked}
                              disabled={locked}
                              aria-describedby={said ? noteId : undefined}
                              onChange={() => toggle(lens)}
                            />
                            <span className="tr-lns-name">{lens.name}</span>
                            <code className="tr-lns-source">
                              {lens.source}
                              {lens.version && ` ${lens.version}`}
                            </code>
                            <span className="tr-lns-origin">{originText(lens)}</span>
                            {said && (
                              <span className="tr-grp-pick-note" id={noteId}>
                                {said}
                              </span>
                            )}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
            {!scopes.length && (
              <p className="tr-lns-empty">No lens matches “{filter}”.</p>
            )}
            <span className="tr-field-help">
              A lens in a group runs in its review whether its switch is on or off: the
              switches are <em>Every lens that is on</em>. It still reads only the files
              its paths match. One lens per name: a lens of this project and a built-in
              one of the same name cannot be in one group.
            </span>
          </div>
        </div>
        <div className="tr-lns-foot">
          <button
            type="submit"
            className="tr-btn tr-btn--primary"
            disabled={locked || saveProblem !== ''}
          >
            {from === undefined ? 'Create the group' : 'Save the group'}
          </button>
          <button type="button" className="tr-btn" onClick={onCancel}>
            Cancel
          </button>
          {from !== undefined && (
            <button
              type="button"
              className="tr-btn"
              disabled={locked}
              title="A new group with the same lenses: B starting from A"
              onClick={onDuplicate}
            >
              Duplicate
            </button>
          )}
          {/* A name typed that is refused says so under it, once. */}
          {saveProblem && !(draft.name !== '' && nameProblem) && (
            <span className="tr-muted">{saveProblem}</span>
          )}
          {from !== undefined && (
            <button
              type="button"
              className="tr-btn tr-btn--danger"
              disabled={locked}
              onClick={onRemove}
            >
              Delete the group
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
