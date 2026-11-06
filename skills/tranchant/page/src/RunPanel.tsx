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

interface Props {
  id: string
  record: FindingRecord | undefined
  /** The run in progress, as `/api/review` sends it. */
  steps: readonly Step[]
  disabled: boolean
}

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
export function RunPanel({ id, record, steps, disabled }: Props) {
  const [history, setHistory] = useState<History>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const runs = record?.runs ?? []
  const key = `${id}:${runs.length}`
  const shown = history?.key === key ? history.steps : undefined
  if (!steps.length && !runs.length) return null

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
        {shown ? (
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
      {runs.length > 0 && (
        <ul className="tr-runs">
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
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
