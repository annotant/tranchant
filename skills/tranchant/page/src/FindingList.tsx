import { useEffect } from 'react'
import {
  type BucketGroup,
  type Finding,
  type Records,
  STATE_LABELS,
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
  onOpen: (id: string) => void
  onToggle: (id: string) => void
}

const optionId = (id: string) => `tr-option-${id}`

function Row({
  finding,
  records,
  focused,
  open,
  checked,
  onOpen,
  onToggle,
}: {
  finding: Finding
  records: Records
  focused: boolean
  open: boolean
  checked: boolean
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
      className={`tr-item ${focused ? 'tr-item--focused' : ''} ${open ? 'tr-item--open' : ''}`}
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
          <span className={`tr-chip tr-chip--${state}`}>{STATE_LABELS[state]}</span>
          {tag !== 'concern' && (
            <span className={`tr-chip tr-chip--tag-${tag}`}>{tag}</span>
          )}
          <span className="tr-item-title">{finding.title}</span>
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
