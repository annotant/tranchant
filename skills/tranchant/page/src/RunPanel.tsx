import { useEffect, useRef, useState } from 'react'
import { activityOf, runningStep, stepKey } from './activity'
import { fetchRuns } from './api'
import {
  type FindingRecord,
  groupClass,
  modelName,
  stateClass,
  type Step,
} from './domain'
import type { FindingCost, RunCost } from './tokens'

interface Props {
  id: string
  record: FindingRecord | undefined
  /** The run in progress, as `/api/review` sends it. */
  steps: readonly Step[]
  disabled: boolean
  /** What its verification, discussion and runs spent; none when the review has no usage. */
  cost?: FindingCost | undefined
}

function Cost({ cost }: { cost: RunCost | undefined }) {
  if (!cost) return null
  return (
    <span
      className={cost.dim ? 'tr-tk-runcost tr-tk-dim' : 'tr-tk-runcost'}
      title={cost.title}
    >
      {cost.text}
    </span>
  )
}

const TONES = {
  confirmed: groupClass('done'),
  running: groupClass('inProgress'),
  still: 'tr-chip',
} as const

function Steps({ steps, live }: { steps: readonly Step[]; live: boolean }) {
  const list = useRef<HTMLOListElement>(null)
  const running = live ? runningStep(steps) : undefined
  useEffect(() => {
    const element = list.current
    if (element && steps.length) element.scrollTop = element.scrollHeight
  }, [steps])
  return (
    <ol className="tr-steps" ref={list} aria-live={live ? 'polite' : undefined}>
      {steps.map((step) => (
        <li
          key={stepKey(step)}
          className={`tr-step tr-step--${step.state}`}
          title={step.detail}
        >
          {step === running ? (
            <span className="tr-spinner" role="img" aria-label="running" />
          ) : (
            <span className="tr-step-dot" aria-hidden="true" />
          )}
          <span className="tr-step-text">{activityOf(step)}</span>
        </li>
      ))}
    </ol>
  )
}

interface History {
  /** The finding and run count it was read for: another makes it stale. */
  key: string
  steps: Step[]
}

type Outcome = NonNullable<FindingRecord['runs'][number]['outcome']>

// A run's own end, not its finding's state: a later run or decision moves the finding on.
const OUTCOME_LABELS: Record<Outcome | 'running', string> = {
  running: 'In progress',
  fixed: 'Fixed',
  asking: 'Asked you',
  failed: 'Did not land',
  stopped: 'Stopped',
}

/** The steps of the run in progress, and the runs that ended, with their history on demand. */
export function RunPanel({ id, record, steps, disabled, cost }: Props) {
  const [history, setHistory] = useState<History>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const runs = record?.runs ?? []
  const key = `${id}:${runs.length}`
  const shown = history?.key === key ? history.steps : undefined
  const rows = cost?.rows ?? []
  if (!steps.length && !runs.length && !rows.length) return null

  async function showHistory() {
    setLoading(true)
    setError(undefined)
    try {
      setHistory({ key, steps: await fetchRuns(id) })
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The history could not be read.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="tr-section tr-run" aria-label="Run">
      <div className="tr-section-head">
        <h3>Run</h3>
        {!steps.length && !runs.length ? null : shown ? (
          <button
            type="button"
            className="tr-btn tr-btn--link"
            onClick={() => setHistory(undefined)}
          >
            Hide history
          </button>
        ) : (
          <button
            type="button"
            className="tr-btn tr-btn--link"
            disabled={disabled || loading}
            onClick={() => void showHistory()}
          >
            {loading ? 'Loading…' : 'Show history'}
          </button>
        )}
      </div>
      {error && <p className="tr-error">{error}</p>}
      {shown ? (
        shown.length ? (
          <Steps steps={shown} live={false} />
        ) : (
          <p className="tr-muted">No step recorded.</p>
        )
      ) : (
        steps.length > 0 && <Steps steps={steps} live />
      )}
      {runs.length + rows.length > 0 && (
        <ul className="tr-runs">
          {rows.map((row) => (
            <li key={row.key}>
              <span className="tr-run-id">{row.name}</span>
              {row.model && <span className="tr-muted"> · {modelName(row.model)}</span>}
              {row.chip && <span className={TONES[row.chip.tone]}>{row.chip.text}</span>}
              <Cost cost={row.cost} />
            </li>
          ))}
          {runs.map((run) => (
            <li key={run.id}>
              <span className="tr-run-id">{run.id}</span>
              {run.model && <span className="tr-muted"> · {modelName(run.model)}</span>}
              <span
                className={
                  run.outcome ? stateClass(run.outcome) : groupClass('inProgress')
                }
              >
                {OUTCOME_LABELS[run.outcome ?? 'running']}
              </span>
              {run.summary && <span className="tr-run-summary"> {run.summary}</span>}
              <Cost cost={cost?.runs.get(run.id)} />
            </li>
          ))}
        </ul>
      )}
      {cost?.foot && <p className="tr-tk-foot">{cost.foot}</p>}
    </section>
  )
}
