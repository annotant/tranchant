// Where a `/tranchant review` stands, by lens, from its agents. Pure, so it is tested alone.
import { activityOf, stepKey } from './activity'
import { plural, type Finding, type ReviewAgent, type Step } from './domain'

type Outcome = 'running' | 'done' | 'failed'

/** A lens's reviewer: its state and how many of the findings still standing bear its lens. */
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

/** What a finding's verifier made of it. */
type Check = 'verified' | 'amended' | 'verifying' | 'unverified'

/** A finding of a lens, with its verifier's verdict and words. */
interface ReportFinding {
  id: string
  title: string
  check: Check
  verifier?: string
}

/** What one lens checked: its verdict, its own report, its findings and its steps. */
export interface LensReport {
  lens: string
  state: Outcome
  verdict: string
  /** Its last words, Markdown; absent until it says something. */
  report?: string
  gist: string
  /** "3 files · 15 commands", or empty. */
  looked: string
  steps: { key: string; text: string }[]
  findings: ReportFinding[]
}

export interface ReviewProgress {
  lenses: LensProgress[]
  verifying: VerifyProgress[]
  now: AgentNow[]
  reports: LensReport[]
  done: number
  total: number
  /** The lenses whose reviewer stopped before it finished: not covered. */
  stopped: string[]
}

type ReviewFinding = Pick<Finding, 'id' | 'title' | 'verified'>

/** The group of a verifier whose finding matches no reviewer's lens. */
export const OTHER = 'other'

const stateOf = (agent: ReviewAgent): Outcome =>
  agent.running ? 'running' : agent.outcome === 'failed' ? 'failed' : 'done'

/** A finding id's lens: reviewers name theirs `<lens>-<n>`; the longest wins, `a-b-1` is `a-b`'s. */
export function lensOf(id: string, lenses: readonly string[]): string | undefined {
  let found: string | undefined
  for (const lens of lenses)
    if (id.startsWith(`${lens}-`) && lens.length > (found?.length ?? -1)) found = lens
  return found
}

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

const lastWords = (steps: readonly Step[]) =>
  steps.findLast((step) => step.kind === 'note')?.label

// The agents name files by their absolute path; the page names them from the project.
const relative = (text: string, project: string) =>
  project ? text.split(`${project.replace(/\/+$/, '')}/`).join('') : text

/** The sentences a report opens with that only repeat its verdict. */
const VERDICT = /^(no finding|i added \S+ findings?|verified|amended)\b/i

/** A report's point in one line: its first sentence past the verdict, plain. */
export function gistOf(report: string) {
  const plain = report
    .replace(/[*`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // A list item's bullet starts a sentence once the report's lines are joined.
  const sentences = plain.split(/(?<=[.!?])\s+/).map((one) => one.replace(/^[-•]\s+/, ''))
  return sentences.find((one) => !VERDICT.test(one)) ?? ''
}

/** What a lens looked at, counted: distinct files read, commands, searches. */
function lookedAt(steps: readonly Step[]) {
  const files = new Set(
    steps.filter((step) => step.kind === 'read').map((step) => step.label),
  )
  const count = (kind: string) => steps.filter((step) => step.kind === kind).length
  return [
    files.size && plural(files.size, 'file'),
    count('bash') && plural(count('bash'), 'command'),
    count('search') && plural(count('search'), 'search', 'searches'),
  ]
    .filter(Boolean)
    .join(' · ')
}

function checkOf(finding: ReviewFinding, verifier: ReviewAgent | undefined): Check {
  const words = verifier && lastWords(verifier.steps)
  if (verifier?.running) return 'verifying'
  if (words && /^amended/i.test(words)) return 'amended'
  return finding.verified === true ? 'verified' : 'unverified'
}

/** The review's progress from its agents (`rv-<lens>`, `vf-<finding id>`) and its findings. */
export function progressOf(
  agents: readonly ReviewAgent[],
  findings: readonly ReviewFinding[],
  project = '',
): ReviewProgress {
  const reviewers = agents.filter((agent) => agent.name.startsWith('rv-'))
  const names = reviewers.map((agent) => agent.name.slice(3))
  const byLensFindings = new Map<string, ReviewFinding[]>()
  for (const finding of findings) {
    const lens = lensOf(finding.id, names)
    if (lens) byLensFindings.set(lens, [...(byLensFindings.get(lens) ?? []), finding])
  }
  const lenses = reviewers.map((agent) => {
    const lens = agent.name.slice(3)
    return {
      lens,
      state: stateOf(agent),
      findings: byLensFindings.get(lens)?.length ?? 0,
    }
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

  const verifiers = new Map(
    agents
      .filter((agent) => agent.name.startsWith('vf-'))
      .map((agent) => [agent.name.slice(3), agent]),
  )
  const reports = reviewers.map((agent): LensReport => {
    const lens = agent.name.slice(3)
    const state = stateOf(agent)
    const own = byLensFindings.get(lens) ?? []
    const words = lastWords(agent.steps)
    const report = words === undefined ? undefined : relative(words, project)
    const verdict =
      state === 'running'
        ? doing(agent.steps)
        : state === 'failed'
          ? stoppedText(agent.steps)
          : own.length
            ? plural(own.length, 'finding')
            : 'no finding'
    return {
      lens,
      state,
      verdict,
      ...(report !== undefined && { report }),
      gist: report === undefined ? '' : gistOf(report),
      looked: lookedAt(agent.steps),
      steps: agent.steps
        .filter((step) => !['start', 'end', 'note'].includes(step.kind))
        .map((step) => ({
          key: stepKey(step),
          text: relative(activityOf(step), project),
        })),
      findings: own.map((finding) => {
        const verifier = verifiers.get(finding.id)
        const said = verifier && lastWords(verifier.steps)
        return {
          id: finding.id,
          title: finding.title,
          check: checkOf(finding, verifier),
          ...(said !== undefined && { verifier: relative(said, project) }),
        }
      }),
    }
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
        step: relative(doing(agent.steps), project),
      })),
    reports,
    done: agents.filter((agent) => !agent.running).length,
    total: agents.length,
    stopped: lenses.filter((one) => one.state === 'failed').map((one) => one.lens),
  }
}
