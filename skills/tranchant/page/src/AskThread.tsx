import { type FormEvent, useState } from 'react'
import { Discussion } from './Discussion'
import {
  BUCKET_LABELS,
  type Bucket,
  endLineOf,
  MAX_ASK_LINES,
  MAX_ASK_TEXT,
  MAX_TITLE,
  type Message,
  type ProposedFinding,
  type LineQuestion,
  type Tag,
  TOPICS,
} from './domain'
import { CodeBlock, type Row } from './Excerpt'
import { Markdown } from './markdown'
import type { Language } from './syntax'

const TAGS: readonly Tag[] = ['concern', 'question', 'suggestion']
const BUCKETS: readonly Bucket[] = ['review', 'auto']

const OFFLINE = 'Offline: Tranchant stopped serving this review, ask once it is back.'

/** `Line 12` or `Lines 12–14`. */
export const linesWords = (from: number, to: number) =>
  from === to ? `Line ${from}` : `Lines ${from}–${to}`

const noop = () => undefined

/** The finding as the reviewer edits it before adding it. */
function FindingForm({
  proposal,
  theirs,
  disabled,
  onAdd,
  onCancel,
}: {
  proposal: ProposedFinding
  theirs: boolean
  disabled: boolean
  onAdd: (finding: ProposedFinding) => Promise<void>
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(proposal)
  const set = <K extends keyof ProposedFinding>(key: K, value: ProposedFinding[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const required = [draft.title, draft.problem, draft.why, draft.fix]
  const complete =
    required.every((text) => text.trim()) && (!theirs || !!draft.comment?.trim())
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!complete || disabled) return
    const { comment, tag, ...rest } = draft
    void onAdd({
      ...rest,
      title: rest.title.trim(),
      problem: rest.problem.trim(),
      why: rest.why.trim(),
      fix: rest.fix.trim(),
      ...(tag && { tag }),
      ...(comment?.trim() && { comment: comment.trim() }),
    })
  }
  const area = (key: 'problem' | 'why' | 'fix' | 'comment', label: string) => (
    <label className="tr-qa-field">
      <span>{label}</span>
      <textarea
        className="tr-textarea"
        rows={3}
        maxLength={MAX_ASK_TEXT}
        value={draft[key] ?? ''}
        onChange={(event) => set(key, event.target.value)}
      />
    </label>
  )
  return (
    <form
      className="tr-proposal tr-proposal--editing tr-qa-form"
      aria-label="The finding to add"
      onSubmit={submit}
    >
      <div className="tr-proposal-foot">
        <strong>Finding, from the agent's proposal</strong>
        <span>Edit it before adding it</span>
      </div>
      <label className="tr-qa-field">
        <span>Title</span>
        <input
          className="tr-input"
          maxLength={MAX_TITLE}
          value={draft.title}
          onChange={(event) => set('title', event.target.value)}
          autoFocus
        />
      </label>
      <div className="tr-qa-row">
        <label className="tr-qa-field">
          <span>Topic</span>
          <select
            className="tr-input"
            value={draft.topic}
            onChange={(event) => set('topic', event.target.value)}
          >
            {TOPICS.map((topic) => (
              <option key={topic}>{topic}</option>
            ))}
          </select>
        </label>
        <label className="tr-qa-field">
          <span>Bucket</span>
          <select
            className="tr-input"
            value={draft.bucket}
            onChange={(event) =>
              set('bucket', BUCKETS.find((one) => one === event.target.value) ?? 'review')
            }
          >
            {BUCKETS.map((bucket) => (
              <option key={bucket} value={bucket}>
                {BUCKET_LABELS[bucket]}
              </option>
            ))}
          </select>
        </label>
        <label className="tr-qa-field">
          <span>Tag</span>
          <select
            className="tr-input"
            value={draft.tag ?? 'concern'}
            onChange={(event) =>
              set('tag', TAGS.find((one) => one === event.target.value) ?? 'concern')
            }
          >
            {TAGS.map((tag) => (
              <option key={tag}>{tag}</option>
            ))}
          </select>
        </label>
      </div>
      {area('problem', 'Problem')}
      {area('why', 'Why it matters')}
      {area('fix', 'Fix')}
      {area('comment', theirs ? 'Comment to post' : 'Comment to post (optional)')}
      <div className="tr-actions">
        <button
          type="submit"
          className="tr-btn tr-btn--primary tr-btn--small"
          disabled={disabled || !complete}
        >
          Add
        </button>
        <button type="button" className="tr-btn tr-btn--small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** The finding the agent proposes, under its answer: added on a click, never without. */
function ProposedCard({
  message,
  theirs,
  disabled,
  onAdd,
  onDecline,
}: {
  message: Message
  theirs: boolean
  disabled: boolean
  onAdd: (finding: ProposedFinding) => Promise<boolean>
  onDecline: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const proposal = message.proposal?.finding
  if (!proposal) return null
  if (message.declined)
    return (
      <div className="tr-taken">
        <span>You did not add the finding it proposed.</span>
      </div>
    )
  if (editing)
    return (
      <FindingForm
        proposal={proposal}
        theirs={theirs}
        disabled={disabled || adding}
        onCancel={() => setEditing(false)}
        onAdd={async (finding) => {
          setAdding(true)
          const added = await onAdd(finding)
          setAdding(false)
          if (added) setEditing(false)
        }}
      />
    )
  return (
    <div className="tr-proposals" aria-label="The finding the agent proposes">
      <div className="tr-proposal tr-qa-proposal">
        <div className="tr-proposal-text">
          <strong>Proposed finding: {proposal.title}</strong>
          <div className="tr-qa-chips">
            <span className={`tr-chip tr-chip--bucket-${proposal.bucket}`}>
              {BUCKET_LABELS[proposal.bucket]}
            </span>
            <span className="tr-chip">{proposal.topic}</span>
            {proposal.tag && proposal.tag !== 'concern' && (
              <span className={`tr-chip tr-chip--tag-${proposal.tag}`}>
                {proposal.tag}
              </span>
            )}
            <span className="tr-muted">line {proposal.line}</span>
          </div>
          <dl className="tr-pwf tr-proposal-body">
            <dt>Problem</dt>
            <dd>
              <Markdown source={proposal.problem} headings={false} />
            </dd>
            <dt>Why</dt>
            <dd>
              <Markdown source={proposal.why} headings={false} />
            </dd>
            <dt>Fix</dt>
            <dd>
              <Markdown source={proposal.fix} headings={false} />
            </dd>
            {proposal.comment && (
              <>
                <dt>Comment</dt>
                <dd className="tr-clamp">{proposal.comment}</dd>
              </>
            )}
          </dl>
          <div className="tr-actions">
            <button
              type="button"
              className="tr-btn tr-btn--primary tr-btn--small"
              disabled={disabled}
              onClick={() => setEditing(true)}
            >
              Add as a finding
            </button>
            <button
              type="button"
              className="tr-btn tr-btn--small"
              disabled={disabled}
              onClick={onDecline}
            >
              No, thanks
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The question's lines, quoted at the top of its thread. */
function Quote({
  question,
  language,
}: {
  question: LineQuestion
  language: Language | undefined
}) {
  const { anchor } = question
  const rows: Row[] = anchor.lines.map((text, at) => ({
    kind: 'context',
    number: anchor.startLine + at,
    text,
  }))
  return (
    <CodeBlock
      rows={rows}
      signed={false}
      label={`${anchor.path}, ${linesWords(anchor.startLine, endLineOf(anchor)).toLowerCase()}`}
      language={language}
    />
  )
}

export interface AskHandlers {
  /** A new question on lines `from` to `to` of `path`: resolves to whether the server took it. */
  onAsk: (path: string, from: number, to: number, text: string) => Promise<boolean>
  onFollowUp: (id: string, text: string) => Promise<boolean>
  onAdd: (id: string, at: string, finding: ProposedFinding) => Promise<boolean>
  onDecline: (id: string, at: string) => void
}

/**
 * A question on lines of the diff: the lines, then the thread as a finding's
 * discussion reads, and the finding the last answer proposes.
 */
export function AskThread({
  id,
  question,
  theirs,
  offline,
  language,
  note,
  handlers,
}: {
  id: string
  question: LineQuestion
  theirs: boolean
  offline: boolean
  language: Language | undefined
  /** Why it sits on its file's header rather than under its lines. */
  note?: string | undefined
  handlers: AskHandlers
}) {
  const last = question.messages.at(-1)
  return (
    <div className="tr-qa" id={`tr-question-${id}`}>
      {note && <p className="tr-marker-note">{note}</p>}
      <Quote question={question} language={language} />
      <Discussion
        id={id}
        title="Ask Tranchant"
        discussion={question}
        writable={!question.finding}
        disabled={offline}
        canFix={false}
        canPost={false}
        canDrop={false}
        onSend={(text) => handlers.onFollowUp(id, text)}
        onFix={noop}
        onPost={noop}
        onDrop={noop}
        below={
          last?.by === 'agent' &&
          !question.finding && (
            <ProposedCard
              key={last.at}
              message={last}
              theirs={theirs}
              disabled={offline}
              onAdd={(finding) => handlers.onAdd(id, last.at, finding)}
              onDecline={() => handlers.onDecline(id, last.at)}
            />
          )
        }
      />
    </div>
  )
}

/** The lines the reviewer picked in one file: `anchor` the one a shift-click extends from. */
export interface LinePick {
  path: string
  anchor: number
  from: number
  to: number
}

/**
 * Under the last line picked: Ask Tranchant, which opens the question's box;
 * offline, disabled with the reason.
 */
export function AskBar({
  pick,
  offline,
  onAsk,
  onClear,
}: {
  pick: LinePick
  offline: boolean
  onAsk: (text: string) => Promise<boolean>
  onClear: () => void
}) {
  const [composing, setComposing] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const count = pick.to - pick.from + 1
  const tooMany = count > MAX_ASK_LINES
  const reason = offline
    ? OFFLINE
    : tooMany
      ? `${MAX_ASK_LINES} lines at most: pick fewer.`
      : undefined
  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (reason || sending || !text.trim()) return
    setSending(true)
    const sent = await onAsk(text.trim())
    setSending(false)
    if (sent) {
      setText('')
      setComposing(false)
    }
  }
  return (
    <div
      className="tr-qa-bar"
      role="group"
      aria-label={`${linesWords(pick.from, pick.to)} selected`}
    >
      <div className="tr-qa-bar-line">
        <span className="tr-qa-bar-what">{linesWords(pick.from, pick.to)}</span>
        {!composing && (
          <button
            type="button"
            className="tr-btn tr-btn--primary tr-btn--small"
            disabled={!!reason}
            title={reason}
            onClick={() => setComposing(true)}
          >
            Ask Tranchant
          </button>
        )}
        <button type="button" className="tr-btn tr-btn--link" onClick={onClear}>
          Clear
        </button>
        {reason && <span className="tr-gap-reason">{reason}</span>}
      </div>
      {composing && (
        <form className="tr-inline-form tr-inline-form--column" onSubmit={send}>
          <textarea
            className="tr-textarea"
            rows={3}
            maxLength={MAX_ASK_TEXT}
            value={text}
            placeholder="Can this be null? Is this lock released on error?"
            aria-label="Your question about these lines"
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key !== 'Enter' || event.shiftKey) return
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
          />
          <div className="tr-actions">
            <button
              type="submit"
              className="tr-btn tr-btn--primary tr-btn--small"
              disabled={!!reason || sending || !text.trim()}
            >
              Send
            </button>
            <button
              type="button"
              className="tr-btn tr-btn--small"
              onClick={() => setComposing(false)}
            >
              Cancel
            </button>
            <span className="tr-muted">
              A read-only agent reads the code and answers; it changes nothing.
            </span>
          </div>
        </form>
      )}
    </div>
  )
}
