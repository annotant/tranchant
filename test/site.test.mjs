import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import {
  PAGES,
  REPOSITORY,
  blankCodeSpans,
  docsNav,
  htmlLines,
  keepSections,
  pageIds,
  rewriteLinks,
  slug,
  toPage,
  unescapeTablePipes,
} from '../.github/scripts/site.mjs'

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')

test('ids headings the way GitHub does', () => {
  assert.equal(slug('1. Check the requirements'), '1-check-the-requirements')
  assert.equal(slug('`decisions.json`'), 'decisionsjson')
  assert.equal(slug('Pause, stop and reset'), 'pause-stop-and-reset')
})

test('keeps the sections named, without the header before them', () => {
  const markdown = [
    '<h1>Header</h1>',
    '## Install',
    'Run it.',
    '````sh',
    '## not a heading',
    '```js',
    '````',
    '## Development',
    'For contributors.',
    '## Security',
    'Local only.',
  ].join('\n')
  assert.equal(
    keepSections(markdown, ['Install', 'Security']),
    '## Install\nRun it.\n````sh\n## not a heading\n```js\n````\n## Security\nLocal only.\n',
  )
  // A renamed heading would drop its section from the site.
  assert.throws(
    () => keepSections(markdown, ['Install', 'Installation']),
    /## Installation/,
  )
})

const README = [
  '## Models',
  '[here](#models) [gone](#development) [file](docs/review-file.md#states-and-moves)',
  '[self](README.md) [policy](SECURITY.md) [web](https://example.com/a.md)',
  '```',
  '[code](SECURITY.md)',
  '```',
  '## Development',
].join('\n')
const REVIEW_FILE = '# The file\n## States and moves\n'
const sources = new Map([
  ['README.md', README],
  ['docs/review-file.md', REVIEW_FILE],
  ['docs/settings.md', '# The settings file\n## Precedence\n'],
])
const pages = [{ ...PAGES[0], sections: ['Models'] }, ...PAGES.slice(1)]
const ids = pageIds(pages, sources)

test('points links at the site, the page, or GitHub', () => {
  assert.equal(
    rewriteLinks(keepSections(README, ['Models']), 'README.md', pages, ids),
    [
      '## Models',
      `[here](#models) [gone](${REPOSITORY}/blob/main/README.md#development) [file](review-file.html#states-and-moves)`,
      `[self](#) [policy](${REPOSITORY}/blob/main/SECURITY.md) [web](https://example.com/a.md)`,
      '```',
      '[code](SECURITY.md)',
      '```',
      '',
    ].join('\n'),
  )
  // A section the site drops, linked from another page, is on GitHub only.
  assert.equal(
    rewriteLinks(
      '[a](../README.md#models) [b](../README.md#development) [c](../skills/x.mjs)',
      'docs/review-file.md',
      pages,
      ids,
    ),
    `[a](./#models) [b](${REPOSITORY}/blob/main/README.md#development) [c](${REPOSITORY}/blob/main/skills/x.mjs)`,
  )
})

test('links each docs page to the others, its previous and its next', () => {
  assert.deepEqual(docsNav(pages[0], pages), {
    nav: [
      { title: 'Guide', href: './', current: true },
      { title: 'The review file', href: 'review-file.html', current: false },
      { title: 'The settings file', href: 'settings.html', current: false },
    ],
    previous: undefined,
    next: { title: 'The review file', href: 'review-file.html', current: false },
  })
  const last = docsNav(pages[2], pages)
  assert.deepEqual(last.previous, {
    title: 'The review file',
    href: 'review-file.html',
    current: false,
  })
  assert.equal(last.next, undefined)
  assert.deepEqual(
    last.nav.map((item) => item.current),
    [false, false, true],
  )
})

test('rewrites the links with a title and the reference definitions too', () => {
  assert.equal(
    rewriteLinks(
      '[a](docs/review-file.md "the file") and\n[b]: docs/review-file.md#states-and-moves',
      'README.md',
      pages,
      ids,
    ),
    '[a](review-file.html "the file") and\n[b]: review-file.html#states-and-moves',
  )
  assert.throws(
    () => rewriteLinks('[b]: javascript:alert(1)', 'README.md', pages, ids),
    /link to javascript:/,
  )
  assert.throws(
    () => rewriteLinks('see <javascript:alert(1)>', 'README.md', pages, ids),
    /link to javascript:/,
  )
  assert.equal(
    rewriteLinks('<https://example.com>', 'README.md', pages, ids),
    '<https://example.com>',
  )
})

test("finds a code span kramdown would not close, and spares a table's escaped pipes", () => {
  assert.deepEqual(blankCodeSpans('`a` `b` and ``x`` fine\n| then ` `, `+` |'), [
    '| then ` `, `+` |',
  ])
  assert.equal(
    unescapeTablePipes(
      '| `a \\| b` | c \\| d |\n`e \\| f` outside a table\n```\n| `g \\| h` |\n```',
    ),
    '| `a | b` | c \\| d |\n`e \\| f` outside a table\n```\n| `g \\| h` |\n```',
  )
  const blank = new Map([...sources, ['docs/review-file.md', '# F\n| a | ` ` |\n']])
  assert.throws(() => toPage(PAGES[1], pages, blank), /code spans of blanks only/)
})

test('finds the page by its path, and refuses one the docs do not have', () => {
  assert.equal(docsNav({ ...pages[1] }, pages).nav[1]?.current, true)
  assert.throws(
    () => docsNav({ ...pages[1], path: 'docs/gone.md' }, pages),
    /not among the docs pages/,
  )
})

test('lists each docs page once, from a file and to a page the site can link', () => {
  assert.equal(new Set(PAGES.map((page) => page.source)).size, PAGES.length)
  assert.equal(new Set(PAGES.map((page) => page.path)).size, PAGES.length)
  for (const page of PAGES) {
    assert.match(page.path, /^docs\/[\w-]+\.md$/, page.path)
    assert.equal(path.posix.normalize(page.source), page.source)
    assert.notDeepEqual(page.sections, [], `${page.source}: no section kept`)
  }
})

test('refuses a link to a missing heading or with an unsafe scheme', () => {
  assert.throws(
    () => rewriteLinks('[a](../README.md#modles)', 'docs/review-file.md', pages, ids),
    /#modles, a heading README.md does not have/,
  )
  assert.throws(
    () => rewriteLinks('[a](javascript:alert(1))', 'README.md', pages, ids),
    /link to javascript:/,
  )
})

test('finds a line kramdown would read as HTML', () => {
  // GitHub reads it as the end of a code span; kramdown as an HTML block.
  assert.deepEqual(
    htmlLines('the server stops with `delete\n<file>`, and\n\n<p>a block</p>'),
    ['<file>`, and'],
  )
})

test('keeps a page that closes the raw block out of Liquid', () => {
  const closing = new Map([
    ...sources,
    ['docs/review-file.md', '{% endraw %}{{ site }}\n'],
  ])
  assert.throws(() => toPage(PAGES[1], pages, closing), /endraw/)
})

test("stages every docs page from the repository's Markdown", async () => {
  const real = new Map(
    await Promise.all(
      PAGES.map(
        async (page) => /** @type {const} */ ([page.source, await read(page.source)]),
      ),
    ),
  )
  for (const page of PAGES) {
    const staged = toPage(page, PAGES, real)
    assert.match(staged, /^---\nlayout: docs\n/)
    assert.match(staged, /\nroot: "\.\.\/"\n/, `${page.source}: its root, from docs/`)
    assert.match(
      staged,
      /\nnav: \[\{"title":"Guide","href":"(\.\/)"/,
      `${page.source}: its nav`,
    )
    assert.match(
      staged,
      /\{% raw %\}\n(?!# )[^]*\n## [^]*\{% endraw %\}\n$/,
      `${page.source}: its sections, without its H1`,
    )
    for (const section of page.sections ?? []) {
      assert.ok(staged.includes(`\n## ${section}\n`), `${page.source}: ${section}`)
    }
  }
})

test('keeps Liquid tags whole in the layouts', async () => {
  // Prettier splits a tag inside an HTML tag across lines, which breaks it.
  const dir = new URL('../site/_layouts/', import.meta.url)
  for (const file of await readdir(dir)) {
    const layout = await readFile(new URL(file, dir), 'utf8')
    assert.doesNotMatch(layout, /\{%[^%]*\n/, file)
  }
})

test('links Annotant, its sibling, from every page: header and footer', async () => {
  const config = await read('site/_config.yml')
  assert.match(config, /^sibling:\n {2}url: https:\/\/annotant\.keveun\.net\/\n/m)
  const layout = await read('site/_layouts/default.html')
  const header = layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'))
  const footer = layout.slice(layout.indexOf('<footer'), layout.indexOf('</footer>'))
  assert.match(header, /href="\{\{ site\.sibling\.url \}\}"/)
  assert.match(footer, /href="\{\{ site\.sibling\.url \}\}"/)
  assert.match(footer, /\{\{ site\.sibling\.tagline \}\}/)
})
