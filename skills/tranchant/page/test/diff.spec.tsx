import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { marksInDiff, parseDiff, placeFindings } from '../src/diff'
import { DiffView, FileList, readingIndex } from '../src/DiffView'
import type { Finding } from '../src/domain'
import { DIFF, DIFF_FILES, FINDINGS, record, STACKED } from './fixture'

const ids = (list: readonly Finding[] | undefined) => list?.map((finding) => finding.id)
const stats = new Map(DIFF_FILES.map((file) => [file.path, file]))

test('a diff parses into files, hunks and rows numbered on the new side', () => {
  const files = parseDiff(DIFF)
  expect(
    files.map((file) => [file.path, file.status, file.binary, file.hunks.length]),
  ).toEqual([
    ['src/people/usePeople.ts', 'modified', false, 1],
    ['src/api/guard.ts', 'modified', false, 1],
    ['src/people/pager.ts', 'modified', false, 1],
    ['src/people/Drawer.tsx', 'modified', false, 1],
    ['src/people/new-name.ts', 'renamed', false, 1],
    ['assets/logo.png', 'modified', true, 0],
    ['src/people/legacy.ts', 'deleted', false, 1],
  ])
  expect(files[4]?.oldPath).toBe('src/people/old-name.ts')
  const people = files[0]!.hunks[0]!
  expect(people.header).toBe(
    '@@ -36,3 +36,11 @@ import { useQuery } from "@tanstack/react-query"',
  )
  expect(people.rows.slice(0, 5).map((row) => [row.kind, row.number ?? null])).toEqual([
    ['header', null],
    ['removed', null],
    ['removed', null],
    ['removed', null],
    ['added', 36],
  ])
  expect(people.rows.at(-1)).toEqual({ kind: 'added', number: 46, text: '  return rows' })
  expect(files[6]!.hunks[0]!.rows.every((row) => row.number === undefined)).toBe(true)
})

test('paths come out of their quotes, and a removed line reading like a header stays content', () => {
  const files = parseDiff(
    [
      'diff --git "a/sp\\303\\251cial \\"x\\".ts" "b/sp\\303\\251cial \\"x\\".ts"',
      'index 1..2 100644',
      '--- "a/sp\\303\\251cial \\"x\\".ts"',
      '+++ "b/sp\\303\\251cial \\"x\\".ts"',
      '@@ -1,3 +1,2 @@',
      ' a',
      '--- b',
      '-+++ c',
      'diff --git a/with space.ts b/with space.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/with space.ts\t',
      '@@ -0,0 +1 @@',
      '+x',
      '\\ No newline at end of file',
    ].join('\n'),
  )
  expect(files[0]?.path).toBe('spécial "x".ts')
  expect(files[0]?.hunks[0]?.rows.map((row) => [row.kind, row.text])).toEqual([
    ['header', '@@ -1,3 +1,2 @@'],
    ['context', 'a'],
    ['removed', '-- b'],
    ['removed', '+++ c'],
  ])
  expect(files[1]).toMatchObject({ path: 'with space.ts', status: 'added' })
  expect(files[1]?.hunks[0]?.rows.map((row) => row.kind)).toEqual([
    'header',
    'added',
    'meta',
  ])
  expect(parseDiff('')).toEqual([])
})

test('each finding lands on its line, stacked, or on the header when the diff lacks the line or the file', () => {
  const { sections, ordered } = placeFindings(parseDiff(DIFF), [...FINDINGS, STACKED])
  expect(sections.map((section) => section.path)).toEqual([
    ...DIFF_FILES.map((file) => file.path),
    'src/people/__tests__/usePeople.test.ts',
  ])
  expect(ids(sections[0]?.lines.get(42))).toEqual(['f-01'])
  expect(ids(sections[1]?.lines.get(21))).toEqual(['f-02', 'f-06'])
  expect(ids(sections[2]?.lines.get(5))).toEqual(['f-05'])
  expect(ids(sections[3]?.header)).toEqual(['f-04'])
  expect(sections[3]?.lines.size).toBe(0)
  expect(sections[7]?.file).toBeUndefined()
  expect(ids(sections[7]?.header)).toEqual(['f-03'])
  expect(ids(ordered)).toEqual(['f-01', 'f-02', 'f-06', 'f-05', 'f-04', 'f-03'])
})

test('marks show in the diff only where its text is the excerpt’s, in any hunk of the file', () => {
  const files = parseDiff(DIFF)
  const people = files[0]!
  expect(marksInDiff(FINDINGS[0]!, people)).toBe(FINDINGS[0]!.marks)
  const moved = { ...FINDINGS[0]!, excerpt: { startLine: 42, lines: ['other text'] } }
  expect(marksInDiff(moved, people)).toEqual([])
  expect(marksInDiff(FINDINGS[0]!, files[1]!)).toEqual([])
  // Its line in a second hunk of the file: the marks still show.
  const split = parseDiff(
    [
      'diff --git a/src/people/usePeople.ts b/src/people/usePeople.ts',
      '--- a/src/people/usePeople.ts',
      '+++ b/src/people/usePeople.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '@@ -41,3 +41,3 @@',
      '   const people = query.data ?? []',
      '-  const rows = people',
      '+  const rows = people.filter((p) => p.tenantId === tenantId)',
      '   if (!rows.length) {',
    ].join('\n'),
  )[0]!
  expect(marksInDiff(FINDINGS[0]!, split)).toBe(FINDINGS[0]!.marks)
})

test('a new or deleted file with no ---/+++ lines takes its status from git’s mode line', () => {
  const files = parseDiff(
    [
      'diff --git "a/img/say \\"hi\\".png" "b/img/say \\"hi\\".png"',
      'new file mode 100644',
      'index 0000000..bdc955b',
      'Binary files /dev/null and "b/img/say \\"hi\\".png" differ',
      'diff --git a/empty.txt b/empty.txt',
      'deleted file mode 100644',
      'index e69de29..0000000',
    ].join('\n'),
  )
  expect(files.map((file) => [file.path, file.status, file.binary])).toEqual([
    ['img/say "hi".png', 'added', true],
    ['empty.txt', 'deleted', false],
  ])
})

test('the file being read is the last whose top reached the pane’s, the last one at the end', () => {
  expect(readingIndex([], 100, false)).toBe(0)
  expect(readingIndex([100, 600, 1400], 100, false)).toBe(0)
  expect(readingIndex([-500, 103, 900], 100, false)).toBe(1)
  expect(readingIndex([-900, -300, 50], 100, false)).toBe(2)
  expect(readingIndex([-900, -300, 400], 100, true)).toBe(2)
})

test('the view draws markers under their lines, notes on the header, and the open finding’s marks', () => {
  const placement = placeFindings(parseDiff(DIFF), [...FINDINGS, STACKED])
  const onOpen = vi.fn()
  const { container } = render(
    <DiffView
      sections={placement.sections}
      stats={stats}
      records={{ 'f-02': record('fixed') }}
      cursor="f-06"
      open={FINDINGS[0]}
      selected={new Set(['f-05'])}
      onOpen={onOpen}
      onToggle={() => undefined}
    />,
  )
  expect(container.querySelector('#tr-marker-f-02 .tr-chip')?.className).toBe(
    'tr-chip tr-chip--done',
  )
  const row21 = container.querySelector('#tr-file-1 .tr-row[data-line="21"]')
  const stack = [...(row21?.parentElement?.querySelectorAll('.tr-marker') ?? [])]
  expect(stack.map((marker) => marker.id)).toEqual(['tr-marker-f-02', 'tr-marker-f-06'])
  expect(stack[0]?.textContent).toContain('Done')
  expect(stack[0]?.textContent).toContain('Bugs')
  expect(stack[1]?.classList.contains('tr-marker--focused')).toBe(true)
  const row42 = container.querySelector('#tr-file-0 .tr-row[data-line="42"]')
  expect(row42?.classList.contains('tr-row--anchor')).toBe(true)
  expect(row42?.querySelector('mark')?.textContent).toBe('people')
  // A .ts file's code is highlighted, its marks over the colours.
  expect(row42?.querySelector('.tr-tok--keyword')?.textContent).toBe('const')
  expect(screen.getByRole('note').textContent).toContain(
    'undefined when the drawer opens',
  )
  expect(
    document.getElementById('tr-marker-f-01')?.classList.contains('tr-marker--open'),
  ).toBe(true)
  const drawer = screen.getByRole('region', { name: 'src/people/Drawer.tsx' })
  expect(drawer.querySelector('.tr-marker')?.textContent).toContain(
    'line 30 is not in the diff',
  )
  const tests = screen.getByRole('region', {
    name: 'src/people/__tests__/usePeople.test.ts',
  })
  expect(tests.textContent).toContain('not in the diff')
  expect(tests.querySelector('.tr-marker')?.textContent).toContain(
    'the diff does not touch this file',
  )
  expect(
    screen.getByRole('region', { name: 'src/people/new-name.ts' }).textContent,
  ).toContain('from src/people/old-name.ts')
  expect(screen.getByRole('region', { name: 'assets/logo.png' }).textContent).toContain(
    'binary',
  )
  expect(
    screen.getByRole('region', { name: 'src/people/legacy.ts' }).textContent,
  ).toContain('deleted')
  expect(
    screen.getByRole('checkbox', { name: 'Select Off-by-one in the page count' }),
  ).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('button', { name: /Is the admin branch tested/ }))
  expect(onOpen).toHaveBeenCalledWith('f-06')
})

test('the file list counts each file’s findings and shows its stats', () => {
  const placement = placeFindings(parseDiff(DIFF), [...FINDINGS, STACKED])
  const onPick = vi.fn()
  render(
    <FileList sections={placement.sections} stats={stats} reading={1} onPick={onPick} />,
  )
  const items = screen.getAllByRole('button')
  expect(items).toHaveLength(8)
  expect(items[0]?.textContent).toContain('usePeople.ts')
  expect(items[0]?.querySelector('[aria-label="1 findings"]')).not.toBeNull()
  expect(items[0]?.textContent).toContain('+11')
  expect(items[1]?.textContent).toContain('guard.ts')
  expect(items[1]?.querySelector('[aria-label="2 findings"]')).not.toBeNull()
  expect(items[1]?.textContent).toContain('+4')
  expect(items[1]?.textContent).toContain('−1')
  expect(items[5]?.textContent).not.toContain('+')
  expect(items[7]?.textContent).toContain('not in the diff')
  expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([
    null,
    'location',
    null,
    null,
    null,
    null,
    null,
    null,
  ])
  fireEvent.click(items[2]!)
  expect(onPick).toHaveBeenCalledWith(2)
})

test('the view highlights a file in the language of its extension, another stays plain', () => {
  const diff = [
    'diff --git a/src/a.css b/src/a.css',
    '--- a/src/a.css',
    '+++ b/src/a.css',
    '@@ -1 +1 @@',
    '+const { color: red }',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -1 +1 @@',
    '+const { color: red }',
  ].join('\n')
  render(
    <DiffView
      sections={placeFindings(parseDiff(diff), []).sections}
      stats={new Map()}
      records={{}}
      cursor={undefined}
      open={undefined}
      selected={new Set()}
      onOpen={() => undefined}
      onToggle={() => undefined}
    />,
  )
  expect(
    screen.getByRole('region', { name: 'src/a.css' }).querySelector('.tr-tok'),
  ).toBeNull()
  expect(
    screen.getByRole('region', { name: 'src/b.ts' }).querySelector('.tr-tok--keyword')
      ?.textContent,
  ).toBe('const')
})
