#!/usr/bin/env node
// open.mjs <review.json> [--verify | --refresh]
// Validates a review file and imports it into the state folder,
// <state>/<hash of its project>/reviews/<its id>/: review.json keeps the
// envelope, findings/<id>.json each finding the producer wrote inline, and
// an empty decisions file sits next to them; prints `REVIEW <dir>`. An id
// imported already with the same envelope (status and findings aside: a
// review grows) is reused, its decisions kept, and its inline findings not
// there yet are added; with another envelope, or a finding of other content,
// it is refused: the producer mints a new id. `verify` and the findings'
// `verified` are the hooks' alone: dropped, unless `--verify`, which
// `/tranchant review` passes for the envelope prepare.mjs wrote, keeps
// `verify`. `--refresh`, which `/tranchant comments` passes, takes an id
// imported already as the same PR/MR imported again: its envelope replaced,
// its findings new or changed written, its decisions kept. Any refusal prints
// `REVIEW_REFUSED <reason>` and exits 2.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './lib/errors.mjs'
import {
  DECISIONS_VERSION,
  FormatError,
  contentOf,
  envelopeOf,
  identityOf,
  oneLine,
  parseReview,
} from './lib/format.mjs'
import { reviewDir } from './lib/project.mjs'
import { StoreRefusal, createStore, findingPath } from './lib/store.mjs'

/** @typedef {import('./lib/format.mjs').Finding} Finding */

/**
 * @param {string} reason
 * @returns {never}
 */
function refuse(reason) {
  console.log(`REVIEW_REFUSED ${oneLine(reason)}`)
  process.exit(2)
}

/** @param {string} file */
async function read(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    return refuse(
      `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * @param {string} file
 * @param {string} text
 */
function parse(file, text) {
  try {
    return parseReview(text)
  } catch (error) {
    if (!(error instanceof FormatError)) throw error
    return refuse(`${file}: ${error.message}`)
  }
}

const [file] = process.argv.slice(2)
if (!file) {
  console.error('usage: open.mjs <review.json>')
  process.exit(2)
}

const text = await read(file)
// Only a run of /tranchant review has verifiers: whatever a file claims, its findings are not dimmed.
const { verify: _claimed, ...parsed } = parse(file, text)
const review = {
  ...parsed,
  ...(process.argv.includes('--verify') ? { verify: true } : {}),
  findings: parsed.findings.map(({ verified: _verified, ...finding }) => finding),
}
const { id, project } = review
const dir = reviewDir(project, id)
const target = path.join(dir, 'review.json')
const store = createStore(dir)

/**
 * Writes the findings a producer wrote inline, one file each, in the
 * producer's order: stamped one millisecond apart.
 * @param {Finding[]} findings
 */
async function split(findings) {
  const base = Date.now()
  for (const [i, finding] of findings.entries()) {
    await store.writeFinding({
      ...finding,
      addedAt: finding.addedAt ?? new Date(base + i).toISOString(),
    })
  }
}

let imported = true
try {
  await readFile(target, 'utf8')
} catch (error) {
  if (errorCode(error) !== 'ENOENT') throw error
  imported = false
}
if (imported && process.argv.includes('--refresh')) {
  try {
    const { added, updated } = await store.refresh(review)
    console.error(`refreshed: ${added} finding(s) added, ${updated} updated`)
  } catch (error) {
    if (!(error instanceof StoreRefusal)) throw error
    refuse(`${target}: ${error.message}`)
  }
} else if (imported) {
  /** @type {import('./lib/format.mjs').Review} */
  let known
  try {
    known = await store.readReview()
  } catch (error) {
    if (!(error instanceof StoreRefusal)) throw error
    known = refuse(`${target}: ${error.message}`)
  }
  if (identityOf(known) !== identityOf(review))
    refuse(`id ${id} exists with other content`)
  const clash = review.findings.find((finding) => {
    const there = known.findings.find((one) => one.id === finding.id)
    return there && contentOf(there) !== contentOf(finding)
  })
  if (clash) refuse(`finding ${clash.id} exists with other content`)
  // A folder imported before findings/ existed holds them inline: split too.
  await split(
    review.findings.filter((finding) => !existsSync(findingPath(dir, finding.id))),
  )
} else {
  await mkdir(path.join(dir, 'runs'), { recursive: true })
  await mkdir(path.join(dir, 'findings'), { recursive: true })
  await split(review.findings)
  await writeFile(target, `${JSON.stringify(envelopeOf(review), null, 2)}\n`)
}
const empty = `${JSON.stringify({ version: DECISIONS_VERSION, findings: {} }, null, 2)}\n`
try {
  await writeFile(path.join(dir, 'decisions.json'), empty, { flag: 'wx' })
} catch (error) {
  if (errorCode(error) !== 'EEXIST') throw error
}
console.log(`REVIEW ${dir}`)
