// What a review's agents spent: usage.json, beside review.json, and the sums
// /api/review answers. An agent's final figure lives where its run is (`usage`
// on a review agent's `end` step, on a fix's run, in a cleaning's
// cleaning.json); usage.json holds what has no run, or no longer has one:
// `live` (an agent at work, its figure so far, written by the hooks; a reset
// empties it), `unclaimed` (a fix's agent that ended before its claim) and
// `reset` (what reset.mjs removed, summed). Every figure is read through format.mjs's
// readUsage: one a fix's agent wrote can be anything.
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cleaningsDir } from './cleaning.mjs'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'
import { LENS_NAME, parseDecisions, readUsage, sumUsage, tokensOf } from './format.mjs'
import { reviewAgentPath } from './store.mjs'

/** @typedef {import('./format.mjs').Usage} Usage */
/** @typedef {import('./format.mjs').Entry} Entry */
/** @typedef {import('./format.mjs').Finding} Finding */
/**
 * The kinds of agent a review counts, as the page names its rows.
 * @typedef {'summary' | 'reviewers' | 'verifiers' | 'fixes' | 'discussions' | 'cleanings'} Kind
 */
/**
 * An agent at work: its figure so far, `at` its last write, in ms. `key` is
 * its run file's name (`rv-bugs`, `vf-f-03`, `cl-…`), or `fix:<id>`.
 * @typedef {{ key: string, agent: string, at: number, usage: Usage }} Live
 */
/** @typedef {{ finding: string, agent: string, usage: Usage }} Unclaimed */
/**
 * What resets removed, summed: by kind, with its agents' count, and by lens.
 * @typedef {{ kinds: { kind: Kind, agents: number, usage: Usage }[], lenses: { lens: string, reviewer?: Usage, verifiers?: Usage }[] }} Removed
 */
/**
 * `broken`: the file is there but unreadable, not JSON or of another
 * version: nothing is written over it, and its sums read as partial.
 * @typedef {{ version: 1, live: Live[], unclaimed: Unclaimed[], reset?: Removed, broken?: true }} UsageFile
 */

const KINDS = /** @type {const} */ ([
  'summary',
  'reviewers',
  'verifiers',
  'fixes',
  'discussions',
  'cleanings',
])
const PREFIXES = /** @type {const} */ ({
  sm: 'summary',
  rv: 'reviewers',
  vf: 'verifiers',
  ds: 'discussions',
})
/** A live figure's key: a run file's name, or `fix:` and a finding's id. */
const LIVE_KEY = /^(?:fix:)?[\w-]{1,90}$/
const AGENT = /^[\w@.:-]{1,200}$/
const ID = /^[\w-]{1,64}$/
const AGENT_FILE = /^([\w-]{1,80})\.jsonl$/
/** The most live and unclaimed figures kept: a review runs a few dozen agents. */
const MAX_ENTRIES = 500

export const usagePath = (/** @type {string} */ dir) => path.join(dir, 'usage.json')

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** @param {unknown} value @returns {value is Kind} */
const isKind = (value) => KINDS.some((kind) => kind === value)

/** A list's first entries; anything else, none. */
const listOf = (/** @type {unknown} */ value) =>
  Array.isArray(value) ? value.slice(0, MAX_ENTRIES) : []

/**
 * usage.json, checked: none yet, unreadable or unsound, it is empty; an
 * unsound entry is left out.
 * @param {string} dir The review folder.
 * @returns {Promise<UsageFile>}
 */
export async function readUsageFile(dir) {
  /** @type {any} */
  let raw
  try {
    raw = JSON.parse(await readFile(usagePath(dir), 'utf8'))
  } catch (error) {
    const none = errorCode(error) === 'ENOENT'
    return { version: 1, live: [], unclaimed: [], ...(!none && { broken: true }) }
  }
  if (!isObject(raw) || raw.version !== 1)
    return { version: 1, live: [], unclaimed: [], broken: true }
  /** @type {Live[]} */
  const live = listOf(raw?.live).flatMap((one) => {
    const usage = isObject(one) ? readUsage(one.usage) : undefined
    return usage &&
      typeof one.key === 'string' &&
      LIVE_KEY.test(one.key) &&
      typeof one.agent === 'string' &&
      AGENT.test(one.agent) &&
      Number.isFinite(one.at)
      ? [{ key: one.key, agent: one.agent, at: one.at, usage }]
      : []
  })
  /** @type {Unclaimed[]} */
  const unclaimed = listOf(raw?.unclaimed).flatMap((one) => {
    const usage = isObject(one) ? readUsage(one.usage) : undefined
    return usage &&
      typeof one.finding === 'string' &&
      ID.test(one.finding) &&
      typeof one.agent === 'string' &&
      AGENT.test(one.agent)
      ? [{ finding: one.finding, agent: one.agent, usage }]
      : []
  })
  const reset = readRemoved(raw?.reset)
  return { version: 1, live, unclaimed, ...(reset && { reset }) }
}

/**
 * A `reset` block, checked.
 * @param {unknown} value
 * @returns {Removed | undefined}
 */
function readRemoved(value) {
  if (!isObject(value)) return undefined
  const kinds = listOf(value.kinds).flatMap((one) => {
    const usage = isObject(one) ? readUsage(one.usage) : undefined
    const kind = isObject(one) ? one.kind : undefined
    return usage && isKind(kind) && Number.isSafeInteger(one.agents) && one.agents >= 0
      ? [{ kind, agents: one.agents, usage }]
      : []
  })
  const lenses = listOf(value.lenses).flatMap((one) => {
    if (!isObject(one) || typeof one.lens !== 'string' || !LENS_NAME.test(one.lens))
      return []
    const reviewer = readUsage(one.reviewer)
    const verifiers = readUsage(one.verifiers)
    return reviewer || verifiers
      ? [
          {
            lens: one.lens,
            ...(reviewer && { reviewer }),
            ...(verifiers && { verifiers }),
          },
        ]
      : []
  })
  return kinds.length || lenses.length ? { kinds, lenses } : undefined
}

/**
 * Changes usage.json under its lock, written whole: the server reads it while
 * the hooks write.
 * @param {string} dir
 * @param {(file: UsageFile) => UsageFile | undefined} change Undefined writes nothing.
 */
function changeUsageFile(dir, change) {
  const file = usagePath(dir)
  return withFileLock(file, async () => {
    const now = await readUsageFile(dir)
    // Its reset history would go with it: left for a person to look at.
    if (now.broken) throw new Error(`${file} cannot be read: not written over`)
    const next = change(now)
    if (!next) return
    const temp = `${file}.${process.pid}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`)
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  })
}

/**
 * The figure so far of an agent at work, replacing its last one.
 * @param {string} dir
 * @param {string} key
 * @param {string} agent
 * @param {Usage} usage
 */
export function setLive(dir, key, agent, usage) {
  if (!LIVE_KEY.test(key) || !AGENT.test(agent)) return Promise.resolve()
  return changeUsageFile(dir, (file) => ({
    ...file,
    live: [
      ...file.live.filter((one) => one.key !== key),
      { key, agent, at: Date.now(), usage },
    ].slice(-MAX_ENTRIES),
  }))
}

/**
 * The agent ended: its live figure goes, its final one being on its run.
 * Another agent's under the same key (Pause now started the next) stays.
 * @param {string} dir
 * @param {string} key
 * @param {string} [agent]
 */
export function dropLive(dir, key, agent) {
  return changeUsageFile(dir, (file) =>
    file.live.some((one) => one.key === key && (!agent || one.agent === agent))
      ? {
          ...file,
          live: file.live.filter(
            (one) => !(one.key === key && (!agent || one.agent === agent)),
          ),
        }
      : undefined,
  )
}

/**
 * A fix's agent that ended with no run of its own: its figure, by finding.
 * @param {string} dir
 * @param {string} finding
 * @param {string} agent
 * @param {Usage} usage
 */
export function addUnclaimed(dir, finding, agent, usage) {
  return changeUsageFile(dir, (file) => ({
    ...file,
    unclaimed: [
      ...file.unclaimed.filter((one) => one.agent !== agent),
      { finding, agent, usage },
    ].slice(-MAX_ENTRIES),
  }))
}

/**
 * A review agent's run file, every line that parses.
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<Record<string, any>[]>}
 */
async function stepsOf(dir, name) {
  const text = await readFile(reviewAgentPath(dir, name), 'utf8').catch(() => '')
  return text.split('\n').flatMap((line) => {
    if (!line.trim()) return []
    try {
      const step = JSON.parse(line)
      return isObject(step) ? [step] : []
    } catch {
      return []
    }
  })
}

/** A start the hooks wrote: a tool's `start` (claim.mjs in Bash) carries its id. */
const hookStart = (/** @type {Record<string, any>} */ step) =>
  step.kind === 'start' && step.id === undefined

/**
 * One agent's figure, as a sum reads it: `running` while it works.
 * `run`: the id of the fix's run it is on, none before its claim.
 * @typedef {{ kind: Kind, label: string, usage?: Usage, running?: true, lens?: string, finding?: string, run?: string }} Counted
 */

/**
 * Every agent of the review's run files, decisions and usage.json, each with
 * its final figure, its live one, or none.
 * @param {string} dir
 * @param {{ findings: Finding[] }} review
 * @param {Record<string, Entry>} decisions
 * @param {UsageFile} file
 * @param {number} since When the serving session started, in ms: a live figure before it is no longer live.
 * @returns {Promise<Counted[]>}
 */
async function countedOf(dir, review, decisions, file, since) {
  /** @type {Counted[]} */
  const counted = []
  /** The agents with a final figure: a live one of theirs written after is stale. */
  const ended = new Set()
  /** @type {Map<string, Live>} */
  const live = new Map(file.live.map((one) => [`${one.key}\n${one.agent}`, one]))
  /** A live figure, and whether its agent still works. @param {Live} one */
  const fromLive = (one) =>
    one.at >= since
      ? { usage: one.usage, running: /** @type {const} */ (true) }
      : { usage: { ...one.usage, partial: /** @type {const} */ (true) } }

  for (const entry of await readdir(path.join(dir, 'reviewers')).catch(() => [])) {
    const name = AGENT_FILE.exec(entry)?.[1]
    const prefix = name?.slice(0, 2)
    const kind = prefix && Object.hasOwn(PREFIXES, prefix) ? PREFIXES[prefix] : undefined
    if (!name || !kind || name[2] !== '-') continue
    const steps = await stepsOf(dir, name)
    const starts = steps.flatMap((step, i) => (hookStart(step) ? [i] : []))
    for (const [n, at] of starts.entries()) {
      const run = steps.slice(at, starts[n + 1] ?? steps.length)
      const start = run[0] ?? {}
      const agent = typeof start.agent === 'string' ? start.agent : ''
      const end = run.find((step) => step.kind === 'end')
      const rest = name.slice(3)
      /** @type {Counted} */
      const one = {
        kind,
        label: starts.length > 1 ? `${name}#${n + 1}` : name,
        ...(kind === 'reviewers' && LENS_NAME.test(rest) && { lens: rest }),
        ...(kind === 'verifiers' &&
          typeof start.lens === 'string' &&
          LENS_NAME.test(start.lens) && { lens: start.lens }),
        ...((kind === 'verifiers' || kind === 'discussions') && { finding: rest }),
      }
      if (end) {
        const usage = readUsage(end.usage)
        if (usage) Object.assign(one, { usage })
        ended.add(agent)
      } else {
        const now = live.get(`${name}\n${agent}`)
        if (now) Object.assign(one, fromLive(now))
        // Started in this session, nothing read yet: at work.
        else if (Number(start.at) >= since) one.running = true
      }
      counted.push(one)
    }
  }

  const lensOf = new Map(review.findings.map((one) => [one.id, one.lens]))
  for (const [id, entry] of Object.entries(decisions)) {
    if (!ID.test(id) || !Array.isArray(entry?.runs)) continue
    for (const run of entry.runs) {
      if (!isObject(run)) continue
      const agent = typeof run.agent === 'string' ? run.agent : ''
      const usage = readUsage(run.usage)
      /** @type {Counted} */
      const one = {
        kind: 'fixes',
        label: `fix:${id}:${typeof run.id === 'string' ? run.id : '?'}`,
        finding: id,
        ...(typeof run.id === 'string' && { run: run.id }),
      }
      const lens = lensOf.get(id)
      if (lens) one.lens = lens
      if (usage) {
        one.usage = usage
        if (agent) ended.add(agent)
      } else {
        const now = agent ? live.get(`fix:${id}\n${agent}`) : undefined
        if (now) {
          Object.assign(one, fromLive(now))
          live.delete(`fix:${id}\n${agent}`)
        } else if (!run.endedAt && Date.parse(run.startedAt) >= since) one.running = true
      }
      counted.push(one)
    }
  }
  for (const one of file.unclaimed) {
    ended.add(one.agent)
    counted.push({
      kind: 'fixes',
      label: `fix:${one.finding}`,
      finding: one.finding,
      usage: one.usage,
    })
  }
  // A fix's agent at work before its claim: counted from its live figure.
  for (const one of live.values())
    if (one.key.startsWith('fix:') && !ended.has(one.agent))
      counted.push({
        kind: 'fixes',
        label: one.key,
        finding: one.key.slice(4),
        ...fromLive(one),
      })
  return counted
}

/**
 * The review agents of a past review, each with its final figure or none:
 * its run files only, nothing live (lib/estimate.mjs).
 * @param {string} dir
 */
export const pastAgents = (dir) =>
  countedOf(dir, { findings: [] }, {}, { version: 1, live: [], unclaimed: [] }, Infinity)

/** A cleaning's agent's name, as the hooks spawn it (register.ts's spawnCleaner): its live figure's key. */
export const cleanerName = (/** @type {string} */ id) =>
  `cl-${id.replace(/[^\w-]/g, '').slice(0, 8)}`

/**
 * The cleanings the hooks ran for the review (a lens whose source changed,
 * cleaned again before its reviewers start): each names it, whatever it came
 * to, stopped or failed included.
 * @param {string} dir
 * @param {string} project
 * @param {UsageFile} file
 * @param {number} since
 * @returns {Promise<Counted[]>}
 */
async function cleaningsOf(dir, project, file, since) {
  const root = cleaningsDir(project)
  const review = path.resolve(dir)
  /** @type {Counted[]} */
  const counted = []
  for (const id of await readdir(root).catch(() => [])) {
    if (!ID.test(id)) continue
    /** @type {any} */
    const record = await readFile(path.join(root, id, 'cleaning.json'), 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    if (!isObject(record) || record.review !== review) continue
    const name = cleanerName(id)
    /** @type {Counted} */
    const one = { kind: 'cleanings', label: name }
    const usage = readUsage(record.usage)
    const now = file.live.find((entry) => entry.key === name)
    if (usage) one.usage = usage
    else if (record.state === 'cleaning' && now)
      Object.assign(
        one,
        now.at >= since
          ? { usage: now.usage, running: true }
          : { usage: { ...now.usage, partial: true } },
      )
    // At work in this session, nothing read yet.
    else if (
      record.state === 'cleaning' &&
      Date.parse(record.startedAt ?? record.createdAt) >= since
    )
      one.running = true
    counted.push(one)
  }
  return counted
}

/**
 * A figure as /api/review answers it: its tokens summed beside it.
 * @param {Usage | undefined} usage
 */
const shown = (usage) => (usage ? { ...usage, tokens: tokensOf(usage) } : null)

/**
 * Sums `counted` by `keyOf`, in a Map: never a plain object keyed by an id or
 * a lens name.
 * @template K
 * @param {Counted[]} counted
 * @param {(one: Counted) => K | undefined} keyOf
 */
function sumBy(counted, keyOf) {
  /** @type {Map<K, Counted[]>} */
  const groups = new Map()
  for (const one of counted) {
    const key = keyOf(one)
    if (key === undefined) continue
    groups.set(key, [...(groups.get(key) ?? []), one])
  }
  return groups
}

/**
 * A finding's verification, discussion or run: its agents summed, and whether
 * one works. Null when it had no agent; its `usage` null when none reported.
 * @param {Counted[]} agents
 */
function part(agents) {
  if (!agents.length) return null
  return {
    usage: shown(total(agents)),
    ...(agents.some((one) => one.running) && { running: /** @type {const} */ (true) }),
  }
}

/**
 * Agents summed: a part not reported makes the sum partial; none reported, none.
 * @param {Counted[]} agents
 */
function total(agents) {
  const sum = sumUsage(agents.map((one) => one.usage))
  const unreported = agents.some((one) => !one.usage && !one.running)
  return sum && unreported ? { ...sum, partial: /** @type {const} */ (true) } : sum
}

/**
 * What the review spent so far, as `/api/review`'s `usage` answers it: the
 * total, by kind, by lens (its reviewer's and its verifications'), by finding
 * (its fixes, each of its runs, its verification and discussion), what resets
 * removed, the agents not reported or partial, and whether any still works.
 * `total` is null when no agent reported a figure.
 * @param {string} dir
 * @param {{ review: { findings: Finding[], project: string }, decisions: Record<string, Entry>, since: number }} known
 */
export async function reviewUsage(dir, { review, decisions, since }) {
  const file = await readUsageFile(dir)
  const counted = [
    ...(await countedOf(dir, review, decisions, file, since)),
    ...(await cleaningsOf(dir, review.project, file, since)),
  ]
  const kinds = sumBy(counted, (one) => one.kind)
  const lenses = sumBy(counted, (one) =>
    one.kind === 'reviewers' || one.kind === 'verifiers' ? one.lens : undefined,
  )
  const findings = sumBy(counted, (one) => one.finding)
  const removed = file.reset
  const all = total(counted)
  const before = sumUsage((removed?.kinds ?? []).map((one) => one.usage))
  const sum = sumUsage([all, before])
  // An agent not reported, or a usage.json that cannot be read, leaves the total a floor.
  const short = !!file.broken || counted.some((one) => !one.usage && !one.running)
  const whole = sum && short ? { ...sum, partial: /** @type {const} */ (true) } : sum
  return {
    total: shown(whole),
    kinds: KINDS.flatMap((kind) => {
      const agents = kinds.get(kind)
      return agents ? [{ kind, agents: agents.length, usage: shown(total(agents)) }] : []
    }),
    lenses: [...lenses.entries()]
      .map(([lens, agents]) => {
        const reviewer = total(agents.filter((one) => one.kind === 'reviewers'))
        const verifiers = total(agents.filter((one) => one.kind === 'verifiers'))
        return {
          lens,
          reviewer: shown(reviewer),
          verifiers: shown(verifiers),
          tokens: tokensOf(reviewer) + tokensOf(verifiers),
        }
      })
      .toSorted((a, b) => b.tokens - a.tokens || a.lens.localeCompare(b.lens)),
    findings: [...findings.entries()]
      .map(([id, agents]) => ({
        id,
        fixes: shown(total(agents.filter((one) => one.kind === 'fixes'))),
        verifier: part(agents.filter((one) => one.kind === 'verifiers')),
        discussion: part(agents.filter((one) => one.kind === 'discussions')),
        runs: agents.flatMap((one) =>
          one.kind === 'fixes' && one.run !== undefined
            ? [{ id: one.run, ...part([one]) }]
            : [],
        ),
        // Before its claim, or on a run with no id: in the sum, on no run.
        unclaimed: part(
          agents.filter((one) => one.kind === 'fixes' && one.run === undefined),
        ),
        usage: shown(total(agents)),
        ...(agents.some((one) => one.running) && {
          running: /** @type {const} */ (true),
        }),
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
    reset: removed
      ? {
          usage: shown(before),
          kinds: removed.kinds.map((one) => ({ ...one, usage: shown(one.usage) })),
          lenses: removed.lenses.map((one) => ({
            lens: one.lens,
            reviewer: shown(one.reviewer),
            verifiers: shown(one.verifiers),
          })),
        }
      : null,
    notReported: counted
      .filter((one) => !one.usage && !one.running)
      .map((one) => one.label),
    partial: counted.filter((one) => one.usage?.partial).map((one) => one.label),
    running: counted.some((one) => one.running),
  }
}

/**
 * What a reset removes, summed, before anything goes: every review agent's
 * figure, every fix's (its runs and unclaimed), by kind and by lens. The
 * cleanings stay: a reset removes none.
 * @param {string} dir
 * @returns {Promise<Removed | undefined>}
 */
export async function removedUsage(dir) {
  const reviewFindings = await readFile(path.join(dir, 'review.json'), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => ({}))
  const lensOf = await findingLenses(dir, reviewFindings)
  /** @type {Record<string, Entry>} */
  let decisions = {}
  try {
    decisions = parseDecisions(
      await readFile(path.join(dir, 'decisions.json'), 'utf8'),
    ).findings
  } catch (error) {
    if (errorCode(error) !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  const file = await readUsageFile(dir)
  // Nothing runs while a review resets: a figure is final, a past session's live one (partial), or none.
  const counted = await countedOf(dir, { findings: lensOf }, decisions, file, Infinity)
  const kinds = sumBy(counted, (one) => one.kind)
  const lenses = sumBy(counted, (one) =>
    one.kind === 'reviewers' || one.kind === 'verifiers' ? one.lens : undefined,
  )
  /** @type {Removed} */
  const removed = {
    kinds: KINDS.flatMap((kind) => {
      const agents = kinds.get(kind) ?? []
      const usage = total(agents)
      return usage ? [{ kind, agents: agents.length, usage }] : []
    }),
    lenses: [...lenses.entries()].flatMap(([lens, agents]) => {
      const reviewer = total(agents.filter((one) => one.kind === 'reviewers'))
      const verifiers = total(agents.filter((one) => one.kind === 'verifiers'))
      return reviewer || verifiers
        ? [{ lens, ...(reviewer && { reviewer }), ...(verifiers && { verifiers }) }]
        : []
    }),
  }
  return removed.kinds.length || removed.lenses.length ? removed : undefined
}

/**
 * The review's findings, inline and in findings/, with their lens.
 * @param {string} dir
 * @param {any} envelope
 * @returns {Promise<Finding[]>}
 */
async function findingLenses(dir, envelope) {
  /** @type {any[]} */
  const found = Array.isArray(envelope?.findings) ? [...envelope.findings] : []
  for (const entry of await readdir(path.join(dir, 'findings')).catch(() => [])) {
    if (!entry.endsWith('.json')) continue
    const one = await readFile(path.join(dir, 'findings', entry), 'utf8')
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    if (isObject(one)) found.push(one)
  }
  return found.filter(
    (one) =>
      isObject(one) &&
      typeof one.id === 'string' &&
      (one.lens === undefined ||
        (typeof one.lens === 'string' && LENS_NAME.test(one.lens))),
  )
}

/**
 * Adds what a reset removed to usage.json's `reset`, and empties `live` and
 * `unclaimed` (their runs and findings went). Called once the reset removed
 * them: a reset refused, or retried, counts nothing twice.
 * @param {string} dir
 * @param {Removed | undefined} removed `removedUsage`'s, read before the reset.
 */
export async function addReset(dir, removed) {
  await changeUsageFile(dir, (file) => {
    if (!removed && !file.live.length && !file.unclaimed.length) return undefined
    const was = file.reset
    /** @type {Removed} */
    const reset = {
      kinds: KINDS.flatMap((kind) => {
        const parts = [...(was?.kinds ?? []), ...(removed?.kinds ?? [])].filter(
          (one) => one.kind === kind,
        )
        const usage = sumUsage(parts.map((one) => one.usage))
        return usage
          ? [{ kind, agents: parts.reduce((n, one) => n + one.agents, 0), usage }]
          : []
      }),
      lenses: [
        ...new Set(
          [...(was?.lenses ?? []), ...(removed?.lenses ?? [])].map((one) => one.lens),
        ),
      ].flatMap((lens) => {
        const parts = [...(was?.lenses ?? []), ...(removed?.lenses ?? [])].filter(
          (one) => one.lens === lens,
        )
        const reviewer = sumUsage(parts.map((one) => one.reviewer))
        const verifiers = sumUsage(parts.map((one) => one.verifiers))
        return [{ lens, ...(reviewer && { reviewer }), ...(verifiers && { verifiers }) }]
      }),
    }
    const { reset: _was, ...rest } = file
    // Nothing runs while a review resets: a live figure left is a past session's, counted in `removed`.
    return {
      ...rest,
      live: [],
      unclaimed: [],
      ...((reset.kinds.length || reset.lenses.length) && { reset }),
    }
  })
}
