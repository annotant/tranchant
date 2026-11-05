// A renderer for the summary's Markdown: headings, paragraphs, bullet and
// numbered lists, fenced code (highlighted in the language its fence names,
// when the page knows it), bold, inline code and links. Nothing else, so the
// page needs no library and runs no HTML the producer wrote.
import type { ReactNode } from 'react'
import { Code, type Language, languageOfFence } from './syntax'

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string; language: Language | undefined }

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
const NUMBERED = /^\s{0,3}\d+[.)]\s+(.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
// A fence's info string starts with its language: ```` ```tsx title="a" ```` is TSX.
const FENCE = /^\s{0,3}(```|~~~)\s*([\w+-]*)/

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
      while (
        index < lines.length &&
        !(lines[index] ?? '').trim().startsWith(fence[1] ?? '')
      ) {
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
      while (index < lines.length) {
        const current = lines[index] ?? ''
        const item = listMatch.exec(current)
        if (item) items.push(item[1] ?? '')
        else if (/^\s+\S/.test(current) && items.length) {
          items[items.length - 1] += ` ${current.trim()}`
        } else break
        index++
      }
      blocks.push({ kind: 'list', ordered: listMatch === NUMBERED, items })
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

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/
const SAFE_LINK = /^(https?:|mailto:)/i

/** Bold, inline code and links; a link to another scheme than http(s) or mailto stays text. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const [whole, code, bold, link] = match
    if (match.index > last) nodes.push(text.slice(last, match.index))
    if (code) nodes.push(<code key={match.index}>{code.slice(1, -1)}</code>)
    else if (bold) nodes.push(<strong key={match.index}>{bold.slice(2, -2)}</strong>)
    else if (link) {
      const parts = LINK.exec(link)
      const label = parts?.[1] ?? link
      const href = parts?.[2] ?? ''
      nodes.push(
        SAFE_LINK.test(href) ? (
          <a key={match.index} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          label
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

function renderBlock(block: Block, key: number): ReactNode {
  if (block.kind === 'heading') {
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
    return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
  }
  return <p key={key}>{renderInline(block.text)}</p>
}

export function Markdown({ source }: { source: string }) {
  // Blocks have no identity of their own: a new source re-renders them all.
  return <div className="tr-md">{parseBlocks(source).map(renderBlock)}</div>
}
