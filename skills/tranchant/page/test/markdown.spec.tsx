import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Markdown, parseBlocks } from '../src/markdown'

test('headings, paragraphs, lists and fenced code become blocks', () => {
  const blocks = parseBlocks(
    [
      '## Change Map',
      'One line',
      'and the next.',
      '',
      '- first',
      '- second',
      '  continued',
      '1. one',
      '2) two',
      '```ts',
      'const a = 1',
      '```',
      'tail',
    ].join('\n'),
  )
  expect(blocks).toEqual([
    { kind: 'heading', level: 2, text: 'Change Map' },
    { kind: 'paragraph', text: 'One line and the next.' },
    { kind: 'list', ordered: false, items: ['first', 'second continued'] },
    { kind: 'list', ordered: true, items: ['one', 'two'], start: 1 },
    { kind: 'code', text: 'const a = 1', language: 'ts' },
    { kind: 'paragraph', text: 'tail' },
  ])
})

test('the summary renders one heading level down, with bold, code and links', () => {
  const { container } = render(
    <Markdown
      source={[
        '# Title',
        '',
        'Some **bold** and `code` with [a link](https://example.com/doc).',
        '',
        '```',
        'x = 1',
        '```',
      ].join('\n')}
    />,
  )
  expect(container.querySelector('h2')?.textContent).toBe('Title')
  const paragraph = container.querySelector('p')
  expect(paragraph?.querySelector('strong')?.textContent).toBe('bold')
  expect(paragraph?.querySelector('code')?.textContent).toBe('code')
  const link = paragraph?.querySelector('a')
  expect(link?.getAttribute('href')).toBe('https://example.com/doc')
  expect(link?.textContent).toBe('a link')
  expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  expect(link?.getAttribute('target')).toBe('_blank')
  expect(container.querySelector('pre code')?.textContent).toBe('x = 1')
})

test('a link to another scheme than http(s) or mailto stays text, as written', () => {
  const { container } = render(
    <Markdown source="[run](javascript:alert(1)) and [the hook](src/hooks/usePeople.ts#L12)" />,
  )
  expect(container.querySelector('a')).toBeNull()
  expect(container.textContent).toBe(
    '[run](javascript:alert(1)) and [the hook](src/hooks/usePeople.ts#L12)',
  )
})

test("a link's target may hold one pair of parentheses", () => {
  const { container } = render(
    <Markdown source="[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) here" />,
  )
  expect(container.querySelector('a')?.getAttribute('href')).toBe(
    'https://en.wikipedia.org/wiki/Foo_(bar)',
  )
  expect(container.textContent).toBe('Foo here')
})

test('bold may hold a star; a double-backtick span may hold a backtick', () => {
  const { container } = render(
    <Markdown
      source={'**select * from users** and **c**, then `` `${id}` `` and ``a`b``'}
    />,
  )
  expect(
    Array.from(container.querySelectorAll('strong')).map((node) => node.textContent),
  ).toEqual(['select * from users', 'c'])
  expect(
    Array.from(container.querySelectorAll('code')).map((node) => node.textContent),
  ).toEqual(['`${id}`', 'a`b'])
})

test('a heading keeps a trailing # that follows no space', () => {
  expect(parseBlocks('## Migrate to C# ##')).toEqual([
    { kind: 'heading', level: 2, text: 'Migrate to C#' },
  ])
})

test('a fence closes only on a run at least as long; an indented fence ends a list', () => {
  expect(
    parseBlocks(
      ['````md', '```ts', 'x', '```', '````', '- one', '  ```', 'y', '  ```'].join('\n'),
    ),
  ).toEqual([
    { kind: 'code', text: '```ts\nx\n```', language: undefined },
    { kind: 'list', ordered: false, items: ['one'] },
    { kind: 'code', text: 'y', language: undefined },
  ])
})

test('a long run of [, * or backticks renders in linear time', () => {
  for (const run of ['[', '[a', '[a](', '*', '**a', '`', '``a']) {
    const started = performance.now()
    const { unmount } = render(<Markdown source={run.repeat(65536 / run.length)} />)
    expect(performance.now() - started).toBeLessThan(2000)
    unmount()
  }
})

test('an ordered list keeps its first number', () => {
  const { container } = render(<Markdown source={'3. foo\n4. bar'} />)
  expect(container.querySelector('ol')?.getAttribute('start')).toBe('3')
})

test('raw HTML is text, not markup', () => {
  const { container } = render(<Markdown source={'<img src=x onerror=alert(1)>'} />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).toContain('<img')
})

test('without headings, a heading is bold text, not a heading', () => {
  const { container } = render(<Markdown source={'## Steps\n\nOne.'} headings={false} />)
  expect(container.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull()
  expect(container.querySelector('p strong')?.textContent).toBe('Steps')
})
