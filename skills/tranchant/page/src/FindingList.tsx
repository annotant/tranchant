import { useEffect } from 'react'
import {
  type BucketGroup,
  type Finding,
  type Records,
  STATE_DETAILS,
  stateClass,
  stateLabel,
  stateOf,
  tagOf,
} from './domain'

interface Props {
  groups: BucketGroup[]
  records: Records
  /** The finding the keyboard is on. */
  cursor: string | undefined
  /** The finding the detail shows. */
  openId: string | undefined
  selected: ReadonlySet<string>
  /** The findings no verifier confirmed yet: dimmed. */
  unverified?: ReadonlySet<string>
  /** The findings with a comment ready to post: marked. */
  commented?: ReadonlySet<string>
  onOpen: (id: string) => void
  onToggle: (id: string) => void
}

const optionId = (id: string) => `tr-option-${id}`

/** A speech bubble: the finding has a comment ready to post. */
export function CommentMark() {
  return (
    <span
      className="tr-comment-mark"
      role="img"
      aria-label="Has a comment"
      title="Has a comment to post"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M2.75 2h10.5c.97 0 1.75.78 1.75 1.75v6.5c0 .97-.78 1.75-1.75 1.75H8.06l-2.78 2.78A.75.75 0 0 1 4 14.25V12H2.75C1.78 12 1 11.22 1 10.25v-6.5C1 2.78 1.78 2 2.75 2Zm0 1.5a.25.25 0 0 0-.25.25v6.5c0 .14.11.25.25.25h2a.75.75 0 0 1 .75.75v1.19l1.72-1.72a.75.75 0 0 1 .53-.22h5.5a.25.25 0 0 0 .25-.25v-6.5a.25.25 0 0 0-.25-.25H2.75Z"
        />
      </svg>
    </span>
  )
}

function Row({
  finding,
  records,
  focused,
  open,
  checked,
  unverified,
  commented,
  onOpen,
  onToggle,
}: {
  finding: Finding
  records: Records
  focused: boolean
  open: boolean
  checked: boolean
  unverified: boolean
  commented: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const state = stateOf(records, finding.id)
  const tag = tagOf(finding)
  return (
    <li
      id={optionId(finding.id)}
      role="option"
      aria-selected={focused}
      aria-current={open ? 'true' : undefined}
      className={`tr-item ${focused ? 'tr-item--focused' : ''} ${open ? 'tr-item--open' : ''} ${unverified ? 'tr-unverified' : ''}`}
    >
      <input
        type="checkbox"
        className="tr-check"
        checked={checked}
        onChange={onToggle}
        aria-label={`Select ${finding.title}`}
      />
      <button type="button" className="tr-item-main" onClick={onOpen} tabIndex={-1}>
        <span className="tr-item-line">
          <span className={stateClass(state)} title={STATE_DETAILS[state]}>
            {stateLabel(state)}
          </span>
          {tag !== 'concern' && (
            <span className={`tr-chip tr-chip--tag-${tag}`}>{tag}</span>
          )}
          {unverified && <span className="tr-chip">unverified</span>}
          <span className="tr-item-title">{finding.title}</span>
          {commented && <CommentMark />}
        </span>
        <span className="tr-item-anchor">
          {finding.path}:{finding.line}
        </span>
      </button>
    </li>
  )
}

export function FindingList({
  groups,
  records,
  cursor,
  openId,
  selected,
  unverified,
  commented,
  onOpen,
  onToggle,
}: Props) {
  useEffect(() => {
    if (!cursor) return
    const element = document.getElementById(optionId(cursor))
    // happy-dom lays nothing out and has no scrollIntoView.
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' })
    }
  }, [cursor])

  return (
    <ul
      className="tr-list"
      role="listbox"
      aria-label="Findings"
      tabIndex={0}
      aria-activedescendant={cursor ? optionId(cursor) : undefined}
    >
      {groups.map((group) => (
        <li
          key={group.bucket}
          role="group"
          aria-label={group.label}
          className={`tr-bucket tr-bucket--${group.bucket}`}
        >
          <h2 className="tr-bucket-title">
            <span className="tr-bucket-dot" aria-hidden="true" />
            {group.label}
            <span className="tr-muted">
              {' '}
              {group.topics.reduce((sum, topic) => sum + topic.findings.length, 0)}
            </span>
          </h2>
          {group.topics.map((topic) => (
            <ul key={topic.topic} role="none" className="tr-topic">
              <li role="none" className="tr-topic-title">
                {topic.topic}
              </li>
              {topic.findings.map((finding) => (
                <Row
                  key={finding.id}
                  finding={finding}
                  records={records}
                  focused={cursor === finding.id}
                  open={openId === finding.id}
                  checked={selected.has(finding.id)}
                  unverified={unverified?.has(finding.id) ?? false}
                  commented={commented?.has(finding.id) ?? false}
                  onOpen={() => onOpen(finding.id)}
                  onToggle={() => onToggle(finding.id)}
                />
              ))}
            </ul>
          ))}
        </li>
      ))}
    </ul>
  )
}
