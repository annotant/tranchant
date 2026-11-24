import { useEffect, useState } from 'react'
import {
  fetchLensInside,
  fetchLensMatches,
  type LensInside,
  type LensMatch,
  type LensMatches,
} from './api'
import type { LensEntry } from './settings'

/** Whether a source is a glob: a `*` or a `?`, as the server reads it; a `[` is part of a path. */
export const isGlob = (source: string) => /[*?]/.test(source)

const LENS_NAME = /^[\w-]{1,40}$/
/** Typing settles before the server is asked: one look per pause, not per key. */
const SETTLE_MS = 300
/** The most sources one batch sends, as the server takes them. */
export const MAX_BATCH = 40

/** The server's answer for what was typed, once typing settles; `loading` while it is asked. */
export type Look<T> =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; error: string }
  | { state: 'done'; key: string; answer: T }

function useLook<T>(key: string, ask: (key: string) => Promise<T>): Look<T> {
  const [answer, setAnswer] = useState<{ key: string; look: Look<T> }>()
  useEffect(() => {
    if (!key) return undefined
    let disposed = false
    const timer = setTimeout(() => {
      void (async () => {
        let look: Look<T>
        try {
          look = { state: 'done', key, answer: await ask(key) }
        } catch (error) {
          look = {
            state: 'error',
            error: error instanceof Error ? error.message : String(error),
          }
        }
        if (!disposed) setAnswer({ key, look })
      })()
    }, SETTLE_MS)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [key, ask])
  // An answer for another key is stale: this one is still being looked for.
  if (!key) return { state: 'idle' }
  return answer?.key === key ? answer.look : { state: 'loading' }
}

/** The files a glob matches, asked once typing settles. */
export const useGlob = (glob: string) => useLook<LensMatches>(glob, fetchLensMatches)

/** The reviewers inside a source typed whole (a command, an agent that starts others), asked once typing settles. */
export const useInside = (source: string) => useLook<LensInside>(source, fetchLensInside)

/** A match as the form shows it: checked or not, under the name it will get. */
export interface Row extends LensMatch {
  checked: boolean
  /** Its file is a lens already, or being added: nothing to add, never checked. */
  present: boolean
  note?: Note | undefined
}

interface Note {
  tag: string
  text: string
  tone: 'warn' | 'danger' | 'muted'
  /** The name it would get is the problem: checked, the batch waits for another one. */
  name?: boolean
}

/** Where a row shows: on its own, or among the reviewers a command (or an agent that starts others) starts, under it. */
type Slot =
  { source: string } | { group: LensMatch; kids: string[]; alsoMatched: string[] }

/** Whether a match's file is a lens already, or being added. */
const isPresent = (match: LensMatch) => Boolean(match.already?.length)

/** One file however a source names it: a skill's folder and its SKILL.md alike. */
const fileOf = (source: string) => source.replace(/[/\\]SKILL\.md$/i, '')

/**
 * The rows to check, each once, and where each shows: the reviewers a
 * command starts under it, a match it starts listed there and not on its
 * own, one two commands start under the first.
 */
function layoutOf(entries: LensMatch[]) {
  const started = new Set(
    entries.flatMap((one) => one.starts?.map((kid) => fileOf(kid.source)) ?? []),
  )
  const matched = new Set(
    entries.filter((one) => !one.starts).map((one) => fileOf(one.source)),
  )
  const seen = new Set<string>()
  const flat: LensMatch[] = []
  const slots: Slot[] = []
  for (const one of entries) {
    if (one.starts) {
      const kids = one.starts.filter((kid) => !seen.has(fileOf(kid.source)))
      for (const kid of kids) {
        seen.add(fileOf(kid.source))
        flat.push(kid)
      }
      slots.push({
        group: one,
        kids: kids.map((kid) => kid.source),
        alsoMatched: kids
          .filter((kid) => matched.has(fileOf(kid.source)))
          .map((kid) => kid.name),
      })
    } else if (!started.has(fileOf(one.source)) && !seen.has(fileOf(one.source))) {
      seen.add(fileOf(one.source))
      flat.push(one)
      slots.push({ source: one.source })
    }
  }
  return { flat, slots }
}

/**
 * Which of `entries` are checked, under which names, from `key` (what was
 * typed) on: a row that reads as no reviewer starts unchecked; one that is
 * a lens already, or being added, is never checked.
 */
export function usePick(entries: LensMatch[], key: string) {
  const [state, setState] = useState<{
    key: string
    off: ReadonlySet<string>
    names: Record<string, string>
  }>()
  const { flat, slots } = layoutOf(entries)
  // Another answer: its own defaults, until the person changes one.
  const current =
    state?.key === key
      ? state
      : {
          key,
          off: new Set(flat.filter((one) => one.notReviewer).map((one) => one.source)),
          names: {},
        }
  const set = (change: Partial<typeof current>) => setState({ ...current, ...change })
  const rows = flat.map((one) => ({
    ...one,
    name: current.names[one.source] ?? one.name,
    present: isPresent(one),
    checked: !isPresent(one) && !current.off.has(one.source),
  }))
  const setChecked = (sources: string[], on: boolean) => {
    const next = new Set(current.off)
    for (const source of sources) {
      if (on) next.delete(source)
      else next.add(source)
    }
    set({ off: next })
  }
  return {
    rows,
    slots,
    toggle: (source: string) => setChecked([source], current.off.has(source)),
    setChecked,
    rename: (source: string, name: string) =>
      set({ names: { ...current.names, [source]: name } }),
    checkAll: () => set({ off: new Set() }),
    checkNone: () => set({ off: new Set(flat.map((one) => one.source)) }),
  }
}

/** A source's short name, as a person calls it: `review-pr` for `pr-review-toolkit:review-pr` or `.claude/commands/review-pr.md`. */
export const shortName = (source: string) =>
  source
    .replace(/[/\\]SKILL\.md$/i, '')
    .split(/[:/\\]/)
    .findLast(Boolean)
    ?.replace(/\.md$/i, '') ?? source

/** A stem made a lens name, as the server makes it: letters, digits, - and _, 40 at most; `lens` when nothing is left. */
export const lensNameOf = (stem: string) =>
  stem
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'lens'

const SCOPE_WORD = { local: "This project's", global: 'The global' } as const

/** Why a lens cannot take `name` where it would live: not a lens name, or another lens's there. */
export function nameProblem(
  name: string,
  scope: 'local' | 'global',
  lenses: LensEntry[],
): { tag: 'name' | 'name taken'; text: string } | undefined {
  if (!LENS_NAME.test(name))
    return {
      tag: 'name',
      text: 'A lens name is letters, digits, - and _ only, 40 at most: change this one.',
    }
  // A lens is a folder: on a filesystem that ignores case, Abac is abac.
  const same = lenses.find(
    (lens) => lens.scope === scope && lens.name.toLowerCase() === name.toLowerCase(),
  )
  if (same)
    return {
      tag: 'name taken',
      text: `${SCOPE_WORD[scope]} ${same.name} is another lens, from ${same.source}: give this one another name.`,
    }
  return undefined
}
const SCOPE_OF = { local: "this project's", global: 'the global' } as const

/** The lenses made from a match's file, in words: `this project's api-review, and being added as the global api`. */
const lensesOf = (already: NonNullable<LensMatch['already']>) =>
  already
    .map((one) =>
      one.adding
        ? `being added as ${SCOPE_OF[one.scope]} ${one.name}`
        : `${SCOPE_OF[one.scope]} ${one.name}`,
    )
    .join(', and ')

/**
 * What a match's row says of it: a file that is a lens already, or being
 * added, says which; a name that cannot be, or is another lens's where it
 * would live, or another match's, is a problem of its name, to change; one
 * that wins over a lens of another scope says which; one that is no
 * reviewer says why.
 */
export function noteRows(
  rows: (LensMatch & { checked: boolean; present: boolean })[],
  scope: 'local' | 'global',
  lenses: LensEntry[],
): Row[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const name = row.name.trim()
    const twice = row.checked && seen.has(name)
    if (row.checked) seen.add(name)
    const named = lenses.filter((lens) => lens.name === name)
    const problem = nameProblem(name, scope, lenses)
    const local = named.find((lens) => lens.scope === 'local' && lens.on)
    const other = named.find((lens) => lens.scope !== scope && lens.runs)
    const already = row.already ?? []
    // Unchecked, a name is no problem yet: it is said, not in red.
    const tone = row.checked ? 'danger' : 'muted'
    let note: Note | undefined
    if (already.length)
      note = {
        tag: already[0]?.adding ? 'being added' : 'added already',
        tone: 'warn',
        text: `This file is ${lensesOf(already)}${already.every((one) => one.adding) ? '' : ' already'}: nothing to add.`,
      }
    else if (problem) note = { ...problem, tone, name: true }
    else if (twice)
      note = {
        tag: 'name taken',
        tone,
        text: `A match above is named ${name} too: give this one another name.`,
        name: true,
      }
    else if (scope === 'global' && local)
      note = {
        tag: 'shadowed',
        tone: 'warn',
        text: `This project's ${name} wins over it here; it runs on the other projects.`,
      }
    else if (other)
      note = {
        tag: 'replaces',
        tone: 'warn',
        text:
          other.scope === 'recipe'
            ? `Replaces the built-in ${name} where it lives: rename it to keep both.`
            : `Replaces the global ${name} (from ${other.source}) on this project: rename it to keep both.`,
      }
    else if (row.notReviewer)
      note = { tag: 'not a reviewer', tone: 'muted', text: row.notReviewer }
    return { ...row, note }
  })
}

const CHIP = {
  warn: 'tr-chip tr-chip--warn',
  danger: 'tr-chip tr-chip--danger',
  muted: 'tr-chip',
}

/** A row's kind, as the list says it: a plugin's agent apart from a file's. */
const kindLabel = (match: LensMatch) =>
  match.kind
    ? `${/^[\w-][\w.-]*:/.test(match.source) ? 'plugin ' : ''}${match.kind}`
    : undefined

interface ListProps {
  rows: Row[]
  slots: Slot[]
  frozen: boolean
  onToggle: (source: string) => void
  onSetChecked: (sources: string[], on: boolean) => void
  onRename: (source: string, name: string) => void
}

/** One row to check and rename. */
function MatchRow({
  row,
  id,
  frozen,
  onToggle,
  onRename,
}: {
  row: Row
  id: string
  frozen: boolean
  onToggle: (source: string) => void
  onRename: (source: string, name: string) => void
}) {
  const wrongName = row.checked && row.note?.name === true
  const kind = kindLabel(row)
  return (
    <li
      className={`tr-match${row.present ? ' tr-match--locked' : row.checked ? '' : ' tr-match--off'}`}
    >
      <input
        type="checkbox"
        className="tr-check"
        id={id}
        checked={row.checked}
        disabled={frozen || row.present}
        onChange={() => onToggle(row.source)}
      />
      <span className="tr-match-path">
        {kind && <span className="tr-kind">{kind}</span>}
        <label htmlFor={id}>
          <code>{row.source}</code>
        </label>
      </span>
      <span className="tr-match-name">
        <span aria-hidden="true">→</span>
        <input
          className="tr-input"
          value={row.name}
          aria-label={`Lens name for ${row.source}`}
          aria-invalid={wrongName || undefined}
          aria-describedby={row.note ? `${id}-note` : undefined}
          disabled={frozen || !row.checked}
          onChange={(event) => onRename(row.source, event.currentTarget.value)}
        />
      </span>
      {row.note && (
        <p className="tr-match-note" id={`${id}-note`}>
          <span className={CHIP[row.note.tone]}>{row.note.tag}</span>
          <span className={wrongName ? 'tr-error' : 'tr-muted'}>{row.note.text}</span>
        </p>
      )}
    </li>
  )
}

/** A command's row, or an agent's that starts others: never a lens itself, its checkbox checks the reviewers it starts, listed under it. */
function GroupRow({
  slot,
  index,
  byKey,
  frozen,
  onToggle,
  onSetChecked,
  onRename,
}: Omit<ListProps, 'rows' | 'slots'> & {
  slot: Extract<Slot, { group: LensMatch }>
  index: number
  byKey: Map<string, Row>
}) {
  const { group } = slot
  const kids = slot.kids.flatMap((source) => byKey.get(source) ?? [])
  const free = kids.filter((kid) => !kid.present)
  const on = free.filter((kid) => kid.checked).length
  const present = kids.length - free.length
  const id = `tr-lns-group-${index}`
  const all = free.length > 0 && on === free.length
  const count = group.starts?.length ?? 0
  const note = !count
    ? 'It names no agent Tranchant finds: they are written in it, or are a plugin’s not installed or turned off. None can become a lens.'
    : `It starts ${count === 1 ? '1 agent' : `${count} agents`}: each one below can become a lens.${
        slot.alsoMatched.length
          ? ` ${slot.alsoMatched.join(', ')} ${slot.alsoMatched.length === 1 ? 'matches' : 'match'} the glob too: listed once, here.`
          : ''
      }${kids.length < count ? ` ${count - kids.length} listed under another match above.` : ''}${group.more ? ` ${group.more} more it names, left out.` : ''}`
  return (
    <li className="tr-match tr-match--group">
      <input
        type="checkbox"
        className="tr-check"
        id={id}
        checked={all}
        ref={(box) => {
          if (box) box.indeterminate = on > 0 && !all
        }}
        disabled={frozen || !free.length}
        aria-describedby={`${id}-note`}
        onChange={() =>
          onSetChecked(
            free.map((kid) => kid.source),
            !all,
          )
        }
      />
      <span className="tr-match-path">
        {kindLabel(group) && <span className="tr-kind">{kindLabel(group)}</span>}
        <label htmlFor={id}>
          <code>{group.source}</code>
        </label>
      </span>
      {kids.length > 0 && (
        <span className="tr-match-aside tr-muted">
          {on} of {kids.length === 1 ? 'its agent' : `its ${kids.length} agents`} checked
          {present ? ` · ${present} already a lens` : ''}
        </span>
      )}
      <p className="tr-match-note" id={`${id}-note`}>
        <span className="tr-chip">not a lens itself</span>
        <span className="tr-muted">{note}</span>
      </p>
      {kids.length > 0 && (
        <ul
          className="tr-match-kids"
          aria-label={`The agents ${shortName(group.source)} starts`}
        >
          {kids.map((kid, at) => (
            <MatchRow
              key={kid.source}
              row={kid}
              id={`${id}-${at}`}
              frozen={frozen}
              onToggle={onToggle}
              onRename={onRename}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** The rows, each where its slot puts it: on its own, or under the match that starts it. */
export function MatchList({
  label,
  rows,
  slots,
  frozen,
  onToggle,
  onSetChecked,
  onRename,
}: ListProps & { label: string }) {
  const byKey = new Map(rows.map((row) => [row.source, row]))
  return (
    <ul className="tr-lns-list tr-matches-box" aria-labelledby={label}>
      {slots.map((slot, index) => {
        if ('group' in slot)
          return (
            <GroupRow
              key={`group:${slot.group.source}`}
              slot={slot}
              index={index}
              byKey={byKey}
              frozen={frozen}
              onToggle={onToggle}
              onSetChecked={onSetChecked}
              onRename={onRename}
            />
          )
        const row = byKey.get(slot.source)
        return (
          row && (
            <MatchRow
              key={row.source}
              row={row}
              id={`tr-lns-match-${index}`}
              frozen={frozen}
              onToggle={onToggle}
              onRename={onRename}
            />
          )
        )
      })}
    </ul>
  )
}

/** How many are checked, and the buttons that check them all or none. */
export function MatchesHead({
  title,
  checked,
  frozen,
  onCheckAll,
  onCheckNone,
}: {
  title: string
  checked: number
  frozen: boolean
  onCheckAll: () => void
  onCheckNone: () => void
}) {
  return (
    <div className="tr-matches-head">
      <strong>{title}</strong>
      <span className="tr-muted">{checked} checked</span>
      <button
        type="button"
        className="tr-btn tr-btn--link"
        disabled={frozen}
        onClick={onCheckAll}
      >
        Check all
      </button>
      <button
        type="button"
        className="tr-btn tr-btn--link"
        disabled={frozen}
        onClick={onCheckNone}
      >
        Check none
      </button>
    </div>
  )
}

/** Past MAX_BATCH checked, the batch waits: said under the list. */
const tooMany = (checked: number) =>
  checked > MAX_BATCH
    ? `At most ${MAX_BATCH} lenses at a time: uncheck ${checked - MAX_BATCH}. `
    : ''

type PickProps = Omit<ListProps, 'rows' | 'slots'> & {
  rows: Row[]
  slots: Slot[]
  onCheckAll: () => void
  onCheckNone: () => void
}

/** A glob's matches, each to check and rename, a command's under it; or the files of the folder a glob that matched nothing looked in. */
export function GlobMatches({
  look,
  ...pick
}: PickProps & {
  look: Look<LensMatches>
}) {
  const checked = pick.rows.filter((row) => row.checked).length
  let body: React.ReactNode
  if (look.state === 'idle' || look.state === 'loading')
    body = <p className="tr-muted">Looking for the files it matches…</p>
  else if (look.state === 'error')
    body = <p className="tr-recipe-problem">{look.error}</p>
  else if (!look.answer.matches.length)
    body = (
      <>
        <p className="tr-lns-empty tr-matches-box" role="status">
          No file matches <code>{look.key}</code>
          {/^[~/]/.test(look.key) ? '' : ' from the project’s root'}. Nothing will run.
        </p>
        {look.answer.folder && <FolderHelp folder={look.answer.folder} />}
      </>
    )
  else {
    const { matches, more } = look.answer
    const groups = matches.some((one) => one.starts)
    body = (
      <>
        <MatchesHead
          title={
            matches.length === 1 ? '1 file matches' : `${matches.length} files match`
          }
          checked={checked}
          {...pick}
        />
        <MatchList label="tr-lns-add-matches" {...pick} />
        <span className="tr-field-help">
          {tooMany(checked)}
          {more
            ? `${more} more ${more === 1 ? 'file matches' : 'files match'}, left out: narrow the glob to add them. `
            : ''}
          Each lens is named after its file; rename one before it is cleaned. Unchecked, a
          file is left out
          {groups ? '; a command’s checkbox checks or unchecks all its agents.' : '.'}
        </span>
      </>
    )
  }
  return (
    <div className="tr-field">
      <span className="tr-field-label" id="tr-lns-add-matches">
        Matches
      </span>
      <div className="tr-field-body tr-matches">{body}</div>
    </div>
  )
}

/** The sources checked in Browse, one row each to uncheck and rename. */
export function PickedMatches(pick: PickProps) {
  const checked = pick.rows.filter((row) => row.checked).length
  return (
    <div className="tr-field">
      <span className="tr-field-label" id="tr-lns-add-picked">
        Picked
      </span>
      <div className="tr-field-body tr-matches">
        <MatchesHead title={`${pick.rows.length} sources`} checked={checked} {...pick} />
        <MatchList label="tr-lns-add-picked" {...pick} />
        <span className="tr-field-help">
          {tooMany(checked)}
          Each lens is named after its source; rename one before it is cleaned. Unchecked,
          it is left out. Browse again to check more: the ones here stay checked.
        </span>
      </div>
    </div>
  )
}

/** A source typed whole that could not be read for the agents it starts: added as one reviewer, said so. */
export function InsideUnread({ source, error }: { source: string; error: string }) {
  return (
    <div className="tr-field">
      <span className="tr-field-label">Its agents</span>
      <div className="tr-field-body tr-matches">
        <p className="tr-recipe-problem" role="status">
          <code>{shortName(source)}</code> could not be read for the agents it starts:{' '}
          {error}. Import cleans it as one reviewer; type the source again to read it
          anew.
        </p>
      </div>
    </div>
  )
}

/** While a source typed whole is read for the agents it starts: Add waits. */
export function ReadingSource({ source }: { source: string }) {
  return (
    <div className="tr-field">
      <span className="tr-field-label">Its agents</span>
      <div className="tr-field-body tr-matches">
        <p className="tr-reading" role="status">
          <span className="tr-spinner" aria-hidden="true" />
          <span>
            Reading <code>{shortName(source)}</code> for the agents it starts…
          </span>
          <span className="tr-muted">a read of the file, no agent</span>
        </p>
      </div>
    </div>
  )
}

/**
 * The reviewers inside a source: a command, or an agent that starts
 * others. Each to check and rename; none found, said, and an agent may look.
 */
export function InsideMatches({
  inside,
  ...pick
}: PickProps & {
  inside: NonNullable<LensInside['inside']>
}) {
  const name = shortName(inside.label)
  const checked = pick.rows.filter((row) => row.checked).length
  const count = inside.starts.length
  let body: React.ReactNode
  if (!count)
    body = (
      <>
        <p className="tr-lns-empty tr-matches-box" role="status">
          <strong>
            No agent Tranchant finds in <code>{name}</code>.
          </strong>{' '}
          Its read, with no agent, finds no agent or skill it names, by name beside it, in
          the project or yours, or as an installed <code>plugin:name</code>.
        </p>
        <span className="tr-field-help">
          An agent can read <code>{name}</code> with what it points to: it makes one lens
          of a single review, or lists the reviewers it starts, files or instructions
          written in it, for you to pick. That is one agent’s run.
        </span>
      </>
    )
  else
    body = (
      <>
        <MatchesHead
          title={`${name} ${inside.kind === 'command' ? 'is a command: it starts' : 'starts'} ${count === 1 ? '1 agent' : `${count} agents`}`}
          checked={checked}
          {...pick}
        />
        <MatchList label="tr-lns-add-inside" {...pick} />
        <span className="tr-field-help">
          {tooMany(checked)}
          {inside.more ? `${inside.more} more it names, left out. ` : ''}
          Each can become a lens; {name} itself cannot, it is a whole process. Each lens
          is named after its agent; rename one before it is cleaned.
        </span>
      </>
    )
  return (
    <div className="tr-field">
      <span className="tr-field-label" id="tr-lns-add-inside">
        Its agents
      </span>
      <div className="tr-field-body tr-matches">{body}</div>
    </div>
  )
}

/** The folder a glob that matched nothing looked in: its files, to mend the glob. */
function FolderHelp({ folder }: { folder: NonNullable<LensMatches['folder']> }) {
  if (folder.unreadable)
    return (
      <span className="tr-field-help">
        <code>{folder.label}</code> cannot be read ({folder.unreadable}): Tranchant may
        not open it.
      </span>
    )
  if (folder.missing)
    return (
      <span className="tr-field-help">
        There is no folder <code>{folder.label}</code>.
      </span>
    )
  if (!folder.count)
    return (
      <span className="tr-field-help">
        <code>{folder.label}</code> is empty.
      </span>
    )
  return (
    <span className="tr-field-help">
      <code>{folder.label}</code> holds{' '}
      {folder.count === 1 ? '1 file' : `${folder.count} files`}:{' '}
      {folder.files.map((file, i) => (
        <span key={file}>
          {i > 0 && ', '}
          <code>{file}</code>
        </span>
      ))}
      {folder.count > folder.files.length ? '…' : '.'}
    </span>
  )
}
