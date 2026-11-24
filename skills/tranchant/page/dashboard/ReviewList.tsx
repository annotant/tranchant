// The reviews, by group: Needs you, Running, Ready to start, then Done, folded.
import { useState } from 'react'
import { Chip, Icon } from '../kit'
import {
  type GroupId,
  type ListedReview,
  grouped,
  ownerOf,
  openUrlOf,
  progressOf,
  refOf,
  tokensOf,
  whenOf,
  whereOf,
} from './domain'

/** The dot before a row, and what it says to a screen reader. */
function dotOf(review: ListedReview): { tone: string; label: string } {
  if (review.state === 'stopped' || review.status === 'refused')
    return { tone: 'stopped', label: review.state === 'stopped' ? 'stopped' : 'refused' }
  switch (review.state) {
    case 'needs':
      return { tone: 'needs', label: 'needs you' }
    case 'ready':
      return { tone: 'ready', label: 'ready to start' }
    case 'settled':
      return { tone: 'done', label: 'done' }
    default:
      return review.paused
        ? { tone: 'paused', label: 'paused' }
        : { tone: 'running', label: 'running' }
  }
}

function Row({ review, home, now }: { review: ListedReview; home: string; now: number }) {
  const dot = dotOf(review)
  const progress = progressOf(review)
  const open = openUrlOf(review)
  const where = whereOf(review, home)
  return (
    <li className="db-row">
      <span className={`db-dot db-dot--${dot.tone}`} role="img" aria-label={dot.label} />
      <div className="db-what">
        <div className="db-line">
          <span className="db-project" title={review.repo.key}>
            {review.repo.name}
          </span>
          <span className="db-title" title={review.title}>
            {review.title}
          </span>
        </div>
        <div className="db-line">
          <code className="db-ref">{refOf(review)}</code>
          <Chip tone="accent">{ownerOf(review)}</Chip>
          {review.mr && (
            <a className="db-link" href={review.mr.url} target="_blank" rel="noreferrer">
              {review.mr.label}
            </a>
          )}
        </div>
      </div>
      <div className={`db-progress db-progress--${progress.tone}`}>
        <span>{progress.text}</span>
        {progress.percent !== undefined && (
          <span
            className="db-bar"
            role="progressbar"
            aria-label="Agents done"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
          >
            <span style={{ width: `${progress.percent}%` }} />
          </span>
        )}
      </div>
      <div className="db-runs">
        <span className="db-runs-where" title={where}>
          {where}
        </span>
        <span>
          {tokensOf(review)} · {whenOf(review, now)}
        </span>
      </div>
      <div className="db-row-actions">
        {open && (
          <a
            className="kit-btn kit-btn--secondary kit-btn--sm"
            href={open}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open the review of ${review.title} in a new tab`}
          >
            Open
            <Icon name="external" />
          </a>
        )}
      </div>
    </li>
  )
}

export function ReviewList({
  reviews,
  home,
  now,
}: {
  reviews: readonly ListedReview[]
  home: string
  now: number
}) {
  const [showDone, setShowDone] = useState(false)
  return (
    <>
      {grouped(reviews).map((group) => {
        const folded = group.id === 'done' && !showDone
        return (
          <section
            key={group.id}
            className={`db-group db-group--${group.id satisfies GroupId}`}
            aria-label={group.label}
          >
            <h2 className="db-group-head">
              <span>{group.label}</span>
              <span className="db-count">{group.reviews.length}</span>
              <span className="tr-muted">{group.help}</span>
            </h2>
            <ul className="db-rows">
              {!folded &&
                group.reviews.map((review) => (
                  <Row key={review.dir} review={review} home={home} now={now} />
                ))}
              {group.id === 'done' && (
                <li className="db-more">
                  <button
                    type="button"
                    className="kit-btn kit-btn--tertiary kit-btn--sm"
                    aria-expanded={showDone}
                    onClick={() => setShowDone(!showDone)}
                  >
                    {showDone
                      ? 'Hide done reviews'
                      : `Show ${group.reviews.length} done ${group.reviews.length === 1 ? 'review' : 'reviews'}`}
                  </button>
                </li>
              )}
            </ul>
          </section>
        )
      })}
    </>
  )
}
