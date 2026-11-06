#!/usr/bin/env node
// reply.mjs <id> --review <dir>, the answer as JSON on stdin
// reply.mjs <id> --review <dir> --ended
// A discussing agent's answer to the reviewer's question on finding <id>:
// `{ "text": "…", "fix"?: "…", "comment"?: "…", "drop"?: "…" }`, the text in
// Markdown and what it proposes the reviewer carries over to a decision.
// Prints `REPLIED <id>`; a refusal prints `REPLY_REFUSED <reason>` and exits 2.
// `--ended`: the hooks, once the agent ended; a question it left waiting gets
// a failed answer, and `UNANSWERED <id>` is printed.
import { parseArgs } from 'node:util'
import { textOrStdin } from './lib/cli.mjs'
import { endUnanswered, reply } from './lib/discussion.mjs'
import { oneLine } from './lib/format.mjs'
import { StoreRefusal } from './lib/store.mjs'

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`REPLY_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: { review: { type: 'string' }, ended: { type: 'boolean' } },
  })
} catch (error) {
  console.error(`reply.mjs: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const { values, positionals } = parsed
const [id] = positionals
if (!values.review || !id || !/^[\w-]{1,64}$/.test(id)) {
  console.error(
    'usage: reply.mjs <id> --review <dir>, the answer as JSON on stdin, or --ended',
  )
  process.exit(2)
}

if (values.ended) {
  if (await endUnanswered(values.review, id)) console.log(`UNANSWERED ${id}`)
  process.exit(0)
}

const text = await textOrStdin(undefined)
if (!text) refuse('the answer is expected as JSON on stdin')
let answer
try {
  answer = JSON.parse(text)
} catch {
  refuse('the answer is not JSON: { "text": "…", "fix"?, "comment"?, "drop"? }')
}
if (!answer || typeof answer !== 'object' || Array.isArray(answer))
  refuse('the answer is a JSON object: { "text": "…", "fix"?, "comment"?, "drop"? }')
try {
  await reply(values.review, id, answer)
  console.log(`REPLIED ${id}`)
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  refuse(error.message)
}
