import { type FormEvent, useState } from 'react'
import { Diagram } from './Diagram'
import { Discussion, type Taken } from './Discussion'
import {
  allows,
  draftComment,
  BUCKET_LABELS,
  type DecisionInput,
  discussable,
  type Discussion as Thread,
  draftIssue,
  type Finding,
  type FindingRecord,
  postsFrom,
  staleMrReason,
  type Review,
  STATE_DETAILS,
  stateClass,
  stateLabel,
  type Step,
  stateOf,
  tagOf,
  type Tracker,
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
  /** Its discussion with an agent, if any. */
  discussion?: Thread | undefined
  /** No verifier confirmed it yet. */
  unverified?: boolean
  disabled: boolean
  /** Where issues go: undefined until known, `kind` null when nowhere. */
  tracker?: Tracker | undefined
  onDecide: (decisions: DecisionInput[]) => void
  onAnswer: (id: string, text: string, choices: string[]) => void
  onStop: (id: string) => void
  /** Resolves to whether the server took the message. */
  onDiscuss: (id: string, text: string) => Promise<boolean>
}

type Mode = 'idle' | 'editing' | 'dropping' | 'issuing'

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
  discussion,
  unverified = false,
  disabled,
  tracker,
  onDecide,
  onAnswer,
  onStop,
  onDiscuss,
}: Props) {
  const state = stateOf(
    { [finding.id]: record ?? { state: 'open', runs: [], events: [] } },
    finding.id,
  )
  // Mounted per finding (keyed by the parent): the drafts start afresh with it.
  const [mode, setMode] = useState<Mode>('idle')
  const [showContext, setShowContext] = useState(false)
  const [context, setContext] = useState('')
  const [comment, setComment] = useState(() => draftComment(finding, record))
  const [reason, setReason] = useState('')
  const [issue, setIssue] = useState<{ title: string; body: string }>()
  const noTracker = tracker?.kind === null
  // Undefined: shown when the finding has a thread; the Discuss button opens or folds it.
  const [folded, setFolded] = useState<boolean>()

  // The tool is opening it: nothing else is offered until it lands or fails.
  const opening = state === 'queued' && record?.decision?.action === 'issue'
  const can = (move: Parameters<typeof allows>[0]) =>
    !disabled && !opening && allows(move, state, review)
  const theirs = review.ownership === 'theirs'
  // Ours with an MR: fixing comes first, posting is the secondary choice.
  const oursWithMr = !theirs && !!review.mr?.diffRefs
  const blocker = staleMrReason(review)
  const blocked = !!blocker && !disabled && postsFrom(state)
  const tag = tagOf(finding)
  const writable = discussable(state)
  const hasThread = !!discussion?.messages.length
  const threadShown = folded === undefined ? hasThread : !folded
  const proposal = discussion?.messages.findLast((one) => one.by === 'agent')?.proposal
  const taken: Taken | undefined =
    state !== 'open' &&
    record?.decision?.action === 'fix' &&
    !!proposal?.fix &&
    record.decision.context === proposal.fix
      ? 'fix'
      : state === 'dropped' && !!proposal?.drop && record?.reason === proposal.drop
        ? 'drop'
        : undefined
  const closed = writable
    ? undefined
    : ['queued', 'working', 'asking'].includes(state)
      ? 'An agent is on the finding: the thread reads as it stands.'
      : 'The finding is settled: the thread reads as it stands.'
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
  const startIssue = () => {
    // Drafted when opened, not when mounted: the tracker may have answered since.
    // A failed attempt's issue comes back as the reviewer wrote it.
    const last = record?.decision?.action === 'issue' ? record.issue : undefined
    setIssue(
      (draft) =>
        draft ??
        (last
          ? { title: last.title, body: last.body }
          : draftIssue(finding, review, tracker)),
    )
    setMode('issuing')
  }
  const openIssue = () => {
    if (!issue?.title.trim() || !issue.body.trim()) return
    decide({ action: 'issue', title: issue.title.trim(), body: issue.body.trim() })
  }
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
          <span className={stateClass(state)} title={STATE_DETAILS[state]}>
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
        {state === 'moved' && record?.issue?.url && (
          <p className="tr-outcome">
            Moved to an issue:{' '}
            <a href={record.issue.url} target="_blank" rel="noreferrer">
              {record.issue.ref ? `${record.issue.ref} · ` : ''}
              {record.issue.url}
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
        {opening ? (
          <p className="tr-outcome tr-pending" role="status">
            <span className="tr-spinner" aria-hidden="true" />
            Opening the issue{tracker?.kind ? ` on ${tracker.web}` : ''}…
          </p>
        ) : (
          can('stop') && (
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
          )
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
        ) : mode === 'issuing' && issue ? (
          <form
            className="tr-inline-form tr-inline-form--column"
            aria-label="Open an issue"
            onSubmit={(event) => {
              event.preventDefault()
              openIssue()
            }}
          >
            <input
              className="tr-input"
              value={issue.title}
              onChange={(event) => setIssue({ ...issue, title: event.target.value })}
              aria-label="Issue title"
              placeholder="The issue's title, one line"
              autoFocus
            />
            <textarea
              className="tr-textarea"
              value={issue.body}
              onChange={(event) => setIssue({ ...issue, body: event.target.value })}
              aria-label="Issue body"
              placeholder="What the issue says: the problem, why it matters, the fix"
              rows={12}
            />
            <div className="tr-actions">
              <button
                type="submit"
                className="tr-btn tr-btn--primary"
                disabled={!issue.title.trim() || !issue.body.trim()}
              >
                Open the issue
              </button>
              <button type="button" className="tr-btn" onClick={() => setMode('idle')}>
                Cancel
              </button>
              {tracker?.kind && <span className="tr-muted">on {tracker.web}</span>}
            </div>
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
              {oursWithMr && (can('post') || blocked) && (
                <button
                  type="button"
                  className="tr-btn"
                  disabled={blocked}
                  title={blocked ? blocker : undefined}
                  onClick={() => setMode('editing')}
                >
                  Post a comment
                </button>
              )}
              {can('issue') && (
                <button
                  type="button"
                  className="tr-btn"
                  disabled={noTracker}
                  title={
                    tracker?.kind === null
                      ? `No issue tracker: ${tracker.reason}`
                      : 'Settle it later: open an issue on the project, prefilled from the finding'
                  }
                  onClick={startIssue}
                >
                  Open an issue
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
              {((writable && !disabled) || hasThread) && (
                <button
                  type="button"
                  className={`tr-btn ${threadShown ? 'tr-btn--on' : ''}`}
                  aria-pressed={threadShown}
                  title="Ask an agent about this finding before you decide"
                  onClick={() => setFolded(threadShown)}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
                  </svg>
                  Discuss
                </button>
              )}
            </div>
            {blocked && (
              <p className="tr-muted" role="note">
                Posting is off: {blocker}.
              </p>
            )}
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

      {threadShown && (
        <Discussion
          discussion={discussion}
          writable={writable}
          closed={closed}
          taken={taken}
          disabled={disabled}
          canFix={can('fix')}
          canPost={can('post')}
          canDrop={can('drop')}
          onSend={(text) => onDiscuss(finding.id, text)}
          onFix={(proposed) => decide({ action: 'fix', context: proposed })}
          onPost={(proposed) => decide({ action: 'post', comment: proposed })}
          onDrop={(proposed) => decide({ action: 'drop', reason: proposed })}
        />
      )}

      <RunPanel id={finding.id} record={record} steps={steps} disabled={disabled} />
    </article>
  )
}
