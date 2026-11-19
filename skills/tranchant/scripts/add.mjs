#!/usr/bin/env node
// add.mjs --review <dir> [--lens <name>] [--file <finding.json>]   (or the finding on stdin)
// Adds one finding to a review still `reviewing`: checks it as open.mjs
// checks a review's (its id, unique in the review; its line within the
// excerpt or the hunk's new side; its comment, when the review is theirs),
// writes findings/<id>.json with the time it landed, and prints `ADDED <id>`.
// `--lens` names the lens that found it, whatever the finding says: a
// reviewer's hooks require its own.
// The same finding again is accepted silently; another one under the same
// id, an unsound one, or any once the review is complete is refused:
// `ADD_REFUSED <reason>`, exit 2.
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { textOrStdin } from './lib/cli.mjs'
import { oneLine } from './lib/format.mjs'
import { findReview } from './lib/project.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`ADD_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

let parsed
try {
  parsed = parseArgs({
    options: {
      review: { type: 'string' },
      file: { type: 'string' },
      lens: { type: 'string' },
    },
  })
} catch (error) {
  console.error(`add.mjs: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const dir = findReview(parsed.values.review ? ['--review', parsed.values.review] : [])
if (!dir) {
  console.error(
    'usage: add.mjs --review <dir> [--lens <name>] [--file <finding.json>] (or the finding on stdin)',
  )
  process.exit(2)
}

const { file, lens } = parsed.values
const text = file
  ? await readFile(file, 'utf8').catch((error) =>
      refuse(
        `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
  : await textOrStdin(undefined)
if (!text.trim()) refuse('no finding given: --file <finding.json>, or JSON on stdin')
let finding
try {
  finding = JSON.parse(text)
} catch {
  refuse(`${file ?? 'the finding'} is not JSON`)
}
if (
  lens !== undefined &&
  finding &&
  typeof finding === 'object' &&
  !Array.isArray(finding)
)
  finding = { ...finding, lens }

try {
  const { id } = await createStore(dir).addFinding(finding)
  console.log(`ADDED ${id}`)
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  refuse(error.message)
}
