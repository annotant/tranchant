// The change's diff as the page shows it: parsed into files, hunks and rows,
// every finding placed on its new-side line, on its file's header when the
// diff does not show that line, or after the diff when it does not touch
// the file at all.
import { type Finding, type Mark, orderedFindings } from './domain'
import { parseHunk, type Row } from './Excerpt'

type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed'

interface DiffHunk {
  /** The `@@` line. */
  header: string
  rows: Row[]
}

export interface DiffFile {
  path: string
  /** A rename: where the file was. */
  oldPath?: string
  status: FileStatus
  binary: boolean
  hunks: DiffHunk[]
}

const PREFIX = /^[ab]\//

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
}

/**
 * A path as git prints it: quoted, with C escapes and octal bytes, when it
 * holds a quote, a backslash or a control character.
 */
function unquote(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw
  const inner = raw.slice(1, -1)
  let out = ''
  let bytes: number[] = []
  const flush = () => {
    if (!bytes.length) return
    out += new TextDecoder().decode(new Uint8Array(bytes))
    bytes = []
  }
  for (let i = 0; i < inner.length; i++) {
    const char = inner.charAt(i)
    if (char !== '\\') {
      flush()
      out += char
      continue
    }
    const octal = /^[0-7]{1,3}/.exec(inner.slice(i + 1, i + 4))?.[0]
    if (octal) {
      bytes.push(parseInt(octal, 8))
      i += octal.length
      continue
    }
    flush()
    const next = inner.charAt(i + 1)
    out += ESCAPES[next] ?? next
    i++
  }
  flush()
  return out
}

/**
 * The new path of a `diff --git a/x b/y` line, best effort: the `+++` and
 * `rename to` lines, when the file has them, say better.
 */
function headerPath(rest: string): string {
  const quoted = /"(?:[^"\\]|\\.)*"$/.exec(rest)
  if (quoted) return unquote(quoted[0]).replace(PREFIX, '')
  // `a/X b/X` when the file kept its name: X is the half that repeats.
  const mid = (rest.length - 1) / 2
  if (
    rest.startsWith('a/') &&
    rest.slice(mid, mid + 3) === ' b/' &&
    rest.slice(2, mid) === rest.slice(mid + 3)
  ) {
    return rest.slice(mid + 3)
  }
  const at = rest.lastIndexOf(' b/')
  return at === -1 ? rest : rest.slice(at + 3)
}

/** The path of a `---` or `+++` line; none for `/dev/null`. */
function markerPath(rest: string): string | undefined {
  // A path with a space gets a tab after it, for patch(1).
  const text = rest.replace(/\t$/, '')
  return text === '/dev/null' ? undefined : unquote(text).replace(PREFIX, '')
}

/** A unified diff as git prints it, file by file, its hunks numbered on the new side. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let hunk: string[] | undefined
  const endHunk = () => {
    if (file && hunk) {
      file.hunks.push({ header: hunk[0] ?? '', rows: parseHunk(hunk.join('\n')) })
    }
    hunk = undefined
  }
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      endHunk()
      file = {
        path: headerPath(line.slice(11)),
        status: 'modified',
        binary: false,
        hunks: [],
      }
      files.push(file)
    } else if (!file) {
      continue
    } else if (line.startsWith('@@')) {
      endHunk()
      hunk = [line]
    } else if (hunk) {
      // A removed line may read `--- a/x`: inside a hunk it is content.
      hunk.push(line)
    } else if (line.startsWith('--- ')) {
      if (markerPath(line.slice(4)) === undefined) file.status = 'added'
    } else if (line.startsWith('+++ ')) {
      const path = markerPath(line.slice(4))
      if (path === undefined) file.status = 'deleted'
      else file.path = path
    } else if (line.startsWith('rename from ')) {
      file.oldPath = unquote(line.slice(12))
      file.status = 'renamed'
    } else if (line.startsWith('rename to ')) {
      file.path = unquote(line.slice(10))
    } else if (line.startsWith('Binary files ')) {
      file.binary = true
    }
  }
  endHunk()
  return files
}

export interface Section {
  path: string
  /** The diff's file; absent when the diff does not touch the path. */
  file?: DiffFile
  /** The findings on the file's header: their line is not in the diff. */
  header: Finding[]
  /** By new-side line, the findings there, stacked in the list's order. */
  lines: Map<number, Finding[]>
}

export interface Placement {
  /** The diff's files in its order, then the paths it does not touch, by name. */
  sections: Section[]
  /** Every finding, in the order the diff shows them. */
  ordered: Finding[]
}

const newSide = (file: DiffFile) =>
  new Set(
    file.hunks.flatMap((hunk) =>
      hunk.rows.flatMap((row) => (row.number === undefined ? [] : [row.number])),
    ),
  )

/** Each finding at its place in the diff. */
export function placeFindings(
  files: readonly DiffFile[],
  findings: readonly Finding[],
): Placement {
  const sections = new Map<string, Section>()
  const shown = new Map<string, Set<number>>()
  for (const file of files) {
    sections.set(file.path, { path: file.path, file, header: [], lines: new Map() })
    shown.set(file.path, newSide(file))
  }
  for (const finding of orderedFindings(findings)) {
    let section = sections.get(finding.path)
    if (!section) {
      section = { path: finding.path, header: [], lines: new Map() }
      sections.set(finding.path, section)
    }
    if (shown.get(finding.path)?.has(finding.line)) {
      const stack = section.lines.get(finding.line) ?? []
      stack.push(finding)
      section.lines.set(finding.line, stack)
    } else section.header.push(finding)
  }
  const all = [...sections.values()]
  const ordered = [
    ...all.filter((section) => section.file),
    ...all
      .filter((section) => !section.file)
      .toSorted((a, b) => a.path.localeCompare(b.path)),
  ]
  return {
    sections: ordered,
    ordered: ordered.flatMap((section) => [
      ...section.header,
      ...(section.file?.hunks ?? []).flatMap((hunk) =>
        hunk.rows.flatMap((row) =>
          row.number === undefined ? [] : (section.lines.get(row.number) ?? []),
        ),
      ),
    ]),
  }
}

const NO_MARKS: readonly Mark[] = []

/**
 * The finding's marks, when `rows` show the text its excerpt describes at
 * its line: a review of another head would mark the wrong text.
 */
export function marksInDiff(finding: Finding, rows: readonly Row[]): readonly Mark[] {
  const row = rows.find((one) => one.number === finding.line)
  const text = finding.excerpt.lines[finding.line - finding.excerpt.startLine]
  return row && text !== undefined && row.text === text
    ? (finding.marks ?? NO_MARKS)
    : NO_MARKS
}
