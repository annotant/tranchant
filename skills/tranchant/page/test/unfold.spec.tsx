import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useMemo } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { useUnfold } from '../src/api'
import { gapsOf, parseDiff, placeFindings, unfoldFile } from '../src/diff'
import { DiffView } from '../src/DiffView'
import type { Finding } from '../src/domain'
import { FINDINGS } from './fixture'

const PATH = 'src/long.ts'
/** The file at the head: 60 lines, `line <n>`, lines 10 and 40 changed. */
const HEAD = Array.from({ length: 60 }, (_, at) =>
  at === 9 || at === 39 ? `changed ${at + 1}` : `line ${at + 1}`,
)

const context = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, at) => ` line ${from + at}`)

const DIFF = [
  `diff --git a/${PATH} b/${PATH}`,
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  '@@ -7,7 +7,7 @@ function first()',
  ...context(7, 9),
  '-old 10',
  '+changed 10',
  ...context(11, 13),
  '@@ -37,7 +37,7 @@ function second()',
  ...context(37, 39),
  '-old 40',
  '+changed 40',
  ...context(41, 43),
].join('\n')

/** A finding on line 20, which the diff hides. */
const HIDDEN: Finding = {
  ...FINDINGS[0]!,
  id: 'f-hidden',
  title: 'Hidden line',
  path: PATH,
  line: 20,
  excerpt: { startLine: 20, lines: ['line 20'] },
  marks: [],
}

/** `/api/lines` over HEAD, as the server answers it. */
function serve(input: string) {
  const url = new URL(input, 'http://page')
  if (url.pathname !== '/api/lines') return Response.json({}, { status: 404 })
  const from = Number(url.searchParams.get('from'))
  const to = Math.min(Number(url.searchParams.get('to')), HEAD.length)
  if (from > HEAD.length) {
    return Response.json({ error: 'past its end', total: HEAD.length }, { status: 416 })
  }
  return Response.json({
    path: url.searchParams.get('path'),
    from,
    to,
    total: HEAD.length,
    lines: HEAD.slice(from - 1, to),
  })
}

const fetchMock = vi.fn((input: string) => Promise.resolve(serve(input)))

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

/** The diff view as the page wires it: the unfolded lines placed with the findings. */
function Page({ offline = false }: { offline?: boolean }) {
  const parsed = useMemo(() => parseDiff(DIFF), [])
  const { unfolds, unfold } = useUnfold('head')
  const files = parsed.map((file) => unfoldFile(file, unfolds.get(file.path)))
  const { sections } = placeFindings(files, [HIDDEN])
  return (
    <DiffView
      sections={sections}
      stats={new Map()}
      records={{}}
      cursor={undefined}
      open={undefined}
      selected={new Set()}
      onOpen={() => undefined}
      onToggle={() => undefined}
      unfolds={unfolds}
      offline={offline}
      onUnfold={(path, from, to) => void unfold(path, from, to)}
    />
  )
}

/** A block's rows by their new-side line: a removed line has none, and is left out. */
const numbers = (block: Element) =>
  [...block.querySelectorAll('.tr-row:not(.tr-row--removed)')].map((row) =>
    row.classList.contains('tr-row--header')
      ? 'header'
      : Number(row.getAttribute('data-line')),
  )
const blocks = () => [...document.querySelectorAll('.tr-code')]
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, at) => from + at)

test('the diff tells where a file ends, and the gaps around its hunks', () => {
  const [file] = parseDiff(DIFF)
  expect(file?.hunks.map((hunk) => [hunk.first, hunk.last])).toEqual([
    [7, 13],
    [37, 43],
  ])
  // Three lines of context after the last change: the file may go on.
  expect(file?.end).toBeUndefined()
  expect(gapsOf(file!)).toEqual([
    { from: 1, to: 6, below: 0 },
    { from: 14, to: 36, below: 1 },
    { from: 44, to: undefined, below: 2 },
  ])
  const short = parseDiff(
    [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -4,4 +4,3 @@',
      ' a',
      ' b',
      '-c',
      ' d',
      'diff --git a/b.ts b/b.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/b.ts',
      '@@ -0,0 +1,2 @@',
      '+x',
      '+y',
      'diff --git a/c.ts b/c.ts',
      '--- a/c.ts',
      '+++ b/c.ts',
      '@@ -1,2 +0,0 @@',
      '-p',
      '-q',
    ].join('\n'),
  )
  // One line after the change: the file ends there.
  expect(short[0]?.end).toBe(6)
  expect(gapsOf(short[0]!)).toEqual([{ from: 1, to: 3, below: 0 }])
  // A new file has nothing to unfold.
  expect(short[1]?.end).toBe(2)
  expect(gapsOf(short[1]!)).toEqual([])
  // `+0,0`: the file is left empty, its hunk covering no line.
  expect(short[2]?.hunks[0]).toMatchObject({ first: 1, last: 0 })
  expect(short[2]?.end).toBe(0)
  expect(gapsOf(short[2]!)).toEqual([])
})

test('unfolding fills the gaps with context rows numbered right, then joins the hunks', async () => {
  vi.stubGlobal('fetch', fetchMock)
  render(<Page />)
  const region = screen.getByRole('region', { name: PATH })
  // Hidden, the finding sits on the file's header.
  expect(region.querySelector('.tr-file > .tr-markers')?.textContent).toContain(
    'line 20 is not in the diff',
  )
  expect(blocks()).toHaveLength(2)
  expect(
    screen.getByRole('group', { name: 'Hidden lines from 1' }).textContent,
  ).toContain('6 lines hidden')
  expect(
    screen.getByRole('group', { name: 'Hidden lines from 14' }).textContent,
  ).toContain('23 lines hidden')
  expect(
    screen.getByRole('group', { name: 'Hidden lines from 44' }).textContent,
  ).toContain('More lines below')

  fireEvent.click(
    screen.getByRole('button', { name: 'Show 20 more lines below line 13' }),
  )
  await waitFor(() => expect(numbers(blocks()[0]!)).toEqual(['header', ...range(7, 33)]))
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/lines?path=${encodeURIComponent(PATH)}&from=14&to=33`,
    expect.anything(),
  )
  const row20 = region.querySelector('.tr-row[data-line="20"]')
  expect(row20?.classList.contains('tr-row--context')).toBe(true)
  expect(row20?.querySelector('.tr-sign')?.textContent).toBe(' ')
  expect(row20?.textContent).toContain('line 20')
  // Unfolded, the finding sits on its line.
  expect(row20?.parentElement?.querySelector('#tr-marker-f-hidden')).not.toBeNull()
  expect(region.querySelector('.tr-file > .tr-markers')).toBeNull()

  const between = screen.getByRole('group', { name: 'Hidden lines from 34' })
  expect(between.textContent).toContain('3 lines hidden')
  fireEvent.click(screen.getByRole('button', { name: 'Show 3 lines, 34 to 36' }))
  // The gap gone, one block: the lower hunk's header with it.
  await waitFor(() => expect(blocks()).toHaveLength(1))
  expect(numbers(blocks()[0]!)).toEqual(['header', ...range(7, 43)])

  fireEvent.click(screen.getByRole('button', { name: 'Show 6 lines, 1 to 6' }))
  await waitFor(() => expect(numbers(blocks()[0]!)).toEqual(range(1, 43)))

  // The first answer said where the file ends: the gap below is counted.
  fireEvent.click(screen.getByRole('button', { name: 'Show 17 lines, 44 to 60' }))
  await waitFor(() => expect(numbers(blocks()[0]!)).toEqual(range(1, 60)))
  // The server said where the file ends: no gap is left.
  expect(screen.queryByRole('group')).toBeNull()
})

test('a file that ends where the diff stops closes its last gap; lines above a hunk keep its header while a gap is left', async () => {
  vi.stubGlobal('fetch', fetchMock)
  render(<Page />)
  // A head whose file ends at line 43: the server says so, and nothing is wrong.
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(Response.json({ error: 'past its end', total: 43 }, { status: 416 })),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Show 20 more lines below line 43' }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('group', { name: 'Hidden lines from 44' })).toBeNull(),
  )

  fireEvent.click(
    screen.getByRole('button', { name: 'Show 20 more lines above line 37' }),
  )
  await waitFor(() => expect(numbers(blocks()[1]!)).toEqual(['header', ...range(17, 43)]))
  expect(blocks()).toHaveLength(2)
  expect(blocks()[1]?.querySelector('.tr-row--header')?.textContent).toContain(
    'function second()',
  )
  expect(
    screen.getByRole('group', { name: 'Hidden lines from 14' }).textContent,
  ).toContain('3 lines hidden')
})

test('offline, or when the server cannot read the file, the row stays, disabled, and says why', async () => {
  vi.stubGlobal('fetch', fetchMock)
  const { rerender } = render(<Page offline />)
  const top = screen.getByRole('group', { name: 'Hidden lines from 1' })
  expect(top.textContent).toContain('offline')
  expect(screen.getByRole('button', { name: 'Show 6 lines, 1 to 6' })).toHaveProperty(
    'disabled',
    true,
  )

  rerender(<Page />)
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      Response.json({ error: `${PATH} cannot be read at abc` }, { status: 409 }),
    ),
  )
  const show = screen.getByRole('button', { name: 'Show 6 lines, 1 to 6' })
  expect(show).toHaveProperty('disabled', false)
  // A native button: Tab reaches it, Enter and Space press it.
  show.focus()
  expect(document.activeElement).toBe(show)
  await act(async () => {
    fireEvent.click(show)
  })
  await waitFor(() => expect(top.textContent).toContain(`${PATH} cannot be read at abc`))
  for (const button of screen.getAllByRole('button', { name: /^Show/ })) {
    expect(button).toHaveProperty('disabled', true)
  }
})

test('a dropped request or a server error leaves the buttons, to try again', async () => {
  vi.stubGlobal('fetch', fetchMock)
  render(<Page />)
  fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
  fireEvent.click(screen.getByRole('button', { name: 'Show 6 lines, 1 to 6' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Show 6 lines, 1 to 6' })).toHaveProperty(
      'disabled',
      false,
    ),
  )
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(Response.json({ error: 'boom' }, { status: 500 })),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Show 6 lines, 1 to 6' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Show 6 lines, 1 to 6' })).toHaveProperty(
      'disabled',
      false,
    ),
  )
  expect(
    screen.getByRole('group', { name: 'Hidden lines from 1' }).textContent,
  ).not.toContain('boom')
  fireEvent.click(screen.getByRole('button', { name: 'Show 6 lines, 1 to 6' }))
  await waitFor(() => expect(numbers(blocks()[0]!)).toEqual(range(1, 13)))
})
