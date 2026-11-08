#!/usr/bin/env node
// summarize.mjs --review <dir>   (`{ "summary": "<Markdown>", "strengths": ["…"] }` on stdin)
// The summary agent of `/tranchant review` writes the review's summary and
// strengths into review.json while the review is `reviewing`, replacing any
// before. Prints `SUMMARIZED`; an unsound one, or any once the review is
// complete, `SUMMARY_REFUSED <reason>`, exit 2.
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
  console.log(`SUMMARY_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

let parsed
try {
  parsed = parseArgs({ options: { review: { type: 'string' } } })
} catch (error) {
  console.error(
    `summarize.mjs: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(2)
}
const dir = findReview(parsed.values.review ? ['--review', parsed.values.review] : [])
if (!dir) {
  console.error(
    'usage: summarize.mjs --review <dir> ({ "summary": "…", "strengths": [] } on stdin)',
  )
  process.exit(2)
}

const text = await textOrStdin(undefined)
if (!text.trim()) refuse('no summary given: { "summary": "…", "strengths": [] } on stdin')
let given
try {
  given = JSON.parse(text)
} catch {
  refuse('the summary is not JSON')
}

try {
  await createStore(dir).summarize(given)
  console.log('SUMMARIZED')
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  refuse(error.message)
}
