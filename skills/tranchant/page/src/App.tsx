import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type DiffState,
  postAnswer,
  postDecisions,
  postStop,
  useDiff,
  useReview,
} from './api'
import { BatchBar } from './BatchBar'
import { parseDiff, placeFindings, type Section } from './diff'
import { DiffView, FileList, fileId, scrollTo, useReadingFile } from './DiffView'
import {
  allows,
  canPost,
  counts,
  type DecisionInput,
  groupFindings,
  isReviewing,
  needsYou,
  nextOpen,
  orderedFindings,
  plural,
  type Review,
  stateOf,
  unverifiedIds,
} from './domain'
import { FindingDetail } from './FindingDetail'
import { FindingList } from './FindingList'
import { Markdown } from './markdown'
import { ReviewAgents } from './ReviewAgents'

const SUMMARY_KEY = 'tranchant:summary'
const VIEW_KEY = 'tranchant:view'
const NO_SECTIONS: readonly Section[] = []

/** The main view: the change's diff, or the findings by bucket and topic. */
type View = 'diff' | 'list'

// A private window or a blocked store throws: the page then keeps its defaults.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Nothing kept: the default shows next time.
  }
}

const readView = (): View => (readStored(VIEW_KEY) === 'list' ? 'list' : 'diff')
const readSummaryOpen = () => readStored(SUMMARY_KEY) !== 'closed'

const isEditing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))

function Header({
  review,
  tally,
  moved,
  onNeedsYou,
}: {
  review: Review
  tally: ReturnType<typeof counts>
  moved: boolean
  /** Opens the next finding waiting on the reviewer. */
  onNeedsYou: () => void
}) {
  return (
    <header className="tr-header">
      <div className="tr-header-main">
        <h1>{review.title}</h1>
        <div className="tr-header-meta">
          <code className="tr-branch">
            {review.branch} → {review.base}
          </code>
          {review.ownership === 'ours' ? (
            <span className="tr-chip tr-chip--ours">your branch</span>
          ) : review.mr ? (
            <a
              className="tr-chip tr-chip--theirs"
              href={review.mr.url}
              target="_blank"
              rel="noreferrer"
            >
              {review.mr.author ? `${review.mr.author}'s MR` : 'their MR'} !
              {review.mr.iid}
            </a>
          ) : (
            <span className="tr-chip tr-chip--theirs">their branch</span>
          )}
          {review.jira && (
            <a
              className="tr-chip"
              href={review.jira.url}
              target="_blank"
              rel="noreferrer"
            >
              {review.jira.key}
            </a>
          )}
          {moved && (
            <span
              className="tr-chip tr-chip--warn"
              title="HEAD is not the commit reviewed; fixes run on the current files"
            >
              checkout moved
            </span>
          )}
          {isReviewing(review) && (
            <span
              className="tr-chip tr-chip--live"
              role="status"
              aria-label="Review in progress"
            >
              <span className="tr-spinner" aria-hidden="true" />
              review in progress · {plural(review.findings.length, 'finding')} so far
            </span>
          )}
        </div>
      </div>
      <div className="tr-attention">
        <button
          type="button"
          className={`tr-attention-item ${tally.needsYou ? 'tr-attention-item--alert' : ''}`}
          disabled={!tally.needsYou}
          title="Asking or failed: open the next one"
          onClick={onNeedsYou}
        >
          Needs you <strong>{tally.needsYou}</strong>
        </button>
        <span
          className={`tr-attention-item ${tally.running ? 'tr-attention-item--live' : ''}`}
          title="Queued or working"
        >
          {tally.running > 0 && <span className="tr-spinner" aria-hidden="true" />}
          Running <strong>{tally.running}</strong>
        </span>
      </div>
      <dl className="tr-counts" aria-label="Findings by state">
        <div>
          <dt>open</dt>
          <dd>{tally.open}</dd>
        </div>
        <div>
          <dt>fixed</dt>
          <dd>{tally.fixed}</dd>
        </div>
        <div>
          <dt>posted</dt>
          <dd>{tally.posted}</dd>
        </div>
        <div>
          <dt>dropped</dt>
          <dd>{tally.dropped}</dd>
        </div>
      </dl>
      <span className="tr-version">tranchant {TRANCHANT_VERSION}</span>
    </header>
  )
}

function ViewToggle({
  shown,
  diff,
  onChange,
  onRetry,
}: {
  shown: View
  diff: DiffState
  onChange: (view: View) => void
  onRetry: () => void
}) {
  const unavailable = diff.status === 'unavailable' ? diff : undefined
  return (
    <div className="tr-view" role="group" aria-label="View">
      <button
        type="button"
        className={`tr-btn tr-btn--small ${shown === 'diff' ? 'tr-btn--primary' : ''}`}
        aria-pressed={shown === 'diff'}
        disabled={unavailable !== undefined}
        onClick={() => onChange('diff')}
      >
        Diff
      </button>
      <button
        type="button"
        className={`tr-btn tr-btn--small ${shown === 'list' ? 'tr-btn--primary' : ''}`}
        aria-pressed={shown === 'list'}
        onClick={() => onChange('list')}
      >
        List
      </button>
      {unavailable && (
        <span className="tr-view-reason tr-muted">
          Diff unavailable: {unavailable.reason}
          {unavailable.retrying ? (
            ' Retrying…'
          ) : (
            <>
              {' '}
              <button type="button" className="tr-btn tr-btn--link" onClick={onRetry}>
                retry
              </button>
            </>
          )}
        </span>
      )}
    </div>
  )
}

export default function App() {
  const { payload, reachable, loaded, reload } = useReview()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [cursorState, setCursor] = useState<string>()
  const [openState, setOpenId] = useState<string>()
  const [summaryOpen, setSummaryOpen] = useState(readSummaryOpen)
  const [view, setView] = useState<View>(readView)
  const [notice, setNotice] = useState<string>()
  // A decision left no open finding to move to: the detail says so until the reviewer opens one.
  const [settled, setSettled] = useState(false)

  const review = payload?.review
  const records = useMemo(() => payload?.findings ?? {}, [payload])
  const groups = useMemo(() => groupFindings(review?.findings ?? []), [review])
  const unverified = useMemo(
    () => (review ? unverifiedIds(review) : new Set<string>()),
    [review],
  )
  const { diff, retry } = useDiff(payload?.head.reviewed, reachable)
  const [diffPane, setDiffPane] = useState<HTMLElement | null>(null)
  const files = useMemo(
    () => (diff.status === 'ready' ? parseDiff(diff.payload.diff) : undefined),
    [diff],
  )
  const stats = useMemo(
    () =>
      new Map(
        (diff.status === 'ready' ? diff.payload.files : []).map((file) => [
          file.path,
          file,
        ]),
      ),
    [diff],
  )
  const placement = useMemo(
    () => (files && review ? placeFindings(files, review.findings) : undefined),
    [files, review],
  )
  const reading = useReadingFile(diffPane, placement?.sections ?? NO_SECTIONS)
  // The diff is the main view; the list replaces it only when the diff is unavailable.
  const shown: View = view === 'diff' && diff.status !== 'unavailable' ? 'diff' : 'list'
  const ordered = useMemo(
    () =>
      shown === 'diff' && placement
        ? placement.ordered
        : orderedFindings(review?.findings ?? []),
    [shown, placement, review],
  )
  const disabled = !reachable
  const has = (id: string | undefined) =>
    !!id && ordered.some((finding) => finding.id === id)
  // The first finding opens itself, and the cursor starts on the open one.
  const openId = has(openState) ? openState : ordered[0]?.id
  const cursor = has(cursorState) ? cursorState : openId
  // Read once a decision returns: the reviewer may have moved on, and the records reloaded.
  const latest = useRef({ openId, ordered, records })
  useEffect(() => {
    latest.current = { openId, ordered, records }
  })

  /** Sends `decisions`; resolves to the ids the server applied. */
  const decide = useCallback(
    async (decisions: DecisionInput[]): Promise<string[]> => {
      if (!decisions.length) return []
      let applied: string[] = []
      try {
        const result = await postDecisions(decisions)
        applied = result.applied
        setNotice(
          result.refused.length
            ? `Refused: ${result.refused.map((one) => `${one.id} (${one.reason})`).join(', ')}`
            : undefined,
        )
        setSelected((current) => {
          const next = new Set(current)
          for (const id of result.applied) next.delete(id)
          return next
        })
      } catch (failure) {
        setNotice(failure instanceof Error ? failure.message : 'The request failed.')
      }
      await reload()
      return applied
    },
    [reload],
  )

  const answer = useCallback(
    async (id: string, text: string, choices: string[]) => {
      try {
        await postAnswer(id, text, choices)
        setNotice(undefined)
      } catch (failure) {
        setNotice(failure instanceof Error ? failure.message : 'The answer was not sent.')
      }
      await reload()
    },
    [reload],
  )

  const stop = useCallback(
    async (id: string) => {
      try {
        await postStop(id)
        setNotice(undefined)
      } catch (failure) {
        setNotice(
          failure instanceof Error ? failure.message : 'The agent was not stopped.',
        )
      }
      await reload()
    },
    [reload],
  )

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const open = useCallback((id: string) => {
    setCursor(id)
    setOpenId(id)
    setSettled(false)
  }, [])

  // A decision on the finding shown leads on to the next open one; a batch's never moves.
  const decideShown = useCallback(
    async (decision: DecisionInput) => {
      const applied = await decide([decision])
      const now = latest.current
      if (!applied.includes(decision.id) || now.openId !== decision.id) return
      const next = nextOpen(now.ordered, now.records, decision.id)
      if (next) open(next)
      else setSettled(true)
    },
    [decide, open],
  )

  // From the cursor, wrapping; off the set it starts at the first. Moving the cursor scrolls.
  const openNextNeedingYou = () => {
    const needing = ordered.filter((finding) => needsYou(stateOf(records, finding.id)))
    const index = needing.findIndex((finding) => finding.id === cursor)
    const next = needing[(index + 1) % needing.length]
    if (next) open(next.id)
  }

  useEffect(() => {
    if (!review) return undefined
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditing(event.target))
        return
      const index = ordered.findIndex((finding) => finding.id === cursor)
      const move = (delta: number) => {
        const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))]
        if (next) setCursor(next.id)
      }
      const shortcuts: Record<string, DecisionInput['action']> = {
        f: 'fix',
        p: 'post',
        d: 'drop',
        s: 'skip',
      }
      const action = shortcuts[event.key]
      if (event.key === 'j' || event.key === 'ArrowDown') move(1)
      else if (event.key === 'k' || event.key === 'ArrowUp') move(-1)
      else if (event.key === 'Enter' && cursor) setOpenId(cursor)
      else if (event.key === 'x' && cursor) toggle(cursor)
      else if (action && cursor && review && !disabled) {
        if (allows(action, stateOf(records, cursor), review)) {
          if (cursor === openId) void decideShown({ id: cursor, action })
          else void decide([{ id: cursor, action }])
        }
      } else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [review, ordered, cursor, openId, records, disabled, decide, decideShown, toggle])

  if (!loaded) return <div className="tr-loading">Loading the review…</div>
  if (!review) {
    return (
      <div className="tr-app">
        <div className="tr-banner" role="alert">
          Tranchant stopped serving this review. Retrying…
        </div>
      </div>
    )
  }

  const tally = counts(review, records)
  const moved =
    payload?.head.current !== null && payload?.head.current !== payload?.head.reviewed
  const current = ordered.find((finding) => finding.id === openId)
  const keys = (
    <p className="tr-keys tr-muted">
      j/k move · Enter open · x select · f fix · {canPost(review) ? 'p post · ' : ''}d
      drop · s skip
    </p>
  )
  const viewToggle = (
    <ViewToggle
      shown={shown}
      diff={diff}
      onRetry={retry}
      onChange={(next) => {
        // Each view opens its first finding by default: keep the one shown.
        setOpenId(openId)
        setCursor(cursor)
        setView(next)
        writeStored(VIEW_KEY, next)
      }}
    />
  )
  const reviewing = isReviewing(review)
  const detail = current ? (
    <FindingDetail
      key={current.id}
      review={review}
      finding={current}
      record={records[current.id]}
      steps={payload?.runs[current.id] ?? []}
      unverified={unverified.has(current.id)}
      disabled={disabled}
      onDecide={(decisions) => {
        const [one] = decisions
        if (decisions.length === 1 && one) void decideShown(one)
        else void decide(decisions)
      }}
      onAnswer={(id, text, choices) => void answer(id, text, choices)}
      onStop={(id) => void stop(id)}
    />
  ) : (
    <p className="tr-muted">
      {reviewing ? 'Waiting for the first finding…' : 'No finding.'}
    </p>
  )
  const empty = (
    <p className="tr-empty tr-muted">
      {reviewing
        ? 'The review is running: findings appear here as they land.'
        : 'No findings.'}
    </p>
  )

  return (
    <div className="tr-app">
      {!reachable && (
        <div className="tr-banner" role="alert">
          Tranchant stopped serving this review. Retrying every 5 seconds…
        </div>
      )}
      <Header
        review={review}
        tally={tally}
        moved={moved}
        onNeedsYou={openNextNeedingYou}
      />
      <ReviewAgents
        agents={(payload?.reviewers ?? []).map((agent) =>
          // An agent whose end step was never written ended with its review all the same.
          review?.status === 'reviewing' ? agent : { ...agent, running: false },
        )}
      />
      <details
        className="tr-summary"
        open={summaryOpen}
        onToggle={(event) => {
          const next = event.currentTarget.open
          setSummaryOpen(next)
          writeStored(SUMMARY_KEY, next ? 'open' : 'closed')
        }}
      >
        <summary>Summary</summary>
        <div className="tr-summary-body">
          <Markdown source={review.summary} />
          {review.strengths && review.strengths.length > 0 && (
            <section aria-label="What looks good">
              <h3>What looks good</h3>
              <ul>
                {review.strengths.map((strength) => (
                  <li key={strength}>{strength}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </details>
      <BatchBar
        review={review}
        records={records}
        ordered={ordered}
        selected={selected}
        disabled={disabled}
        onSelect={(ids) => setSelected(new Set(ids))}
        onDecide={(decisions) => void decide(decisions)}
      />
      {notice && (
        <p className="tr-notice" role="status">
          {notice}
          <button
            type="button"
            className="tr-btn tr-btn--link"
            onClick={() => setNotice(undefined)}
          >
            dismiss
          </button>
        </p>
      )}
      <div className={`tr-main ${shown === 'diff' ? 'tr-main--diff' : ''}`}>
        {shown === 'diff' ? (
          <nav key="files" className="tr-list-pane" aria-label="Files">
            {viewToggle}
            {!ordered.length && empty}
            {placement ? (
              <FileList
                sections={placement.sections}
                stats={stats}
                reading={reading}
                onPick={(index) => scrollTo(fileId(index), 'start')}
              />
            ) : (
              <p className="tr-muted tr-pad">Loading the diff…</p>
            )}
            {ordered.length > 0 && keys}
          </nav>
        ) : (
          <nav key="findings" className="tr-list-pane" aria-label="Findings">
            {viewToggle}
            {ordered.length ? (
              <>
                <FindingList
                  groups={groups}
                  records={records}
                  cursor={cursor}
                  openId={openId}
                  selected={selected}
                  unverified={unverified}
                  onOpen={open}
                  onToggle={toggle}
                />
                {keys}
              </>
            ) : (
              empty
            )}
          </nav>
        )}
        {shown === 'diff' && (
          <section
            key="diff"
            ref={setDiffPane}
            className="tr-diff-pane"
            aria-label="Diff"
          >
            {placement ? (
              <DiffView
                sections={placement.sections}
                stats={stats}
                records={records}
                cursor={cursor}
                open={current}
                selected={selected}
                unverified={unverified}
                onOpen={open}
                onToggle={toggle}
              />
            ) : (
              <p className="tr-muted tr-pad">Loading the diff…</p>
            )}
          </section>
        )}
        {/* Third child in both layouts, the diff's slot empty in the list: its drafts survive. */}
        <main key="detail" className="tr-detail-pane">
          {settled && tally.open === 0 && (
            <p className="tr-settled" role="status">
              {tally.needsYou || tally.running
                ? `No open finding left: ${tally.needsYou} need you, ${tally.running} running`
                : 'All findings settled'}
            </p>
          )}
          {detail}
        </main>
      </div>
    </div>
  )
}
