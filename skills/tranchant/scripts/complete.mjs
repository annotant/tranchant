#!/usr/bin/env node
// complete.mjs --review <dir>
// The producer is done: the review's status becomes `complete`, and the
// page's in-progress indicator goes. Prints `COMPLETE`; on a review complete
// already, `COMPLETE_REFUSED <reason>` and exits 2.
import { oneLine } from './lib/format.mjs'
import { findReview } from './lib/project.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'

const dir = findReview()
if (!dir) {
  console.error('usage: complete.mjs --review <dir>')
  process.exit(2)
}

try {
  await createStore(dir).complete()
  console.log('COMPLETE')
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  console.log(`COMPLETE_REFUSED ${oneLine(error.message)}`)
  process.exit(2)
}
