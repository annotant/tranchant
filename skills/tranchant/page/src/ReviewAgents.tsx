import { useState } from 'react'
import type { Finding, ReviewAgent } from './domain'
import { plural, progressOf, type LensProgress, type VerifyProgress } from './progress'

const Check = () => (
  <svg
    className="tr-lens-icon"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-label="done"
    role="img"
  >
    <path d="M5 12.5l4 4 10-10" />
  </svg>
)

const Cross = () => (
  <svg
    className="tr-lens-icon"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    aria-label="stopped"
    role="img"
  >
    <path d="M7 7l10 10M17 7 7 17" />
  </svg>
)

const NOT_COVERED = 'The agent stopped before it finished: its lens is not covered'

function Chip({
  lens,
  state,
  count,
  title,
}: {
  lens: string
  state: LensProgress['state']
  count?: string | undefined
  title?: string | undefined
}) {
  return (
    <li className={`tr-lens tr-lens--${state}`} title={title}>
      {state === 'running' ? (
        <span className="tr-spinner" role="img" aria-label="running" />
      ) : state === 'failed' ? (
        <Cross />
      ) : (
        <Check />
      )}
      {lens}
      {count !== undefined && <span className="tr-lens-count">{count}</span>}
    </li>
  )
}

const verifyCount = (group: VerifyProgress) => `${group.done}/${group.total}`

/** "conventions stopped: that lens is not covered", for one lens or more. */
const notCovered = (lenses: readonly string[]) =>
  lenses.length === 1
    ? `${lenses[0]} stopped: that lens is not covered`
    : `${lenses.join(', ')} stopped: those lenses are not covered`

/**
 * Where the review stands, by lens: its reviewers, its verifiers grouped by
 * the lens of their finding, and the agents still at work; folded into one
 * line once the review is done.
 */
export function ReviewAgents({
  agents,
  reviewing,
  findings,
  verify,
}: {
  agents: readonly ReviewAgent[]
  reviewing: boolean
  findings: readonly Pick<Finding, 'id' | 'verified'>[]
  verify: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!agents.length) return null
  const progress = progressOf(
    agents,
    findings.map((finding) => finding.id),
  )
  const toggle = (
    <button
      type="button"
      className="tr-btn tr-btn--link tr-progress-toggle"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      {open ? 'Hide agents' : 'Show all agents'}
    </button>
  )
  const verified = findings.filter((finding) => finding.verified === true).length
  return (
    <section className="tr-progress" aria-label="Review agents">
      {reviewing ? (
        <>
          <div className="tr-progress-head">
            <span className="tr-spinner" aria-hidden="true" />
            <span className="tr-progress-title">Reviewing the change</span>
            <span
              className="tr-progress-bar"
              role="progressbar"
              aria-label="Agents done"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
            >
              <span style={{ width: `${(100 * progress.done) / progress.total}%` }} />
            </span>
            <span className="tr-muted">
              {progress.done} of {plural(progress.total, 'agent')} done
            </span>
            {toggle}
          </div>
          <div className="tr-progress-rows">
            {progress.lenses.length > 0 && (
              <>
                <span className="tr-progress-label">Lenses</span>
                <ul className="tr-lenses" aria-label="Reviewers, one per lens">
                  {progress.lenses.map((one) => (
                    <Chip
                      key={one.lens}
                      lens={one.lens}
                      state={one.state}
                      count={one.state === 'done' ? String(one.findings) : undefined}
                      title={one.state === 'failed' ? NOT_COVERED : undefined}
                    />
                  ))}
                </ul>
              </>
            )}
            {progress.verifying.length > 0 && (
              <>
                <span className="tr-progress-label">Verifying</span>
                <ul className="tr-lenses" aria-label="Verifiers, by lens">
                  {progress.verifying.map((group) => (
                    <Chip
                      key={group.lens}
                      lens={group.lens}
                      state={group.state}
                      count={verifyCount(group)}
                    />
                  ))}
                </ul>
              </>
            )}
            {progress.now.length > 0 && (
              <>
                <span className="tr-progress-label">Now</span>
                <ul className="tr-now" aria-label="Agents at work">
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
        </>
      ) : (
        <div className="tr-progress-head">
          <svg
            className="tr-progress-ok"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.5l4 4 10-10" />
          </svg>
          <span className="tr-progress-title">Review done</span>
          <span className="tr-muted">
            {plural(progress.lenses.length, 'lens', 'lenses')} ·{' '}
            {plural(findings.length, 'finding')}
            {verify && `, ${verified} verified`}
          </span>
          {progress.stopped.length > 0 && (
            <span className="tr-progress-warn">{notCovered(progress.stopped)}</span>
          )}
          {toggle}
        </div>
      )}
      {open && (
        <ul className="tr-log" aria-label="Every review agent">
          {progress.all.map((agent) => (
            <li
              key={agent.name}
              className={`tr-agent ${agent.state === 'running' ? '' : 'tr-agent--ended'}`}
            >
              {agent.state === 'running' ? (
                <span className="tr-spinner" role="img" aria-label="running" />
              ) : (
                <span
                  className={`tr-agent-dot ${agent.state === 'failed' ? 'tr-agent-dot--failed' : ''}`}
                  role="img"
                  aria-label={agent.state === 'failed' ? 'stopped' : 'ended'}
                />
              )}
              <span className="tr-agent-name">{agent.role}</span>
              <span
                className={`tr-agent-step ${agent.state === 'failed' ? 'tr-agent-step--failed' : ''}`}
              >
                {agent.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
