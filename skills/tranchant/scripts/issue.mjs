#!/usr/bin/env node
// issue.mjs <id> --review <dir>
// Opens the issue the reviewer wrote for the finding on the project's own
// tracker, the project its origin remote names (the one the page names too):
// `gh api` on GitHub, `glab api` on GitLab (the settings' `postWith` names
// one for a host neither tool recognises). Then moves the finding
// from queued to moved, with the issue's url, or to failed with the tool's
// error. Prints `moved <url>` or `failed <reason>`. The server runs it on
// each issue decision, one at a time; never an agent.
// TRANCHANT_GH and TRANCHANT_GLAB name other executables (the tests' fakes).
import { existsSync } from 'node:fs'
import { firstLine, runWithInput } from './lib/command.mjs'
import { oneLine } from './lib/format.mjs'
import { findReview, positional } from './lib/project.mjs'
import { loadSettings } from './lib/settings.mjs'
import { StoreRefusal, createStore } from './lib/store.mjs'
import { trackerOf } from './lib/tracker.mjs'

const MAX_REASON = 300

/**
 * @param {string} reason
 * @returns {never}
 */
function failed(reason) {
  console.log(`failed ${oneLine(reason)}`)
  process.exit(1)
}

const [id] = positional()
const dir = findReview()
if (!id || !dir) {
  console.error('usage: issue.mjs <id> --review <dir>')
  process.exit(2)
}
const store = createStore(dir)
const { review, decisions } = await store.readAll()
const entry = decisions.findings[id]
if (!review.findings.some((one) => one.id === id))
  failed(`no finding ${id} in the review`)
if (entry?.state !== 'queued' || entry.decision?.action !== 'issue') {
  failed(`finding ${id} is not queued for an issue`)
}

/**
 * Fails the issue and says why: the reviewer reads the reason on the page.
 * @param {string} reason
 * @returns {Promise<never>}
 */
async function give(reason) {
  const short = reason.slice(0, MAX_REASON)
  await store.fail(id, short).catch((error) => {
    if (!(error instanceof StoreRefusal)) throw error
    console.error(error.message)
  })
  return failed(short)
}

const title = entry?.issue?.title
const body = entry?.issue?.body
if (!title || !body) await give(`finding ${id} has no issue title or body`)

const { postWith } = (await loadSettings()).values
const tracker = await trackerOf(review.project, {
  gitlab: !!review.mr && review.mr.forge !== 'github',
  ...(postWith !== 'auto' && { forge: postWith === 'gh' ? 'github' : 'gitlab' }),
}).catch((error) => give(error instanceof Error ? error.message : String(error)))

const json = ['--header', 'Content-Type: application/json', '--input', '-']
/** @type {{ tool: string, command: string, args: string[], request: object }} */
const call =
  tracker.kind === 'github'
    ? {
        tool: 'gh',
        command: process.env.TRANCHANT_GH || 'gh',
        args: [
          'api',
          '--method',
          'POST',
          '--hostname',
          tracker.host,
          ...json,
          `repos/${tracker.path}/issues`,
        ],
        request: { title, body },
      }
    : {
        tool: 'glab',
        command: process.env.TRANCHANT_GLAB || 'glab',
        args: [
          'api',
          '--method',
          'POST',
          '--hostname',
          tracker.host,
          ...json,
          `projects/${encodeURIComponent(tracker.path)}/issues`,
        ],
        request: { title, description: body },
      }
// From the project, as a post: the tools read their settings for the checkout.
const cwd = existsSync(review.project) ? review.project : undefined
const ran = await runWithInput(call.command, call.args, JSON.stringify(call.request), cwd)
if (ran.code !== 0) {
  await give(
    firstLine(ran.stderr) ||
      firstLine(ran.stdout) ||
      `${call.tool} exited with ${ran.code}`,
  )
}
// The tool succeeded: the issue is likely open, so the reason says where to look before trying again.
const unsure = `check ${tracker.web}/${tracker.kind === 'gitlab' ? '-/issues' : 'issues'} before trying again`
let answer
try {
  answer = JSON.parse(ran.stdout)
} catch {
  await give(`${call.tool} answered something other than the issue: ${unsure}`)
}
// GitHub answers html_url and number; GitLab, web_url and iid.
const url = String(answer?.html_url ?? answer?.web_url ?? '')
const number = answer?.number ?? answer?.iid
if (!/^https?:\/\//.test(url))
  await give(`${call.tool} answered without the issue's url: ${unsure}`)
try {
  await store.moved(id, { url, ...(number === undefined ? {} : { ref: `#${number}` }) })
} catch (error) {
  if (!(error instanceof StoreRefusal)) throw error
  // The issue is open all the same: the reviewer dropped, skipped or stopped the finding meanwhile.
  console.error(`${error.message}; the issue is open at ${url}`)
}
console.log(`moved ${url}`)
