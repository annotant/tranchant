import { type FormEvent, useState } from 'react'
import { Diagram } from './Diagram'
import {
  allows,
  BUCKET_LABELS,
  type DecisionInput,
  type Finding,
  type FindingRecord,
  type Review,
  STATE_DETAILS,
  stateLabel,
  type Step,
  stateOf,
  tagOf,
} from './domain'
import { Excerpt } from './Excerpt'
import { FixChanges } from './FixChanges'
import { Markdown } from './markdown'
import { RunPanel } from './RunPanel'
import { languageOfFile } from './syntax'

interface Props {
  review: Review
  finding: Finding
  record: FindingRecord | undefined
  steps: readonly Step[]
  /** No verifier confirmed it yet. */
  unverified?: boolean
  disabled: boolean
  onDecide: (decisions: DecisionInput[]) => void
  onAnswer: (id: string, text: string, choices: string[]) => void
  onStop: (id: string) => void
}

type Mode = 'idle' | 'editing' | 'dropping'

function CopyAnchor({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <span className="tr-anchor">
      <code>{text}</code>
      <button
        type="button"
        className="tr-btn tr-btn--link"
        onClick={() => void copy()}
        aria-label={`Copy ${text}`}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  )
}

function AskForm({
  record,
  disabled,
  onAnswer,
}: {
  record: FindingRecord
  disabled: boolean
  onAnswer: (text: string, choices: string[]) => void
}) {
  const question = record.question
  const [choices, setChoices] = useState<string[]>([])
  const [text, setText] = useState('')
  if (!question) return null
  const options = question.options ?? []
  const multiple = question.multiple === true
  const canSend = !disabled && (choices.length > 0 || text.trim().length > 0)

  function toggle(label: string) {
    setChoices((current) =>
      multiple
        ? current.includes(label)
          ? current.filter((one) => one !== label)
          : [...current, label]
        : [label],
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSend) return
    onAnswer(text.trim(), choices)
  }

  return (
    <form className="tr-ask" onSubmit={submit} aria-label="Answer the agent">
      <p className="tr-ask-text">{question.text}</p>
      {options.length > 0 && (
        <ul className="tr-options" role={multiple ? 'group' : 'radiogroup'}>
          {options.map((option) => (
            <li key={option.label}>
              <label className="tr-option">
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name="tr-choice"
                  checked={choices.includes(option.label)}
                  onChange={() => toggle(option.label)}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description && (
                    <span className="tr-muted"> — {option.description}</span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <textarea
        className="tr-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Or answer in your own words…"
        aria-label="Your answer"
        rows={3}
      />
      <div className="tr-actions">
        <button type="submit" className="tr-btn tr-btn--primary" disabled={!canSend}>
          Answer
        </button>
      </div>
    </form>
  )
}

export function FindingDetail({
  review,
  finding,
  record,
  steps,
  unverified = false,
  disabled,
  onDecide,
  onAnswer,
  onStop,
}: Props) {
  const state = stateOf(
    { [finding.id]: record ?? { state: 'open', runs: [], events: [] } },
    finding.id,
  )
  // Mounted per finding (keyed by the parent): the drafts start afresh with it.
  const [mode, setMode] = useState<Mode>('idle')
  const [showContext, setShowContext] = useState(false)
  const [context, setContext] = useState('')
  const [comment, setComment] = useState(record?.comment ?? finding.comment ?? '')
  const [reason, setReason] = useState('')

  const can = (move: Parameters<typeof allows>[0]) =>
    !disabled && allows(move, state, review)
  const theirs = review.ownership === 'theirs'
  const tag = tagOf(finding)
  const lastRun = record?.runs.at(-1)

  const decide = (input: Omit<DecisionInput, 'id'>) => {
    onDecide([{ id: finding.id, ...input }])
    setMode('idle')
  }
  const fix = () =>
    decide(
      context.trim() ? { action: 'fix', context: context.trim() } : { action: 'fix' },
    )
  const postAsWritten = () => decide({ action: 'post' })
  const editAndPost = () =>
    decide(
      comment.trim() && comment.trim() !== finding.comment
        ? { action: 'post', comment: comment.trim() }
        : { action: 'post' },
    )
  const drop = () =>
    decide(reason.trim() ? { action: 'drop', reason: reason.trim() } : { action: 'drop' })

  return (
    <article className="tr-detail" aria-labelledby="tr-detail-title">
      <header className="tr-detail-head">
        <h2 id="tr-detail-title">{finding.title}</h2>
        {unverified && (
          <p className="tr-muted" role="note">
            {review.status === 'reviewing'
              ? 'Not verified yet: a verifier re-reads the code, then confirms, corrects or removes it.'
              : 'Not verified: the review ended before a verifier confirmed it.'}
          </p>
        )}
        <div className="tr-detail-meta">
          <CopyAnchor text={`${finding.path}:${finding.line}`} />
          <span className={`tr-chip tr-chip--bucket-${finding.bucket}`}>
            {BUCKET_LABELS[finding.bucket]}
          </span>
          <span className="tr-chip">{finding.topic}</span>
          {tag !== 'concern' && (
            <span className={`tr-chip tr-chip--tag-${tag}`}>{tag}</span>
          )}
          <span className={`tr-chip tr-chip--${state}`} title={STATE_DETAILS[state]}>
            {stateLabel(state)}
          </span>
        </div>
      </header>

      <Excerpt
        excerpt={finding.excerpt}
        hunk={finding.hunk}
        marks={finding.marks}
        anchor={finding.line}
        label={`Excerpt of ${finding.path}`}
        language={languageOfFile(finding.path)}
      />

      <dl className="tr-pwf">
        <dt>Problem</dt>
        <dd>
          <Markdown source={finding.problem} headings={false} />
        </dd>
        <dt>Why</dt>
        <dd>
          <Markdown source={finding.why} headings={false} />
        </dd>
        <dt>Fix</dt>
        <dd>
          <Markdown source={finding.fix} headings={false} />
        </dd>
      </dl>

      {finding.related && finding.related.length > 0 && (
        <details className="tr-related">
          <summary>Related ({finding.related.length})</summary>
          {finding.related.map((related) => (
            <div key={`${related.path}:${related.line}`} className="tr-related-item">
              <code className="tr-related-anchor">
                {related.path}:{related.line}
              </code>
              <Excerpt
                excerpt={related.excerpt}
                marks={related.marks}
                anchor={related.line}
                label={`Excerpt of ${related.path}`}
                language={languageOfFile(related.path)}
              />
            </div>
          ))}
        </details>
      )}

      {finding.diagram && <Diagram diagram={finding.diagram} />}

      <section className="tr-section" aria-label="Outcome">
        {state === 'posted' && record?.posted && (
          <p className="tr-outcome">
            Posted:{' '}
            <a href={record.posted.url} target="_blank" rel="noreferrer">
              {record.posted.url}
            </a>
          </p>
        )}
        {state === 'fixed' && (
          <div className="tr-outcome">
            <p>{lastRun?.summary ?? 'Fixed on the working tree.'}</p>
            {lastRun?.changed && lastRun.changed.length > 0 && (
              <ul className="tr-changed">
                {lastRun.changed.map((file) => (
                  <li key={file}>
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
            )}
            <FixChanges id={finding.id} disabled={disabled} />
          </div>
        )}
        {state === 'failed' && (
          <p className="tr-outcome tr-error">
            Failed: {record?.reason ?? 'no reason given'}
          </p>
        )}
        {state === 'dropped' && (
          <p className="tr-outcome">
            Dropped{record?.reason ? `: ${record.reason}` : '.'}
          </p>
        )}
        {state === 'skipped' && <p className="tr-outcome">Skipped for now.</p>}
        {state === 'stopped' && record?.cancellation && (
          <p className="tr-outcome">
            Stopped after {record.cancellation.steps} steps
            {record.cancellation.changed.length
              ? `; left changed: ${record.cancellation.changed.join(', ')}`
              : '.'}
          </p>
        )}
        {state === 'asking' && record && (
          <AskForm
            key={record.question?.at}
            record={record}
            disabled={disabled}
            onAnswer={(text, choices) => onAnswer(finding.id, text, choices)}
          />
        )}
      </section>

      <section className="tr-section tr-decide" aria-label="Actions">
        {can('stop') && (
          <div className="tr-actions">
            <span className="tr-muted">
              {state === 'queued' ? 'Waiting for an agent…' : 'An agent is on it…'}
            </span>
            <button
              type="button"
              className="tr-btn tr-btn--danger"
              onClick={() => onStop(finding.id)}
            >
              Stop
            </button>
          </div>
        )}
        {mode === 'dropping' ? (
          <form
            className="tr-inline-form"
            onSubmit={(event) => {
              event.preventDefault()
              drop()
            }}
          >
            <input
              className="tr-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why? (optional, one line)"
              aria-label="Reason for dropping"
              autoFocus
            />
            <button type="submit" className="tr-btn tr-btn--danger">
              Drop
            </button>
            <button type="button" className="tr-btn" onClick={() => setMode('idle')}>
              Cancel
            </button>
          </form>
        ) : mode === 'editing' ? (
          <form
            className="tr-inline-form tr-inline-form--column"
            onSubmit={(event) => {
              event.preventDefault()
              editAndPost()
            }}
          >
            <textarea
              className="tr-textarea"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              aria-label="Comment to post"
              rows={6}
              autoFocus
            />
            <div className="tr-actions">
              <button
                type="submit"
                className="tr-btn tr-btn--primary"
                disabled={!comment.trim()}
              >
                Post
              </button>
              <button type="button" className="tr-btn" onClick={() => setMode('idle')}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="tr-actions">
              {theirs && can('post') && (
                <>
                  <button
                    type="button"
                    className="tr-btn tr-btn--primary"
                    onClick={postAsWritten}
                  >
                    Post as written
                  </button>
                  <button
                    type="button"
                    className="tr-btn"
                    onClick={() => setMode('editing')}
                  >
                    Edit &amp; post
                  </button>
                </>
              )}
              {can('fix') && (
                <button
                  type="button"
                  className={`tr-btn ${theirs ? '' : 'tr-btn--primary'}`}
                  onClick={fix}
                >
                  Fix now
                </button>
              )}
              {can('drop') && (
                <button
                  type="button"
                  className="tr-btn tr-btn--danger"
                  onClick={() => setMode('dropping')}
                >
                  Drop
                </button>
              )}
              {can('skip') && (
                <button
                  type="button"
                  className="tr-btn"
                  onClick={() => decide({ action: 'skip' })}
                >
                  Skip
                </button>
              )}
            </div>
            {can('fix') && (
              <div className="tr-context">
                <button
                  type="button"
                  className="tr-btn tr-btn--link"
                  aria-expanded={showContext}
                  onClick={() => setShowContext((shown) => !shown)}
                >
                  {showContext ? 'Hide context' : 'Add context for the fix'}
                </button>
                {showContext && (
                  <textarea
                    className="tr-textarea"
                    value={context}
                    onChange={(event) => setContext(event.target.value)}
                    placeholder="What the agent should know before it fixes this"
                    aria-label="Context for the fix"
                    rows={3}
                  />
                )}
              </div>
            )}
          </>
        )}
      </section>

      <RunPanel id={finding.id} record={record} steps={steps} disabled={disabled} />
    </article>
  )
}
