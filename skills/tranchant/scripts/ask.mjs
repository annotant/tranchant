#!/usr/bin/env node
// ask.mjs <id> --review <dir> "<question>" [--option "<label>: <description>"]... [--multiple]
// (or the question on stdin)
// Moves the finding from working to asking: the agent stops, and the
// reviewer's answer queues the finding again for a new run. With options,
// the reviewer picks one (several with --multiple) or answers in their own
// words. Prints `asked`.
import { questionArgs, textOrStdin } from './lib/cli.mjs'
import { findReview } from './lib/project.mjs'
import { MAX_OPTIONS, StoreRefusal, createStore } from './lib/store.mjs'

const asked = questionArgs()
const problem = 'problem' in asked ? asked.problem : undefined
const parsed = 'problem' in asked ? undefined : asked
const [id, questionArg] = parsed?.args ?? []
const dir = findReview(parsed?.review ? ['--review', parsed.review] : [])
const text = problem ? '' : await textOrStdin(questionArg)
if (!parsed || !id || !dir || !text) {
  if (problem) console.error(`ask.mjs: ${problem}`)
  console.error(
    'usage: ask.mjs <id> --review <dir> "<question>" (or the question on stdin)\n' +
      `  [--option "<label>: <description>"]... (2 to ${MAX_OPTIONS} distinct labels) [--multiple]`,
  )
  process.exit(2)
}

try {
  await createStore(dir).ask(id, {
    text,
    options: parsed.options,
    multiple: parsed.multiple,
  })
  console.log('asked')
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  console.error(`${error.message}; not asking`)
  process.exit(1)
}
