#!/usr/bin/env node
// verify.mjs <id> --review <dir> [--file <finding.json> | --amend]
// verify.mjs --pending --review <dir>
// A verifier's verdict on a finding that landed: confirmed, it gets
// `verified: true` and prints `VERIFIED <id>`; amended (the finding whole,
// same id, from the file or, with --amend, stdin), it is replaced, verified,
// and prints `AMENDED <id>`. Amending a finding the person decided on is
// refused. `--pending`: the hooks' check before they complete the review, one
// `UNVERIFIED <id>` per finding not verified yet. A refusal prints
// `VERIFY_REFUSED <reason>` and exits 2.
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { textOrStdin } from './lib/cli.mjs'
import { oneLine } from './lib/format.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'

const USAGE =
  'usage: verify.mjs <id> --review <dir> [--file <finding.json> | --amend], or verify.mjs --pending --review <dir>'

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`VERIFY_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      review: { type: 'string' },
      file: { type: 'string' },
      amend: { type: 'boolean' },
      pending: { type: 'boolean' },
    },
  })
} catch (error) {
  console.error(`verify.mjs: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const { values, positionals } = parsed
const [id] = positionals
if (!values.review || (!id && !values.pending)) {
  console.error(USAGE)
  process.exit(2)
}
const store = createStore(values.review)

if (values.pending) {
  const review = await store.readReview().catch((error) => {
    if (!(error instanceof StoreRefusal)) throw error
    return refuse(error.message)
  })
  for (const finding of review.findings) {
    if (finding.verified !== true) console.log(`UNVERIFIED ${finding.id}`)
  }
  process.exit(0)
}

/** The amended finding, when one is given. */
async function amended() {
  if (values.file) {
    const text = await readFile(values.file, 'utf8').catch((error) =>
      refuse(
        `cannot read ${values.file}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
    return parse(text)
  }
  if (values.amend) {
    const text = await textOrStdin(undefined)
    if (!text) refuse('--amend: the amended finding is expected as JSON on stdin')
    return parse(text)
  }
  return undefined
}

/** @param {string} text */
function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return refuse('the amended finding is not JSON')
  }
}

const finding = await amended()
try {
  await store.verify(String(id), finding)
  console.log(`${finding === undefined ? 'VERIFIED' : 'AMENDED'} ${id}`)
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  refuse(error.message)
}
