import { type FormEvent, useState } from 'react'
import { type Discussion as Thread, isWaiting, type Message } from './domain'
import { Markdown } from './markdown'

interface Props {
  discussion: Thread | undefined
  /** The reviewer may write, and carry a proposal over: else the thread reads as it stands. */
  writable: boolean
  disabled: boolean
  canFix: boolean
  canPost: boolean
  canDrop: boolean
  /** Resolves to whether the server took the message: the draft stays until it does. */
  onSend: (text: string) => Promise<boolean>
  onFix: (context: string) => void
  onPost: (comment: string) => void
  onDrop: (reason: string) => void
}

function Proposals({
  message,
  disabled,
  canFix,
  canPost,
  canDrop,
  onFix,
  onPost,
  onDrop,
}: Pick<
  Props,
  'disabled' | 'canFix' | 'canPost' | 'canDrop' | 'onFix' | 'onPost' | 'onDrop'
> & {
  message: Message
}) {
  const { fix, comment, drop } = message.proposal ?? {}
  const shown = [fix && canFix, comment && canPost, drop && canDrop].some(Boolean)
  if (!shown) return null
  return (
    <div className="tr-proposals" aria-label="What the agent proposes">
      {fix && canFix && (
        <div className="tr-proposal">
          <span className="tr-proposal-label">Fix</span>
          <Markdown source={fix} headings={false} />
          <button
            type="button"
            className="tr-btn tr-btn--primary"
            disabled={disabled}
            onClick={() => onFix(fix)}
          >
            Fix with this
          </button>
        </div>
      )}
      {comment && canPost && (
        <div className="tr-proposal">
          <span className="tr-proposal-label">Comment</span>
          <p className="tr-message-text">{comment}</p>
          <button
            type="button"
            className="tr-btn"
            disabled={disabled}
            onClick={() => onPost(comment)}
          >
            Post this
          </button>
        </div>
      )}
      {drop && canDrop && (
        <div className="tr-proposal">
          <span className="tr-proposal-label">Drop</span>
          <p className="tr-message-text">{drop}</p>
          <button
            type="button"
            className="tr-btn tr-btn--danger"
            disabled={disabled}
            onClick={() => onDrop(drop)}
          >
            Drop with this reason
          </button>
        </div>
      )}
    </div>
  )
}

/** A finding's discussion with an agent: the reviewer asks, a read-only agent answers. */
export function Discussion(props: Props) {
  const { discussion, writable, disabled, onSend } = props
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const messages = discussion?.messages ?? []
  const waiting = isWaiting(discussion)
  const last = messages.at(-1)
  const canSend = writable && !disabled && !waiting && !sending && text.trim().length > 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSend) return
    setSending(true)
    const sent = await onSend(text.trim())
    setSending(false)
    if (sent) setText('')
  }

  return (
    <section className="tr-section tr-discussion" aria-label="Discussion">
      <h3 className="tr-discussion-title">Discussion</h3>
      {messages.length > 0 && (
        <ol className="tr-messages">
          {messages.map((message) => (
            <li
              key={`${message.by}-${message.at}`}
              className={`tr-message tr-message--${message.by}`}
            >
              <span className="tr-message-by">
                {message.by === 'reviewer' ? 'You' : 'Agent'}
              </span>
              {message.by === 'agent' && !message.failed ? (
                <Markdown source={message.text} headings={false} />
              ) : (
                <p className={`tr-message-text${message.failed ? ' tr-error' : ''}`}>
                  {message.text}
                </p>
              )}
              {writable && message === last && message.by === 'agent' && (
                <Proposals message={message} {...props} />
              )}
            </li>
          ))}
        </ol>
      )}
      {waiting && (
        <p className="tr-muted" role="status">
          The agent is answering…{discussion?.activity ? ` ${discussion.activity}` : ''}
        </p>
      )}
      {writable ? (
        !waiting && (
          <form
            className="tr-inline-form tr-inline-form--column"
            onSubmit={(event) => void submit(event)}
          >
            <textarea
              className="tr-textarea"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                messages.length
                  ? 'Ask a follow-up…'
                  : 'Ask about this finding: is it reachable, what about another fix…'
              }
              aria-label="Your message to the agent"
              rows={3}
              autoFocus={!messages.length}
            />
            <div className="tr-actions">
              <button
                type="submit"
                className="tr-btn tr-btn--primary"
                disabled={!canSend}
              >
                Send
              </button>
              <span className="tr-muted">
                The agent reads the code, never changes it; the finding stays as it is.
              </span>
            </div>
          </form>
        )
      ) : (
        <p className="tr-muted">
          Read-only: the finding is settled or an agent is on it.
        </p>
      )}
    </section>
  )
}
