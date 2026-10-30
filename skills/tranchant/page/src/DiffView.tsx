// Hunks have no identity but their place in the file: a new diff re-renders them all.
/* oxlint-disable react/no-array-index-key */
import { useEffect } from 'react'
import { type DiffFile, marksInDiff, type Section } from './diff'
import { type Finding, type Records, STATE_LABELS, stateOf } from './domain'
import { CodeRows, digitsOf } from './Excerpt'

/** A file's counts, as `/api/diff` lists them. */
interface FileStat {
  path: string
  additions: number
  deletions: number
  binary: boolean
}

const markerId = (id: string) => `tr-marker-${id}`
export const fileId = (index: number) => `tr-file-${index}`

/** Scrolls the element with `id` into view, when the browser lays out (happy-dom does not). */
export function scrollTo(id: string, block: ScrollLogicalPosition) {
  const element = document.getElementById(id)
  if (typeof element?.scrollIntoView === 'function') element.scrollIntoView({ block })
}

interface MarkerProps {
  finding: Finding
  records: Records
  focused: boolean
  open: boolean
  checked: boolean
  /** Why the finding sits on the header rather than on its line. */
  note?: string | undefined
  onOpen: (id: string) => void
  onToggle: (id: string) => void
}

/** A finding at its place in the diff: its state, topic and title; a click opens it. */
function Marker({
  finding,
  records,
  focused,
  open,
  checked,
  note,
  onOpen,
  onToggle,
}: MarkerProps) {
  const state = stateOf(records, finding.id)
  return (
    <div
      id={markerId(finding.id)}
      className={`tr-marker ${focused ? 'tr-marker--focused' : ''} ${open ? 'tr-marker--open' : ''}`}
    >
      <input
        type="checkbox"
        className="tr-check"
        checked={checked}
        onChange={() => onToggle(finding.id)}
        aria-label={`Select ${finding.title}`}
      />
      <button
        type="button"
        className="tr-marker-main"
        onClick={() => onOpen(finding.id)}
        aria-current={open ? 'true' : undefined}
      >
        <span className={`tr-chip tr-chip--${state}`}>{STATE_LABELS[state]}</span>
        <span className="tr-chip">{finding.topic}</span>
        <span className="tr-marker-title">{finding.title}</span>
        {note && <span className="tr-marker-note">{note}</span>}
      </button>
    </div>
  )
}

const STATUS_WORDS: Record<DiffFile['status'], string | undefined> = {
  added: 'new file',
  deleted: 'deleted',
  renamed: 'renamed',
  modified: undefined,
}

function Stat({ stat }: { stat: FileStat | undefined }) {
  if (!stat || stat.binary) return null
  return (
    <span className="tr-stat">
      <span className="tr-stat-add">+{stat.additions}</span>{' '}
      <span className="tr-stat-del">−{stat.deletions}</span>
    </span>
  )
}

interface ViewProps {
  sections: readonly Section[]
  stats: ReadonlyMap<string, FileStat>
  records: Records
  /** The finding the keyboard is on. */
  cursor: string | undefined
  /** The finding the detail shows: its row is set apart, with its marks. */
  open: Finding | undefined
  selected: ReadonlySet<string>
  onOpen: (id: string) => void
  onToggle: (id: string) => void
}

type SectionProps = ViewProps & { section: Section; index: number }

function FileSection({ section, index, stats, open, ...marker }: SectionProps) {
  const { file } = section
  const digits = digitsOf(file?.hunks.flatMap((hunk) => hunk.rows) ?? [])
  const status = file ? STATUS_WORDS[file.status] : 'not in the diff'
  const markers = (findings: readonly Finding[], note?: (finding: Finding) => string) => (
    <div className="tr-markers">
      {findings.map((finding) => (
        <Marker
          key={finding.id}
          finding={finding}
          records={marker.records}
          focused={marker.cursor === finding.id}
          open={open?.id === finding.id}
          checked={marker.selected.has(finding.id)}
          note={note?.(finding)}
          onOpen={marker.onOpen}
          onToggle={marker.onToggle}
        />
      ))}
    </div>
  )
  return (
    <section className="tr-file" id={fileId(index)} aria-label={section.path}>
      <header className="tr-file-head">
        <code className="tr-file-path">{section.path}</code>
        {file?.oldPath && <code className="tr-muted">from {file.oldPath}</code>}
        {status && (
          <span className={`tr-chip ${file ? '' : 'tr-chip--warn'}`}>{status}</span>
        )}
        {file?.binary && <span className="tr-chip">binary</span>}
        <Stat stat={stats.get(section.path)} />
      </header>
      {section.header.length > 0 &&
        markers(section.header, (finding) =>
          file
            ? `line ${finding.line} is not in the diff`
            : 'the diff does not touch this file',
        )}
      {file?.hunks.map((hunk, at) => (
        <div
          key={at}
          className="tr-code tr-code--hunk"
          style={{ '--tr-digits': `${digits}ch`, '--tr-sign': '1ch' }}
        >
          <CodeRows
            rows={hunk.rows}
            signed
            anchor={open?.path === section.path ? open.line : undefined}
            marks={open?.path === section.path ? marksInDiff(open, hunk.rows) : undefined}
            under={(line) => {
              const stack = section.lines.get(line)
              return stack ? markers(stack) : null
            }}
          />
        </div>
      ))}
    </section>
  )
}

/** The diff, file by file, every finding a marker under its line. */
export function DiffView(props: ViewProps) {
  const { sections, cursor } = props
  useEffect(() => {
    if (cursor) scrollTo(markerId(cursor), 'center')
  }, [cursor])
  return (
    <div className="tr-diff">
      {sections.map((section, index) => (
        <FileSection key={section.path} {...props} section={section} index={index} />
      ))}
    </div>
  )
}

interface ListProps {
  sections: readonly Section[]
  stats: ReadonlyMap<string, FileStat>
  onPick: (index: number) => void
}

const countOf = (section: Section) =>
  section.header.length +
  [...section.lines.values()].reduce((sum, stack) => sum + stack.length, 0)

/** The change's files, with their counts and how many findings each holds. */
export function FileList({ sections, stats, onPick }: ListProps) {
  return (
    <ul className="tr-files" aria-label="Files">
      {sections.map((section, index) => {
        const slash = section.path.lastIndexOf('/')
        const count = countOf(section)
        return (
          <li key={section.path}>
            <button
              type="button"
              className="tr-file-item"
              onClick={() => onPick(index)}
              title={section.path}
            >
              <span className="tr-file-name">
                {slash !== -1 && (
                  <span className="tr-file-dir">{section.path.slice(0, slash + 1)}</span>
                )}
                <span className="tr-file-base">{section.path.slice(slash + 1)}</span>
              </span>
              <span className="tr-file-meta">
                {count > 0 && (
                  <span className="tr-count" aria-label={`${count} findings`}>
                    {count}
                  </span>
                )}
                <Stat stat={stats.get(section.path)} />
                {!section.file && <span className="tr-muted">not in the diff</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
