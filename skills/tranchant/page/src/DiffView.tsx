// Hunks have no identity but their place in the file: a new diff, or two joined, re-renders those after.
/* oxlint-disable react/no-array-index-key */
import { Fragment, useEffect, useState } from 'react'
import type { DiffStat, FileUnfold } from './api'
import { type DiffFile, type Gap, gapsOf, marksInDiff, type Section } from './diff'
import {
  type Finding,
  type Records,
  STATE_DETAILS,
  stateClass,
  stateLabel,
  stateOf,
} from './domain'
import { CodeFrame, CodeRows, digitsOf, NO_MARKS } from './Excerpt'
import { CommentMark, DiscussionMark } from './FindingList'
import { languageOfFile } from './syntax'

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
  commented: boolean
  /** The messages of its discussion; none, 0. */
  discussed: number
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
  commented,
  discussed,
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
        <span className={stateClass(state)} title={STATE_DETAILS[state]}>
          {stateLabel(state)}
        </span>
        <span className="tr-chip">{finding.topic}</span>
        {unverified && <span className="tr-chip">unverified</span>}
        <span className="tr-marker-title">{finding.title}</span>
        {commented && <CommentMark />}
        {discussed > 0 && <DiscussionMark count={discussed} />}
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
  /** The findings with a comment ready to post: marked. */
  commented?: ReadonlySet<string> | undefined
  /** By finding, the messages of its discussion: marked with their count. */
  discussed?: ReadonlyMap<string, number> | undefined
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
  commented,
  discussed,
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
          commented={commented?.has(finding.id) ?? false}
          discussed={discussed?.get(finding.id) ?? 0}
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

/** How many hidden lines a click unfolds. */
const UNFOLD_STEP = 20

/** What the rows of hidden lines need: without `onUnfold`, the view has none. */
interface UnfoldProps {
  /** By path, what the reader unfolded. */
  unfolds?: ReadonlyMap<string, FileUnfold> | undefined
  /** The server does not answer: nothing can be unfolded. */
  offline?: boolean | undefined
  onUnfold?: ((path: string, from: number, to: number) => void) | undefined
}

interface GapProps {
  gap: Gap
  /** Below the last hunk: lines only unfold downwards. */
  last: boolean
  unfold: FileUnfold | undefined
  offline: boolean
  onUnfold: (from: number, to: number) => void
}

const lines = (count: number) => `${count} ${count === 1 ? 'line' : 'lines'}`

type Toward = 'up' | 'all' | 'down'

const ARROWS: Record<Toward, string> = {
  up: 'M5 4h14M12 20V9M7 13l5-5 5 5',
  all: 'M12 3v6M9 6l3-3 3 3M12 21v-6M9 18l3 3 3-3M5 12h14',
  down: 'M5 20h14M12 4v11M7 11l5 5 5-5',
}

/**
 * The lines the diff hides at one place, as a bar: all of them, and for a long
 * gap 20 more next to the hunk below, or the one above.
 */
function GapRow({ gap, last, unfold, offline, onUnfold }: GapProps) {
  const { from, to } = gap
  const size = to === undefined ? undefined : to - from + 1
  const reason = offline ? 'offline' : unfold?.error
  const disabled = !!reason || !!unfold?.pending
  const long = size === undefined || size > UNFOLD_STEP
  const actions: { toward: Toward; text: string; label: string; to: number }[] = []
  if (long && !last && to !== undefined) {
    actions.push({
      toward: 'up',
      text: `${UNFOLD_STEP} more lines`,
      label: `Show ${UNFOLD_STEP} more lines above line ${to + 1}`,
      to,
    })
  }
  actions.push(
    size === undefined || to === undefined
      ? {
          toward: 'all',
          text: 'Show to the end',
          label: `Show the lines below line ${from - 1}`,
          // The server stops at the file's end.
          to: Number.MAX_SAFE_INTEGER,
        }
      : {
          toward: 'all',
          text: `Show all ${size}`,
          label: `Show ${lines(size)}, ${from} to ${to}`,
          to,
        },
  )
  if (long && gap.below > 0) {
    actions.push({
      toward: 'down',
      text: `${UNFOLD_STEP} more lines`,
      label: `Show ${UNFOLD_STEP} more lines below line ${from - 1}`,
      to: Math.min(to ?? Infinity, from + UNFOLD_STEP - 1),
    })
  }
  return (
    <div className="tr-gap" role="group" aria-label={`Hidden lines from ${from}`}>
      <span>{size === undefined ? 'More lines below' : `${lines(size)} hidden`}</span>
      <span className="tr-gap-sep" aria-hidden="true">
        ·
      </span>
      {actions.map((action) => (
        <button
          key={action.toward}
          type="button"
          className="tr-gap-action"
          aria-label={action.label}
          disabled={disabled}
          onClick={() =>
            onUnfold(
              action.toward === 'up' ? action.to - UNFOLD_STEP + 1 : from,
              action.to,
            )
          }
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path d={ARROWS[action.toward]} />
          </svg>
          {action.text}
        </button>
      ))}
      {unfold?.pending && <span className="tr-spinner" aria-hidden="true" />}
      {reason && <span className="tr-gap-reason">{reason}</span>}
    </div>
  )
}

type ViewProps = MarkerState &
  UnfoldProps & {
    sections: readonly Section[]
    stats: ReadonlyMap<string, DiffStat>
  }

type SectionProps = MarkerState &
  UnfoldProps & {
    section: Section
    index: number
    stat: DiffStat | undefined
  }

function FileSection({
  section,
  index,
  stat,
  unfolds,
  offline = false,
  onUnfold,
  ...state
}: SectionProps) {
  const { file } = section
  const { open } = state
  // One gutter for the file: its hunks line up.
  const digits = digitsOf(file?.hunks.flatMap((hunk) => hunk.rows) ?? [])
  const status = file ? STATUS_WORDS[file.status] : 'not in the diff'
  const opened = open?.path === section.path ? open : undefined
  const marks = opened && file ? marksInDiff(opened, file) : NO_MARKS
  const language = languageOfFile(section.path)
  const under = new Map(
    [...section.lines].map(([line, stack]) => [
      line,
      <Markers key={line} {...state} findings={stack} />,
    ]),
  )
  const gaps = file && onUnfold ? gapsOf(file) : []
  const gapRow = (below: number) => {
    const gap = gaps.find((one) => one.below === below)
    return (
      gap &&
      onUnfold && (
        <GapRow
          gap={gap}
          last={below === file?.hunks.length}
          unfold={unfolds?.get(section.path)}
          offline={offline}
          onUnfold={(from, to) => onUnfold(section.path, from, to)}
        />
      )
    )
  }
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
            finding.thread?.file
              ? 'on the whole file'
              : finding.thread?.outdated
                ? 'outdated: the code it was on moved since'
                : file
                  ? `line ${finding.line} is not in the diff`
                  : 'the diff does not touch this file'
          }
        />
      )}
      {file && file.hunks.length > 0 && (
        // One frame for the file: the hidden lines' bars run across it, between its hunks.
        <CodeFrame signed digits={digits}>
          {file.hunks.map((hunk, at) => (
            <Fragment key={at}>
              {gapRow(at)}
              <div className="tr-hunk">
                <CodeRows
                  rows={hunk.rows}
                  signed
                  anchor={opened?.line}
                  marks={marks}
                  under={under}
                  language={language}
                />
              </div>
            </Fragment>
          ))}
          {gapRow(file.hunks.length)}
        </CodeFrame>
      )}
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
