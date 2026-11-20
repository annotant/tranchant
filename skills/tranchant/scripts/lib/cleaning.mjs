// A lens's cleaning: Add a lens on the page, /tranchant import, or a source
// that changed since its lens was last cleaned. Each in
// <state>/<project hash>/cleanings/<id>/: cleaning.json (the source, the lens
// it makes or cleans again, where it stands) and the two files the cleaning
// agent writes, lens.md (the source's review without its orchestration and
// output) and report.json (where it runs, its topics, its added instructions,
// what was removed and added; or why the source holds no single review). A
// new lens waits there, unused, until the page adds it; a lens cleaned again
// takes its new version as soon as the cleaning is checked.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { insideOf, insideRefusal, nameOfSource } from './inside.mjs'
import { LensRefusal, buildLens } from './lens.mjs'
import { STATE_ROOT, hashOf } from './project.mjs'
import {
  LensFileRefusal,
  isSourceText,
  checkChanges,
  checkUserLens,
  checkRuntime,
  hashesOf,
  isScope,
  lensDir,
  readUserLens,
  recordedSource,
  whereOf,
  writeJson,
  writeText,
  writeUserLens,
} from './userlens.mjs'

/** @typedef {import('./userlens.mjs').Scope} Scope */
/** @typedef {import('./userlens.mjs').UserLens} UserLens */
/**
 * @typedef {object} Cleaning
 * @property {string} id
 * @property {string} createdAt
 * @property {string} project
 * @property {string} name The lens it makes, or cleans again.
 * @property {Scope} scope
 * @property {boolean} again Whether it cleans a stored lens again.
 * @property {string} source As the lens records it.
 * @property {string} file The source's file, found.
 * @property {string} folder Its folder.
 * @property {string} [version]
 * @property {string} sourceHash
 * @property {'cleaning' | 'ready' | 'failed' | 'added'} state
 * @property {true} [queued] Made by the page: it waits for a free cleaning agent until the hooks start it.
 * @property {string} [startedAt] When the hooks started its agent.
 * @property {string} [from] The glob it was matched by, when it came with others.
 * @property {string} [reason] With `failed`.
 * @property {string[]} [instead] With `failed`: the reviewers a whole process starts, to add one by one.
 */

/** A cleaning still `cleaning` this long after its agent started lost it: shown failed. */
const LOST_MS = 30 * 60 * 1000
/** A cleaning waiting this long for a free agent lost the session that would start it. */
const WAIT_LOST_MS = 3 * 60 * 60 * 1000
const MAX_DOMAIN = 64 * 1024
const MAX_RULES = 8 * 1024
const MAX_INSTEAD = 12

/** A cleaning this Tranchant refuses to start or use, and why. */
export class CleaningRefusal extends Error {}

/** @param {string} what @returns {never} */
const refuse = (what) => {
  throw new CleaningRefusal(what)
}

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error)

/** The cleanings of the project at `root`. */
export const cleaningsDir = (/** @type {string} */ root) =>
  path.join(STATE_ROOT, hashOf(root), 'cleanings')

/** A cleaning's folder, from its id: a name, never a path. */
function cleaningDir(/** @type {string} */ project, /** @type {string} */ id) {
  if (!/^[\w-]{1,64}$/.test(id)) throw new CleaningRefusal(`no cleaning ${id}`)
  return path.join(cleaningsDir(project), id)
}

/** @returns {Promise<Cleaning>} */
async function readCleaning(/** @type {string} */ dir) {
  return JSON.parse(await readFile(path.join(dir, 'cleaning.json'), 'utf8'))
}

/** The record of cleaning `id`, or a refusal naming it. */
export async function cleaningOf(
  /** @type {string} */ project,
  /** @type {string} */ id,
) {
  const dir = cleaningDir(project, id)
  return {
    dir,
    record: await readCleaning(dir).catch(() => {
      throw new CleaningRefusal(`no cleaning ${id}`)
    }),
  }
}

/**
 * What the cleaning agent is given, from its record: the files it reads and
 * the two it writes.
 * @param {string} dir
 * @param {Cleaning} record
 */
export function agentInput(dir, record) {
  const kept = path.join(dir, 'rules.md')
  return {
    id: record.id,
    dir,
    project: record.project,
    name: record.name,
    scope: record.scope,
    again: record.again,
    source: record.source,
    file: record.file,
    folder: record.folder,
    ...(record.version && { version: record.version }),
    ...(existsSync(kept) && { rules: kept }),
    lens: path.join(dir, 'lens.md'),
    report: path.join(dir, 'report.json'),
  }
}

/**
 * The source of a lens found and hashed, as a cleaning records it; a
 * LensRefusal becomes the cleaning's refusal.
 * @param {{ source: string }} lens
 * @param {string} project
 */
async function found(lens, project) {
  try {
    const hashes = await hashesOf(lens, project)
    return {
      file: hashes.source.file,
      folder: hashes.source.folder,
      ...(hashes.source.version && { version: hashes.source.version }),
      sourceHash: hashes.sourceHash,
    }
  } catch (error) {
    if (error instanceof LensRefusal) throw new CleaningRefusal(error.message)
    throw error
  }
}

/**
 * A new lens's cleaning, for the project at `project`: the source found
 * first, so a name that does not resolve starts no agent, and the name free
 * in its scope; a command, or a source that starts reviewers it names, is
 * refused with them. `queued` when the page asks for it: the hooks start its
 * agent once one is free.
 * @param {{ project: string, source: string, name?: string, scope: string, queued?: boolean, from?: string }} given
 * @returns {Promise<{ dir: string, record: Cleaning }>}
 */
export async function createCleaning({ project, source, name, scope, queued, from }) {
  if (!isScope(scope))
    throw new CleaningRefusal(
      `a lens is global or local, never in the repository: not ${scope}`,
    )
  if (!isSourceText(source))
    throw new CleaningRefusal('a source is required, on one line: plugin:name, or a path')
  const lensName = name?.trim() || nameOfSource(source, project)
  let target
  try {
    target = lensDir(scope, project, lensName)
  } catch (error) {
    if (error instanceof LensFileRefusal) throw new CleaningRefusal(error.message)
    throw error
  }
  if (existsSync(target))
    // hooks/register.ts reads this wording to point /tranchant import at --name.
    throw new CleaningRefusal(
      `a lens named ${lensName} is ${scope === 'global' ? 'global' : "this project's"} already: edit it, or choose another name`,
    )
  const recorded = recordedSource(source, scope, project)
  // Before any agent: a command, or a source that starts reviewers it names, holds the lenses, never is one.
  const inside = await insideOf(project, recorded)
  if (inside) throw new CleaningRefusal(insideRefusal(inside))
  const sources = await found({ source: recorded }, project)
  return start(project, {
    name: lensName,
    scope,
    again: false,
    source: recorded,
    ...sources,
    ...(queued && { queued: /** @type {const} */ (true) }),
    ...(from && { from }),
  })
}

/**
 * The cleanings of several sources at once (a glob's matches), all queued:
 * one refused (not found, its name taken, unwritable) does not stop the
 * others, and of two given the same name the first is kept.
 * @param {{ project: string, scope: string, from?: string, sources: { source: string, name?: string }[] }} given
 */
export async function createCleanings({ project, scope, from, sources }) {
  if (!isScope(scope))
    throw new CleaningRefusal(
      `a lens is global or local, never in the repository: not ${scope}`,
    )
  /** @type {{ dir: string, record: Cleaning }[]} */
  const made = []
  /** @type {{ source: string, reason: string }[]} */
  const refused = []
  const names = new Set()
  for (const one of sources) {
    const name = one.name?.trim() || undefined
    try {
      if (name && names.has(name))
        throw new CleaningRefusal(`${name} is the name of another match: rename one`)
      const cleaning = await createCleaning({
        project,
        source: one.source,
        scope,
        queued: true,
        ...(name && { name }),
        ...(from && { from }),
      })
      names.add(cleaning.record.name)
      made.push(cleaning)
    } catch (error) {
      // Thrown, the cleanings made before it would wait for ever: no CLEAN line printed for them.
      refused.push({ source: one.source, reason: message(error) })
    }
  }
  return { made, refused }
}

/**
 * The hooks start cleaning `id`'s agent: it waits no more, and its time to
 * get lost runs from now. Refused once it is not `cleaning`.
 * @param {string} project
 * @param {string} id
 */
export async function startedCleaning(project, id) {
  const { dir, record } = await cleaningOf(project, id)
  if (record.state !== 'cleaning')
    throw new CleaningRefusal(`the cleaning ${id} is ${record.state} already`)
  // Two sessions with its page open both queue it: the first one starts it.
  if (!record.queued) throw new CleaningRefusal(`the cleaning ${id} is started already`)
  const { queued: _queued, ...rest } = record
  /** @type {Cleaning} */
  const next = { ...rest, startedAt: new Date().toISOString() }
  await writeJson(path.join(dir, 'cleaning.json'), next)
  return { dir, record: next }
}

/** Whether a cleaning still `cleaning` lost its agent, or the session that would start it. */
function isLost(/** @type {Cleaning} */ record) {
  if (record.state !== 'cleaning') return false
  const since = Date.now() - Date.parse(record.startedAt ?? record.createdAt)
  return since > (record.queued ? WAIT_LOST_MS : LOST_MS)
}

/**
 * A stored lens's cleaning again, its source changed or asked anew: the
 * added instructions the user edited go to the agent, and stay. `queued`
 * when the page asks for it (Clean it again now), as a new lens's.
 * @param {{ project: string, scope: string, name: string, queued?: boolean }} given
 */
export async function cleanAgain({ project, scope, name, queued }) {
  if (!isScope(scope)) throw new CleaningRefusal(`no lens scope ${scope}`)
  let dir
  let lens
  try {
    dir = lensDir(scope, project, name)
    lens = await readUserLens(dir)
  } catch (error) {
    if (error instanceof LensFileRefusal)
      throw new CleaningRefusal(`the lens ${name} cannot be read: ${error.message}`)
    throw error
  }
  const sources = await found(lens, project)
  const made = await start(project, {
    name,
    scope,
    again: true,
    source: lens.source,
    ...sources,
    ...(queued && { queued: /** @type {const} */ (true) }),
  })
  if (lens.rulesEdited) await writeText(path.join(made.dir, 'rules.md'), lens.rules)
  return made
}

/**
 * Writes a cleaning's record, `cleaning`.
 * @param {string} project
 * @param {Omit<Cleaning, 'id' | 'createdAt' | 'project' | 'state'>} fields
 */
async function start(project, fields) {
  const id = randomUUID()
  const dir = cleaningDir(project, id)
  /** @type {Cleaning} */
  const record = {
    id,
    createdAt: new Date().toISOString(),
    project,
    ...fields,
    state: 'cleaning',
  }
  await writeJson(path.join(dir, 'cleaning.json'), record)
  return { dir, record }
}

/**
 * What the agent wrote, checked: its lens's domain and its report, or why
 * the source holds no single review.
 * @param {string} dir
 */
async function readOutput(dir) {
  let raw
  try {
    raw = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'))
  } catch (error) {
    return refuse(`the cleaning agent wrote no report that reads: ${message(error)}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    refuse('report.json: an object')
  if (raw.refused !== undefined) {
    if (typeof raw.refused !== 'string' || !raw.refused.trim())
      refuse('report.json: refused, a short text')
    const instead = Array.isArray(raw.instead)
      ? raw.instead
          .filter((/** @type {unknown} */ one) => typeof one === 'string' && one.trim())
          .slice(0, MAX_INSTEAD)
          .map((/** @type {string} */ one) => one.trim().slice(0, 200))
      : []
    return { refused: raw.refused.trim().slice(0, 1000), instead }
  }
  const domain = await readFile(path.join(dir, 'lens.md'), 'utf8').catch(() => '')
  if (!domain.trim()) refuse('the cleaning agent wrote no lens.md')
  if (Buffer.byteLength(domain) > MAX_DOMAIN)
    refuse(`lens.md is larger than ${MAX_DOMAIN / 1024} KiB`)
  if (typeof raw.rules !== 'string' || raw.rules.length > MAX_RULES)
    refuse(`report.json: rules, a text of ${MAX_RULES / 1024} KiB at most`)
  const runtime = checkRuntime(
    {
      name: 'lens',
      ...(raw.otherwise === true ? { otherwise: true } : { paths: raw.paths }),
      ...(raw.topics !== undefined && { topics: raw.topics }),
    },
    (what) => refuse(`report.json: ${what}`),
  )
  const changes = checkChanges(raw.removed, raw.added, (what) =>
    refuse(`report.json: ${what}`),
  )
  return {
    domain,
    report: {
      paths: runtime.paths,
      ...(runtime.otherwise && { otherwise: /** @type {const} */ (true) }),
      ...(runtime.topics && { topics: runtime.topics }),
      rules: raw.rules,
      ...changes,
    },
  }
}

/**
 * The cleaning agent ended: what it wrote checked, and the lens built from
 * it as a review would. A new lens is `ready`, to add from the page; a lens
 * cleaned again takes its new version at once (`added`). `failed` with why;
 * a lens cleaned again then keeps its last version, the failure recorded on
 * it so the next review does not clean it again for the same source; unless
 * the agent was `stopped` or never started, which says nothing of the source.
 * @param {string} dir
 * @param {{ stopped?: boolean }} [options]
 * @returns {Promise<Cleaning>}
 */
export async function checkCleaning(dir, { stopped = false } = {}) {
  const record = await readCleaning(dir)
  if (record.state !== 'cleaning') return record
  /** @type {Cleaning} */
  let next
  try {
    if (stopped) refuse('the cleaning agent was stopped, or did not start')
    const output = await readOutput(dir)
    if ('refused' in output) {
      next = {
        ...record,
        state: 'failed',
        reason: `the source holds no single review: ${output.refused}`,
        ...(output.instead.length && { instead: output.instead }),
      }
    } else {
      const { domain, report } = output
      const lens = record.again ? await promoted(record, report) : fresh(record, report)
      await builds(record, lens, domain)
      if (record.again)
        await writeUserLens(
          lensDir(record.scope, record.project, record.name),
          lens,
          domain,
        )
      next = { ...record, state: record.again ? 'added' : 'ready' }
    }
  } catch (error) {
    if (!(error instanceof CleaningRefusal || error instanceof LensFileRefusal))
      throw error
    next = { ...record, state: 'failed', reason: error.message }
  }
  if (next.state === 'failed' && record.again && !stopped)
    await recordFailure(record, next.reason ?? '')
  await writeJson(path.join(dir, 'cleaning.json'), next)
  return next
}

/** The lens a new cleaning makes, on, with what the agent found. */
function fresh(/** @type {Cleaning} */ record, /** @type {any} */ report) {
  /** @type {UserLens} */
  const lens = {
    name: record.name,
    source: record.source,
    on: true,
    paths: report.paths,
    ...(report.otherwise && { otherwise: true }),
    ...(report.topics && { topics: report.topics }),
    rules: report.rules,
    cleaned: cleanedOf(record, report),
  }
  return lens
}

/** The stored lens with its new cleaning: the user's settings kept, and the rules they edited. */
async function promoted(/** @type {Cleaning} */ record, /** @type {any} */ report) {
  const dir = lensDir(record.scope, record.project, record.name)
  const lens = await readUserLens(dir).catch((error) => {
    throw new CleaningRefusal(`the lens ${record.name} is gone: ${message(error)}`)
  })
  // Removed and added again meanwhile, from another source: this cleaning is not its.
  if (lens.source !== record.source)
    throw new CleaningRefusal(`the lens ${record.name} names another source now`)
  const { failedCleaning: _failed, ...rest } = lens
  return {
    ...rest,
    ...(!lens.rulesEdited && { rules: report.rules }),
    cleaned: cleanedOf(record, report),
  }
}

/** @param {Cleaning} record @param {any} report */
const cleanedOf = (record, report) => ({
  at: new Date().toISOString(),
  sourceHash: record.sourceHash,
  ...(record.version && { version: record.version }),
  removed: report.removed,
  added: report.added,
})

/** Builds the lens as a review would, from a trial folder: a lens that cannot run is not kept. */
async function builds(
  /** @type {Cleaning} */ record,
  /** @type {UserLens} */ lens,
  /** @type {string} */ domain,
) {
  const trial = path.join(cleaningDir(record.project, record.id), 'trial')
  try {
    await writeUserLens(trial, lens, domain)
    await buildLens(
      {
        name: lens.name,
        paths: lens.paths,
        source: lens.source,
        added: { scope: record.scope, dir: trial },
      },
      whereOf(record.project),
    )
  } catch (error) {
    if (error instanceof LensRefusal) throw new CleaningRefusal(error.message)
    throw error
  } finally {
    await rm(trial, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** A cleaning again failed: its lens says so, and for which source. */
async function recordFailure(
  /** @type {Cleaning} */ record,
  /** @type {string} */ reason,
) {
  const dir = lensDir(record.scope, record.project, record.name)
  const lens = await readUserLens(dir).catch(() => undefined)
  if (!lens) return
  await writeUserLens(dir, {
    ...lens,
    failedCleaning: {
      at: new Date().toISOString(),
      reason: reason.slice(0, 1000),
      sourceHash: record.sourceHash,
    },
  })
}

/**
 * Add this lens: a ready cleaning written to its scope, with the user's
 * changes to what the agent found (its name, scope, paths, topics, model,
 * rules); the cleaning is `added` from then on.
 * @param {string} project
 * @param {string} id
 * @param {any} [edits]
 */
export async function addCleaned(project, id, edits = {}) {
  const { dir, record } = await cleaningOf(project, id)
  if (record.again) throw new CleaningRefusal('this cleaning updates its lens on its own')
  if (record.state === 'added') throw new CleaningRefusal('this lens is added already')
  if (record.state !== 'ready')
    throw new CleaningRefusal(
      record.state === 'cleaning'
        ? 'the cleaning agent is still at work'
        : `this cleaning failed: ${record.reason ?? ''}`,
    )
  const output = await readOutput(dir)
  if ('refused' in output) throw new CleaningRefusal(output.refused)
  const scope = edits.scope ?? record.scope
  if (!isScope(scope)) throw new CleaningRefusal('scope: global or local')
  const name =
    typeof edits.name === 'string' && edits.name.trim() ? edits.name.trim() : record.name
  const { otherwise: _otherwise, topics: _topics, ...made } = fresh(record, output.report)
  // Recorded for the scope it was cleaned for: a global lens's paths are absolute.
  const base = {
    ...made,
    source: recordedSource(made.source, scope, project),
  }
  const otherwise =
    edits.otherwise === true || (edits.paths === undefined && output.report.otherwise)
  const topics = edits.topics === undefined ? output.report.topics : edits.topics
  let clean
  try {
    // Checked as lens.json is read: what the person changed is held to the same rules.
    clean = checkUserLens({
      version: 1,
      ...base,
      name,
      ...(otherwise
        ? { otherwise: true, paths: [] }
        : { paths: edits.paths ?? base.paths }),
      ...(topics?.length && { topics }),
      ...(typeof edits.model === 'string' && edits.model && { model: edits.model }),
      ...(typeof edits.rules === 'string' &&
        edits.rules !== base.rules && { rules: edits.rules, rulesEdited: true }),
    })
  } catch (error) {
    if (error instanceof LensFileRefusal) throw new CleaningRefusal(error.message)
    throw error
  }
  let target
  try {
    target = lensDir(scope, project, name)
  } catch (error) {
    if (error instanceof LensFileRefusal) throw new CleaningRefusal(error.message)
    throw error
  }
  if (existsSync(target))
    throw new CleaningRefusal(
      `a lens named ${name} is ${scope === 'global' ? 'global' : "this project's"} already`,
    )
  try {
    await writeUserLens(target, clean, output.domain)
  } catch (error) {
    await rm(target, { recursive: true, force: true }).catch(() => undefined)
    if (error instanceof LensFileRefusal) throw new CleaningRefusal(error.message)
    throw error
  }
  await writeJson(path.join(dir, 'cleaning.json'), { ...record, state: 'added' })
  return { scope, name }
}

/** Discard: a cleaning's folder removed, refused while its agent may still be at work. */
export async function discardCleaning(
  /** @type {string} */ project,
  /** @type {string} */ id,
) {
  const { dir, record } = await cleaningOf(project, id)
  // Waiting, no agent reads it yet: the hooks find it gone and start the next one.
  if (record.state === 'cleaning' && !record.queued && !isLost(record))
    throw new CleaningRefusal('the cleaning agent is still at work')
  await rm(dir, { recursive: true, force: true })
}

/**
 * The cleanings of the project not added yet, newest first, as the page
 * shows them: a new lens's with what it found, a lens cleaned again while it
 * runs. One whose agent was lost reads as failed.
 * @param {string} project
 */
export async function listCleanings(project) {
  const root = cleaningsDir(project)
  const all = []
  for (const id of await readdir(root).catch(() => [])) {
    const dir = path.join(root, id)
    const record = await readCleaning(dir).catch(() => undefined)
    if (!record || record.state === 'added') continue
    if (record.again && record.state !== 'cleaning') continue
    const lost = isLost(record)
    let shown = {}
    if (record.state === 'ready') {
      const output = await readOutput(dir).catch((error) => ({ broken: message(error) }))
      shown =
        'broken' in output
          ? { state: 'failed', reason: output.broken }
          : 'refused' in output
            ? { state: 'failed', reason: output.refused, instead: output.instead }
            : { report: output.report, domain: output.domain }
    }
    all.push({
      id: record.id,
      createdAt: record.createdAt,
      name: record.name,
      scope: record.scope,
      again: record.again,
      source: record.source,
      ...(record.version && { version: record.version }),
      ...(record.from && { from: record.from }),
      state: lost ? 'failed' : record.state,
      ...(!lost && record.state === 'cleaning' && record.queued && { waiting: true }),
      ...(lost && {
        reason: record.queued
          ? 'no cleaning agent started: the session that would start it ended'
          : 'the cleaning agent did not finish',
      }),
      ...(record.reason && { reason: record.reason }),
      ...(record.instead && { instead: record.instead }),
      ...shown,
    })
  }
  return all.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
}
