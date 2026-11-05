// Where a `/tranchant review` stands, by lens, from its agents. Pure, so it is tested alone.
import { activityOf } from './activity'
import type { ReviewAgent, Step } from './domain'

type Outcome = 'running' | 'done' | 'failed'

/** A lens's reviewer: its state and the findings that bear its lens. */
export interface LensProgress {
  lens: string
  state: Outcome
  findings: number
}

/** The verifiers of one lens's findings. */
export interface VerifyProgress {
  lens: string
  state: Outcome
  done: number
  total: number
}

/** An agent still at work, and what it does. */
interface AgentNow {
  name: string
  who: string
  step: string
}

/** One agent of the full list: what it is doing, or how it ended. */
interface AgentLine {
  name: string
  role: string
  state: Outcome
  text: string
}

export interface ReviewProgress {
  lenses: LensProgress[]
  verifying: VerifyProgress[]
  now: AgentNow[]
  all: AgentLine[]
  done: number
  total: number
  /** The lenses whose reviewer stopped before it finished: not covered. */
  stopped: string[]
}

/** The lens of a verifier whose finding no lens claims. */
export const OTHER = 'other'

const stateOf = (agent: ReviewAgent): Outcome =>
  agent.running ? 'running' : agent.outcome === 'failed' ? 'failed' : 'done'

/**
 * The lens a finding id bears: reviewers name theirs `<lens>-<n>`, and the
 * longest match wins so `a-b-1` goes to lens `a-b`, not `a`.
 */
export function lensOf(id: string, lenses: readonly string[]): string | undefined {
  let found: string | undefined
  for (const lens of lenses)
    if (id.startsWith(`${lens}-`) && lens.length > (found?.length ?? -1)) found = lens
  return found
}

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

/** Why an agent stopped: its last step before the end, when that one failed. */
function stoppedText(steps: readonly Step[]) {
  const last = steps.findLast((step) => step.kind !== 'end')
  return last?.state === 'failed' ? `stopped: ${activityOf(last)}` : 'stopped'
}

/** What a running agent is doing: the step still running, else its latest. */
function doing(steps: readonly Step[]) {
  const step = steps.findLast((one) => one.state === 'running') ?? steps.at(-1)
  return step && step.kind !== 'end' ? activityOf(step) : 'Starting'
}

/**
 * The review's progress from its agents (`rv-<lens>`, `vf-<finding id>`) and
 * the ids of the findings that stand.
 */
export function progressOf(
  agents: readonly ReviewAgent[],
  findingIds: readonly string[],
): ReviewProgress {
  const reviewers = agents.filter((agent) => agent.name.startsWith('rv-'))
  const names = reviewers.map((agent) => agent.name.slice(3))
  const found = new Map<string, number>()
  for (const id of findingIds) {
    const lens = lensOf(id, names)
    if (lens) found.set(lens, (found.get(lens) ?? 0) + 1)
  }
  const lenses = reviewers.map((agent) => {
    const lens = agent.name.slice(3)
    return { lens, state: stateOf(agent), findings: found.get(lens) ?? 0 }
  })

  const byLens = new Map<string, VerifyProgress>()
  for (const agent of agents) {
    if (!agent.name.startsWith('vf-')) continue
    const lens = lensOf(agent.name.slice(3), names) ?? OTHER
    const group = byLens.get(lens) ?? { lens, state: 'done', done: 0, total: 0 }
    const state = stateOf(agent)
    group.total += 1
    if (state !== 'running') group.done += 1
    if (state === 'running') group.state = 'running'
    else if (state === 'failed' && group.state === 'done') group.state = 'failed'
    byLens.set(lens, group)
  }

  const all = agents.map((agent): AgentLine => {
    const state = stateOf(agent)
    const reviewer = agent.name.startsWith('rv-')
    const verifier = agent.name.startsWith('vf-')
    const role = reviewer
      ? `Reviewer · ${agent.name.slice(3)}`
      : verifier
        ? `Verifier · ${agent.name.slice(3)}`
        : agent.name
    const findings = found.get(agent.name.slice(3)) ?? 0
    const text =
      state === 'running'
        ? doing(agent.steps)
        : state === 'failed'
          ? stoppedText(agent.steps)
          : reviewer
            ? findings
              ? plural(findings, 'finding')
              : 'no finding'
            : 'done'
    return { name: agent.name, role, state, text }
  })

  return {
    lenses,
    verifying: [...byLens.values()],
    now: agents
      .filter((agent) => agent.running)
      .map((agent) => ({
        name: agent.name,
        who: agent.name.startsWith('rv-')
          ? agent.name.slice(3)
          : agent.name.startsWith('vf-')
            ? `verifying ${agent.name.slice(3)}`
            : agent.name,
        step: doing(agent.steps),
      })),
    all,
    done: agents.filter((agent) => !agent.running).length,
    total: agents.length,
    stopped: lenses.filter((one) => one.state === 'failed').map((one) => one.lens),
  }
}
