#!/usr/bin/env node
// playground.mjs [--theirs] [--fresh]
// Builds `.playground/` at the repository root: a throwaway git repository
// holding every file a fixture review names, its excerpt lines at their real
// line numbers, and `.playground/review.json`, the fixture pointed at it, so a
// real session can try the plugin: `claude --plugin-dir .` then
// `/tranchant .playground/review.json`. `--fresh` replaces an existing one.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PLAYGROUND = path.join(ROOT, '.playground')
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
mkdirSync(PLAYGROUND, { recursive: true })

/** @type {import('../../skills/tranchant/scripts/lib/format.mjs').Review} */
const review = JSON.parse(readFileSync(fixture, 'utf8'))

/** Every excerpt of the review by file: the findings' and their related ones. */
const excerpts = new Map()
for (const finding of review.findings) {
  for (const { path: file, excerpt } of [finding, ...(finding.related ?? [])]) {
    const list = excerpts.get(file) ?? []
    list.push(excerpt)
    excerpts.set(file, list)
  }
}

for (const [file, list] of excerpts) {
  /** @type {string[]} */
  const lines = []
  for (const { startLine, lines: text } of list.toSorted(
    (a, b) => a.startLine - b.startLine,
  )) {
    while (lines.length < startLine - 1)
      lines.push(`// line ${lines.length + 1} of the playground`)
    text.forEach((line, i) => (lines[startLine - 1 + i] = line))
  }
  const target = path.join(PLAYGROUND, file)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, `${lines.join('\n')}\n`)
}

writeFileSync(
  path.join(PLAYGROUND, 'CLAUDE.md'),
  [
    '# Playground',
    '',
    'A throwaway copy made by test/fixtures/playground.mjs to try Tranchant on.',
    'There are no tests, no typecheck and no linter here: make the change the',
    'finding asks for with the Edit tool, and finish.',
    '',
  ].join('\n'),
)

const git = (/** @type {string[]} */ ...args) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: PLAYGROUND,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim()
git('init', '-q', '-b', 'main')
git('add', '-A')
git(
  '-c',
  'user.name=Tranchant',
  '-c',
  'user.email=tranchant@localhost',
  'commit',
  '-q',
  '-m',
  'playground',
)

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
const placed = {
  ...review,
  id: `playground-${theirs ? 'theirs' : 'ours'}-${stamp}`,
  project: PLAYGROUND,
  headSha: git('rev-parse', 'HEAD'),
}
const out = path.join(PLAYGROUND, 'review.json')
writeFileSync(out, `${JSON.stringify(placed, null, 2)}\n`)

console.log(`PLAYGROUND ${PLAYGROUND}`)
console.log(`REVIEW_FILE ${out}`)
console.error(`Now: claude --plugin-dir . then /tranchant ${path.relative(ROOT, out)}`)
