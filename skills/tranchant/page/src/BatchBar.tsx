import { useState } from 'react'
import { useAccount } from './api'
import {
  type Action,
  applicable,
  canPost,
  type DecisionInput,
  type Finding,
  hasComment,
  idsInBucket,
  plural,
  postInput,
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
  /** Resolves with the ids the server applied. */
  onDecide: (decisions: DecisionInput[]) => Promise<string[]>
}

interface Pending {
  action: Action
  ids: string[]
}

/** A chip of the bar: a group the selection can be set to in one click. */
interface Group {
  readonly label: string
  readonly ids: readonly string[]
  readonly hint: string
}

const VERBS: Record<Action, string> = {
  fix: 'Fix',
  post: 'Post',
  drop: 'Drop',
  skip: 'Skip',
}

const DONE: Record<Action, string> = {
  fix: 'fixed',
  post: 'posted',
  drop: 'dropped',
  skip: 'skipped',
}

/** True when the selection is exactly `ids`, and `ids` is not empty. */
const selectsExactly = (ids: readonly string[], selected: ReadonlySet<string>) => {
  const wanted = new Set(ids)
  return (
    wanted.size > 0 &&
    wanted.size === selected.size &&
    [...wanted].every((id) => selected.has(id))
  )
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
  const all = ordered.map((finding) => finding.id)
  const open = all.filter((id) => stateOf(records, id) === 'open')
  const auto = new Set(idsInBucket(review, 'auto'))
  const openToPost = applicable(open, 'post', records, review)
  const actions: Action[] = posting
    ? ['fix', 'post', 'drop', 'skip']
    : ['fix', 'drop', 'skip']
  const count = selected.size
  const allSelected = all.length > 0 && count === all.length
  const groups: Group[] = [
    { label: 'To do', ids: open, hint: 'Every finding nothing was decided on yet' },
    {
      label: 'Safe to auto-fix',
      // To do only, as the button it replaces: a finding set aside is not fixed again.
      ids: open.filter((id) => auto.has(id)),
      hint: 'The findings still to do that the review judged safe to fix without you',
    },
  ]

  // One request for the batch; a single finding needs no confirmation, but a post leaves the page.
  function propose(action: Action, ids: string[]) {
    if (!ids.length) return
    if (ids.length === 1 && action !== 'post') {
      void send(ids.map((id) => ({ id, action })))
      setPending(undefined)
    } else setPending({ action, ids })
  }

  // A refusal or a failure keeps the selection, so the reviewer can try again.
  async function send(decisions: DecisionInput[]) {
    const applied = await onDecide(decisions)
    if (applied.length === decisions.length) onSelect([])
  }

  function confirm() {
    if (!pending) return
    void send(
      pending.ids.map((id) => {
        const finding = byId.get(id)
        return pending.action === 'post' && finding
          ? postInput(finding, records[id])
          : { id, action: pending.action }
      }),
    )
    setPending(undefined)
  }

  const masterLabel = allSelected ? 'Clear the selection' : 'Select every finding'

  return (
    <div className="tr-batch" role="toolbar" aria-label="Batch actions">
      <div className="tr-batch-group">
        <button
          type="button"
          className="tr-master"
          role="checkbox"
          aria-checked={allSelected ? 'true' : count ? 'mixed' : 'false'}
          aria-label={masterLabel}
          title={masterLabel}
          disabled={!all.length}
          onClick={() => onSelect(allSelected ? [] : all)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            {allSelected ? (
              <path d="M5 12.5l4 4 10-10" />
            ) : count ? (
              <path d="M6 12h12" />
            ) : null}
          </svg>
        </button>
        <span className="tr-selection" aria-live="polite">
          {count
            ? `${count} of ${plural(all.length, 'finding')} selected`
            : `Select among ${plural(all.length, 'finding')}`}
        </span>
        <div className="tr-picks" role="group" aria-label="Select by group">
          {groups.map((group) => {
            const pressed = selectsExactly(group.ids, selected)
            return (
              <button
                key={group.label}
                type="button"
                className="tr-pick"
                aria-pressed={pressed}
                title={group.hint}
                disabled={!group.ids.length}
                onClick={() => onSelect(pressed ? [] : group.ids)}
              >
                {`${group.label} `}
                <span className="tr-pick-count">{group.ids.length}</span>
              </button>
            )
          })}
        </div>
        {count > 0 && (
          <button
            type="button"
            className="tr-btn tr-btn--link tr-clear"
            onClick={() => onSelect([])}
          >
            Clear
          </button>
        )}
      </div>
      {count > 0 && (
        <div
          className="tr-batch-group"
          role="group"
          aria-label="Actions on the selection"
        >
          {actions.map((action) => {
            const ids = applicable(selected, action, records, review)
            return (
              <button
                key={action}
                type="button"
                className={`tr-btn tr-btn--small ${action === 'drop' ? 'tr-btn--danger' : ''}`}
                disabled={disabled || !ids.length}
                title={
                  ids.length
                    ? `${VERBS[action]} ${plural(ids.length, 'finding')}`
                    : `None of the selection can be ${DONE[action]}`
                }
                onClick={() => propose(action, ids)}
              >
                {VERBS[action]}
                <span className="tr-count"> {ids.length}</span>
              </button>
            )
          })}
        </div>
      )}
      {posting && openToPost.length > 0 && (
        <div className="tr-batch-group tr-batch-end">
          <button
            type="button"
            className="tr-btn tr-btn--small tr-btn--secondary"
            disabled={disabled}
            onClick={() => propose('post', openToPost)}
          >
            Post all to do
            <span className="tr-count"> {openToPost.length}</span>
          </button>
        </div>
      )}
      {pending && (
        <div className="tr-confirm" role="alertdialog" aria-label="Confirm the batch">
          {pending.action === 'post' ? (
            <div className="tr-confirm-post">
              <span>
                Post {plural(pending.ids.length, 'comment')} on !{review.mr?.iid} as{' '}
                {account ?? 'your glab account'}?
              </span>
              <ul aria-label="Comments to post">
                {pending.ids.map((id) => {
                  const finding = byId.get(id)
                  return (
                    <li key={id}>
                      {finding?.title ?? id}
                      {!records[id]?.comment && !hasComment(finding) && (
                        <span className="tr-muted">
                          {' '}
                          · written from its problem and fix
                        </span>
                      )}
                    </li>
                  )
                })}
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
