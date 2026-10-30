#!/usr/bin/env node
// open.mjs <review.json>
// Validates a review file and imports it into the state folder,
// <state>/<hash of its project>/reviews/<its id>/, with an empty decisions
// file next to it; prints `REVIEW <dir>`. An id imported already with the
// same content is reused, its decisions kept; with other content it is
// refused: the producer mints a new id. Any refusal prints
// `REVIEW_REFUSED <reason>` and exits 2.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './lib/errors.mjs'
import { DECISIONS_VERSION, FormatError, oneLine, parseReview } from './lib/format.mjs'
import { reviewDir } from './lib/project.mjs'

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
const review = parse(file, text)
const { id, project } = review
const dir = reviewDir(project, id)
const target = path.join(dir, 'review.json')

// The same review, however it was laid out: its content, not its bytes.
const canonical = JSON.stringify(review)
let existing
try {
  existing = await readFile(target, 'utf8')
} catch (error) {
  if (errorCode(error) !== 'ENOENT') throw error
}
if (existing !== undefined) {
  let same = false
  try {
    same = JSON.stringify(JSON.parse(existing)) === canonical
  } catch {}
  if (!same) refuse(`id ${id} exists with other content`)
} else {
  await mkdir(path.join(dir, 'runs'), { recursive: true })
  await writeFile(target, text)
}
const empty = `${JSON.stringify({ version: DECISIONS_VERSION, findings: {} }, null, 2)}\n`
try {
  await writeFile(path.join(dir, 'decisions.json'), empty, { flag: 'wx' })
} catch (error) {
  if (errorCode(error) !== 'EEXIST') throw error
}
console.log(`REVIEW ${dir}`)
