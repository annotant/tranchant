// Hunks have no identity but their place in the file: a new diff re-renders them all.
/* oxlint-disable react/no-array-index-key */
import { useEffect, useState } from 'react'
import type { DiffStat } from './api'
import { type DiffFile, marksInDiff, type Section } from './diff'
import { type Finding, type Records, STATE_DETAILS, stateLabel, stateOf } from './domain'
import { CodeBlock, digitsOf, NO_MARKS } from './Excerpt'

const markerId = (id: string) => `tr-marker-${id}`
export const fileId = (index: number) => `tr-file-${index}`
const fileItemId = (index: number) => `tr-file-item-${index}`

export function scrollTo(id: string, block: ScrollLogicalPosition) {
  document.getElementById(id)?.scrollIntoView({ block })
}

/** How far below the pane's top a file's top may sit and still count as reached. */
const REACHED_PX = 4

/**
 * The file being read: the last one whose top reached the pane's top, or the
 * last one once the pane is scrolled to its end, where a short file never reaches it.
 */
export function readingIndex(
  tops: readonly number[],
  paneTop: number,
  atEnd: boolean,
): number {
  if (atEnd) return Math.max(0, tops.length - 1)
  return tops.reduce(
    (reading, top, index) => (top <= paneTop + REACHED_PX ? index : reading),
    0,
  )
}

/** The index of the file the reader is on in `pane`, followed as it scrolls. */
export function useReadingFile(pane: HTMLElement | null, sections: readonly Section[]) {
  const [reading, setReading] = useState(0)
  useEffect(() => {
    if (!pane || !sections.length) return undefined
    let frame = 0
    const measure = () => {
      frame = 0
      const tops = [...pane.querySelectorAll('.tr-file')].map(
        (file) => file.getBoundingClientRect().top,
      )
      const scrolls = pane.scrollHeight > pane.clientHeight
      const atEnd = scrolls && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2
      setReading(readingIndex(tops, pane.getBoundingClientRect().top, atEnd))
    }
    const schedule = () => {
      frame ||= requestAnimationFrame(measure)
    }
    measure()
    pane.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      pane.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
    }
  }, [pane, sections])
  return reading
}

interface MarkerProps {
  finding: Finding
  records: Records
  focused: boolean
  open: boolean
  checked: boolean
  unverified: boolean
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
  unverified,
  note,
  onOpen,
  onToggle,
}: MarkerProps) {
  const state = stateOf(records, finding.id)
  return (
    <div
      id={markerId(finding.id)}
      className={`tr-marker ${focused ? 'tr-marker--focused' : ''} ${open ? 'tr-marker--open' : ''} ${unverified ? 'tr-unverified' : ''}`}
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
        <span className={`tr-chip tr-chip--${state}`} title={STATE_DETAILS[state]}>
          {stateLabel(state)}
        </span>
        <span className="tr-chip">{finding.topic}</span>
        {unverified && <span className="tr-chip">unverified</span>}
        <span className="tr-marker-title">{finding.title}</span>
        {note && <span className="tr-marker-note">{note}</span>}
      </button>
    </div>
  )
}

/** What every marker of the view shares. */
interface MarkerState {
  records: Records
  /** The finding the keyboard is on. */
  cursor: string | undefined
  /** The finding the detail shows: its row is set apart, with its marks. */
  open: Finding | undefined
  selected: ReadonlySet<string>
  /** The findings no verifier confirmed yet: dimmed. */
  unverified?: ReadonlySet<string> | undefined
  onOpen: (id: string) => void
  onToggle: (id: string) => void
}

type MarkersProps = MarkerState & {
  findings: readonly Finding[]
  note?: ((finding: Finding) => string) | undefined
}

/** The findings stacked at one place: a line, or a file's header. */
function Markers({
  findings,
  note,
  cursor,
  open,
  selected,
  unverified,
  ...shared
}: MarkersProps) {
  return (
    <div className="tr-markers">
      {findings.map((finding) => (
        <Marker
          key={finding.id}
          {...shared}
          finding={finding}
          focused={cursor === finding.id}
          open={open?.id === finding.id}
          checked={selected.has(finding.id)}
          unverified={unverified?.has(finding.id) ?? false}
          note={note?.(finding)}
        />
      ))}
    </div>
  )
}

const STATUS_WORDS: Record<DiffFile['status'], string | undefined> = {
  added: 'new file',
  deleted: 'deleted',
  renamed: 'renamed',
  modified: undefined,
}

function Stat({ stat }: { stat: DiffStat | undefined }) {
  if (!stat || stat.binary) return null
  return (
    <span className="tr-stat">
      <span className="tr-stat-add">+{stat.additions}</span>{' '}
      <span className="tr-stat-del">−{stat.deletions}</span>
    </span>
  )
}

type ViewProps = MarkerState & {
  sections: readonly Section[]
  stats: ReadonlyMap<string, DiffStat>
}

type SectionProps = MarkerState & {
  section: Section
  index: number
  stat: DiffStat | undefined
}

function FileSection({ section, index, stat, ...state }: SectionProps) {
  const { file } = section
  const { open } = state
  // One gutter for the file: its hunks line up.
  const digits = digitsOf(file?.hunks.flatMap((hunk) => hunk.rows) ?? [])
  const status = file ? STATUS_WORDS[file.status] : 'not in the diff'
  const opened = open?.path === section.path ? open : undefined
  const marks = opened && file ? marksInDiff(opened, file) : NO_MARKS
  const under = new Map(
    [...section.lines].map(([line, stack]) => [
      line,
      <Markers key={line} {...state} findings={stack} />,
    ]),
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
        <Stat stat={stat} />
      </header>
      {section.header.length > 0 && (
        <Markers
          {...state}
          findings={section.header}
          note={(finding) =>
            file
              ? `line ${finding.line} is not in the diff`
              : 'the diff does not touch this file'
          }
        />
      )}
      {file?.hunks.map((hunk, at) => (
        <CodeBlock
          key={at}
          rows={hunk.rows}
          signed
          digits={digits}
          anchor={opened?.line}
          marks={marks}
          under={under}
        />
      ))}
    </section>
  )
}

/**
 * The diff, file by file: every finding a marker under its line, or on its
 * file's header when the diff does not show that line or that file.
 */
export function DiffView({ sections, stats, ...state }: ViewProps) {
  const { cursor } = state
  useEffect(() => {
    if (cursor) scrollTo(markerId(cursor), 'center')
  }, [cursor])
  return (
    <div className="tr-diff">
      {sections.map((section, index) => (
        <FileSection
          key={section.path}
          {...state}
          section={section}
          index={index}
          stat={stats.get(section.path)}
        />
      ))}
    </div>
  )
}

interface ListProps {
  sections: readonly Section[]
  stats: ReadonlyMap<string, DiffStat>
  /** The index of the file the reader is on in the diff. */
  reading: number
  onPick: (index: number) => void
}

const countOf = (section: Section) =>
  section.header.length +
  [...section.lines.values()].reduce((sum, stack) => sum + stack.length, 0)

/**
 * The diff's files, then the paths findings name that it does not touch:
 * their counts, how many findings each holds, and the one being read.
 */
export function FileList({ sections, stats, reading, onPick }: ListProps) {
  useEffect(() => {
    document.getElementById(fileItemId(reading))?.scrollIntoView({ block: 'nearest' })
  }, [reading])
  return (
    <ul className="tr-files" aria-label="Files">
      {sections.map((section, index) => {
        const slash = section.path.lastIndexOf('/')
        const count = countOf(section)
        const read = index === reading
        return (
          <li key={section.path}>
            <button
              type="button"
              id={fileItemId(index)}
              className={`tr-file-item ${read ? 'tr-file-item--reading' : ''}`}
              aria-current={read ? 'location' : undefined}
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
