import { useEffect, useRef, useState } from 'react'
import { plural, type LensRow, type LensesProgress, type Review } from './domain'

const CHANGE_WORDS: Record<NonNullable<LensRow['change']>, string> = {
  unchanged: 'unchanged',
  updated: 'updated since the last review',
  new: 'new in this project',
}

const SCOPE_WORDS = { local: 'this project', global: 'global' }

/** Settings › Lenses with this lens's editor open: the key LensesView gives it. */
export const lensHref = (row: Pick<LensRow, 'name' | 'scope'>) =>
  `#settings/lenses/${encodeURIComponent(`${row.scope ?? 'recipe'}:${row.name}`)}`

const names = (rows: LensRow[]) => rows.map((row) => row.name).join(', ')

function rowWords(row: LensRow) {
  if (row.cleaning === 'running') return 'its source changed · cleaning again'
  if (row.state === 'resolving') return 'resolving'
  if (row.state === 'failed') return 'failed'
  if (row.cleaning === 'again') return 'ready · cleaned again: its source changed'
  if (row.cleaning === 'failed') return 'cleaning failed · its last version runs'
  if (row.cleaning === 'held') return 'its last version runs'
  return row.change ? `ready · ${CHANGE_WORDS[row.change]}` : 'ready'
}

function Row({ row, fixable }: { row: LensRow; fixable: boolean }) {
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
        {row.scope && ` · ${SCOPE_WORDS[row.scope]}`}
      </code>
      <span
        className={`tr-lens-row-state${row.change === 'updated' || row.cleaning ? ' tr-lens-row-state--updated' : ''}`}
      >
        {rowWords(row)}
      </span>
      {row.state === 'failed' && (
        <p className="tr-lens-row-reason">
          {row.reason}
          {row.fix && <span className="tr-muted">: {row.fix}</span>}
          {fixable && (
            <>
              {' '}
              <a
                href={lensHref(row)}
                title="Opens Settings › Lenses with this lens’s editor open"
              >
                Fix {row.name} in Settings › Lenses
              </a>
            </>
          )}
        </p>
      )}
      {row.state === 'ready' &&
        (row.cleaning === 'failed' || row.cleaning === 'held') &&
        row.reason && (
          <p className="tr-lens-row-reason tr-lens-row-reason--warn">{row.reason}</p>
        )}
    </li>
  )
}

function Rows({ id, rows, fixable }: { id: string; rows: LensRow[]; fixable?: boolean }) {
  return (
    <ul className="tr-lens-rows" id={id} aria-label="The lenses, one per row">
      {rows.map((row) => (
        <Row key={row.name} row={row} fixable={fixable === true} />
      ))}
    </ul>
  )
}

function Refused({ rows, review }: { rows: LensRow[]; review: Pick<Review, 'refusal'> }) {
  const failed = rows.filter((row) => row.state === 'failed')
  const { refusal } = review
  return (
    <main className="tr-lenses-center" aria-label="Lenses">
      <svg
        className="tr-lenses-center-icon"
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5v.5" />
      </svg>
      <h2>
        Review refused:{' '}
        {failed.length > 1
          ? `${failed.length} lenses cannot be built`
          : failed.length === 1
            ? 'a lens cannot be built'
            : 'the lenses were not built'}
        , no reviewer started
      </h2>
      {failed.length > 0 ? (
        <p className="tr-notice" role="alert">
          <strong>{names(failed)}</strong> cannot be built:{' '}
          {failed.length > 1 ? 'each' : 'its'} row says why. Fix{' '}
          {failed.length > 1 ? 'them' : 'it'}, or turn {failed.length > 1 ? 'them' : 'it'}{' '}
          off, in Settings › Lenses, then run <code>/tranchant review</code> again.
        </p>
      ) : (
        // No row to carry it (the step itself failed, or lenses.json was not written).
        <p className="tr-notice" role="alert">
          {refusal ? (
            <>
              Lens <strong>{refusal.lens}</strong> (<code>{refusal.source}</code>):{' '}
              {refusal.reason}.{refusal.fix && ` To fix it: ${refusal.fix}.`}
            </>
          ) : (
            <>
              The review does not say why: run <code>/tranchant review</code> again.
            </>
          )}
        </p>
      )}
      {rows.length > 0 && <Rows id="tr-lens-rows" rows={rows} fixable />}
    </main>
  )
}

/**
 * The page's body while a `/tranchant review` review has no reviewer yet: its
 * lenses being built (or cleaned again first), a spinner and one line, the
 * rows on demand; or, refused, the lenses that failed and how to fix them.
 */
export function LensesCenter({
  step,
  review,
}: {
  step: LensesProgress | undefined
  review: Pick<Review, 'status' | 'refusal'>
}) {
  const [details, setDetails] = useState(false)
  const rows = step?.lenses ?? []
  if (review.status === 'refused') return <Refused rows={rows} review={review} />
  const ready = rows.filter((row) => row.state === 'ready').length
  const cleaning = rows.filter((row) => row.cleaning === 'running')
  return (
    <main className="tr-lenses-center" aria-label="Lenses">
      <span className="tr-spinner tr-spinner--big" aria-hidden="true" />
      <h2>Building the lenses</h2>
      {rows.length > 0 && (
        <>
          <span
            className="tr-progress-bar"
            role="progressbar"
            aria-label="Lenses ready"
            aria-valuemin={0}
            aria-valuemax={rows.length}
            aria-valuenow={ready}
          >
            <span style={{ width: `${Math.round((ready / rows.length) * 100)}%` }} />
          </span>
          <p className="tr-lenses-center-line" role="status">
            {ready} of {plural(rows.length, 'lens', 'lenses')} ready
          </p>
          {cleaning.length > 0 && (
            <p className="tr-lenses-center-line">
              {names(cleaning)} {cleaning.length > 1 ? 'are' : 'is'} cleaned again first,{' '}
              {cleaning.length > 1 ? 'their' : 'its'} source changed: the reviewers wait
              for {cleaning.length > 1 ? 'them' : 'it'}. This review runs the new version.
            </p>
          )}
          <button
            type="button"
            className="tr-btn tr-btn--link"
            aria-expanded={details}
            aria-controls="tr-lens-rows"
            onClick={() => setDetails(!details)}
          >
            {details ? 'Hide details' : 'Show details'}
          </button>
          {details && <Rows id="tr-lens-rows" rows={rows} />}
        </>
      )}
    </main>
  )
}

/**
 * The lenses of a review that runs or ran, folded into the header: a chip
 * that opens their rows over the page. A lens running its last version (its
 * cleaning failed, or is held) turns it amber: a warning, not an alert.
 */
export function LensesControl({ step }: { step: LensesProgress }) {
  const [open, setOpen] = useState(false)
  const control = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !control.current?.contains(event.target))
        setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])
  const rows = step.lenses
  const updated = rows.filter((row) => row.change === 'updated').length
  const cleanedAgain = rows.filter((row) => row.cleaning === 'again').length
  const cleanFailed = rows.filter(
    (row) => row.cleaning === 'failed' || row.cleaning === 'held',
  )
  return (
    <div className="tr-lenses-control" ref={control}>
      <button
        type="button"
        className={`tr-chip tr-chip--lenses${cleanFailed.length ? ' tr-chip--lenses-warn' : ''}`}
        aria-expanded={open}
        aria-controls="tr-lenses-pop"
        title="The lenses of this review: where each comes from"
        onClick={() => setOpen(!open)}
      >
        {plural(rows.length, 'lens', 'lenses')}
        {cleanFailed.length > 0 && ` · ${plural(cleanFailed.length, 'warning')}`}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <section className="tr-lenses-pop" id="tr-lenses-pop" aria-label="Lenses">
          <div className="tr-lenses-pop-head">
            <strong>Lenses</strong>
            <span className="tr-muted">
              {rows.length} built
              {updated > 0 && `, ${updated} updated since the last review`}
              {cleanedAgain > 0 && `, ${cleanedAgain} cleaned again`}
              {cleanFailed.length > 0 &&
                ` · ${names(cleanFailed)} could not be cleaned again: the last version runs`}
            </span>
            <a
              className="tr-btn tr-btn--link"
              href="#settings/lenses"
              onClick={() => setOpen(false)}
            >
              Manage the lenses
            </a>
          </div>
          <Rows id="tr-lenses-pop-rows" rows={rows} />
          <div className="tr-lenses-pop-foot">
            <button
              type="button"
              className="tr-btn tr-btn--small"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
