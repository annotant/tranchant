// Rows, segments and notes have no identity but their place: a new excerpt re-renders them all.
/* oxlint-disable react/no-array-index-key */
import type { ReactNode } from 'react'
import type { Excerpt as ExcerptText, Mark } from './domain'
import { type Language, sliceTokens, spans, type Token, tokens } from './syntax'

type RowKind = 'context' | 'added' | 'removed' | 'header' | 'meta'

export interface Row {
  kind: RowKind
  /** New-side line number; none for a removed line or a hunk header. */
  number?: number
  text: string
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** The lines of a unified-diff hunk, numbered on the new side. */
export function parseHunk(hunk: string): Row[] {
  const rows: Row[] = []
  let next = 1
  for (const line of hunk.replace(/\r\n?/g, '\n').split('\n')) {
    const header = HUNK_HEADER.exec(line)
    if (header) {
      next = Number(header[1])
      rows.push({ kind: 'header', text: line })
      continue
    }
    const sign = line.charAt(0)
    const text = line.slice(1)
    if (sign === '+') rows.push({ kind: 'added', number: next++, text })
    else if (sign === '-') rows.push({ kind: 'removed', text })
    else if (sign === '\\') rows.push({ kind: 'meta', text: line })
    else rows.push({ kind: 'context', number: next++, text })
  }
  // A trailing newline in the hunk is not a context line.
  const last = rows.at(-1)
  if (last?.kind === 'context' && last.text === '' && hunk.endsWith('\n')) rows.pop()
  return rows
}

const plainRows = (excerpt: ExcerptText): Row[] =>
  excerpt.lines.map((text, index) => ({
    kind: 'context',
    number: excerpt.startLine + index,
    text,
  }))

interface Segment {
  text: string
  marked: boolean
}

/** The line cut where column marks start and end; empty marks mark nothing. */
export function segments(text: string, marks: readonly Mark[]): Segment[] {
  const flags = Array.from({ length: text.length }, () => false)
  for (const mark of marks) {
    const from = Math.max(0, mark.from ?? 0)
    const to = Math.min(text.length, mark.to ?? text.length)
    for (let column = from; column < to; column++) flags[column] = true
  }
  const result: Segment[] = []
  for (let column = 0; column < text.length; column++) {
    const marked = flags[column] ?? false
    const last = result.at(-1)
    if (last && last.marked === marked) last.text += text.charAt(column)
    else result.push({ text: text.charAt(column), marked })
  }
  return result
}

const isColumnMark = (mark: Mark) => mark.from !== undefined || mark.to !== undefined

export const NO_MARKS: readonly Mark[] = []

// In a hunk every row carries a sign column, so marks keep their columns.
const signOf = (row: Row) =>
  row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '

/** The gutter's width: the longest line number, two digits at least. */
export const digitsOf = (rows: readonly Row[]) =>
  Math.max(
    2,
    ...rows.map((row) => (row.number === undefined ? 0 : String(row.number).length)),
  )

interface RowsProps {
  rows: readonly Row[]
  marks?: readonly Mark[] | undefined
  /** The finding's line, set apart in the gutter. */
  anchor?: number | undefined
  /** Whether the rows carry a sign column: a hunk's do. */
  signed: boolean
  /** By new-side line, what to show under its row: the diff view's markers. */
  under?: ReadonlyMap<number, ReactNode> | undefined
  /** The language to highlight the rows in; none leaves them plain. */
  language?: Language | undefined
}

/** A row's tokens: a hunk's header and meta rows stay plain, like a file of another language. */
const tokensOf = (row: Row, language: Language | undefined): Token[] =>
  language && row.kind !== 'header' && row.kind !== 'meta'
    ? tokens(row.text, language)
    : [{ text: row.text }]

// The syntax is coloured under the marks, never over them: a mark's background
// and the anchor's gutter are what the eye lands on first.
function CodeRows({
  rows,
  marks = NO_MARKS,
  anchor,
  signed,
  under,
  language,
}: RowsProps) {
  return (
    <>
      {rows.map((row, index) => {
        const lineMarks =
          row.number === undefined ? [] : marks.filter((mark) => mark.line === row.number)
        const wholeLine = lineMarks.some((mark) => !isColumnMark(mark))
        const columns = lineMarks.filter(isColumnMark)
        const lineTokens = tokensOf(row, language)
        let column = 0
        const classes = [
          'tr-row',
          `tr-row--${row.kind}`,
          wholeLine ? 'tr-row--marked' : '',
          row.number !== undefined && row.number === anchor ? 'tr-row--anchor' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div key={index} className="tr-line-group">
            <div className={classes} data-line={row.number}>
              <span className="tr-gutter" aria-hidden="true">
                {row.number ?? ''}
              </span>
              <span className="tr-text">
                {signed && row.kind !== 'header' && row.kind !== 'meta' && (
                  <span className="tr-sign">{signOf(row)}</span>
                )}
                {columns.length
                  ? segments(row.text, columns).map((segment, at) => {
                      const from = column
                      column += segment.text.length
                      const inner = spans(sliceTokens(lineTokens, from, column))
                      return segment.marked ? (
                        <mark key={at}>{inner}</mark>
                      ) : (
                        <span key={at}>{inner}</span>
                      )
                    })
                  : row.text
                    ? spans(lineTokens)
                    : ' '}
              </span>
            </div>
            {lineMarks
              .filter((mark) => mark.note)
              .map((mark, at) => (
                <div
                  key={at}
                  role="note"
                  className="tr-callout"
                  style={{ '--tr-col': mark.from ?? 0 }}
                >
                  <span className="tr-callout-body">{mark.note}</span>
                </div>
              ))}
            {row.number !== undefined && under?.get(row.number)}
          </div>
        )
      })}
    </>
  )
}

type BlockProps = RowsProps & {
  /** The gutter's width; the rows' own by default, a file's to align its hunks. */
  digits?: number
  label?: string | undefined
}

/** Rows in their frame: `signed` sets the sign column and the gutter together. */
export function CodeBlock({ rows, signed, digits, label, ...rest }: BlockProps) {
  return (
    <div
      className={`tr-code ${signed ? 'tr-code--hunk' : ''}`}
      style={{
        '--tr-digits': `${digits ?? digitsOf(rows)}ch`,
        '--tr-sign': signed ? '1ch' : '0ch',
      }}
      aria-label={label}
      role="figure"
    >
      <CodeRows rows={rows} signed={signed} {...rest} />
    </div>
  )
}

interface Props {
  excerpt: ExcerptText
  hunk?: string | undefined
  marks?: readonly Mark[] | undefined
  /** The finding's line, set apart in the gutter. */
  anchor?: number | undefined
  label?: string
  /** The language to highlight the code in; none leaves it plain. */
  language?: Language | undefined
}

export function Excerpt({ excerpt, hunk, marks, anchor, label, language }: Props) {
  return (
    <CodeBlock
      rows={hunk ? parseHunk(hunk) : plainRows(excerpt)}
      signed={!!hunk}
      marks={marks}
      anchor={anchor}
      label={label}
      language={language}
    />
  )
}
