// The change's diff as the page shows it, and each finding's place in it.
import { type Finding, type Mark, orderedFindings } from './domain'
import { NO_MARKS, parseHunk, type Row } from './Excerpt'

type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed'

interface DiffHunk {
  /** Its `@@` line, git's ranges; empty for a block of unfolded lines alone. */
  header: string
  rows: Row[]
  /** The first new-side line it covers. */
  first: number
  /** The last new-side line it covers: `first - 1` when it covers none. */
  last: number
}

export interface DiffFile {
  path: string
  /** A rename: where the file was. */
  oldPath?: string
  status: FileStatus
  binary: boolean
  hunks: DiffHunk[]
  /** The file's line count at the head, when the diff tells it or the server did. */
  end?: number
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
 * holds a quote, a backslash or a control character, or a non-ASCII byte
 * unless the server passes `core.quotePath=false`.
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

/** What each line before a file's first hunk says about it, by its prefix. */
const FILE_LINES: [prefix: string, read: (file: DiffFile, rest: string) => void][] = [
  // Git's own word: a new or deleted file that is binary or empty has no `---`/`+++`.
  ['new file mode ', (file) => (file.status = 'added')],
  ['deleted file mode ', (file) => (file.status = 'deleted')],
  [
    '--- ',
    (file, rest) => {
      if (markerPath(rest) === undefined) file.status = 'added'
    },
  ],
  [
    '+++ ',
    (file, rest) => {
      const path = markerPath(rest)
      if (path === undefined) file.status = 'deleted'
      else file.path = path
    },
  ],
  [
    'rename from ',
    (file, rest) => {
      file.oldPath = unquote(rest)
      file.status = 'renamed'
    },
  ],
  ['rename to ', (file, rest) => (file.path = unquote(rest))],
  ['Binary files ', (file) => (file.binary = true)],
]

const FILE_HEADER = 'diff --git '

const HUNK_RANGE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** The context git keeps around a change: the server asks for this many. */
const CONTEXT = 3

function hunkOf(lines: readonly string[]): DiffHunk {
  const header = lines[0] ?? ''
  const range = HUNK_RANGE.exec(header)
  const start = Number(range?.[1] ?? 1)
  const count = Number(range?.[2] ?? 1)
  // `+c,0` covers nothing: its lines would come after line c.
  const first = count ? start : start + 1
  return { header, rows: parseHunk(lines.join('\n')), first, last: first + count - 1 }
}

/**
 * The file's last line when the diff tells it: the whole new file, nothing
 * left of a deleted one, or a last hunk that ran out of context.
 */
function endOf(file: DiffFile): number | undefined {
  const last = file.hunks.at(-1)
  if (file.status === 'deleted') return 0
  if (!last) return undefined
  if (file.status === 'added') return last.last
  const rows = last.rows.filter((row) => row.kind !== 'meta')
  const trailing = rows.length - 1 - rows.findLastIndex((row) => row.kind !== 'context')
  return trailing < CONTEXT ? last.last : undefined
}

/** A unified diff as git prints it, file by file, its hunks numbered on the new side. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let hunk: string[] | undefined
  const endHunk = () => {
    if (file && hunk) file.hunks.push(hunkOf(hunk))
    hunk = undefined
  }
  for (const line of text.split('\n')) {
    if (line.startsWith(FILE_HEADER)) {
      endHunk()
      file = {
        path: headerPath(line.slice(FILE_HEADER.length)),
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
    } else {
      const known = FILE_LINES.find(([prefix]) => line.startsWith(prefix))
      known?.[1](file, line.slice(known[0].length))
    }
  }
  endHunk()
  for (const one of files) {
    const end = endOf(one)
    if (end !== undefined) one.end = end
  }
  return files
}

/** The head's lines the reader unfolded in one file, by new-side line, and its length once known. */
export interface Unfolded {
  lines: ReadonlyMap<number, string>
  total?: number | undefined
}

/**
 * The file with its unfolded lines in place, as context rows: a hunk grows
 * by the lines next to it, and two hunks the reader joined are one, the
 * lower one's header gone.
 */
export function unfoldFile(file: DiffFile, unfolded: Unfolded | undefined): DiffFile {
  if (!unfolded) return file
  const end = unfolded.total ?? file.end
  const known = end === undefined ? file : { ...file, end }
  const { lines } = unfolded
  if (!lines.size || !file.hunks.length) return known
  const hunks: DiffHunk[] = []
  let block: DiffHunk | undefined
  // Lines are hidden above the block: the hunk it reaches keeps its header.
  let hiddenAbove = false
  const close = () => {
    if (block) hunks.push(block)
    block = undefined
  }
  const add = (number: number, text: string) => {
    const row: Row = { kind: 'context', number, text }
    if (block) {
      block.rows.push(row)
      block.last = number
      return
    }
    block = { header: '', rows: [row], first: number, last: number }
    hiddenAbove = number > 1
  }
  let next = 1
  for (const hunk of file.hunks) {
    const gap = hunk.first > next
    for (let number = next; number < hunk.first; number++) {
      const text = lines.get(number)
      if (text === undefined) close()
      else add(number, text)
    }
    const [head, ...body] = hunk.rows
    if (block && gap) {
      const keep = hiddenAbove && head?.kind === 'header'
      block.rows = keep ? [head, ...block.rows, ...body] : [...block.rows, ...body]
      if (keep) block.header = hunk.header
      block.last = hunk.last
    } else {
      close()
      block = { ...hunk, rows: [...hunk.rows] }
    }
    hiddenAbove = false
    next = hunk.last + 1
  }
  const limit = end ?? Infinity
  for (let number = next; number <= limit; number++) {
    const text = lines.get(number)
    if (text === undefined) break
    add(number, text)
  }
  close()
  return { ...known, hunks }
}

/** Lines the diff hides: above a hunk, or below the last one. */
export interface Gap {
  from: number
  /** Its last line; unknown below the last hunk until the server says where the file ends. */
  to: number | undefined
  /** The index of the hunk under it; the hunks' count below the last. */
  below: number
}

/** The lines `file` hides around its hunks; none in a file the change adds, deletes, or does not show. */
export function gapsOf(file: DiffFile): Gap[] {
  if (file.binary || file.status === 'added' || file.status === 'deleted') return []
  const gaps: Gap[] = []
  let next = 1
  file.hunks.forEach((hunk, below) => {
    if (hunk.first > next) gaps.push({ from: next, to: hunk.first - 1, below })
    next = hunk.last + 1
  })
  if (file.hunks.length && (file.end === undefined || file.end >= next)) {
    gaps.push({ from: next, to: file.end, below: file.hunks.length })
  }
  return gaps
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

/**
 * The finding's marks, when `file` shows the text its excerpt describes at
 * its line: a review of another head would mark the wrong text.
 */
export function marksInDiff(finding: Finding, file: DiffFile): readonly Mark[] {
  const row = file.hunks
    .flatMap((hunk) => hunk.rows)
    .find((one) => one.number === finding.line)
  const text = finding.excerpt.lines[finding.line - finding.excerpt.startLine]
  return row && text !== undefined && row.text === text
    ? (finding.marks ?? NO_MARKS)
    : NO_MARKS
}
