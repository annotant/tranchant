import { type FormEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { activityOf } from './activity'
import {
  type Discussion as Thread,
  isWaiting,
  type Message,
  type Step,
  waitsForChange,
} from './domain'
import { FixChanges } from './FixChanges'
import { Markdown } from './markdown'

/** What the reviewer did with the agent's last proposal, said under it once taken. */
export type Taken = 'fix' | 'drop' | 'reply'

interface Props {
  /** The finding's: what its changes are read by. */
  id: string
  discussion: Thread | undefined
  /** The reviewer may write, and carry a proposal over: else the thread reads as it stands. */
  writable: boolean
  /** Why it reads as it stands, when it does. */
  closed?: string | undefined
  taken?: Taken[] | undefined
  disabled: boolean
  canFix: boolean
  canPost: boolean
  canDrop: boolean
  /** A PR/MR thread's finding: the proposed comment is a reply, opened in its editor. */
  replyOn?: boolean
  /** Read as it stands while its fix runs, the thread still takes the agent's reply. */
  replyAside?: boolean
  /** The reviewer may ask for a change to the code: an agent makes it in the working tree. */
  canChange?: boolean
  /** The steps of the run making the change asked for, the last one shown live. */
  steps?: readonly Step[]
  /** A change asked for is under way: queued or its agent at work. */
  underway?: boolean
  /** The change under way may be stopped. */
  canStop?: boolean
  /** The form answering the question the change's agent asked, shown under it. */
  asking?: ReactNode
  /** Resolves to whether the server took the message: the draft stays until it does. */
  onSend: (text: string, change?: boolean) => Promise<boolean>
  onStop?: () => void
  onFix: (context: string) => void
  onPost: (comment: string) => void
  onDrop: (reason: string) => void
}

const SUGGESTIONS = [
  'Is this really reachable?',
  'Is there a better fix?',
  'Draft the comment to post',
]
const THREAD_SUGGESTIONS = [
  'Is the comment right?',
  'What would the fix take?',
  'Draft my reply',
]

const TAKEN_WORDS: Record<Taken, string> = {
  fix: "You sent it to fix with the agent's proposal",
  drop: "You dropped it with the agent's reason",
  reply: "You replied with the agent's proposal",
}

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const BUBBLE = <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
const WRENCH = (
  <>
    <path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3.4-3.4 8-8-1.3-1.3a4 4 0 0 0-5-5Z" />
    <path d="m3 21 6.6-6.6" />
  </>
)

/** The comment the agent proposes, rewritten in place before it is posted. */
function CommentEditor({
  comment,
  disabled,
  onPost,
  onCancel,
}: {
  comment: string
  disabled: boolean
  onPost: (comment: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(comment)
  return (
    <form
      className="tr-proposal tr-proposal--editing"
      aria-label="Comment to post"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim()) onPost(text.trim())
      }}
    >
      <div className="tr-proposal-foot">
        <strong>Comment, from the agent's proposal</strong>
        <span>Edit it before posting</span>
      </div>
      <textarea
        className="tr-textarea"
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Comment to post"
        rows={6}
        autoFocus
      />
      <div className="tr-actions">
        <button
          type="submit"
          className="tr-btn tr-btn--primary tr-btn--small"
          disabled={disabled || !text.trim()}
        >
          Post
        </button>
        <button type="button" className="tr-btn tr-btn--small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Proposal({
  icon,
  label,
  children,
  action,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
  action: ReactNode
}) {
  return (
    <div className="tr-proposal">
      <span className="tr-proposal-icon">
        <Icon>{icon}</Icon>
      </span>
      <div className="tr-proposal-text">
        <strong>{label}</strong>
        <div className="tr-proposal-body">{children}</div>
      </div>
      {action}
    </div>
  )
}

function Proposals({
  message,
  disabled,
  canFix,
  canPost,
  canDrop,
  replyOn = false,
  onFix,
  onPost,
  onDrop,
}: Pick<
  Props,
  | 'disabled'
  | 'canFix'
  | 'canPost'
  | 'canDrop'
  | 'replyOn'
  | 'onFix'
  | 'onPost'
  | 'onDrop'
> & {
  message: Message
}) {
  const [editing, setEditing] = useState(false)
  const { fix, comment, drop } = message.proposal ?? {}
  const shown = [fix && canFix, comment && canPost, drop && canDrop].some(Boolean)
  if (!shown) return null
  return (
    <div className="tr-proposals" aria-label="What the agent proposes">
      {fix && canFix && (
        <Proposal
          icon={WRENCH}
          label="Fix"
          action={
            <button
              type="button"
              className="tr-btn tr-btn--primary tr-btn--small"
              disabled={disabled}
              onClick={() => onFix(fix)}
            >
              Fix with this
            </button>
          }
        >
          <Markdown source={fix} headings={false} />
        </Proposal>
      )}
      {comment && canPost && replyOn && (
        <Proposal
          icon={BUBBLE}
          label="Reply"
          action={
            <button
              type="button"
              className="tr-btn tr-btn--small"
              disabled={disabled}
              onClick={() => onPost(comment)}
            >
              Reply with this
            </button>
          }
        >
          <p className="tr-clamp">{comment}</p>
        </Proposal>
      )}
      {comment &&
        canPost &&
        !replyOn &&
        (editing ? (
          <CommentEditor
            comment={comment}
            disabled={disabled}
            onPost={onPost}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Proposal
            icon={BUBBLE}
            label="Comment"
            action={
              <button
                type="button"
                className="tr-btn tr-btn--small"
                disabled={disabled}
                onClick={() => setEditing(true)}
              >
                Post this
              </button>
            }
          >
            <p className="tr-clamp">{comment}</p>
          </Proposal>
        ))}
      {drop && canDrop && (
        <Proposal
          icon={<path d="M18 6 6 18M6 6l12 12" />}
          label="Drop"
          action={
            <button
              type="button"
              className="tr-btn tr-btn--danger tr-btn--small"
              disabled={disabled}
              onClick={() => onDrop(drop)}
            >
              Drop with this reason
            </button>
          }
        >
          <p>{drop}</p>
        </Proposal>
      )}
    </div>
  )
}

/**
 * The message box: it grows with its text, Enter sends, Shift+Enter breaks
 * the line. Its draft lives with the thread, for the suggestions to fill it.
 */
function Composer({
  value,
  placeholder,
  waiting,
  changing,
  blocked,
  canChange,
  onChange,
  onSubmit,
  onChangeSubmit,
}: {
  value: string
  placeholder: string
  waiting: boolean
  /** What waits is a change, not an answer. */
  changing: boolean
  blocked: boolean
  canChange: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onChangeSubmit: () => void
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const textarea = box.current
    if (!textarea) return
    textarea.style.height = 'auto'
    // Empty, it keeps the CSS height: one line.
    if (value) textarea.style.height = `${textarea.scrollHeight}px`
  }, [value])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!blocked) onSubmit()
  }
  return (
    <>
      <form className="tr-composer" onSubmit={submit}>
        <textarea
          ref={box}
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-label="Your message to the agent"
          disabled={waiting}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
        />
        {canChange && (
          // Never Enter's: a change writes in the working tree, only ever asked for on purpose.
          <button
            type="button"
            className="tr-btn tr-btn--small tr-change"
            title="An agent makes this change in the working tree"
            disabled={blocked}
            onClick={onChangeSubmit}
          >
            <Icon size={14}>{WRENCH}</Icon>
            Change
          </button>
        )}
        <button
          type="submit"
          className="tr-send"
          aria-label="Send"
          title="Send"
          disabled={blocked}
        >
          <Icon size={18}>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </Icon>
        </button>
      </form>
      <div className="tr-composer-foot">
        <span>
          {waiting
            ? changing
              ? 'The agent makes the change: the next message waits for it.'
              : 'One question at a time: the next waits for this answer.'
            : canChange
              ? 'Send asks a read-only agent; Change has an agent make it.'
              : 'The agent reads the code, never changes it.'}
        </span>
        <span>
          <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> new line
        </span>
      </div>
    </>
  )
}

/**
 * A finding's discussion: the reviewer asks, a read-only agent answers; on a
 * thread, a change they ask for is made by a fix's agent, its result here.
 */
export function Discussion(props: Props) {
  const {
    discussion,
    writable,
    closed,
    taken,
    disabled,
    replyOn,
    replyAside,
    canChange = false,
    steps = [],
    underway = false,
    canStop = false,
    asking,
    onSend,
    onStop,
  } = props
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const messages = discussion?.messages ?? []
  // A change whose result did not land is no wait: the next message lands it first.
  const changing = waitsForChange(discussion) && underway
  const waiting = isWaiting(discussion) && (changing || !waitsForChange(discussion))
  const last = messages.at(-1)
  const lastQuestion = messages.findLast((message) => message.by === 'reviewer')
  // Asked again, a change is its request, never the answer to its agent's question.
  const lastRequest = messages.findLast(
    (message, i) => message.change && messages[i - 1]?.outcome !== 'asking',
  )
  const step = changing ? steps.at(-1) : discussion?.step

  async function send(text: string, change = false) {
    if (!writable || disabled || waiting || sending || !text.trim()) return
    if (change && !canChange) return
    setSending(true)
    const sent = await onSend(text.trim(), change)
    setSending(false)
    if (sent) setDraft('')
  }

  return (
    <section className="tr-dsc" aria-label="Discussion">
      <div className="tr-dsc-head">
        <h3>Discussion</h3>
        <span className="tr-dsc-note">
          {canChange || changing
            ? 'Questions: read-only agent · Change: makes it'
            : 'Read-only agent · decides nothing'}
        </span>
      </div>

      {messages.length === 0 && writable && (
        <div className="tr-dsc-empty">
          <span className="tr-dsc-empty-icon">
            <Icon size={28}>
              {BUBBLE}
              <path d="M9 10h6M9 14h4" />
            </Icon>
          </span>
          <p className="tr-dsc-empty-title">
            {replyOn ? 'Not sure what to answer?' : 'Not sure about this finding?'}
          </p>
          <p className="tr-muted">
            {replyOn
              ? canChange
                ? 'Ask an agent: it reads the comment and the code, never changes them. Ask for a change with Change: an agent makes it in the working tree. Nothing is posted until you reply.'
                : 'Ask an agent. It reads the comment and the code, never changes them; nothing is posted until you reply.'
              : 'Ask an agent. It reads the code and never changes it; the finding stays as it is until you decide.'}
          </p>
          <div className="tr-suggest">
            {(replyOn ? THREAD_SUGGESTIONS : SUGGESTIONS).map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => setDraft(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <ol className="tr-chat">
          {messages.map((message) => (
            <li
              key={`${message.by}-${message.at}`}
              className={`tr-msg tr-msg--${message.by === 'reviewer' ? 'you' : 'agent'}`}
            >
              {message.by === 'reviewer' ? (
                <>
                  <span className="tr-sr">You</span>
                  <div className="tr-bubble tr-bubble--you">{message.text}</div>
                  {message.change && (
                    <span className="tr-msg-tag">
                      <Icon size={12}>{WRENCH}</Icon>
                      {messages[messages.indexOf(message) - 1]?.outcome === 'asking'
                        ? 'Your answer'
                        : 'Change asked'}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="tr-msg-who">Agent</span>
                  {message.failed ? (
                    <div className="tr-unanswered">
                      <Icon>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 8v5M12 16h.01" />
                      </Icon>
                      <div className="tr-unanswered-body">
                        <span>{message.text}</span>
                        {writable &&
                          message === last &&
                          (message.outcome
                            ? lastRequest &&
                              canChange && (
                                <div>
                                  <button
                                    type="button"
                                    className="tr-btn tr-btn--small"
                                    disabled={disabled || sending}
                                    onClick={() => void send(lastRequest.text, true)}
                                  >
                                    Try again
                                  </button>
                                </div>
                              )
                            : lastQuestion && (
                                <div>
                                  <button
                                    type="button"
                                    className="tr-btn tr-btn--small"
                                    disabled={disabled || sending}
                                    onClick={() => void send(lastQuestion.text)}
                                  >
                                    Ask again
                                  </button>
                                </div>
                              ))}
                      </div>
                    </div>
                  ) : (
                    <div className="tr-bubble tr-bubble--agent">
                      <Markdown source={message.text} headings={false} />
                    </div>
                  )}
                  {message.outcome === 'fixed' && (
                    <div className="tr-msg-change">
                      <span className="tr-msg-tag">
                        <Icon size={12}>
                          <path d="M20 6 9 17l-5-5" />
                        </Icon>
                        Changed in the working tree
                      </span>
                      {message.runs && message.runs.length > 0 && (
                        <FixChanges
                          id={props.id}
                          runs={message.runs}
                          disabled={disabled}
                        />
                      )}
                    </div>
                  )}
                  {message === last && message.outcome === 'asking' && asking}
                  {writable && message === last && !message.failed && (
                    <Proposals message={message} {...props} />
                  )}
                  {!writable && replyAside && message === last && !message.failed && (
                    <Proposals
                      message={message}
                      {...props}
                      canFix={false}
                      canDrop={false}
                    />
                  )}
                  {message === last &&
                    !message.failed &&
                    taken?.map((one) => (
                      <div key={one} className="tr-taken">
                        <Icon>
                          <path d="M20 6 9 17l-5-5" />
                        </Icon>
                        <span>{TAKEN_WORDS[one]}</span>
                      </div>
                    ))}
                </>
              )}
            </li>
          ))}
          {waiting && (
            <li className="tr-msg tr-msg--agent">
              <span className="tr-msg-who">Agent</span>
              <div className="tr-step-now" role="status">
                <span className="tr-step-icon">
                  <Icon size={14}>
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 3v5h5" />
                  </Icon>
                </span>
                <span>{step ? activityOf(step) : 'An agent is starting…'}</span>
              </div>
              {changing && canStop && onStop && (
                <button
                  type="button"
                  className="tr-btn tr-btn--small"
                  disabled={disabled}
                  onClick={onStop}
                >
                  Stop
                </button>
              )}
            </li>
          )}
        </ol>
      )}

      {writable ? (
        <Composer
          value={draft}
          placeholder={
            waiting
              ? changing
                ? 'The agent is making the change…'
                : 'The agent is answering…'
              : messages.length
                ? canChange
                  ? 'Ask a follow-up, or for a change…'
                  : 'Ask a follow-up…'
                : 'Ask about this finding…'
          }
          waiting={waiting}
          changing={changing}
          blocked={disabled || waiting || sending || !draft.trim()}
          canChange={canChange}
          onChange={setDraft}
          onSubmit={() => void send(draft)}
          onChangeSubmit={() => void send(draft, true)}
        />
      ) : (
        <div className="tr-dsc-closed">
          <Icon>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </Icon>
          <span>{closed ?? 'The thread reads as it stands.'}</span>
        </div>
      )}
    </section>
  )
}
