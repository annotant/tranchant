import { useState } from 'react'

import type { Review, ReviewAgent } from './domain'
import { Inline, Markdown } from './markdown'
import { readStored, writeStored } from './storage'

const SUMMARY_KEY = 'tranchant:summary'

function Sparkle() {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0l1.8 6.2L16 8l-6.2 1.8L8 16l-1.8-6.2L0 8l6.2-1.8z"
      />
    </svg>
  )
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 8.5l3 3 6-7"
      />
    </svg>
  )
}

/**
 * The review's summary and strengths. While the review runs it stays one line
 * high and closed, so nothing below moves when the summary lands.
 */
export function Summary({
  review,
  agents,
  reviewing,
}: {
  review: Pick<Review, 'summary' | 'strengths'>
  agents: readonly ReviewAgent[]
  reviewing: boolean
}) {
  const strengths = review.strengths ?? []
  // A section with nothing in it would only repeat the band above it.
  const hasSummary = review.summary.trim() !== '' || strengths.length > 0
  const writing =
    reviewing &&
    !hasSummary &&
    agents.some((agent) => agent.name === 'sm-summary' && agent.running)
  // The remembered choice waits for the review's end: opening mid-review would push the findings down.
  const [open, setOpen] = useState(
    () => !reviewing && readStored(SUMMARY_KEY) !== 'closed',
  )
  const [waited, setWaited] = useState(false)
  const [landed, setLanded] = useState(false)
  if (reviewing && !hasSummary && !waited) setWaited(true)
  if (hasSummary && waited) {
    setWaited(false)
    setLanded(true)
  }

  const announce = reviewing && (
    <p className="tr-sr" role="status">
      {landed ? 'Summary ready' : ''}
    </p>
  )
  if (writing)
    return (
      <>
        <div className="tr-summary tr-summary-line">
          Summary
          <span className="tr-spinner" aria-hidden="true" />
          <span className="tr-summary-hint">the summary agent reads the change</span>
          <span className="tr-shimmer" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
        {announce}
      </>
    )
  if (!hasSummary) return announce || null
  return (
    <>
      <details
        className={landed ? 'tr-summary tr-summary--landed' : 'tr-summary'}
        open={open}
        onToggle={(event) => {
          const next = event.currentTarget.open
          if (next === open) return
          setOpen(next)
          if (next) setLanded(false)
          writeStored(SUMMARY_KEY, next ? 'open' : 'closed')
        }}
      >
        <summary>
          Summary
          {landed && (
            <span className="tr-summary-ready">
              <Sparkle />
              ready
            </span>
          )}
          {reviewing && !open && (
            <span className="tr-summary-hint">
              what the change does and where it moves
            </span>
          )}
        </summary>
        <div className="tr-summary-body">
          {review.summary.trim() && <Markdown source={review.summary} />}
          {strengths.length > 0 && (
            <section className="tr-md tr-praise" aria-label="What looks good">
              <h3>
                <Sparkle />
                What looks good
              </h3>
              <ul>
                {strengths.map((strength) => (
                  <li key={strength}>
                    <Check />
                    <span>
                      <Inline source={strength} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </details>
      {announce}
    </>
  )
}
