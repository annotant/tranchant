import { useEffect, useState } from 'react'
import {
  battleMarkdown,
  letterOf,
  onlyOf,
  scoreOf,
  SIDES,
  type BattleView,
  type Side,
} from './battle'
import {
  type Finding,
  type Records,
  type Review,
  type ReviewAgent,
  type ReviewUsage,
  STATE_DETAILS,
  stateClass,
  stateLabel,
  stateOf,
} from './domain'

function Badge({ side }: { side: Side }) {
  return (
    <span className={`tr-bt-badge tr-bt-badge--${side}`} aria-hidden="true">
      {letterOf(side)}
    </span>
  )
}

/** A finding in the comparison: its title, its anchor and id; a click opens it in its group. */
function Item({ finding, onOpen }: { finding: Finding | undefined; onOpen: () => void }) {
  if (!finding) return null
  return (
    <span className="tr-bt-item">
      <button
        type="button"
        className="tr-btn tr-btn--link tr-bt-item-title"
        onClick={onOpen}
      >
        {finding.title}
      </button>
      <span className="tr-item-anchor">
        {finding.path}:{finding.line} · {finding.id}
      </span>
    </span>
  )
}

function State({ records, id }: { records: Records; id: string }) {
  const state = stateOf(records, id)
  return (
    <span className={stateClass(state)} title={STATE_DETAILS[state]}>
      {stateLabel(state)}
    </span>
  )
}

/**
 * A battle's comparison: the scorecard, A and B as columns, the better side
 * marked; the findings both found (Not the same splits a pair); those only
 * one found; Copy as Markdown.
 */
export function BattleCompare({
  review,
  view,
  records,
  agents,
  usage,
  disabled,
  onSplit,
  onOpen,
}: {
  review: Review
  view: BattleView
  /** As the battle shows them: a pair's decision for both. */
  records: Records
  agents: readonly ReviewAgent[]
  usage: ReviewUsage | undefined
  disabled: boolean
  onSplit: (pair: [string, string]) => void
  /** Opens finding `id` in its group's view. */
  onOpen: (side: Side, id: string) => void
}) {
  const [copied, setCopied] = useState<string>()
  const { battle } = view
  const byId = new Map(review.findings.map((finding) => [finding.id, finding]))
  const score = scoreOf({ review, view, records, agents, usage })
  const shared = review.findings.filter(
    (finding) => view.sides.get(finding.id) === 'both',
  )
  const sharedLenses = Object.entries(battle.lenses)
    .filter(([, side]) => side === 'both')
    .map(([name]) => name)
  const lensesOf = (side: Side) =>
    Object.entries(battle.lenses)
      .filter(([, one]) => one === side || one === 'both')
      .map(([name]) => name)
  const settled = review.findings.filter(
    (finding) => stateOf(records, finding.id) !== 'open',
  )
  // Said a few seconds, then the count of findings settled again.
  useEffect(() => {
    if (copied === undefined) return undefined
    const timer = setTimeout(() => setCopied(undefined), 4000)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = () => {
    // No clipboard outside a secure context: said, never a click that does nothing.
    if (!navigator.clipboard) {
      setCopied('This browser gives the page no clipboard.')
      return
    }
    navigator.clipboard
      .writeText(battleMarkdown({ review, view, score }))
      .then(() => setCopied('Copied: paste it in an issue or a note.'))
      .catch(() => setCopied('The browser refused to copy.'))
  }
  return (
    <main className="tr-bt-compare" aria-labelledby="tr-bt-compare-title">
      <div className="tr-bt-compare-head">
        <h2 id="tr-bt-compare-title">
          {battle.a} against {battle.b} on this change
        </h2>
        <p className="tr-muted">
          A ({battle.a}): {lensesOf('a').join(', ')}. B ({battle.b}):{' '}
          {lensesOf('b').join(', ')}.
          {sharedLenses.length > 0 && ` ${sharedLenses.join(', ')} ran once, for both.`}
          {battle.twice && ' The shared lenses ran once per group.'}
        </p>
      </div>
      <table className="tr-bt-score">
        <caption className="tr-sr">Scorecard</caption>
        <thead>
          <tr>
            <th scope="col" />
            {SIDES.map((side) => (
              <th scope="col" key={side}>
                <Badge side={side} /> {side === 'a' ? battle.a : battle.b}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {score.map((row) => (
            <tr key={row.label}>
              <th scope="row">
                {row.label}
                {row.help && <span className="tr-bt-score-help">{row.help}</span>}
              </th>
              {SIDES.map((side) => (
                <td
                  key={side}
                  className={row.win === side ? 'tr-bt-win' : undefined}
                  title={row.win === side ? 'Did better' : undefined}
                >
                  {row[side]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <section className="tr-bt-pairs" aria-labelledby="tr-bt-both">
        <h3 id="tr-bt-both">
          Found by both{' '}
          <span className="tr-muted">{shared.length + view.pairs.length}</span>
        </h3>
        <p className="tr-field-help">
          Paired by file, topic and lines within three of each other. A pair that is not
          the same finding: <em>Not the same</em> splits it. A pair is settled once:
          deciding on one of its findings settles the other.
        </p>
        {shared.length + view.pairs.length > 0 ? (
          <ul className="tr-bt-pairlist">
            {shared.map((finding) => (
              <li className="tr-bt-pair" key={finding.id}>
                <div className="tr-bt-pair-side">
                  <Badge side="a" />
                  <Item finding={finding} onOpen={() => onOpen('a', finding.id)} />
                </div>
                <div className="tr-bt-pair-side">
                  <Badge side="b" />
                  <Item finding={finding} onOpen={() => onOpen('b', finding.id)} />
                </div>
                <div className="tr-bt-pair-end">
                  <State records={records} id={finding.id} />
                  <span
                    className="tr-chip tr-chip--scope"
                    title="A lens both groups share, run once"
                  >
                    shared lens
                  </span>
                </div>
              </li>
            ))}
            {view.pairs.map((pair) => (
              <li className="tr-bt-pair" key={`${pair.a} ${pair.b}`}>
                <div className="tr-bt-pair-side">
                  <Badge side="a" />
                  <Item finding={byId.get(pair.a)} onOpen={() => onOpen('a', pair.a)} />
                </div>
                <div className="tr-bt-pair-side">
                  <Badge side="b" />
                  <Item finding={byId.get(pair.b)} onOpen={() => onOpen('b', pair.b)} />
                </div>
                <div className="tr-bt-pair-end">
                  <State records={records} id={pair.a} />
                  <button
                    type="button"
                    className="tr-btn tr-btn--link"
                    disabled={disabled}
                    title="These two are not the same finding: each counts for its group alone"
                    onClick={() => onSplit([pair.a, pair.b])}
                  >
                    Not the same
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tr-muted">No finding of A matches one of B.</p>
        )}
      </section>
      <div className="tr-bt-only">
        {SIDES.map((side) => {
          const only = onlyOf(view, review.findings, side)
          return (
            <section
              className="tr-bt-pairs"
              aria-labelledby={`tr-bt-only-${side}`}
              key={side}
            >
              <h3 id={`tr-bt-only-${side}`}>
                <Badge side={side} /> Only {letterOf(side)} found{' '}
                <span className="tr-muted">{only.length}</span>
              </h3>
              {only.length > 0 ? (
                <ul className="tr-bt-pairlist">
                  {only.map((finding) => (
                    <li className="tr-bt-pair tr-bt-pair--one" key={finding.id}>
                      <Item
                        finding={byId.get(finding.id)}
                        onOpen={() => onOpen(side, finding.id)}
                      />
                      <State records={records} id={finding.id} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tr-muted">None.</p>
              )}
            </section>
          )
        })}
      </div>
      <div className="tr-ready-foot">
        <button type="button" className="tr-btn" onClick={copy}>
          Copy as Markdown
        </button>
        <span className="tr-muted" role="status">
          {copied ??
            `${settled.length} of ${review.findings.length} findings settled: Kept by you and Dropped by you fill in as you settle them.`}
        </span>
      </div>
    </main>
  )
}
