#!/usr/bin/env node
// playground.mjs [--theirs] [--fresh]
// Builds `.playground/` at the repository root: a throwaway git repository
// holding every file a fixture review names, with a base commit on `main`
// and, on the review's branch, a head commit putting the excerpt lines at
// their real line numbers, and `.playground/review.json`, the fixture pointed
// at it, so a real session can try the plugin: `claude --plugin-dir .` then
// `/tranchant .playground/review.json`. `--fresh` replaces an existing one.
// The tests build the same repository elsewhere with `buildPlayground`.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** @typedef {import('../../skills/tranchant/scripts/lib/format.mjs').Review} Review */
/** @typedef {import('../../skills/tranchant/scripts/lib/format.mjs').Excerpt} Excerpt */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PLAYGROUND = path.join(ROOT, '.playground')

/** What line `number` of every file holds before the change. */
const placeholder = (/** @type {number} */ number) =>
  `// line ${number} of the playground`

/**
 * Every excerpt of the review by file: the findings' and their related ones.
 * @param {Review} review
 */
function excerptsByFile(review) {
  /** @type {Map<string, Excerpt[]>} */
  const excerpts = new Map()
  for (const finding of review.findings) {
    for (const { path: file, excerpt } of [finding, ...(finding.related ?? [])]) {
      const list = excerpts.get(file) ?? []
      list.push(excerpt)
      excerpts.set(file, list)
    }
  }
  return excerpts
}

/**
 * The file's lines: placeholders up to the last line an excerpt reaches,
 * with the excerpts' text in place when `changed`.
 * @param {Excerpt[]} excerpts
 * @param {boolean} changed
 */
function linesOf(excerpts, changed) {
  const length = Math.max(...excerpts.map((e) => e.startLine + e.lines.length - 1))
  const lines = Array.from({ length }, (_, i) => placeholder(i + 1))
  if (changed) {
    for (const { startLine, lines: text } of excerpts) {
      text.forEach((line, i) => (lines[startLine - 1 + i] = line))
    }
  }
  return lines
}

/**
 * Builds in `dir`, an empty folder, a git repository for `review`: on `main`,
 * every file the review names made of placeholder lines; on the review's
 * branch, one commit putting the excerpt lines at their line numbers, so each
 * finding's line is an added line of `git diff main...HEAD`. With `folder`,
 * the files and `project` lie in that folder of the repository. Returns the
 * review pointed at it: `project`, `base`, `headSha` and, when the review has
 * them, `mr.diffRefs`.
 * @param {string} dir
 * @param {Review} review
 * @param {{ folder?: string }} [options]
 * @returns {Review}
 */
export function buildPlayground(dir, review, { folder = '' } = {}) {
  const git = (/** @type {string[]} */ ...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Tranchant',
        '-c',
        'user.email=tranchant@localhost',
        ...args,
      ],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    ).trim()
  const project = path.join(dir, folder)
  const excerpts = excerptsByFile(review)
  const write = (/** @type {boolean} */ changed) => {
    for (const [file, list] of excerpts) {
      const target = path.join(project, file)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, `${linesOf(list, changed).join('\n')}\n`)
    }
  }
  mkdirSync(project, { recursive: true })
  writeFileSync(
    path.join(project, 'CLAUDE.md'),
    [
      '# Playground',
      '',
      'A throwaway copy made by test/fixtures/playground.mjs to try Tranchant on.',
      'There are no tests, no typecheck and no linter here: make the change the',
      'finding asks for with the Edit tool, and finish.',
      '',
    ].join('\n'),
  )
  write(false)
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  const baseSha = git('rev-parse', 'HEAD')
  git('checkout', '-q', '-b', review.branch)
  write(true)
  git('add', '-A')
  git('commit', '-q', '-m', 'the change under review')
  const headSha = git('rev-parse', 'HEAD')
  return {
    ...review,
    project,
    base: 'main',
    headSha,
    ...(review.mr?.diffRefs && {
      mr: { ...review.mr, diffRefs: { baseSha, headSha, startSha: baseSha } },
    }),
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const theirs = process.argv.includes('--theirs')
  const fixture = path.join(
    ROOT,
    'test/fixtures',
    theirs ? 'review-theirs.json' : 'review-ours.json',
  )
  if (existsSync(PLAYGROUND)) {
    if (!process.argv.includes('--fresh')) {
      console.error(`${PLAYGROUND} exists: pass --fresh to replace it`)
      process.exit(2)
    }
    rmSync(PLAYGROUND, { recursive: true })
  }
  /** @type {Review} */
  const review = JSON.parse(readFileSync(fixture, 'utf8'))
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
  const placed = buildPlayground(PLAYGROUND, {
    ...review,
    id: `playground-${theirs ? 'theirs' : 'ours'}-${stamp}`,
  })
  const out = path.join(PLAYGROUND, 'review.json')
  writeFileSync(out, `${JSON.stringify(placed, null, 2)}\n`)
  console.log(`PLAYGROUND ${PLAYGROUND}`)
  console.log(`REVIEW_FILE ${out}`)
  console.error(`Now: claude --plugin-dir . then /tranchant ${path.relative(ROOT, out)}`)
}
