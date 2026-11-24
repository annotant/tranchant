import { useEffect, useRef, useState } from 'react'
import { plural, type Finding, type ReviewAgent } from './domain'
import { Markdown } from './markdown'
import {
  progressOf,
  type LensProgress,
  type LensReport,
  type ReviewPhase,
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

const PauseIcon = ({ size = 12, className }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
)

const StopIcon = ({ size = 12, className }: { size?: number; className?: string }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
)

const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 5l12 7-12 7z" />
  </svg>
)

const ResetIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4h4" />
  </svg>
)

const NOT_COVERED = 'The agent stopped before it finished: its lens is not covered'
const NOT_VERIFIED = 'A verifier stopped before it finished: its finding stays unverified'

function Chip({
  lens,
  state,
  count,
  title,
  note,
}: {
  lens: string
  state: LensProgress['state']
  count?: string | undefined
  title?: string | undefined
  /** What the review's pause or stop makes of it. */
  note?: string | undefined
}) {
  return (
    <li className={`tr-lens tr-lens--${state}`} title={title ?? note}>
      {state === 'running' ? (
        <span className="tr-spinner" role="img" aria-label="running" />
      ) : state === 'failed' ? (
        <Cross />
      ) : state === 'done' ? (
        <Check />
      ) : null}
      {lens}
      {note && <span className="tr-rp-note">{note}</span>}
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
  focused,
  onOpen,
}: {
  report: LensReport
  /** The Tokens screen's link names it: opened, and scrolled to. */
  focused: boolean
  onOpen: (id: string) => void
}) {
  const [open, setOpen] = useState(focused)
  const [wasFocused, setWasFocused] = useState(focused)
  if (focused !== wasFocused) {
    setWasFocused(focused)
    if (focused) setOpen(true)
  }
  const [allSteps, setAllSteps] = useState(false)
  const row = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused) row.current?.scrollIntoView?.({ block: 'start' })
  }, [focused])
  const steps = allSteps ? report.steps : report.steps.slice(0, STEPS_SHOWN)
  const body = `tr-report-body-${report.lens}`
  return (
    <li className="tr-report" id={`tr-report-${report.lens}`} ref={row}>
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
        ) : report.state === 'interrupted' ? (
          <PauseIcon className="tr-lens-icon" />
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

const NO_GROUPS: readonly string[] = []

/** "a", "a and b", "a, b and c". */
const listOf = (names: readonly string[]) =>
  names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

/** What a review's pause or stop makes of a lens, in its chip. */
function noteOf(phase: ReviewPhase, state: LensProgress['state']) {
  const paused = phase === 'pausing' || phase === 'paused'
  if (phase === 'pausing' && state === 'running') return 'finishing'
  if (paused && state === 'queued') return 'paused'
  if (paused && state === 'interrupted') return 'interrupted · runs again on Resume'
  if (phase === 'stopped' && state === 'failed') return 'stopped · not covered'
  if (phase === 'stopped' && state === 'running') return 'still running'
  if (phase === 'stopped' && state !== 'done') return 'not covered'
  return undefined
}

/** How far the review got. */
function Bar({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <span
      className="tr-progress-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      <span style={{ width: `${total ? (100 * done) / total : 0}%` }} />
    </span>
  )
}

/** Names for a note: the first three, then how many more. */
const listed = (names: readonly string[]) =>
  names.length > 3
    ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
    : names.join(', ')

/** A review's controls, as the page sends them. */
export type ReviewControl =
  'pause' | 'pauseNow' | 'resume' | 'halt' | 'haltReset' | 'reset'

/** Where the review stands, by lens; one line once it is done. */
export function ReviewAgents({
  agents,
  phase,
  findings,
  verify,
  project,
  lensGroup,
  planned = NO_GROUPS,
  others = NO_GROUPS,
  underWay = NO_GROUPS,
  stuck = NO_GROUPS,
  report,
  onOpen,
  onControl,
}: {
  agents: readonly ReviewAgent[]
  /** Where the review's agents stand: see ReviewPhase. */
  phase: ReviewPhase
  /** The group of lenses the review runs, when it runs one. */
  lensGroup?: string | undefined
  /** The lenses the review runs: those not started yet show queued. */
  planned?: readonly string[]
  /** The project's other groups: a review of one of them is how two are compared. */
  others?: readonly string[]
  findings: readonly Pick<Finding, 'id' | 'title' | 'verified'>[]
  verify: boolean
  project: string
  onOpen: (id: string) => void
  /** The findings a fix, a post, an issue or an answer holds: Reset is refused until they end. */
  underWay?: readonly string[]
  /** The review agents TaskStop did not end, still running: Reset is refused until they end too. */
  stuck?: readonly string[]
  /** Pause, Resume, Stop and Reset; absent, the panel offers none. */
  onControl?: ((control: ReviewControl) => Promise<boolean>) | undefined
  /** The lens whose report `#report/<lens>` opens. */
  report?: string | undefined
}) {
  const [open, setOpen] = useState(report !== undefined)
  const [shownReport, setShownReport] = useState(report)
  if (report !== shownReport) {
    setShownReport(report)
    if (report !== undefined) setOpen(true)
  }
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!agents.length && !planned.length) return null
  const progress = progressOf(agents, findings, project, phase === 'done' ? [] : planned)
  const ends = underWay.length + stuck.length > 1 ? 'they end' : 'it ends'
  const waitsFor =
    [
      underWay.length &&
        `${listed(underWay)}: a fix, a post, an issue or an answer under way`,
      stuck.length &&
        `${listed(stuck)}, still running: Tranchant could not stop ${stuck.length > 1 ? 'them' : 'it'}`,
    ]
      .filter(Boolean)
      .join('; ') || undefined
  const control = async (which: ReviewControl) => {
    if (!onControl || busy) return
    setBusy(true)
    const ok = await onControl(which)
    setBusy(false)
    if (ok) setConfirming(false)
  }
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
  const lensesOf = (...states: LensProgress['state'][]) =>
    progress.lenses.filter((one) => states.includes(one.state)).map((one) => one.lens)
  const covered = lensesOf('done').length
  const lensCount = progress.lenses.length
  const inGroup = lensGroup ? ` · group ${lensGroup}` : ''
  const running = lensesOf('running')
  const left = lensesOf('queued')
  const interrupted = lensesOf('interrupted')
  const paused = phase === 'pausing' || phase === 'paused'
  const findingCount = plural(findings.length, 'finding')
  const confirmText = [
    phase === 'paused'
      ? [...interrupted, ...left].length > 0 &&
        `${listOf([...interrupted, ...left])} never start.`
      : [
          running.length > 0 && `${listOf(running)} end now, before they finish`,
          [...interrupted, ...left].length > 0 &&
            `${listOf([...interrupted, ...left])} never start`,
        ]
          .filter(Boolean)
          .join('; ') + (running.length || left.length || interrupted.length ? '.' : ''),
    `The review ends as it is: no Resume. Stop the review keeps the ${findingCount} so far, to read and settle; Stop and reset deletes them and goes back to Ready to start.`,
  ]
    .filter(Boolean)
    .join(' ')
  const controls = onControl && !confirming && (
    <>
      {phase === 'running' && (
        <button
          type="button"
          className="tr-btn tr-btn--small"
          disabled={busy}
          title="Start no new agent; the running ones finish their work"
          onClick={() => void control('pause')}
        >
          <PauseIcon />
          Pause
        </button>
      )}
      {phase === 'pausing' && (
        <button
          type="button"
          className="tr-btn tr-btn--small"
          disabled={busy}
          title="End the running agents now; they run again from the start on Resume"
          onClick={() => void control('pauseNow')}
        >
          Pause now
        </button>
      )}
      {paused && (
        <button
          type="button"
          className={`tr-btn tr-btn--small${phase === 'paused' ? ' tr-btn--primary' : ''}`}
          disabled={busy}
          onClick={() => void control('resume')}
        >
          <PlayIcon />
          Resume
        </button>
      )}
      {(phase === 'running' || paused) && (
        <button
          type="button"
          className="tr-btn tr-btn--small tr-btn--danger"
          disabled={busy}
          title="End the review as it is: no resume"
          onClick={() => setConfirming(true)}
        >
          <StopIcon />
          Stop the review
        </button>
      )}
      {phase === 'stopped' && (
        <button
          type="button"
          className="tr-btn tr-btn--small"
          disabled={busy || !!waitsFor}
          title={
            waitsFor
              ? `Refused until ${ends}: ${waitsFor}`
              : 'Delete the findings and go back to Ready to start, the lenses built'
          }
          onClick={() => void control('reset')}
        >
          <ResetIcon />
          Reset the review
        </button>
      )}
    </>
  )
  return (
    <section
      className={`tr-progress${paused ? ' tr-rp--paused' : phase === 'stopped' ? ' tr-rp--stopped' : ''}`}
      aria-label="Review agents"
    >
      <div className="tr-progress-head">
        {phase === 'running' || phase === 'pausing' ? (
          <>
            <span className="tr-spinner" aria-hidden="true" />
            <span className="tr-progress-title">
              {phase === 'pausing' ? 'Pausing' : 'Reviewing the change'}
              {inGroup}
            </span>
            <Bar label="Agents done" done={progress.done} total={progress.total} />
            <span className="tr-muted">
              {phase === 'pausing' && running.length
                ? `${listOf(running)} ${running.length > 1 ? 'finish their' : 'finishes its'} work; nothing new starts`
                : `${progress.done} of ${plural(progress.total, 'agent')} done`}
            </span>
          </>
        ) : phase === 'paused' || phase === 'stopped' ? (
          <>
            {phase === 'paused' ? (
              <PauseIcon size={16} className="tr-rp-icon" />
            ) : (
              <StopIcon size={16} className="tr-rp-icon tr-rp-icon--stop" />
            )}
            <span className="tr-progress-title">
              {phase === 'paused' ? 'Review paused' : 'Review stopped'}
              {inGroup}
            </span>
            <Bar label="Lenses covered" done={covered} total={lensCount} />
            <span className="tr-muted">
              {phase === 'paused'
                ? [
                    `${covered} of ${plural(lensCount, 'lens', 'lenses')} done`,
                    left.length > 0 && `${listOf(left)} start on Resume`,
                    interrupted.length > 0 &&
                      `${listOf(interrupted)} ${interrupted.length > 1 ? 'were' : 'was'} interrupted, and run${interrupted.length > 1 ? '' : 's'} again on Resume`,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : covered === lensCount
                  ? `every lens covered`
                  : `${covered} of ${plural(lensCount, 'lens', 'lenses')} covered · the rest will not run: Reset the review to start it again`}
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
            <span className="tr-progress-title">Review done{inGroup}</span>
            <span className="tr-muted">
              {plural(progress.lenses.length, 'lens', 'lenses')} · {findingCount}
              {verify && `, ${verified} verified`}
            </span>
            {progress.stopped.length > 0 && (
              <span className="tr-progress-warn">{notCovered(progress.stopped)}</span>
            )}
          </>
        )}
        <span className="tr-rp-controls">
          {controls}
          {toggle}
        </span>
      </div>
      {confirming && (
        <div
          className="tr-rp-confirm"
          role="alertdialog"
          aria-labelledby="tr-rp-confirm-title"
          aria-describedby="tr-rp-confirm-text"
        >
          <strong id="tr-rp-confirm-title">Stop the review?</strong>
          <p id="tr-rp-confirm-text">{confirmText}</p>
          <div className="tr-rp-confirm-actions">
            <button
              type="button"
              className="tr-btn tr-btn--small tr-btn--danger"
              disabled={busy}
              title="The findings stay, to read and settle"
              onClick={() => void control('halt')}
            >
              Stop the review
            </button>
            <button
              type="button"
              className="tr-btn tr-btn--small tr-btn--danger"
              disabled={busy || !!waitsFor}
              title={
                waitsFor
                  ? `Refused until ${ends}: ${waitsFor}`
                  : 'Delete the findings too, and go back to Ready to start'
              }
              onClick={() => void control('haltReset')}
            >
              Stop and reset
            </button>
            <button
              type="button"
              className="tr-btn tr-btn--small"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              {paused ? 'Keep it paused' : 'Keep it running'}
            </button>
            <span className="tr-muted">
              {waitsFor
                ? `Stop and reset is refused until ${ends}: ${waitsFor}. A fix already made stays on the working tree.`
                : 'A fix under way keeps running, and a fix already made stays on the working tree.'}
            </span>
          </div>
        </div>
      )}
      {lensGroup && others.length > 0 && (
        <p className="tr-muted tr-progress-compare" role="note">
          This review runs the group {lensGroup}. To compare, review the same change with{' '}
          {others.map((name, i) => (
            <span key={name}>
              {i > 0 && ' or '}
              <code>--group {name}</code>
            </span>
          ))}
          : each review keeps its group. Comparing their findings is still to come (#112).
        </p>
      )}
      {(phase === 'paused' || phase === 'stopped') && (
        <p className="tr-muted tr-rp-body">
          {phase === 'stopped'
            ? `Stopped: the ${findingCount} that landed stay below, to read and settle as usual, for as long as you want. ${waitsFor ? `Reset is refused until ${ends}: ${waitsFor}.` : 'Reset the review to run it again from Ready to start.'}`
            : `Paused: the ${findingCount} below are yours to settle while no reviewer runs.`}
        </p>
      )}
      {phase !== 'done' && (
        <div className="tr-progress-rows">
          {progress.lenses.length > 0 && (
            <>
              <span className="tr-progress-label">Lenses</span>
              <ul className="tr-lenses" aria-label="Reviewers, one per lens">
                {progress.lenses.map((one) => (
                  <Chip
                    key={one.lens}
                    lens={one.lens}
                    // Stopped, whatever did not finish is not covered; one the hooks could not stop still runs.
                    state={
                      phase === 'stopped' &&
                      one.state !== 'done' &&
                      one.state !== 'running'
                        ? 'failed'
                        : one.state
                    }
                    count={one.state === 'done' ? String(one.findings) : undefined}
                    title={
                      one.state === 'failed' && phase !== 'stopped'
                        ? NOT_COVERED
                        : undefined
                    }
                    note={noteOf(phase, one.state)}
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
          {progress.reports.map((one) => (
            <LensRow
              key={one.lens}
              report={one}
              focused={one.lens === report}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
