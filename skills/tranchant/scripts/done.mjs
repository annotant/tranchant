#!/usr/bin/env node
// done.mjs <id> --review <dir> "<summary>"   (or the summary on stdin)
// Moves the finding from working to fixed: the working tree holds the fix.
// The run records the summary and the files its steps wrote, and a change
// asked in the finding's discussion gets the summary there. Prints `done`.
import { parseArgs } from 'node:util'
import { closeDiscussion, textOrStdin } from './lib/cli.mjs'
import { findReview } from './lib/project.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'

let parsed
try {
  parsed = parseArgs({ allowPositionals: true, options: { review: { type: 'string' } } })
} catch (error) {
  console.error(`done.mjs: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const [id, summaryArg] = parsed.positionals
const dir = findReview(parsed.values.review ? ['--review', parsed.values.review] : [])
const summary = await textOrStdin(summaryArg)
if (!id || !dir || !summary) {
  console.error(
    'usage: done.mjs <id> --review <dir> "<summary>" (or the summary on stdin)',
  )
  process.exit(2)
}

try {
  await createStore(dir).done(id, summary)
  await closeDiscussion(dir, id)
  console.log('done')
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  console.error(`${error.message}; not finishing`)
  process.exit(1)
}
