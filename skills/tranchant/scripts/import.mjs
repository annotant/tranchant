#!/usr/bin/env node
// import.mjs --find | --prepare <source> --to <project | local> | --check <folder>
// What `/tranchant import` runs, from the session's folder, around the import
// agent (lib/imports.mjs).
// --find: the project's review processes, `.claude/skills/*review*` and
//   `.claude/agents/*review*`: one `CANDIDATE <path>` each, from the
//   project's root, or `NO_CANDIDATE`. The user names or confirms one.
// --prepare: finds the source and makes the import's folder:
//   `IMPORT <json>`, `{ id, dir, recipe, source, file, folder, version?, to,
//   target, project }`, `recipe` the only file the agent may write.
// --check: the agent ended: its recipe checked, `IMPORTED <lenses>`.
// Any refusal prints `IMPORT_REFUSED <reason>` and exits 2.
import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { oneLine } from './lib/format.mjs'
import { ImportRefusal, checkImport, createImport } from './lib/imports.mjs'

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`IMPORT_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

const flag = (/** @type {string} */ name) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** The git repository the session is in, else its folder. */
function projectRoot() {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return path.resolve(top || process.cwd())
  } catch {
    return process.cwd()
  }
}

const project = projectRoot()

if (process.argv.includes('--find')) {
  const found = []
  for (const [folder, skill] of /** @type {const} */ ([
    ['skills', true],
    ['agents', false],
  ])) {
    const root = path.join(project, '.claude', folder)
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!/review/i.test(entry.name)) continue
      if (skill ? entry.isDirectory() : entry.isFile() && entry.name.endsWith('.md'))
        found.push(path.join('.', '.claude', folder, entry.name))
    }
  }
  if (!found.length) console.log('NO_CANDIDATE')
  for (const one of found.toSorted((a, b) => a.localeCompare(b)))
    console.log(`CANDIDATE ${one}`)
  process.exit(0)
}

const checked = flag('--check')
if (checked) {
  const record = await checkImport(path.resolve(checked)).catch((error) =>
    refuse(`${checked}: ${error instanceof Error ? error.message : String(error)}`),
  )
  if (record.state !== 'ready') refuse(record.reason ?? 'the recipe cannot be used')
  console.log(`IMPORTED ${record.target}`)
  process.exit(0)
}

const source = flag('--prepare')
const to = flag('--to')
if (!source || !to) {
  console.error(
    'usage: import.mjs --find | --prepare <source> --to <project | local> | --check <folder>',
  )
  process.exit(2)
}
try {
  const made = await createImport({ project, source, to })
  console.log(`IMPORT ${JSON.stringify(made)}`)
} catch (error) {
  if (!(error instanceof ImportRefusal)) throw error
  refuse(error.message)
}
