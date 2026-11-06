import { useState } from 'react'
import { plural, type Finding, type ReviewAgent } from './domain'
import { Markdown } from './markdown'
import {
  progressOf,
  type LensProgress,
  type LensReport,
  type VerifyProgress,
} from './progress'

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
const NOT_VERIFIED = 'A verifier stopped before it finished: its finding stays unverified'

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

const CHECK_WORDS: Record<LensReport['findings'][number]['check'], string> = {
  verified: 'verified',
  amended: 'amended',
  verifying: 'verifying',
  unverified: 'unverified',
}

/** Steps shown before "and N more". */
const STEPS_SHOWN = 6

/** One lens: its verdict in a row; opened, its report, its findings and what it looked at. */
function LensRow({
  report,
  onOpen,
}: {
  report: LensReport
  onOpen: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [allSteps, setAllSteps] = useState(false)
  const steps = allSteps ? report.steps : report.steps.slice(0, STEPS_SHOWN)
  const body = `tr-report-body-${report.lens}`
  return (
    <li className="tr-report">
      <button
        type="button"
        className="tr-report-row"
        aria-expanded={open}
        aria-controls={body}
        onClick={() => setOpen(!open)}
      >
        {report.state === 'running' ? (
          <span className="tr-spinner" role="img" aria-label="running" />
        ) : report.state === 'failed' ? (
          <Cross />
        ) : (
          <Check />
        )}
        <span className="tr-report-lens">{report.lens}</span>
        <span
          className={`tr-report-verdict tr-report-verdict--${report.state === 'done' && report.findings.length ? 'found' : report.state}`}
        >
          {report.verdict}
        </span>
        <span className="tr-report-gist">{report.gist}</span>
        <span className="tr-report-looked">{report.looked}</span>
      </button>
      {open && (
        <div className="tr-report-body" id={body}>
          <div>
            <h3 className="tr-report-h">Its report</h3>
            {report.report ? (
              <Markdown source={report.report} headings={false} />
            ) : (
              <p className="tr-muted">Nothing said yet.</p>
            )}
          </div>
          <div>
            {report.findings.length > 0 && (
              <>
                <h3 className="tr-report-h">Its findings</h3>
                <ul className="tr-report-findings">
                  {report.findings.map((finding) => (
                    <li key={finding.id}>
                      <button
                        type="button"
                        className="tr-btn tr-btn--link"
                        onClick={() => onOpen(finding.id)}
                      >
                        {finding.title}
                      </button>
                      <span
                        className={`tr-chip tr-chip--check-${finding.check}`}
                        title={finding.verifier}
                      >
                        {CHECK_WORDS[finding.check]}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {report.steps.length > 0 && (
              <>
                <h3 className="tr-report-h">What it looked at</h3>
                <ul className="tr-report-steps">
                  {steps.map((step) => (
                    <li key={step.key}>{step.text}</li>
                  ))}
                </ul>
                {report.steps.length > STEPS_SHOWN && (
                  <button
                    type="button"
                    className="tr-btn tr-btn--link tr-report-more"
                    onClick={() => setAllSteps(!allSteps)}
                  >
                    {allSteps
                      ? 'Fewer steps'
                      : `and ${plural(report.steps.length - STEPS_SHOWN, 'more step')}`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

const verifyCount = (group: VerifyProgress) => `${group.done}/${group.total}`

/** "conventions stopped: that lens is not covered", for one lens or more. */
const notCovered = (lenses: readonly string[]) =>
  lenses.length === 1
    ? `${lenses[0]} stopped: that lens is not covered`
    : `${lenses.join(', ')} stopped: those lenses are not covered`

/** Where the review stands, by lens; one line once it is done. */
export function ReviewAgents({
  agents,
  reviewing,
  findings,
  verify,
  project,
  onOpen,
}: {
  agents: readonly ReviewAgent[]
  reviewing: boolean
  findings: readonly Pick<Finding, 'id' | 'title' | 'verified'>[]
  verify: boolean
  project: string
  onOpen: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (!agents.length) return null
  const progress = progressOf(agents, findings, project)
  const toggle = (
    <button
      type="button"
      className="tr-btn tr-btn--link tr-progress-toggle"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      {open ? 'Hide the lenses' : 'What each lens checked'}
    </button>
  )
  const verified = findings.filter((finding) => finding.verified === true).length
  return (
    <section className="tr-progress" aria-label="Review agents">
      <div className="tr-progress-head">
        {reviewing ? (
          <>
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
          </>
        ) : (
          <>
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
          </>
        )}
        {toggle}
      </div>
      {reviewing && (
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
                    title={group.state === 'failed' ? NOT_VERIFIED : undefined}
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
      )}
      {open && (
        <ul className="tr-reports" aria-label="What each lens checked">
          {progress.reports.map((report) => (
            <LensRow key={report.lens} report={report} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  )
}
