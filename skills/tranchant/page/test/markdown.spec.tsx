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
    { kind: 'list', ordered: true, items: ['one', 'two'] },
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
  expect(link?.getAttribute('rel')).toBe('noreferrer')
  expect(container.querySelector('pre code')?.textContent).toBe('x = 1')
})

test('a link to another scheme than http(s) or mailto stays text', () => {
  const { container } = render(<Markdown source="[run](javascript:evil)" />)
  expect(container.querySelector('a')).toBeNull()
  expect(container.textContent).toBe('run')
})

test('raw HTML is text, not markup', () => {
  const { container } = render(<Markdown source={'<img src=x onerror=alert(1)>'} />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.textContent).toContain('<img')
})
