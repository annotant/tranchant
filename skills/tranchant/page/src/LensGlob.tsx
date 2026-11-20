import { useEffect, useState } from 'react'
import { fetchLensMatches, type LensMatch, type LensMatches } from './api'
import type { LensEntry } from './settings'

/** Whether a source is a glob: a `*` or a `?`, as the server reads it; a `[` is part of a path. */
export const isGlob = (source: string) => /[*?]/.test(source)

const LENS_NAME = /^[\w-]{1,40}$/
/** Typing settles before the server is asked: one look per pause, not per key. */
const SETTLE_MS = 300

type Found =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; error: string }
  | ({ state: 'done'; glob: string } & LensMatches)

/** A match as the form shows it: checked or not, under the name it will get. */
export interface Row extends LensMatch {
  checked: boolean
  note?: Note | undefined
}

interface Note {
  tag: string
  text: string
  tone: 'warn' | 'danger' | 'muted'
  /** Checked, it keeps the batch from being added: rename it, or uncheck it. */
  blocks?: boolean
}

/**
 * The files `glob` matches, asked once typing settles; and which are
 * checked, under which names. A match that reads as no reviewer starts
 * unchecked; the others checked.
 */
export function useGlobPick(glob: string) {
  const [answer, setAnswer] = useState<{ glob: string; found: Found }>()
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!glob) return undefined
    let disposed = false
    const timer = setTimeout(() => {
      void (async () => {
        let found: Found
        let unchecked: string[] = []
        try {
          const matches = await fetchLensMatches(glob)
          found = { state: 'done', glob, ...matches }
          unchecked = matches.matches
            .filter((one) => one.notReviewer)
            .map((one) => one.source)
        } catch (error) {
          found = {
            state: 'error',
            error: error instanceof Error ? error.message : String(error),
          }
        }
        if (disposed) return
        setAnswer({ glob, found })
        setOff(new Set(unchecked))
        setNames({})
      })()
    }, SETTLE_MS)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [glob])
  // An answer for another glob is stale: this one is still being looked for.
  const found: Found = !glob
    ? { state: 'idle' }
    : answer?.glob === glob
      ? answer.found
      : { state: 'loading' }
  const matches = found.state === 'done' ? found.matches : []
  return {
    found,
    rows: matches.map((one) => ({
      ...one,
      name: names[one.source] ?? one.name,
      checked: !off.has(one.source),
    })),
    toggle: (source: string) =>
      setOff((now) => {
        const next = new Set(now)
        if (!next.delete(source)) next.add(source)
        return next
      }),
    rename: (source: string, name: string) =>
      setNames((now) => ({ ...now, [source]: name })),
    checkAll: () => setOff(new Set()),
    checkNone: () => setOff(new Set(matches.map((one) => one.source))),
  }
}

const SCOPE_WORD = { local: "This project's", global: 'The global' } as const

/**
 * What a match's row says of it: a name that cannot be, or is taken where
 * it would live, or twice in the batch, blocks it; one that wins over a
 * lens of another scope says which; one that is no reviewer says why.
 */
export function noteRows(
  rows: (LensMatch & { checked: boolean })[],
  scope: 'local' | 'global',
  lenses: LensEntry[],
): Row[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const name = row.name.trim()
    const twice = row.checked && seen.has(name)
    if (row.checked) seen.add(name)
    const named = lenses.filter((lens) => lens.name === name)
    const same = named.find((lens) => lens.scope === scope)
    const local = named.find((lens) => lens.scope === 'local' && lens.on)
    const other = named.find((lens) => lens.scope !== scope && lens.runs)
    let note: Note | undefined
    if (!LENS_NAME.test(name))
      note = {
        tag: 'not a name',
        tone: 'danger',
        text: 'A lens name is letters, digits, - and _ only, 40 at most.',
        blocks: true,
      }
    else if (same)
      note = {
        tag: 'taken',
        tone: 'danger',
        text: `${SCOPE_WORD[scope]} ${name} (from ${same.source}) has this name: rename this one, or uncheck it.`,
        blocks: true,
      }
    else if (twice)
      note = {
        tag: 'twice',
        tone: 'danger',
        text: 'Another match above has this name: rename one.',
        blocks: true,
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

/** A glob's matches, each to check and rename; or the files of the folder a glob that matched nothing looked in. */
export function GlobMatches({
  found,
  rows,
  frozen,
  onToggle,
  onRename,
  onCheckAll,
  onCheckNone,
}: {
  found: Found
  rows: Row[]
  frozen: boolean
  onToggle: (source: string) => void
  onRename: (source: string, name: string) => void
  onCheckAll: () => void
  onCheckNone: () => void
}) {
  const checked = rows.filter((row) => row.checked).length
  let body: React.ReactNode
  if (found.state === 'idle' || found.state === 'loading')
    body = <p className="tr-muted">Looking for the files it matches…</p>
  else if (found.state === 'error')
    body = <p className="tr-recipe-problem">{found.error}</p>
  else if (!found.matches.length)
    body = (
      <>
        <p className="tr-lns-empty tr-matches-box" role="status">
          No file matches <code>{found.glob}</code>
          {/^[~/]/.test(found.glob) ? '' : ' from the project’s root'}. Nothing will run.
        </p>
        {found.folder && <FolderHelp folder={found.folder} />}
      </>
    )
  else
    body = (
      <>
        <div className="tr-matches-head">
          <strong>
            {found.matches.length === 1
              ? '1 file matches'
              : `${found.matches.length} files match`}
          </strong>
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
        <ul className="tr-lns-list tr-matches-box" aria-labelledby="tr-lns-add-matches">
          {rows.map((row, index) => {
            const id = `tr-lns-match-${index}`
            return (
              <li
                key={row.source}
                className={`tr-match${row.checked ? '' : ' tr-match--off'}`}
              >
                <input
                  type="checkbox"
                  className="tr-check"
                  id={id}
                  checked={row.checked}
                  disabled={frozen}
                  onChange={() => onToggle(row.source)}
                />
                <label htmlFor={id} className="tr-match-path">
                  <code>{row.source}</code>
                </label>
                <span className="tr-match-name">
                  <span aria-hidden="true">→</span>
                  <input
                    className="tr-input"
                    value={row.name}
                    aria-label={`Lens name for ${row.source}`}
                    aria-invalid={row.checked && row.note?.blocks ? true : undefined}
                    disabled={frozen || !row.checked}
                    onChange={(event) => onRename(row.source, event.currentTarget.value)}
                  />
                </span>
                {row.note && (
                  <p className="tr-match-note">
                    <span className={CHIP[row.note.tone]}>{row.note.tag}</span>
                    <span className="tr-muted">{row.note.text}</span>
                  </p>
                )}
              </li>
            )
          })}
        </ul>
        <span className="tr-field-help">
          {found.more
            ? `${found.more} more ${found.more === 1 ? 'file matches' : 'files match'}, left out: narrow the glob to add them. `
            : ''}
          Each lens is named after its file; rename one before it is cleaned. Unchecked, a
          file is left out.
        </span>
      </>
    )
  return (
    <div className="tr-field">
      <span className="tr-field-label" id="tr-lns-add-matches">
        Matches
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
