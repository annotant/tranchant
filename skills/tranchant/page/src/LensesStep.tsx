import { useState } from 'react'
import { plural, type LensRow, type LensesProgress, type Review } from './domain'

const CHANGE_WORDS: Record<NonNullable<LensRow['change']>, string> = {
  unchanged: 'unchanged',
  updated: 'updated since the last review',
  new: 'new in this project',
}

/** What a row says of its lens, by state. */
function rowWords(row: LensRow) {
  if (row.state === 'resolving') return 'resolving'
  if (row.state === 'failed') return 'failed'
  return row.change ? `ready · ${CHANGE_WORDS[row.change]}` : 'ready'
}

function Row({ row }: { row: LensRow }) {
  return (
    <li className={`tr-lens-row tr-lens-row--${row.state}`}>
      {row.state === 'resolving' ? (
        <span className="tr-spinner" role="img" aria-label="resolving" />
      ) : (
        <span
          className={`tr-lens-mark tr-lens-mark--${row.state}`}
          role="img"
          aria-label={row.state}
        >
          {row.state === 'ready' ? '✓' : '✕'}
        </span>
      )}
      <span className="tr-lens-row-name">{row.name}</span>
      <code className="tr-lens-row-source" title="Its source">
        {row.source}
        {row.version && ` ${row.version}`}
      </code>
      <span
        className={`tr-lens-row-state${row.change === 'updated' ? ' tr-lens-row-state--updated' : ''}`}
      >
        {rowWords(row)}
      </span>
      {row.state === 'failed' && (
        <p className="tr-lens-row-reason">
          {row.reason}
          {row.fix && <span className="tr-muted">: {row.fix}</span>}
        </p>
      )}
    </li>
  )
}

/**
 * The Lenses step of a `/tranchant review` review, above the reviewers: one
 * row per lens while it builds them or when it refused the review; one line
 * once the review runs, its rows on demand.
 */
export function LensesStep({
  step,
  review,
}: {
  step: LensesProgress | undefined
  review: Pick<Review, 'status' | 'refusal'> | undefined
}) {
  const [open, setOpen] = useState(false)
  const refused = review?.status === 'refused'
  if (!step && !refused) return null
  const rows = step?.lenses ?? []
  const building = review?.status === 'preparing'
  const updated = rows.filter((row) => row.change === 'updated').length
  const refusal = review?.refusal
  return (
    <section className="tr-progress tr-lenses-step" aria-label="Lenses">
      <div className="tr-progress-head">
        {building ? (
          <>
            <span className="tr-spinner" aria-hidden="true" />
            <span className="tr-progress-title">Building the lenses</span>
            <span className="tr-muted">
              {rows.filter((row) => row.state !== 'resolving').length} of{' '}
              {plural(rows.length, 'lens', 'lenses')} done
            </span>
          </>
        ) : refused ? (
          <span className="tr-progress-title tr-progress-warn">
            Review refused: a lens cannot be built, no reviewer started
          </span>
        ) : (
          <>
            <span className="tr-progress-title">Lenses</span>
            <span className="tr-muted">
              {plural(rows.length, 'lens', 'lenses')} built
              {updated > 0 && `, ${updated} updated since the last review`}
            </span>
            <button
              type="button"
              className="tr-btn tr-btn--link tr-progress-toggle"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? 'Hide the lenses' : 'Where each lens comes from'}
            </button>
          </>
        )}
      </div>
      {refusal && (
        <p className="tr-notice" role="alert">
          Lens <strong>{refusal.lens}</strong> (<code>{refusal.source}</code>):{' '}
          {refusal.reason}.{refusal.fix && ` To fix it: ${refusal.fix}.`}
        </p>
      )}
      {(building || refused || open) && rows.length > 0 && (
        <ul className="tr-lens-rows" aria-label="The lenses, one per row">
          {rows.map((row) => (
            <Row key={row.name} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}
