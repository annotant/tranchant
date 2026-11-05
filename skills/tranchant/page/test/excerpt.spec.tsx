import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Excerpt, parseHunk, segments } from '../src/Excerpt'
import { FINDINGS, HUNK } from './fixture'

const bug = FINDINGS[0]!
const guard = FINDINGS[1]!

const rowOf = (container: HTMLElement, line: number) =>
  container.querySelector(`.tr-row[data-line="${line}"]`)

test('a column mark highlights exactly its columns', () => {
  const { container } = render(
    <Excerpt
      excerpt={bug.excerpt}
      marks={bug.marks}
      anchor={bug.line}
      language={undefined}
    />,
  )
  const row = rowOf(container, 42)
  expect(row?.querySelector('mark')?.textContent).toBe('people')
  expect(row?.querySelector('.tr-text')?.textContent).toBe(
    '  const rows = people.filter((p) => p.tenantId === tenantId)',
  )
  expect(row?.classList.contains('tr-row--anchor')).toBe(true)
})

test('a whole-line mark marks the row, and a note is a callout under its line', () => {
  const { container } = render(
    <Excerpt excerpt={bug.excerpt} marks={bug.marks} language={undefined} />,
  )
  expect(rowOf(container, 44)?.classList.contains('tr-row--marked')).toBe(true)
  expect(rowOf(container, 44)?.querySelector('mark')).toBeNull()
  const note = screen.getByRole('note')
  expect(note.textContent).toBe(
    'undefined when the drawer opens before the query settles',
  )
  expect(note.previousElementSibling).toBe(rowOf(container, 42))
  expect(note.getAttribute('style')).toContain('--tr-col: 15')
})

const tokensOf = (row: Element | null) =>
  [...(row?.querySelectorAll('.tr-tok') ?? [])].map(
    (token) => `${token.className.replace('tr-tok tr-tok--', '')}:${token.textContent}`,
  )

test('the code is highlighted in the language given, under the marks', () => {
  const excerpt = { startLine: 1, lines: ['const total = 1234 + x', '// sum'] }
  const { container } = render(
    <Excerpt excerpt={excerpt} marks={[{ line: 1, from: 15, to: 17 }]} language="ts" />,
  )
  const row = rowOf(container, 1)
  expect(row?.querySelector('.tr-text')?.textContent).toBe('const total = 1234 + x')
  // The mark cuts the number: its span, with the number's colour on each side and inside.
  expect(row?.querySelector('mark')?.textContent).toBe('23')
  expect(tokensOf(row)).toEqual(['keyword:const', 'number:1', 'number:23', 'number:4'])
  expect(tokensOf(row?.querySelector('mark') ?? null)).toEqual(['number:23'])
  expect(tokensOf(rowOf(container, 2))).toEqual(['comment:// sum'])
})

test('the code stays plain without a language, and a hunk header stays plain with one', () => {
  const excerpt = { startLine: 1, lines: ['const a = 1'] }
  const plain = render(
    <Excerpt
      excerpt={excerpt}
      marks={[{ line: 1, from: 0, to: 5 }]}
      language={undefined}
    />,
  )
  expect(plain.container.querySelector('.tr-tok')).toBeNull()
  expect(plain.container.querySelector('mark')?.textContent).toBe('const')
  plain.unmount()
  const { container } = render(
    <Excerpt excerpt={guard.excerpt} hunk={HUNK} language="ts" />,
  )
  expect(tokensOf(container.querySelector('.tr-row--header'))).toEqual([])
  expect(tokensOf(container.querySelector('.tr-row--removed'))).toEqual([
    'keyword:return',
    'keyword:false',
  ])
})

test('the gutter starts at the excerpt start line', () => {
  const { container } = render(<Excerpt excerpt={bug.excerpt} language={undefined} />)
  const numbers = [...container.querySelectorAll('.tr-gutter')].map((g) => g.textContent)
  expect(numbers[0]).toBe('36')
  expect(numbers.at(-1)).toBe('46')
  expect(numbers).toHaveLength(bug.excerpt.lines.length)
})

test('segments cut a line where marks start and end, overlapping marks merged', () => {
  expect(segments('abcdef', [{ line: 1, from: 1, to: 3 }])).toEqual([
    { text: 'a', marked: false },
    { text: 'bc', marked: true },
    { text: 'def', marked: false },
  ])
  expect(
    segments('abcdef', [
      { line: 1, from: 1, to: 3 },
      { line: 1, from: 2, to: 4 },
    ]),
  ).toEqual([
    { text: 'a', marked: false },
    { text: 'bcd', marked: true },
    { text: 'ef', marked: false },
  ])
  expect(segments('ab', [{ line: 1, from: 5, to: 9 }])).toEqual([
    { text: 'ab', marked: false },
  ])
})

test('a hunk is numbered on the new side, removed lines unnumbered', () => {
  const rows = parseHunk(HUNK)
  expect(rows.map((row) => [row.kind, row.number ?? null])).toEqual([
    ['header', null],
    ['context', 18],
    ['removed', null],
    ['added', 19],
    ['added', 20],
    ['added', 21],
    ['added', 22],
    ['context', 23],
    ['context', 24],
  ])
  expect(rows[2]?.text).toBe('    return false')
  expect(
    parseHunk('@@ -1 +1 @@\n a\n\\ No newline at end of file\n').map((r) => r.kind),
  ).toEqual(['header', 'context', 'meta'])
})

test('a hunk is shown instead of the excerpt, coloured, with marks by new-side line', () => {
  const { container } = render(
    <Excerpt
      excerpt={guard.excerpt}
      hunk={guard.hunk}
      marks={guard.marks}
      anchor={guard.line}
      language={undefined}
    />,
  )
  const added = container.querySelectorAll('.tr-row--added')
  expect(added).toHaveLength(4)
  expect(added[0]?.querySelector('.tr-sign')?.textContent).toBe('+')
  const removed = container.querySelector('.tr-row--removed')
  expect(removed?.querySelector('.tr-sign')?.textContent).toBe('-')
  expect(removed?.querySelector('.tr-gutter')?.textContent).toBe('')
  expect(removed?.textContent).toContain('return false')
  const row = rowOf(container, 21)
  expect(row?.classList.contains('tr-row--added')).toBe(true)
  expect(row?.classList.contains('tr-row--anchor')).toBe(true)
  expect(row?.querySelector('mark')?.textContent).toBe("user.role === 'admin'")
  expect(screen.getByRole('note').textContent).toBe('admins of another tenant pass too')
  expect(container.querySelector('.tr-row--header')?.textContent).toContain(
    '@@ -15,6 +18,8 @@',
  )
})
