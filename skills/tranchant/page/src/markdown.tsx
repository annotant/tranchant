// A renderer for the summary's and the findings' Markdown: headings,
// paragraphs, bullet and numbered lists, fenced code (highlighted in the
// language its fence names, when the page knows it), bold, inline code and
// links. Nothing else, so the page needs no library and runs no HTML the
// producer wrote.
import type { ReactNode } from 'react'
import { Code, type Language, languageOfFence } from './syntax'

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[]; start?: number }
  | { kind: 'code'; text: string; language: Language | undefined }

// The item's text is each regex's last group.
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const NUMBERED = /^\s{0,3}(\d+)[.)]\s+(.*)$/
// A closing run of `#` only counts after a space: "## Migrate to C#" keeps its C#.
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
// A fence's info string starts with its language: ```` ```tsx title="a" ```` is TSX.
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/
const CLOSING_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*$/

/** The closing fence is of the same character and at least as long, so a fence can hold a shorter one. */
function closes(line: string, opening: string): boolean {
  const run = CLOSING_FENCE.exec(line)?.[1] ?? ''
  return run.length >= opening.length && run[0] === opening[0]
}

/** Splits Markdown into blocks; a list item continues on indented lines. */
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const code: string[] = []
      index++
      while (index < lines.length && !closes(lines[index] ?? '', fence[1] ?? '')) {
        code.push(lines[index] ?? '')
        index++
      }
      index++
      blocks.push({
        kind: 'code',
        text: code.join('\n'),
        language: languageOfFence(fence[2]),
      })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]?.length ?? 1,
        text: heading[2] ?? '',
      })
      index++
      continue
    }
    const listMatch = BULLET.exec(line)
      ? BULLET
      : NUMBERED.exec(line)
        ? NUMBERED
        : undefined
    if (listMatch) {
      const items: string[] = []
      let start = 1
      while (index < lines.length) {
        const current = lines[index] ?? ''
        const item = listMatch.exec(current)
        if (item) {
          if (!items.length) start = Number(item[1]) || 1
          items.push(item.at(-1) ?? '')
        } else if (FENCE.test(current)) {
          // An indented fence ends the list rather than folding into the item.
          break
        } else if (/^\s+\S/.test(current) && items.length) {
          items[items.length - 1] += ` ${current.trim()}`
        } else break
        index++
      }
      blocks.push(
        listMatch === NUMBERED
          ? { kind: 'list', ordered: true, items, start }
          : { kind: 'list', ordered: false, items },
      )
      continue
    }
    const text: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (
        !current.trim() ||
        HEADING.test(current) ||
        FENCE.test(current) ||
        BULLET.test(current) ||
        NUMBERED.test(current)
      ) {
        break
      }
      text.push(current.trim())
      index++
    }
    blocks.push({ kind: 'paragraph', text: text.join(' ') })
  }
  return blocks
}

// A double-backtick span may hold a backtick; a link's target may hold one pair of
// parentheses. Every run is capped so a long run of `[`, `*` or backticks scans in
// linear time: the producer's text is untrusted.
const INLINE =
  /(``(?:[^`]|`(?!`)){1,2000}``|`[^`]{1,2000}`)|(\*\*.{1,500}?\*\*)|(\[[^\]]{1,500}\]\((?:[^()\s]|\([^()\s]*\)){1,2000}\))/g
const LINK = /^\[([^\]]+)\]\((.+)\)$/
const SAFE_LINK = /^(https?:|mailto:)/i

function codeText(span: string): string {
  if (!span.startsWith('``')) return span.slice(1, -1)
  const inner = span.slice(2, -2)
  return inner.startsWith(' ') && inner.endsWith(' ') && inner.trim()
    ? inner.slice(1, -1)
    : inner
}

/** Bold, inline code and links; a link to another scheme than http(s) or mailto stays text, as written. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const [whole, code, bold, link] = match
    if (match.index > last) nodes.push(text.slice(last, match.index))
    if (code) nodes.push(<code key={match.index}>{codeText(code)}</code>)
    else if (bold) nodes.push(<strong key={match.index}>{bold.slice(2, -2)}</strong>)
    else if (link) {
      const parts = LINK.exec(link)
      const label = parts?.[1] ?? link
      const href = parts?.[2] ?? ''
      nodes.push(
        SAFE_LINK.test(href) ? (
          <a
            key={match.index}
            href={href}
            title={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </a>
        ) : (
          link
        ),
      )
    }
    last = match.index + whole.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

// One level down: the summary sits under the page's own headings.
const HEADINGS = { 1: 'h2', 2: 'h3', 3: 'h4', 4: 'h5' } as const

function renderBlock(block: Block, key: number, headings: boolean): ReactNode {
  if (block.kind === 'heading') {
    if (!headings) {
      return (
        <p key={key}>
          <strong>{renderInline(block.text)}</strong>
        </p>
      )
    }
    const Tag =
      block.level === 1 || block.level === 2 || block.level === 3 || block.level === 4
        ? HEADINGS[block.level]
        : 'h6'
    return <Tag key={key}>{renderInline(block.text)}</Tag>
  }
  if (block.kind === 'code') {
    return (
      <pre key={key}>
        <code>
          <Code code={block.text} language={block.language} />
        </code>
      </pre>
    )
  }
  if (block.kind === 'list') {
    // Items have no identity of their own: the whole block re-renders with its source.
    // oxlint-disable-next-line react/no-array-index-key
    const items = block.items.map((item, at) => <li key={at}>{renderInline(item)}</li>)
    if (!block.ordered) return <ul key={key}>{items}</ul>
    return block.start === 1 ? (
      <ol key={key}>{items}</ol>
    ) : (
      <ol key={key} start={block.start}>
        {items}
      </ol>
    )
  }
  return <p key={key}>{renderInline(block.text)}</p>
}

interface Props {
  source: string
  /** False renders a heading as bold text: a finding never adds to the page's outline. */
  headings?: boolean
}

export function Markdown({ source, headings = true }: Props) {
  // Blocks have no identity of their own: a new source re-renders them all.
  return (
    <div className="tr-md">
      {parseBlocks(source).map((block, at) => renderBlock(block, at, headings))}
    </div>
  )
}
