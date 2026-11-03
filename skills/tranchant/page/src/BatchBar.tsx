import { useState } from 'react'
import { useAccount } from './api'
import {
  type Action,
  applicable,
  canPost,
  type DecisionInput,
  type Finding,
  idsInBucket,
  plural,
  type Records,
  type Review,
  stateOf,
} from './domain'

interface Props {
  review: Review
  records: Records
  /** Every finding, in the list's order. */
  ordered: readonly Finding[]
  selected: ReadonlySet<string>
  disabled: boolean
  onSelect: (ids: readonly string[]) => void
  onDecide: (decisions: DecisionInput[]) => void
}

interface Pending {
  action: Action
  ids: string[]
}

const VERBS: Record<Action, string> = {
  fix: 'Fix',
  post: 'Post',
  drop: 'Drop',
  skip: 'Skip',
}

export function BatchBar({
  review,
  records,
  ordered,
  selected,
  disabled,
  onSelect,
  onDecide,
}: Props) {
  const [pending, setPending] = useState<Pending>()
  const posting = canPost(review)
  const account = useAccount(posting)
  const byId = new Map(ordered.map((finding) => [finding.id, finding]))
  // In the list's order: the batch runs top to bottom.
  const open = ordered
    .filter((finding) => stateOf(records, finding.id) === 'open')
    .map((finding) => finding.id)
  const autoOpen = ordered
    .filter((finding) => finding.bucket === 'auto' && open.includes(finding.id))
    .map((finding) => finding.id)
  const actions: Action[] = posting
    ? ['fix', 'post', 'drop', 'skip']
    : ['fix', 'drop', 'skip']

  // One request for the batch; a single finding needs no confirmation.
  function propose(action: Action, ids: string[]) {
    if (!ids.length) return
    if (ids.length === 1) {
      onDecide(ids.map((id) => ({ id, action })))
      setPending(undefined)
    } else setPending({ action, ids })
  }

  function confirm() {
    if (!pending) return
    onDecide(pending.ids.map((id) => ({ id, action: pending.action })))
    setPending(undefined)
  }

  return (
    <div className="tr-batch" role="toolbar" aria-label="Batch actions">
      <div className="tr-batch-group">
        <span className="tr-muted">
          {selected.size ? `${plural(selected.size, 'finding')} selected` : 'Select'}
        </span>
        <button
          type="button"
          className="tr-btn tr-btn--link"
          onClick={() => onSelect(ordered.map((finding) => finding.id))}
        >
          all
        </button>
        <button
          type="button"
          className="tr-btn tr-btn--link"
          onClick={() => onSelect(idsInBucket(review, 'auto'))}
        >
          safe to auto-fix
        </button>
        <button
          type="button"
          className="tr-btn tr-btn--link"
          onClick={() => onSelect(open)}
        >
          to do
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            className="tr-btn tr-btn--link"
            onClick={() => onSelect([])}
          >
            none
          </button>
        )}
      </div>
      <div className="tr-batch-group">
        {actions.map((action) => {
          const ids = applicable(selected, action, records, review)
          return (
            <button
              key={action}
              type="button"
              className={`tr-btn tr-btn--small ${action === 'drop' ? 'tr-btn--danger' : ''}`}
              disabled={disabled || !ids.length}
              onClick={() => propose(action, ids)}
            >
              {VERBS[action]}
              {ids.length > 0 && <span className="tr-count"> {ids.length}</span>}
            </button>
          )
        })}
      </div>
      <div className="tr-batch-group">
        <button
          type="button"
          className="tr-btn tr-btn--small tr-btn--secondary"
          disabled={disabled || !autoOpen.length}
          onClick={() => propose('fix', autoOpen)}
        >
          Fix all safe to auto-fix
          {autoOpen.length > 0 && <span className="tr-count"> {autoOpen.length}</span>}
        </button>
        {posting && (
          <button
            type="button"
            className="tr-btn tr-btn--small tr-btn--secondary"
            disabled={disabled || !open.length}
            onClick={() => propose('post', open)}
          >
            Post all
            {open.length > 0 && <span className="tr-count"> {open.length}</span>}
          </button>
        )}
      </div>
      {pending && (
        <div className="tr-confirm" role="alertdialog" aria-label="Confirm the batch">
          {pending.action === 'post' ? (
            <div className="tr-confirm-post">
              <span>
                Post {plural(pending.ids.length, 'comment')} on !{review.mr?.iid} as{' '}
                {account ?? 'your glab account'}?
              </span>
              <ul aria-label="Comments to post">
                {pending.ids.map((id) => (
                  <li key={id}>{byId.get(id)?.title ?? id}</li>
                ))}
              </ul>
            </div>
          ) : (
            <span>
              {VERBS[pending.action]} {plural(pending.ids.length, 'finding')}?
            </span>
          )}
          <button
            type="button"
            className="tr-btn tr-btn--small tr-btn--primary"
            onClick={confirm}
          >
            Confirm
          </button>
          <button
            type="button"
            className="tr-btn tr-btn--small"
            onClick={() => setPending(undefined)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
