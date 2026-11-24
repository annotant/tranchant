import {
  formatDuration,
  inSide,
  letterOf,
  SIDES,
  sideAgents,
  timeOf,
  tokensOf,
  type BattleView,
  type Side,
} from './battle'
import { plural, type Finding, type ReviewAgent, type ReviewUsage } from './domain'
import { progressOf, type ReviewPhase } from './progress'
import { Bar, Chip } from './ReviewAgents'
import { formatTokens } from './tokens'

type Shown = Pick<Finding, 'id' | 'title' | 'verified'>

/** What a side's verifiers made of its findings so far. */
function verifyWords(agents: readonly ReviewAgent[], findings: readonly Shown[]) {
  const ids = new Set(findings.map((finding) => finding.id))
  const verifiers = agents.filter((agent) => agent.name.startsWith('vf-'))
  if (!verifiers.length) return 'none yet'
  const ended = verifiers.filter((agent) => !agent.running)
  const kept = ended.filter((agent) => ids.has(agent.name.slice(3))).length
  const dropped = ended.filter(
    (agent) =>
      !ids.has(agent.name.slice(3)) &&
      agent.outcome !== 'failed' &&
      agent.outcome !== 'interrupted',
  ).length
  const running = verifiers.length - ended.length
  return [
    `${kept} kept`,
    dropped > 0 && `${dropped} dropped`,
    running > 0 && `${running} verifying`,
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * A battle's agents while it runs, and once done: the shared lenses in a
 * strip above, run once for both; then A and B side by side, each with its
 * own lenses, its verifiers, what its agents do now, and its findings,
 * tokens and time.
 */
export function BattleBoard({
  view,
  agents,
  findings,
  usage,
  phase,
  project,
}: {
  view: BattleView
  agents: readonly ReviewAgent[]
  findings: readonly (Shown & Pick<Finding, 'lens'>)[]
  usage: ReviewUsage | undefined
  phase: ReviewPhase
  project: string
}) {
  const { battle } = view
  const sideOf = (lens: string) =>
    Object.hasOwn(battle.lenses, lens) ? battle.lenses[lens] : undefined
  const queued = phase === 'done' || phase === 'stopped' ? [] : undefined
  const planned = (keep: (side: string) => boolean) =>
    queued ??
    Object.entries(battle.lenses)
      .filter(([, side]) => keep(side))
      .map(([name]) => name)
  const ofSide = (side: Side) =>
    findings.filter((finding) => inSide(view.sides.get(finding.id), side))
  const shared = agents.filter(
    (agent) => agent.name.startsWith('rv-') && sideOf(agent.name.slice(3)) === 'both',
  )
  const sharedProgress = progressOf(
    shared,
    findings.filter((finding) => view.sides.get(finding.id) === 'both'),
    project,
    planned((side) => side === 'both'),
  )
  return (
    <>
      {sharedProgress.lenses.length > 0 && (
        <div className="tr-bt-shared">
          <span className="tr-progress-label">Shared · counts for both</span>
          <ul className="tr-lenses" aria-label="The shared lenses, run once">
            {sharedProgress.lenses.map((one) => (
              <Chip
                key={one.lens}
                lens={one.lens}
                state={one.state}
                count={one.state === 'done' ? String(one.findings) : undefined}
              />
            ))}
          </ul>
        </div>
      )}
      <div className="tr-bt-cols">
        {SIDES.map((side) => {
          const letter = letterOf(side)
          const own = sideAgents(agents, battle, side).filter(
            (agent) =>
              !(agent.name.startsWith('rv-') && sideOf(agent.name.slice(3)) === 'both'),
          )
          const mine = ofSide(side)
          const progress = progressOf(
            own,
            mine,
            project,
            planned((one) => one === side),
          )
          const reviewers = progress.lenses
          const time = timeOf(sideAgents(agents, battle, side))
          const tokens = tokensOf(usage, battle, side)
          return (
            <section
              key={side}
              className={`tr-bt-col tr-bt-side--${side}`}
              aria-label={`Group ${letter}: ${side === 'a' ? battle.a : battle.b}`}
            >
              <div className="tr-bt-col-head">
                <span className="tr-bt-badge" aria-hidden="true">
                  {letter}
                </span>
                <strong>{side === 'a' ? battle.a : battle.b}</strong>
                <Bar
                  label={`Group ${letter}: agents done`}
                  done={progress.done}
                  total={progress.total}
                />
                <span className="tr-muted">
                  {progress.total && progress.done === progress.total
                    ? 'done'
                    : `${progress.done} of ${plural(progress.total, 'agent')}`}
                </span>
              </div>
              <div className="tr-progress-rows">
                {reviewers.length > 0 && (
                  <>
                    <span className="tr-progress-label">Lenses</span>
                    <ul className="tr-lenses" aria-label={`Group ${letter}'s own lenses`}>
                      {reviewers.map((one) => (
                        <Chip
                          key={one.lens}
                          lens={one.lens}
                          state={one.state}
                          count={one.state === 'done' ? String(one.findings) : undefined}
                        />
                      ))}
                    </ul>
                  </>
                )}
                <span className="tr-progress-label">Verifying</span>
                <span className="tr-muted">{verifyWords(own, mine)}</span>
                {progress.now.length > 0 && (
                  <>
                    <span className="tr-progress-label">Now</span>
                    <ul
                      className="tr-now"
                      aria-label={`Group ${letter}'s agents at work`}
                    >
                      {progress.now.map((agent) => (
                        <li key={agent.name}>
                          <span className="tr-now-who">{agent.who}</span>
                          <span className="tr-agent-step">{agent.step}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <dl className="tr-bt-cost">
                <div>
                  <dt>Findings</dt>
                  <dd>{mine.length}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>{tokens === undefined ? '—' : formatTokens(tokens)}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{time === undefined ? '—' : formatDuration(time)}</dd>
                </div>
              </dl>
            </section>
          )
        })}
      </div>
    </>
  )
}
