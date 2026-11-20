#!/usr/bin/env node
// clean.mjs [--project <root>] --find
//   | --prepare <source> --to <global | local> [--name <name>] [--context <skill>]
//   | --again <name> --scope <global | local> | --start <id> | --check <folder> [--stopped]
//   | --drop <id>
// What runs around a lens's cleaning agent (lib/cleaning.mjs), from the
// session's folder or for --project.
// --find: the project's reviewers, `.claude/skills/*review*` and
//   `.claude/agents/*review*`: one `CANDIDATE <path>` each, from the
//   project's root, or `NO_CANDIDATE`. The user names or confirms one.
// --prepare: a new lens's cleaning (/tranchant import); --again: a stored
//   lens's, its source changed; --start: one the page made, which waits no
//   more from then on. Each prints
//   `CLEANING <json>`, what the agent is given: `{ id, dir, project, name,
//   scope, again, source, file, folder, version?, context?, contextFile?,
//   rules?, lens, report }`, `lens` and `report` the only files it writes.
// --check: the agent ended: what it wrote checked, `CLEANED <state> <scope>
//   <name>` (`ready` to add from the page, `added` for a lens cleaned again)
//   or `CLEAN_FAILED <reason>`. With --stopped, the agent was stopped or
//   never started: the cleaning fails, and a lens cleaned again keeps no
//   failure on its source.
// --drop: one the page made that waited for an agent and gets none
//   (/tranchant stop): it fails as stopped, `CLEAN_FAILED <reason>`.
// Any refusal prints `CLEAN_REFUSED <reason>` and exits 2.
import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { oneLine } from './lib/format.mjs'
import {
  CleaningRefusal,
  agentInput,
  checkCleaning,
  cleanAgain,
  cleaningOf,
  createCleaning,
  startedCleaning,
} from './lib/cleaning.mjs'

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`CLEAN_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

const flag = (/** @type {string} */ name) => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/**
 * The git repository --project, else the session's folder, is in, as
 * prepare.mjs names it (its lenses are filed under its hash); else the folder.
 */
function projectRoot() {
  const from = path.resolve(flag('--project') ?? process.cwd())
  try {
    const top = execFileSync('git', ['-C', from, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return path.resolve(top || from)
  } catch {
    return from
  }
}

const project = projectRoot()

/** Runs `step`; a refusal of the cleaning is printed, anything else thrown. */
async function guarded(/** @type {() => Promise<void>} */ step) {
  try {
    await step()
  } catch (error) {
    if (error instanceof CleaningRefusal) refuse(error.message)
    throw error
  }
}

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

const dropped = flag('--drop')
const checked = flag('--check')
if (checked || dropped) {
  const record = await (async () => {
    const dir = dropped
      ? (await cleaningOf(project, dropped)).dir
      : path.resolve(checked ?? '')
    return checkCleaning(dir, {
      stopped: Boolean(dropped) || process.argv.includes('--stopped'),
    })
  })().catch((error) =>
    refuse(
      `${checked ?? dropped}: ${error instanceof Error ? error.message : String(error)}`,
    ),
  )
  if (record.state === 'failed')
    console.log(`CLEAN_FAILED ${oneLine(record.reason ?? 'the cleaning failed')}`)
  else console.log(`CLEANED ${record.state} ${record.scope} ${record.name}`)
  process.exit(0)
}

const source = flag('--prepare')
const again = flag('--again')
const id = flag('--start')
await guarded(async () => {
  let made
  if (source) {
    const to = flag('--to')
    if (!to) refuse('--to global or --to local: where the lens lives')
    const name = flag('--name')
    const context = flag('--context')
    made = await createCleaning({
      project,
      source,
      scope: to,
      ...(name && { name }),
      ...(context && { context }),
    })
  } else if (again) {
    made = await cleanAgain({ project, scope: flag('--scope') ?? '', name: again })
  } else if (id) {
    made = await startedCleaning(project, id)
  } else {
    console.error(
      'usage: clean.mjs [--project <root>] --find | --prepare <source> --to <global | local> [--name <name>] [--context <skill>] | --again <name> --scope <global | local> | --start <id> | --check <folder> [--stopped] | --drop <id>',
    )
    process.exit(2)
  }
  console.log(`CLEANING ${JSON.stringify(agentInput(made.dir, made.record))}`)
})
