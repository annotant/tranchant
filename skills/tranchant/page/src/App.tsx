import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type DiffState,
  postAnswer,
  postDiscuss,
  postDecisions,
  postHalt,
  postPause,
  postReset,
  postResume,
  postStart,
  postStop,
  useDiff,
  useUnfold,
  useReview,
  useSettings,
  useTracker,
} from './api'
import { BatchBar } from './BatchBar'
import { parseDiff, placeFindings, type Section, unfoldFile } from './diff'
import { DiffView, FileList, fileId, scrollTo, useReadingFile } from './DiffView'
import {
  allows,
  canPost,
  changeRef,
  commentedIds,
  underWayIds,
  counts,
  type DecisionInput,
  type LensesProgress,
  groupFindings,
  hasComment,
  isReviewing,
  GROUP_LABELS,
  needsYou,
  nextOpen,
  orderedFindings,
  plural,
  type Review,
  type ReviewUsage,
  type StartChoices,
  stateOf,
  unverifiedIds,
} from './domain'
import { FindingDetail } from './FindingDetail'
import { FindingList } from './FindingList'
import { LensesCenter, LensesControl, ReadyCenter } from './LensesStep'
import { phaseOf } from './progress'
import { ReviewAgents, type ReviewControl } from './ReviewAgents'
import type { View } from './settings'
import { LensesView } from './LensesView'
import { SettingsView } from './SettingsView'
import { Summary } from './Summary'
import { applyTheme, type Theme } from '../kit/theme'
import { SettingsLink, ThemeToggle } from './ThemeToggle'
import { chipOf } from './tokens'
import { TokensChip, type TokensTab, TokensView } from './TokensView'

const NO_SECTIONS: readonly Section[] = []

/**
 * What the page shows: the review (`#report/<lens>` opening that lens's
 * report), its Tokens (`#tokens`), the Settings (`#settings`) or their Lenses
 * (`#settings/lenses`, `/<lens>` opening its editor).
 */
type Route = 'review' | 'tokens' | 'settings' | 'lenses'

const LENSES_HASH = '#settings/lenses'
const REPORT_HASH = '#report'

const readRoute = (): Route =>
  location.hash === '#settings'
    ? 'settings'
    : location.hash === '#tokens'
      ? 'tokens'
      : location.hash === LENSES_HASH || location.hash.startsWith(`${LENSES_HASH}/`)
        ? 'lenses'
        : 'review'

/** The name after `<prefix>/` in the hash. */
function readName(prefix: string) {
  if (!location.hash.startsWith(`${prefix}/`)) return undefined
  try {
    return decodeURIComponent(location.hash.slice(prefix.length + 1))
  } catch {
    return undefined
  }
}

/** The lens `#settings/lenses/<lens>` names, as LensesView keys it. */
const readLens = () => readName(LENSES_HASH)

const readAt = () => ({
  route: readRoute(),
  lens: readLens(),
  report: readName(REPORT_HASH),
})

/** The route the URL's hash names, the lens it opens and the report, following the gear, the chip and the browser's back. */
function useRoute(): ReturnType<typeof readAt> {
  const [at, setAt] = useState(readAt)
  useEffect(() => {
    const onChange = () => setAt(readAt())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return at
}

const isEditing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))

function Header({
  review,
  lenses,
  tally,
  moved,
  usage,
  route,
  onNeedsYou,
  onTheme,
}: {
  review: Review
  usage: ReviewUsage | undefined
  /** The Lenses step of a `/tranchant review` review. */
  lenses: LensesProgress | undefined
  tally: ReturnType<typeof counts>
  moved: boolean
  /** What the page shows: on the Settings or the Tokens, the gear or the chip leads back. */
  route: Route
  /** Opens the next finding waiting on the reviewer. */
  onNeedsYou: () => void
  /** The theme toggle: written to the settings, for every page. */
  onTheme: (theme: Theme) => void
}) {
  const chip = chipOf(usage, review)
  return (
    <header className="tr-header">
      <div className="tr-header-main">
        <h1>{review.title}</h1>
        <div className="tr-header-meta">
          <code className="tr-branch">
            {review.branch} → {review.base}
          </code>
          {review.ownership === 'ours' ? (
            <>
              <span className="tr-chip tr-chip--ours">your branch</span>
              {review.mr && (
                <a
                  className="tr-chip tr-chip--ours"
                  href={review.mr.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {changeRef(review.mr)}
                </a>
              )}
            </>
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
          {review.status === 'preparing' && lenses?.state === 'waiting' ? (
            <span className="tr-chip tr-chip--ready" role="status">
              ready to start
            </span>
          ) : review.stopped ? (
            <span className="tr-chip tr-chip--danger" role="status">
              review stopped · {plural(review.findings.length, 'finding')}
            </span>
          ) : review.paused && review.status === 'reviewing' ? (
            <span className="tr-chip tr-chip--warn" role="status">
              review paused · {plural(review.findings.length, 'finding')}
            </span>
          ) : (
            isReviewing(review) && (
              <span
                className="tr-chip tr-chip--live"
                role="status"
                aria-label="Review in progress"
              >
                <span className="tr-spinner" aria-hidden="true" />
                {review.status === 'preparing'
                  ? 'building the lenses'
                  : `review in progress · ${plural(review.findings.length, 'finding')} so far`}
              </span>
            )
          )}
          {review.status === 'refused' && (
            <span className="tr-chip tr-chip--warn" role="status">
              review refused
            </span>
          )}
          {(review.group ?? lenses?.group) && (
            <span className="tr-chip" title="The group of lenses this review runs">
              group {review.group ?? lenses?.group}
            </span>
          )}
          {/* While they build, or refused, the page's center shows them. */}
          {lenses && review.status !== 'preparing' && review.status !== 'refused' && (
            <LensesControl step={lenses} />
          )}
          {chip && <TokensChip chip={chip} open={route === 'tokens'} />}
        </div>
      </div>
      <div className="tr-attention">
        <button
          type="button"
          className={`tr-attention-item ${tally.needsYou ? 'tr-attention-item--alert' : ''}`}
          disabled={!tally.needsYou}
          title="An agent asks you, or a fix did not land: go to the next one"
          onClick={onNeedsYou}
        >
          {GROUP_LABELS.needsYou} <strong>{tally.needsYou}</strong>
        </button>
        <span
          className={`tr-attention-item ${tally.inProgress ? 'tr-attention-item--live' : ''}`}
          title="Waiting for an agent, or being fixed"
        >
          {tally.inProgress > 0 && <span className="tr-spinner" aria-hidden="true" />}
          {GROUP_LABELS.inProgress} <strong>{tally.inProgress}</strong>
        </span>
      </div>
      <dl className="tr-counts" aria-label="Findings by state">
        {(['toDo', 'done', 'setAside'] as const).map((group) => (
          <div key={group}>
            <dt>{GROUP_LABELS[group]}</dt>
            <dd>{tally[group]}</dd>
          </div>
        ))}
      </dl>
      <div className="tr-header-end">
        <div className="tr-header-tools">
          <SettingsLink open={route === 'settings' || route === 'lenses'} />
          <ThemeToggle onPick={onTheme} />
        </div>
        <span className="tr-version">tranchant {TRANCHANT_VERSION}</span>
      </div>
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
  const settings = useSettings()
  const { tracker, reload: reloadTracker } = useTracker()
  const { reload: reloadSettings } = settings
  // The settings changed under the page: `postWith` moves the tracker too.
  const onSettings = useCallback(
    () => Promise.all([reloadSettings(), reloadTracker()]).then(() => undefined),
    [reloadSettings, reloadTracker],
  )
  const { payload, reachable, loaded, reload } = useReview(onSettings)
  const { route, lens: focusedLens, report } = useRoute()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [cursorState, setCursor] = useState<string>()
  const [openState, setOpenId] = useState<string>()
  // The session's view; absent, the settings decide, as when a review opens.
  const [viewPick, setView] = useState<View>()
  const values = settings.payload?.values
  const view: View = viewPick ?? values?.view ?? 'diff'
  const theme = values?.theme
  // The server put the pick on <html> before the page loaded; this follows a change.
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])
  const [notice, setNotice] = useState<string>()
  const [tokensTab, setTokensTab] = useState<TokensTab>('kind')
  // A review waiting to start: the switches of its ready screen, kept while the Settings show.
  const [choicesPick, setChoices] = useState<StartChoices>()
  const savedChoices = payload?.lenses?.choices
  const startChoices: StartChoices = useMemo(
    () => choicesPick ?? savedChoices ?? { lenses: {}, remember: false },
    [choicesPick, savedChoices],
  )
  const waiting =
    payload?.review.status === 'preparing' && payload.lenses?.state === 'waiting'
  // The settings changed while away from the review: its lenses are built again on the way back.
  const seenSettings = useRef(settings.payload)
  const buildOnReturn = useRef(false)
  useEffect(() => {
    if (settings.payload === seenSettings.current) return
    seenSettings.current = settings.payload
    if (route !== 'review' && waiting) buildOnReturn.current = true
  }, [settings.payload, route, waiting])
  useEffect(() => {
    if (route !== 'review' || !waiting || !buildOnReturn.current) return
    buildOnReturn.current = false
    postStart(startChoices, true).catch((error: unknown) =>
      setNotice(
        `The lenses were not built again: ${error instanceof Error ? error.message : 'the server did not answer'}`,
      ),
    )
  }, [route, waiting, startChoices])
  // A decision left no open finding to move to: the detail says so until the reviewer opens one.
  const [settled, setSettled] = useState(false)

  const review = payload?.review
  const records = useMemo(() => payload?.findings ?? {}, [payload])
  const groups = useMemo(() => groupFindings(review?.findings ?? []), [review])
  const unverified = useMemo(
    () => (review ? unverifiedIds(review) : new Set<string>()),
    [review],
  )
  const discussed = useMemo(
    () =>
      new Map(
        Object.entries(payload?.discussions ?? {}).map(([id, one]) => [
          id,
          one.messages.length,
        ]),
      ),
    [payload?.discussions],
  )
  const commented = useMemo(
    () => (review ? commentedIds(review) : new Set<string>()),
    [review],
  )
  const underWay = useMemo(
    () => (review ? underWayIds(review, records, payload?.discussions) : []),
    [review, records, payload?.discussions],
  )
  const { diff, retry } = useDiff(payload?.head.reviewed, reachable)
  const [diffPane, setDiffPane] = useState<HTMLElement | null>(null)
  const parsed = useMemo(
    () => (diff.status === 'ready' ? parseDiff(diff.payload.diff) : undefined),
    [diff],
  )
  const { unfolds, unfold } = useUnfold(
    diff.status === 'ready' ? diff.payload.head : undefined,
  )
  // The unfolded lines are the diff's: a finding on one sits on its line.
  const files = useMemo(
    () => parsed?.map((file) => unfoldFile(file, unfolds.get(file.path))),
    [parsed, unfolds],
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

  const discuss = useCallback(
    async (id: string, text: string, change?: boolean) => {
      let sent = false
      try {
        await postDiscuss(id, text, change)
        sent = true
        setNotice(undefined)
      } catch (failure) {
        setNotice(
          failure instanceof Error ? failure.message : 'The message was not sent.',
        )
      }
      await reload()
      return sent
    },
    [reload],
  )

  // Pause, Resume, Stop and Reset: what the server refuses is said, and the page reads the review again.
  const control = useCallback(
    async (which: ReviewControl) => {
      let done = false
      try {
        if (which === 'pause' || which === 'pauseNow')
          await postPause(which === 'pauseNow')
        else if (which === 'resume') await postResume()
        else if (which === 'reset') await postReset()
        else await postHalt(which === 'haltReset')
        setNotice(undefined)
        done = true
      } catch (failure) {
        setNotice(
          failure instanceof Error ? failure.message : 'The server did not answer.',
        )
      }
      await reload()
      return done
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
      // An issue or a comment was written, not triaged in a keystroke: the reviewer watches it land.
      if (decision.action === 'issue' || decision.action === 'post') return
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
    if (!review || route !== 'review') return undefined
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
        // A finding with no comment is posted from its editor, never blind.
        const blind =
          action === 'post' &&
          !hasComment(ordered.find((finding) => finding.id === cursor))
        const finding = ordered.find((one) => one.id === cursor)
        if (!blind && allows(action, stateOf(records, cursor), review, finding)) {
          if (cursor === openId) void decideShown({ id: cursor, action })
          else void decide([{ id: cursor, action }])
        }
      } else return
      event.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    review,
    route,
    ordered,
    cursor,
    openId,
    records,
    disabled,
    decide,
    decideShown,
    toggle,
  ])

  if (!loaded || !settings.loaded)
    return <div className="tr-loading">Loading the review…</div>
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
  const header = (
    <Header
      review={review}
      lenses={payload?.lenses}
      tally={tally}
      moved={moved}
      usage={payload?.usage}
      route={route}
      onNeedsYou={openNextNeedingYou}
      onTheme={(next) => {
        // No settings read yet (an older server): the switch holds for this visit.
        if (!settings.payload) applyTheme(next)
        else void settings.save((stored) => ({ ...stored, theme: next }))
      }}
    />
  )
  const settingsNotice = settings.error && (
    <p className="tr-notice" role="status">
      The change was not kept: {settings.error}
      <button type="button" className="tr-btn tr-btn--link" onClick={settings.dismiss}>
        dismiss
      </button>
    </p>
  )
  if (route === 'lenses') {
    return (
      <div className="tr-app">
        {!reachable && (
          <div className="tr-banner" role="alert">
            Tranchant stopped serving this review. The lenses are read-only until it is
            back; retrying every 5 seconds…
          </div>
        )}
        {header}
        <LensesView
          key={focusedLens ?? ''}
          focus={focusedLens}
          settings={settings.payload}
          offline={!reachable}
          error={settings.error}
          onDismiss={settings.dismiss}
          onSave={(change) => void settings.save(change)}
          onLens={settings.lens}
        />
      </div>
    )
  }
  if (route === 'tokens' && payload) {
    return (
      <div className="tr-app">
        {!reachable && (
          <div className="tr-banner" role="alert">
            Tranchant stopped serving this review. Retrying every 5 seconds…
          </div>
        )}
        {header}
        <TokensView
          review={review}
          payload={payload}
          records={records}
          tab={tokensTab}
          onTab={setTokensTab}
        />
      </div>
    )
  }
  if (route === 'settings') {
    return (
      <div className="tr-app">
        {!reachable && (
          <div className="tr-banner" role="alert">
            Tranchant stopped serving this review. Settings are read-only until it is
            back; retrying every 5 seconds…
          </div>
        )}
        {header}
        <SettingsView
          settings={settings.payload}
          offline={!reachable}
          unavailable={settings.unavailable}
          error={settings.error}
          onDismiss={settings.dismiss}
          onSave={(change) => void settings.save(change)}
        />
      </div>
    )
  }
  // No reviewer yet, or none ever: the lenses take the page.
  if (review.status === 'preparing' || review.status === 'refused') {
    return (
      <div className="tr-app">
        {!reachable && (
          <div className="tr-banner" role="alert">
            Tranchant stopped serving this review. Retrying every 5 seconds…
          </div>
        )}
        {header}
        {settingsNotice}
        {notice && (
          <p className="tr-notice" role="status">
            {notice}
          </p>
        )}
        {payload?.lenses?.state === 'waiting' && review.status === 'preparing' ? (
          <ReadyCenter
            step={payload.lenses}
            review={review}
            estimate={payload.estimate}
            choices={startChoices}
            cap={values?.maxReviewAgents}
            model={values?.reviewModel}
            groups={settings.payload?.groups}
            onChoices={setChoices}
            onStart={(build, next) =>
              postStart(next ?? startChoices, build).then(() => undefined)
            }
          />
        ) : (
          <LensesCenter step={payload?.lenses} review={review} />
        )}
      </div>
    )
  }
  const current = ordered.find((finding) => finding.id === openId)
  const keys = (
    <p className="tr-keys tr-muted">
      {[
        'j/k move',
        'Enter open',
        'x select',
        'f fix',
        ...(canPost(review) ? ['p post'] : []),
        'd drop',
        's skip',
      ].map((key, index) => (
        <Fragment key={key}>
          {index > 0 && ' · '}
          <span>{key}</span>
        </Fragment>
      ))}
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
      }}
    />
  )
  // Stopped from the page, nothing more lands: no longer in progress, whatever its status.
  const reviewing = isReviewing(review) && !review.stopped
  const phase = phaseOf(review, payload?.reviewers ?? [])
  const agents = (payload?.reviewers ?? []).flatMap((agent) => {
    // An interrupted agent runs again once resumed (a reviewer's lens shows queued meanwhile); ended without it, its lens is not covered.
    if (agent.outcome === 'interrupted' && phase === 'running') return []
    // One the hooks could not stop does run: shown so, until its end step.
    if (reviewing || agent.stuck) return [agent]
    // An agent whose end step was never written ended with its review all the same; stopped, before it finished.
    const cut = (review.stopped && agent.running) || agent.outcome === 'interrupted'
    return [{ ...agent, running: false, ...(cut && { outcome: 'failed' as const }) }]
  })
  const detail = current ? (
    <FindingDetail
      key={current.id}
      review={review}
      finding={current}
      record={records[current.id]}
      steps={payload?.runs[current.id] ?? []}
      discussion={payload?.discussions?.[current.id]}
      unverified={unverified.has(current.id)}
      usage={payload?.usage}
      disabled={disabled}
      tracker={tracker}
      onDecide={(decisions) => {
        const [one] = decisions
        if (decisions.length === 1 && one) void decideShown(one)
        else void decide(decisions)
      }}
      onAnswer={(id, text, choices) => void answer(id, text, choices)}
      onStop={(id) => void stop(id)}
      onDiscuss={discuss}
    />
  ) : (
    <p className="tr-empty tr-muted">
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
      {header}
      <ReviewAgents
        agents={agents}
        phase={phase}
        planned={review.lenses?.map((lens) => lens.name) ?? []}
        onControl={review.lenses ? control : undefined}
        underWay={underWay}
        stuck={(payload?.reviewers ?? [])
          // As the server's resetRefusal: a discussing agent belongs to its finding.
          .filter((agent) => agent.stuck && !agent.name.startsWith('ds-'))
          .map((agent) => agent.name)}
        findings={review?.findings ?? []}
        verify={review?.verify === true}
        project={review?.project ?? ''}
        lensGroup={review?.group}
        others={(settings.payload?.groups?.list ?? [])
          .map((group) => group.name)
          .filter((name) => name !== review?.group)}
        onOpen={open}
        report={report}
      />
      <Summary
        review={review}
        agents={payload?.reviewers ?? []}
        reviewing={reviewing}
        openAtStart={values?.summary !== 'closed'}
      />
      <BatchBar
        review={review}
        records={records}
        ordered={ordered}
        selected={selected}
        disabled={disabled}
        tracker={tracker}
        onSelect={(ids) => setSelected(new Set(ids))}
        onDecide={decide}
      />
      {settingsNotice}
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
                  commented={commented}
                  discussed={discussed}
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
                commented={commented}
                discussed={discussed}
                onOpen={open}
                onToggle={toggle}
                unfolds={unfolds}
                offline={!reachable}
                onUnfold={(path, from, to) => {
                  // The first finding opens itself: unfolding may move another one first.
                  if (!openState && openId) setOpenId(openId)
                  void unfold(path, from, to)
                }}
              />
            ) : (
              <p className="tr-muted tr-pad">Loading the diff…</p>
            )}
          </section>
        )}
        {/* Third child in both layouts, the diff's slot empty in the list: its drafts survive. */}
        <main key="detail" className="tr-detail-pane">
          {settled && tally.toDo === 0 && (
            <p className="tr-settled" role="status">
              {tally.needsYou || tally.inProgress
                ? `Nothing left to do: ${tally.needsYou} need you, ${tally.inProgress} in progress`
                : 'All findings settled'}
            </p>
          )}
          {detail}
        </main>
      </div>
    </div>
  )
}
