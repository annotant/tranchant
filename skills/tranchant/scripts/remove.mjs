#!/usr/bin/env node
// remove.mjs <id> --review <dir>
// A verifier removes a finding that landed: its claim does not hold, or it
// repeats one that landed before it. Prints `REMOVED <id>`; a finding the
// reviewer decided on, or one inline in review.json, stays:
// `REMOVE_REFUSED <reason>`, exit 2.
import { oneLine } from './lib/format.mjs'
import { findReview, positional } from './lib/project.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'

const [id] = positional()
const dir = findReview()
if (!id || !dir) {
  console.error('usage: remove.mjs <id> --review <dir>')
  process.exit(2)
}

try {
  await createStore(dir).remove(id)
  console.log(`REMOVED ${id}`)
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  console.log(`REMOVE_REFUSED ${oneLine(error.message)}`)
  process.exit(2)
}
