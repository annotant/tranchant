import type { Records, Review, ReviewPayload } from './domain'
import {
  type Chip,
  cellOf,
  kindRows,
  lensRows,
  notesOf,
  formatTokens,
  totalNote,
} from './tokens'

const COINS = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  </svg>
)

/** The header's chip: opens the Tokens screen, as the gear opens the Settings; on it, back to the review. */
export function TokensChip({ chip, open }: { chip: Chip; open: boolean }) {
  return (
    <a
      className={`tr-chip tr-tk-chip${chip.tone === 'still' ? '' : ` tr-tk-chip--${chip.tone}`}`}
      href={open ? '#' : '#tokens'}
      aria-current={open ? 'page' : undefined}
      title={
        open ? 'Back to the review' : "What the review's agents spent: open the breakdown"
      }
    >
      {COINS}
      {chip.text}
    </a>
  )
}

const KIND_FOOT =
  'Tokens as the API counts them: input, output, cache reads and cache writes, summed. Cache reads are most of it: an agent sends what it read again at each step, from the cache.'

const LENS_FOOT =
  "Review: the lens's reviewer. Verify: its findings' verifiers, those removed included. Dropped: removed by its verifier, or dropped by you. Settled: fixed, posted or moved. Per confirmed: both, over the findings that stand confirmed. Sorted by tokens, the most first; a lens's name opens its reviewer's report."

export type TokensTab = 'kind' | 'lens'

/** The Tokens screen (`#tokens`): the total, then by agent kind and by lens. */
export function TokensView({
  review,
  payload,
  records,
  tab,
  onTab,
}: {
  review: Review
  payload: ReviewPayload
  records: Records
  /** Kept by the page: a lens's report and the chip back reopen the same tab. */
  tab: TokensTab
  onTab: (tab: TokensTab) => void
}) {
  const usage = payload.usage
  const head = (
    <div className="tr-settings-head">
      <a className="tr-btn tr-btn--link tr-settings-back" href="#">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M15 6l-6 6 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back to the review
      </a>
      <h2 id="tr-tk-title">Tokens</h2>
    </div>
  )
  if (!usage?.total)
    return (
      <main className="tr-settings tr-settings--wide" aria-labelledby="tr-tk-title">
        {head}
        <p className="tr-muted">
          {usage
            ? 'No agent of this review has reported its tokens yet.'
            : "This review's tokens cannot be read: the server is older than this page, or its usage.json is unreadable (the server's log says why)."}
        </p>
      </main>
    )
  const atLeast = !!usage.total.partial || usage.notReported.length > 0
  const reviewers = payload.reviewers ?? []
  const kinds = kindRows(usage, {
    reviewers,
    records,
    discussions: payload.discussions,
    lenses: payload.lenses,
  })
  const lenses = lensRows({ usage, review, records, reviewers, lenses: payload.lenses })
  const notes = notesOf(usage, review)
  const tabs: [TokensTab, string, number?][] = [
    ['kind', 'By agent kind'],
    ['lens', 'By lens', lenses.length],
  ]
  return (
    <main
      className="tr-settings tr-settings--wide tr-tk-screen"
      aria-labelledby="tr-tk-title"
    >
      {head}
      <section className="tr-tk-body" aria-label="What the review spent">
        <div className="tr-tk-head">
          <span className="tr-tk-total">
            {atLeast && 'at least '}
            {formatTokens(usage.total.tokens)}
          </span>
          <span className="tr-muted">{totalNote(usage, review)}</span>
        </div>
        {notes.map((note) => (
          <p key={note} className="tr-tk-note" role="note">
            {note}
          </p>
        ))}
        <div className="tr-tabs" role="tablist" aria-label="Breakdown">
          {tabs.map(([one, label, count]) => (
            <button
              key={one}
              type="button"
              role="tab"
              className="tr-tab"
              id={`tr-tk-tab-${one}`}
              aria-selected={one === tab}
              aria-controls="tr-tk-panel"
              onClick={() => onTab(one)}
            >
              {label}
              {count !== undefined && <span className="tr-tab-count">{count}</span>}
            </button>
          ))}
        </div>
        <div
          className="tr-tk-scroll"
          id="tr-tk-panel"
          role="tabpanel"
          aria-labelledby={`tr-tk-tab-${tab}`}
        >
          {tab === 'kind' ? (
            <table className="tr-tk-table">
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col" className="tr-tk-num">
                    Agents
                  </th>
                  <th scope="col" className="tr-tk-num">
                    Tokens
                  </th>
                  <th scope="col">Share of the review</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      <span className="tr-tk-name">
                        {row.running && (
                          <span className="tr-spinner" role="img" aria-label="running" />
                        )}
                        {row.name}
                      </span>
                      {row.detail && <div className="tr-tk-detail">{row.detail}</div>}
                    </th>
                    <td className="tr-tk-num">{row.agents}</td>
                    <td className="tr-tk-num">{row.tokens}</td>
                    <td>
                      {row.share === null ? (
                        <span className="tr-muted">—</span>
                      ) : (
                        <div className="tr-tk-share">
                          <span className="tr-tk-bar" aria-hidden="true">
                            <span style={{ width: `${Math.max(row.share, 1)}%` }} />
                          </span>
                          <span className="tr-muted">{row.share} %</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="tr-tk-table tr-tk-table--lens">
              <thead>
                <tr>
                  <th scope="col">Lens</th>
                  <th scope="col" className="tr-tk-num" title="Its reviewer">
                    Review
                  </th>
                  <th scope="col" className="tr-tk-num" title="Its findings' verifiers">
                    Verify
                  </th>
                  <th scope="col" className="tr-tk-num">
                    Landed
                  </th>
                  <th scope="col" className="tr-tk-num">
                    Confirmed
                  </th>
                  <th
                    scope="col"
                    className="tr-tk-num"
                    title="Removed by its verifier, or dropped by you"
                  >
                    Dropped
                  </th>
                  <th scope="col" className="tr-tk-num" title="Fixed, posted or moved">
                    Settled
                  </th>
                  <th scope="col" className="tr-tk-num">
                    Per confirmed
                  </th>
                  <th scope="col" aria-label="Note" />
                </tr>
              </thead>
              <tbody>
                {lenses.map((row) => (
                  <tr
                    key={row.lens}
                    className={row.nothingConfirmed ? 'tr-tk-row--flag' : undefined}
                  >
                    <th scope="row">
                      <span className="tr-tk-name">
                        {row.running && (
                          <span className="tr-spinner" role="img" aria-label="running" />
                        )}
                        {row.report ? (
                          <a
                            href={`#report/${encodeURIComponent(row.lens)}`}
                            title={`Open the report of ${row.lens}'s reviewer`}
                          >
                            {row.lens}
                          </a>
                        ) : (
                          row.lens
                        )}
                      </span>
                      {row.model && <div className="tr-tk-detail">{row.model}</div>}
                    </th>
                    <td className="tr-tk-num">{row.review}</td>
                    <td className="tr-tk-num">{row.verify}</td>
                    <td className="tr-tk-num">{row.landed}</td>
                    <td className="tr-tk-num">{row.confirmed}</td>
                    <td className="tr-tk-num">{row.dropped}</td>
                    <td className="tr-tk-num">{row.settled}</td>
                    <td className="tr-tk-num">{row.perConfirmed}</td>
                    <td>
                      {row.nothingConfirmed ? (
                        <span className="tr-tk-flag">nothing confirmed</span>
                      ) : (
                        row.note && <span className="tr-tk-state">{row.note}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="tr-tk-foot">
          {tab === 'kind' ? KIND_FOOT : LENS_FOOT}
          {tab === 'lens' &&
            usage.reset?.usage &&
            ` Before the reset: ${cellOf(usage.reset.usage)} tokens, in no row.`}
        </p>
      </section>
    </main>
  )
}
