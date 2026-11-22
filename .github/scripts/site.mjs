#!/usr/bin/env node
// site.mjs <out-dir>
// Stages the website's sources in <out-dir> for Jekyll: site/ as it is, and
// the docs pages built from the Markdown files PAGES lists, so the site never
// holds a copy of them. Run from the repository root; the Pages workflow
// builds <out-dir> with Jekyll. Fails on what would break a page.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPOSITORY = 'https://github.com/annotant/tranchant'

/**
 * A docs page: its source in the repository, where it goes on the site, its
 * title, and the sections it keeps when it keeps only some (the README: the
 * rest is for contributors).
 * @typedef {{ source: string, path: string, title: string, sections?: string[] }} Page
 */

/**
 * A link of the docs' pages nav, as the layout reads it.
 * @typedef {{ title: string, href: string, current: boolean }} NavItem
 */

/** @type {Page[]} */
export const PAGES = [
  {
    source: 'README.md',
    path: 'docs/index.md',
    title: 'Guide',
    sections: [
      'How it works',
      'What the review looks at',
      'Install',
      'Use',
      'Troubleshooting',
    ],
  },
  {
    source: 'docs/review-file.md',
    path: 'docs/review-file.md',
    title: 'The review file',
  },
  {
    source: 'docs/settings.md',
    path: 'docs/settings.md',
    title: 'The settings file',
  },
]

/**
 * GitHub's id for a heading (but the `-1` it adds to a repeated one): lowercase, punctuation but `_` and `-` dropped,
 * spaces to dashes.
 * @param {string} heading
 */
export const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')

/**
 * The Markdown's lines, each with whether it lies in a fenced code block.
 * @param {string} markdown
 */
function lines(markdown) {
  let fence = ''
  return markdown.split('\n').map((text) => {
    const [, marker, info] = /^\s*(`{3,}|~{3,})(.*)$/.exec(text) ?? []
    // A closing fence is the opening one's character, at least as long, and nothing else.
    if (marker && (!fence || (marker.startsWith(fence) && !info?.trim()))) {
      fence = fence ? '' : marker
      return { text, code: true }
    }
    return { text, code: fence !== '' }
  })
}

/**
 * Keeps the `## ` sections named, in their order in the file, and drops what
 * comes before the first one (the README's header, made for GitHub). Throws
 * when one of them is not in the file: a renamed heading would drop it.
 * @param {string} markdown
 * @param {string[]} names
 */
export function keepSections(markdown, names) {
  /** @type {string[]} */
  const kept = []
  const found = new Set()
  let keep = false
  for (const { text, code } of lines(markdown)) {
    const h2 = code ? undefined : /^## (.+)$/.exec(text)?.[1]?.trim()
    if (h2 !== undefined) {
      keep = names.includes(h2)
      if (keep) found.add(h2)
    }
    if (keep) kept.push(text)
  }
  const missing = names.filter((name) => !found.has(name))
  if (missing.length) throw new Error(`no "## ${missing.join('", "## ')}" section`)
  return kept.join('\n').trim() + '\n'
}

/**
 * The ids of the Markdown's headings.
 * @param {string} markdown
 */
export const headingIds = (markdown) =>
  new Set(
    lines(markdown).flatMap(({ text, code }) => {
      const heading = code ? undefined : /^#{1,6} (.+)$/.exec(text)?.[1]
      return heading === undefined ? [] : [slug(heading)]
    }),
  )

/**
 * The headings of a docs page's source: all of them, and those its page keeps.
 * @typedef {{ all: Set<string>, kept: Set<string> }} Ids
 */

/**
 * The link from one docs page to another, relative so the site works at any
 * address: a folder's index is the folder.
 * @param {string} from the linking page's path on the site
 * @param {string} to the linked page's path on the site
 */
const relative = (from, to) =>
  posix
    .relative(posix.dirname(from), to)
    .replace(/(^|\/)index\.md$/, '$1')
    .replace(/\.md$/, '.html') || './'

/**
 * Points the page's links, inline (a title kept) or reference definitions,
 * where they work on the site: to a docs page when it keeps the heading linked
 * to, else to the file on GitHub. Throws on a link to a heading a docs page's
 * source does not have, or with a scheme but http(s) and mailto, autolinks
 * included: kramdown, unlike GitHub, keeps any scheme.
 * @param {string} markdown the page, as the site shows it
 * @param {string} source the page's file in the repository
 * @param {Page[]} pages
 * @param {Map<string, Ids>} ids the headings of each page's source
 */
export function rewriteLinks(markdown, source, pages, ids) {
  const site = new Map(pages.map((page) => [page.source, page.path]))
  const here = site.get(source) ?? source
  /** @param {string} target */
  const link = (target) => {
    if (/^(https?|mailto):/i.test(target)) return target
    if (/^[a-z][a-z0-9+.-]*:/i.test(target))
      throw new Error(`${source}: link to ${target}`)
    const [path = '', hash = ''] = target.split('#')
    const file = path ? posix.normalize(posix.join(posix.dirname(source), path)) : source
    const anchor = hash ? `#${hash}` : ''
    const page = site.get(file)
    const headings = ids.get(file)
    if (hash && headings && !headings.all.has(hash)) {
      throw new Error(`${source}: link to ${target}, a heading ${file} does not have`)
    }
    if (page && (!hash || headings?.kept.has(hash))) {
      if (page === here) return anchor || '#'
      return relative(here, page) + anchor
    }
    return `${REPOSITORY}/blob/main/${file}${anchor}`
  }
  return lines(markdown)
    .map(({ text, code }) => {
      if (code) return text
      for (const [, target = ''] of text.matchAll(/<([a-z][a-z0-9+.-]*:[^>\s]*)>/gi)) {
        if (!/^(https?|mailto):/i.test(target))
          throw new Error(`${source}: link to ${target}`)
      }
      return text
        .replace(/^( {0,3}\[[^\]]+\]:\s*)(\S+)/, (_, head, target) => head + link(target))
        .replace(
          /\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
          (_, target, title) => `](${link(target)}${title})`,
        )
    })
    .join('\n')
}

/**
 * The lines kramdown would read as raw HTML where GitHub reads text: a line
 * inside a paragraph that starts with a tag (`<file>` wrapped from a code
 * span), which swallows the rest of the page.
 * @param {string} markdown
 */
export function htmlLines(markdown) {
  const all = lines(markdown)
  return all.flatMap(({ text, code }, i) =>
    !code && all[i - 1]?.text.trim() && /^\s*<[a-z]/i.test(text) ? [text.trim()] : [],
  )
}

/**
 * The code spans kramdown reads apart from GitHub: one of blanks only, which
 * kramdown does not close and which shifts every later one, a table with them.
 * @param {string} markdown
 */
export function blankCodeSpans(markdown) {
  return lines(markdown).flatMap(({ text, code }) =>
    !code && codeSpans(text).some((span) => span && !span.trim()) ? [text.trim()] : [],
  )
}

/**
 * The contents of a line's code spans: each run of backticks closed by the
 * next run as long.
 * @param {string} text
 */
function codeSpans(text) {
  const runs = [...text.matchAll(/`+/g)]
  /** @type {string[]} */
  const found = []
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]
    const close = runs.findIndex((run, k) => k > i && run[0] === open?.[0])
    if (!open || close === -1) continue
    found.push(text.slice((open.index ?? 0) + open[0].length, runs[close]?.index))
    i = close
  }
  return found
}

/**
 * The table rows with `\|` in their code spans written `|`: GitHub needs the
 * escape there and drops it, kramdown keeps the cell whole without it and
 * would show the backslash.
 * @param {string} markdown
 */
export const unescapeTablePipes = (markdown) =>
  lines(markdown)
    .map(({ text, code }) =>
      code || !/^\s*\|/.test(text)
        ? text
        : text.replace(/(`+)([^`]+?)\1/g, (span) => span.replaceAll('\\|', '|')),
    )
    .join('\n')

/**
 * The Markdown a docs page shows: the sections it keeps.
 * @param {Page} page
 * @param {string} markdown the source file's content
 */
const shown = (page, markdown) =>
  page.sections ? keepSections(markdown, page.sections) : markdown

/**
 * The headings of each page's source.
 * @param {Page[]} pages
 * @param {Map<string, string>} sources each page's source file's content
 * @returns {Map<string, Ids>}
 */
export const pageIds = (pages, sources) =>
  new Map(
    pages.map((page) => {
      const markdown = sources.get(page.source) ?? ''
      return [
        page.source,
        { all: headingIds(markdown), kept: headingIds(shown(page, markdown)) },
      ]
    }),
  )

/**
 * The docs' pages nav as a page shows it, in PAGES' order: each page's title,
 * its link from this page, and which one this page is; the previous and the
 * next page are its neighbours there. Throws when `pages` lacks the page.
 * @param {Page} page
 * @param {Page[]} pages
 * @returns {{ nav: NavItem[], previous?: NavItem, next?: NavItem }}
 */
export function docsNav(page, pages) {
  const at = pages.findIndex((other) => other.path === page.path)
  if (at === -1) throw new Error(`${page.path}: not among the docs pages`)
  const nav = pages.map((other, i) => ({
    title: other.title,
    href: relative(page.path, other.path),
    current: i === at,
  }))
  return { nav, previous: nav[at - 1], next: nav[at + 1] }
}

/**
 * A docs page as Jekyll reads it: its front matter (its pages nav included), a
 * table of contents (kramdown's), and its sections with their links
 * rewritten, without its H1 (the layout's title) and kept out of Liquid.
 * Throws on what would break it.
 * @param {Page} page
 * @param {Page[]} pages
 * @param {Map<string, string>} sources each page's source file's content
 */
export function toPage(page, pages, sources) {
  const kept = shown(page, sources.get(page.source) ?? '')
  const html = htmlLines(kept)
  if (html.length) {
    throw new Error(
      `${page.source}: rewrap the lines that start with a tag: ${html.join(' | ')}`,
    )
  }
  const blank = blankCodeSpans(kept)
  if (blank.length) {
    throw new Error(
      `${page.source}: reword the code spans of blanks only: ${blank.join(' | ')}`,
    )
  }
  if (/\{%-?\s*endraw/.test(kept)) throw new Error(`${page.source}: holds an endraw tag`)
  const body = rewriteLinks(
    unescapeTablePipes(kept),
    page.source,
    pages,
    pageIds(pages, sources),
  ).replace(/^# .+\n+/, '')
  const root = '../'.repeat(page.path.split('/').length - 1)
  const { nav, previous, next } = docsNav(page, pages)
  // JSON is YAML: the values reach the layout as they are, quotes and all.
  return [
    '---',
    'layout: docs',
    `title: ${JSON.stringify(page.title)}`,
    `root: ${JSON.stringify(root)}`,
    `source: ${JSON.stringify(`${REPOSITORY}/blob/main/${page.source}`)}`,
    `nav: ${JSON.stringify(nav)}`,
    ...(previous ? [`previous: ${JSON.stringify(previous)}`] : []),
    ...(next ? [`next: ${JSON.stringify(next)}`] : []),
    '---',
    '',
    '* Contents',
    '{:toc}',
    '',
    '{% raw %}',
    body.trimEnd(),
    '{% endraw %}',
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) {
    console.error('usage: site.mjs <out-dir>')
    process.exit(2)
  }
  cpSync('site', out, { recursive: true })
  const sources = new Map(
    PAGES.map((page) => [page.source, readFileSync(page.source, 'utf8')]),
  )
  for (const page of PAGES) {
    const file = join(out, page.path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, toPage(page, PAGES, sources))
  }
}
