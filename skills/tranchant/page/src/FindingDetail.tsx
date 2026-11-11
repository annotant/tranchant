import { type FormEvent, useState } from 'react'
import { Diagram } from './Diagram'
import { Discussion, type Taken } from './Discussion'
import {
  allows,
  changeName,
  draftComment,
  draftReply,
  BUCKET_LABELS,
  type DecisionInput,
  changeable,
  discussable,
  type Discussion as Thread,
  draftIssue,
  type Finding,
  type FindingRecord,
  postsFrom,
  replyPending,
  repliesAside,
  replyTaken,
  repliesOn,
  staleMrReason,
  type Review,
  STATE_DETAILS,
  stateClass,
  stateLabel,
  type Step,
  stateOf,
  tagOf,
  type Thread as ReviewThread,
  type ThreadItem,
  threadItems,
  threadResolved,
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
  /** Resolves to whether the server took the message; `change`: a change to the code it asks for. */
  onDiscuss: (id: string, text: string, change?: boolean) => Promise<boolean>
}

type Mode = 'idle' | 'editing' | 'dropping' | 'issuing'

const when = (at: string) => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString()
}

/** The PR/MR thread the finding comes from: its comments, data to read, and the replies sent from here. */
function ThreadView({
  thread,
  change,
  items,
  resolved,
}: {
  thread: ReviewThread
  change: string
  items: ThreadItem[]
  resolved: boolean
}) {
  return (
    <section className="tr-section tr-thread" aria-label="Review thread">
      <p
        className={
          resolved ? 'tr-thread-head tr-thread-head--resolved' : 'tr-thread-head tr-muted'
        }
      >
        {resolved ? 'Resolved' : 'Unresolved'} on the {change}:{' '}
        <a href={thread.url} target="_blank" rel="noreferrer">
          open the thread
        </a>
      </p>
      <ol className="tr-thread-comments">
        {items.map((item, index) => (
          <li
            key={item.url ?? `${index} ${item.author} ${item.at ?? ''}`}
            className={[
              'tr-thread-comment',
              item.mine && 'tr-thread-comment--mine',
              item.sent === 'sending' && 'tr-thread-comment--sending',
              item.sent === 'failed' && 'tr-thread-comment--failed',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <p className="tr-thread-meta">
              <strong>@{item.author}</strong>
              {item.mine && <span className="tr-chip tr-chip--you">you</span>}
              {item.at &&
                (item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {when(item.at)}
                  </a>
                ) : (
                  <span className="tr-muted">{when(item.at)}</span>
                ))}
            </p>
            {item.body.trim() ? (
              <Markdown source={item.body} headings={false} />
            ) : (
              <p className="tr-muted">No text.</p>
            )}
            {item.sent === 'sending' && (
              <p className="tr-thread-foot tr-muted" role="status">
                <span className="tr-spinner" aria-hidden="true" />
                Replying on the thread…
              </p>
            )}
            {item.sent === 'sent' && (
              <p className="tr-thread-foot tr-muted">
                Sent from Tranchant{item.resolved ? ' · thread resolved' : ''}
              </p>
            )}
            {item.sent === 'failed' && (
              <p className="tr-thread-foot tr-error">Did not post: {item.failed}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

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
  bare = false,
  onAnswer,
}: {
  record: FindingRecord
  disabled: boolean
  /** Under the question in the discussion: the question is not said again. */
  bare?: boolean
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
      {!bare && <p className="tr-ask-text">{question.text}</p>}
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
  const reply = repliesOn(finding)
  const [comment, setComment] = useState(() =>
    reply ? draftReply(record) : draftComment(finding, record),
  )
  const [resolve, setResolve] = useState(false)
  const [reason, setReason] = useState('')
  const [issue, setIssue] = useState<{ title: string; body: string }>()
  const noTracker = tracker?.kind === null
  // Undefined: shown when the finding has a thread; the Discuss button opens or folds it.
  const [folded, setFolded] = useState<boolean>()
  // The `at` of the agent's answer whose proposed reply the editor opened with.
  const [replyFrom, setReplyFrom] = useState<string>()

  // The tool is opening it, or posting it: nothing else is offered until it lands or fails.
  const opening = state === 'queued' && record?.decision?.action === 'issue'
  const posting = state === 'queued' && record?.decision?.action === 'post'
  const can = (move: Parameters<typeof allows>[0]) =>
    !disabled && !opening && !posting && allows(move, state, review, finding)
  const theirs = review.ownership === 'theirs'
  // Ours with an MR: fixing comes first, posting is the secondary choice.
  const oursWithMr = !theirs && !reply && !!review.mr?.diffRefs
  // A reply on a thread is positioned nowhere: the diff refs do not hold it back.
  const blocker = reply ? undefined : staleMrReason(review)
  const blocked = !!blocker && !disabled && postsFrom(state)
  const change = changeName(review)
  const replying = replyPending(record)
  // A thread is replied on aside from the moves too: once settled, or beside a fix under way.
  const canReply =
    reply &&
    !replying &&
    (can('post') || (!disabled && !!review.mr && repliesAside(record)))
  const thread = finding.thread
  const tag = tagOf(finding)
  const writable = discussable(state, finding)
  // A change asked in the discussion: its run, its question and its result show there.
  const changing =
    !!record?.decision?.change && ['queued', 'working', 'asking'].includes(state)
  // Its question shows in the thread once it landed there; until then, in the outcome.
  const askedInThread =
    changing && state === 'asking' && discussion?.messages.at(-1)?.outcome === 'asking'
  const hasThread = !!discussion?.messages.length
  const threadShown = folded === undefined ? hasThread : !folded
  const answer = discussion?.messages.findLast((one) => one.by === 'agent')
  const proposal = answer?.proposal
  const proposedReply =
    thread && answer && proposal?.comment
      ? { at: answer.at, text: proposal.comment }
      : undefined
  const replied =
    !!thread &&
    !!proposedReply &&
    replyTaken(thread, record, review.mr?.viewer, proposedReply)
  const taken: Taken[] = []
  if (
    state !== 'open' &&
    record?.decision?.action === 'fix' &&
    !!proposal?.fix &&
    record.decision.context === proposal.fix
  )
    taken.push('fix')
  if (state === 'dropped' && !!proposal?.drop && record?.reason === proposal.drop)
    taken.push('drop')
  if (replied) taken.push('reply')
  const editingProposal = mode === 'editing' && !!replyFrom && replyFrom === answer?.at
  const closed = writable
    ? undefined
    : posting
      ? 'The comment is on its way: the thread reads as it stands.'
      : changing
        ? state === 'asking'
          ? 'Answer the question above: the change goes on with it.'
          : 'An agent is making the change: Stop ends it.'
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
  const editAndPost = () => {
    decide(
      reply
        ? {
            action: 'post',
            comment: comment.trim(),
            ...(resolve && { resolve: true }),
            ...(replyFrom && { proposal: replyFrom }),
          }
        : comment.trim() && comment.trim() !== finding.comment
          ? { action: 'post', comment: comment.trim() }
          : { action: 'post' },
    )
    // The page stays on the finding: the next reply starts afresh, a failed one comes back.
    if (reply) {
      setComment('')
      setResolve(false)
      setReplyFrom(undefined)
    }
  }
  /** The agent's proposed reply, in the editor for the reviewer to read, change and send. */
  const replyWith = (proposed: string) => {
    setReplyFrom(answer?.at)
    setComment(proposed)
    setResolve(false)
    setMode('editing')
  }
  const startReply = () => {
    // Opened by hand, the reply is the reviewer's own, whatever the editor still holds.
    setReplyFrom(undefined)
    // After a fix, the empty editor opens with what changed.
    setComment((text) => (text.trim() ? text : draftReply(record)))
    setMode('editing')
  }
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
        {thread && (thread.outdated || thread.file) && (
          <p className="tr-muted" role="note">
            {thread.file
              ? 'On the whole file.'
              : 'Outdated: the code the comment was on moved since; its excerpt is the code it read.'}
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

      {thread ? (
        <ThreadView
          thread={thread}
          change={change}
          items={threadItems(thread, record, review.mr?.viewer)}
          resolved={threadResolved(record)}
        />
      ) : (
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
      )}

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
        {/* A reply on a thread shows in the thread itself: sent, on its way or failed. */}
        {state === 'posted' && !reply && record?.posted && (
          <p className="tr-outcome">
            Posted:{' '}
            <a href={record.posted.url} target="_blank" rel="noreferrer">
              {record.posted.url}
            </a>
          </p>
        )}
        {record?.posted?.unresolved && (state === 'posted' || reply) && (
          <p className="tr-outcome tr-error">
            The thread is not resolved: {record.posted.unresolved}
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
        {state === 'failed' && !(reply && record?.decision?.action === 'post') && (
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
        {state === 'asking' && record && !askedInThread && (
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
        ) : posting ? (
          // A reply shows on its way in the thread itself.
          !reply && (
            <p className="tr-outcome tr-pending" role="status">
              <span className="tr-spinner" aria-hidden="true" />
              Posting on the {change}…
            </p>
          )
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
              aria-label={reply ? 'Reply on the thread' : 'Comment to post'}
              placeholder={reply ? `Your reply on the ${change}'s thread` : undefined}
              rows={6}
              autoFocus
            />
            {reply && (
              <label className="tr-option">
                <input
                  type="checkbox"
                  checked={resolve}
                  onChange={(event) => setResolve(event.target.checked)}
                />
                <span>Resolve the thread once replied</span>
              </label>
            )}
            <div className="tr-actions">
              <button
                type="submit"
                className="tr-btn tr-btn--primary"
                disabled={!comment.trim()}
              >
                {reply ? 'Reply' : 'Post'}
              </button>
              <button
                type="button"
                className="tr-btn"
                onClick={() => {
                  setReplyFrom(undefined)
                  setMode('idle')
                }}
              >
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
              {canReply && (
                <button
                  type="button"
                  className={`tr-btn ${state === 'fixed' ? 'tr-btn--primary' : ''}`}
                  title={`Write a reply on the ${change}'s thread, and resolve it if you like`}
                  onClick={startReply}
                >
                  Reply on the thread
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
          id={finding.id}
          discussion={discussion}
          writable={writable}
          closed={closed}
          taken={taken}
          disabled={disabled}
          canFix={can('fix')}
          canPost={(reply ? canReply : can('post')) && !replied && !editingProposal}
          canDrop={can('drop')}
          replyOn={reply}
          replyAside={reply && repliesAside(record)}
          canChange={!disabled && changeable(state, finding)}
          steps={steps}
          underway={changing && state !== 'asking'}
          canStop={can('stop')}
          asking={
            askedInThread &&
            record && (
              <AskForm
                key={record.question?.at}
                record={record}
                disabled={disabled}
                bare
                onAnswer={(text, choices) => onAnswer(finding.id, text, choices)}
              />
            )
          }
          onSend={(text, asksChange) =>
            asksChange ? onDiscuss(finding.id, text, true) : onDiscuss(finding.id, text)
          }
          onStop={() => onStop(finding.id)}
          onFix={(proposed) => decide({ action: 'fix', context: proposed })}
          onPost={(proposed) =>
            reply ? replyWith(proposed) : decide({ action: 'post', comment: proposed })
          }
          onDrop={(proposed) => decide({ action: 'drop', reason: proposed })}
        />
      )}

      <RunPanel id={finding.id} record={record} steps={steps} disabled={disabled} />
    </article>
  )
}
