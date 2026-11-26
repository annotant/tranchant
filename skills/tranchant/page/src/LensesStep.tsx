import { useEffect, useRef, useState } from 'react'
import {
  plural,
  type Estimate,
  type LensRow,
  type LensesProgress,
  type Review,
  type StartChoices,
} from './domain'
import { BattleSetup, pickedBattle } from './BattleSetup'
import { lensHref, MANY_LENSES } from './LensesView'
import type { GroupsPayload } from './settings'
import { formatTokens } from './tokens'

const CHANGE_WORDS: Record<NonNullable<LensRow['change']>, string> = {
  unchanged: 'unchanged',
  updated: 'updated since the last review',
  new: 'new in this project',
}

const SCOPE_WORDS = { local: 'this project', global: 'global' }

const names = (rows: LensRow[]) => rows.map((row) => row.name).join(', ')

const FROM_WORDS: Record<NonNullable<LensRow['modelFrom']>, string> = {
  forced: 'TRANCHANT_MODEL',
  auto: 'auto',
  lens: 'its own',
  reviewers: "reviewers'",
}

const AUTO_WHY_WORDS: Partial<Record<NonNullable<LensRow['autoWhy']>, string>> = {
  foreign: 'its source names a model that is not Claude’s',
  unreadable: 'its source’s frontmatter cannot be read',
  held: 'this change edits its source',
}

/** The model a ready lens's reviewer runs on, as its row names it: ` · auto · claude-opus-5-5`, and why Auto-detect fell back. */
function ModelWords({ row }: { row: LensRow }) {
  if (!row.modelFrom) return null
  const why = row.autoWhy && AUTO_WHY_WORDS[row.autoWhy]
  return (
    <span className={why ? 'tr-warn' : undefined}>
      {` · ${FROM_WORDS[row.modelFrom]} · ${row.model ?? "the session's model"}`}
      {why && ` (${why})`}
    </span>
  )
}

function rowWords(row: LensRow) {
  if (row.cleaning === 'running') return 'its source changed · cleaning again'
  if (row.state === 'resolving') return 'resolving'
  if (row.state === 'idle') return row.off ? 'off in your settings' : 'it does not run'
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
          {row.state === 'ready' ? '✓' : row.state === 'idle' ? '–' : '✕'}
        </span>
      )}
      <span className="tr-lens-row-name">{row.name}</span>
      <code className="tr-lens-row-source" title="Its source">
        {row.source}
        {row.version && ` ${row.version}`}
        {row.scope && ` · ${SCOPE_WORDS[row.scope]}`}
        <ModelWords row={row} />
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
  // A lens that does not run is not built: never counted, never waited for.
  const building = rows.filter((row) => row.state !== 'idle')
  const ready = building.filter((row) => row.state === 'ready').length
  const cleaning = rows.filter((row) => row.cleaning === 'running')
  return (
    <main className="tr-lenses-center" aria-label="Lenses">
      <span className="tr-spinner tr-spinner--big" aria-hidden="true" />
      <h2>Building the lenses{step?.group && ` of group ${step.group}`}</h2>
      <GroupNotes notes={step?.notes} />
      {building.length > 0 && (
        <>
          <span
            className="tr-progress-bar"
            role="progressbar"
            aria-label="Lenses ready"
            aria-valuemin={0}
            aria-valuemax={building.length}
            aria-valuenow={ready}
          >
            <span style={{ width: `${Math.round((ready / building.length) * 100)}%` }} />
          </span>
          <p className="tr-lenses-center-line" role="status">
            {ready} of {plural(building.length, 'lens', 'lenses')} ready
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

/** What a group's review says of its lenses that do not run: removed, or gone. */
function GroupNotes({ notes }: { notes: string[] | undefined }) {
  if (!notes?.length) return null
  return (
    <div className="tr-notice" role="status">
      {notes.map((note) => (
        <p key={note}>{note}.</p>
      ))}
    </div>
  )
}

/** What a lens that runs should spend, on its row: `~350k`, or that it has no past run. */
function Cost({
  row,
  lit,
  cost,
}: {
  row: LensRow
  lit: boolean
  cost: Estimate['lenses'][number] | undefined
}) {
  const files = row.files ?? 0
  if (!lit || files < 1 || row.state === 'failed') return null
  if (!cost)
    return (
      <span
        className="tr-lens-row-est"
        title="No past run in this project with its prompt: not in the estimate"
      >
        no past run
      </span>
    )
  return (
    <span
      className="tr-lens-row-est tr-tk-est"
      title={`${formatTokens(cost.perFile)} tokens per file read, the median of its last ${plural(cost.runs, 'review')} here, × ${plural(files, 'file')}, plus its verifiers`}
    >
      ~{formatTokens(cost.tokens)}
    </span>
  )
}

/** On for this review: the page's choice, else what the settings say. */
const isOn = (row: LensRow, choices: StartChoices) =>
  Object.hasOwn(choices.lenses, row.name) ? choices.lenses[row.name] === true : !row.off

/** What a row of the ready screen says: its switch, whether it was saved, what it reads. */
function readyWords(
  row: LensRow,
  on: boolean,
  flipped: boolean,
  choices: StartChoices,
  changed: number,
  group: string | undefined,
  shared: boolean,
) {
  const saved = choices.remember
    ? group
      ? on
        ? shared && row.scope === 'local'
          ? `not saved in ${group}: a global group holds no lens of this project`
          : `joins ${group} on Start`
        : `removed from ${group} on Start`
      : 'saved on Start'
    : undefined
  if (!on) {
    const off = flipped
      ? saved
        ? `off · ${saved}`
        : 'off for this review'
      : group
        ? `not in ${group}`
        : 'off in your settings'
    return row.state === 'failed' ? `${off} · it cannot be built` : off
  }
  if (row.state === 'failed') return 'failed'
  const reads = row.files
    ? `reads ${row.files} of ${plural(changed, 'file')}`
    : 'no changed file in its paths: it will not run'
  const lead = flipped
    ? saved
      ? `on · ${saved}`
      : 'on for this review'
    : row.cleaning === 'again'
      ? 'ready · cleaned again: its source changed'
      : row.cleaning === 'failed'
        ? 'ready · cleaning failed, its last version runs'
        : row.cleaning === 'held'
          ? 'ready · its last version runs'
          : 'ready'
  const inGroup = row.offInSettings ? ' · off in your settings, on in this group' : ''
  return `${lead} · ${reads}${inGroup}`
}

/**
 * The page's body while a `/tranchant review` review waits to start: why it
 * waits, what will run, a switch on each lens for this review (or saved,
 * with Remember these choices), and Start the review, refused while a lens
 * that is on cannot be built.
 */
export function ReadyCenter({
  step,
  review,
  estimate,
  choices,
  cap,
  model,
  groups,
  onChoices,
  onStart,
}: {
  step: LensesProgress
  review: Pick<Review, 'branch' | 'base' | 'ownership'>
  /** What it should spend, from the project's past reviews; absent from older servers. */
  estimate?: Estimate | undefined
  choices: StartChoices
  /** Review agents at a time, and their model: the settings'. */
  cap: number | undefined
  model: string | null | undefined
  /** The groups: the Group select. */
  groups?: GroupsPayload | undefined
  onChoices: (next: StartChoices) => void
  /**
   * Start the review, or (`build`) build the lenses again, waiting still,
   * with `next` when the choices just changed; throws the server's refusal.
   */
  onStart: (build: boolean, next?: StartChoices) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // A battle's plan opens on its tab (--battle); the Review tab otherwise.
  const [tab, setTab] = useState<'review' | 'battle'>(step.battle ? 'battle' : 'review')
  const rows = step.lenses
  const changed = step.changed ?? 0
  const group = step.group
  // A global group's switches saved leave out the lenses of this project.
  const shared = groups?.list.find((one) => one.name === group)?.scope === 'global'
  // The group picked: its lenses are built before the rows follow it.
  const picked = choices.group !== undefined ? (choices.group ?? undefined) : group
  const pending = picked !== group
  const groupNames = groups?.list.map((one) => one.name) ?? []
  const hasGroups = !step.own && (groupNames.length > 0 || group !== undefined)
  const on = (row: LensRow) => isOn(row, choices)
  const flipped = (row: LensRow) => on(row) !== !row.off
  const running = rows.filter((row) => on(row) && (row.files ?? 0) > 0)
  const idle = rows.filter((row) => on(row) && !row.files)
  const off = rows.filter((row) => !on(row))
  const blocking = rows.filter((row) => on(row) && row.state === 'failed')
  const changes = rows.filter(flipped).length
  const canStart = !busy && !pending && !blocking.length && running.length > 0
  const toggle = (row: LensRow) => {
    const { [row.name]: _was, ...rest } = choices.lenses
    const next = !on(row)
    // Back to what the settings say: no choice left on it.
    onChoices({
      ...choices,
      lenses: next === !row.off ? rest : { ...rest, [row.name]: next },
    })
  }
  const act = (build: boolean, next?: StartChoices) => {
    setBusy(true)
    setError(undefined)
    // A battle picked but never built is no choice of the Review tab's: Start would wait on it for ever.
    const stale = !next && !step.battle && choices.battle
    const asked = next
      ? onStart(build, next)
      : stale
        ? onStart(build, { ...choices, battle: null })
        : onStart(build)
    asked
      .catch((refusal: unknown) =>
        setError(
          refusal instanceof Error ? refusal.message : 'The server did not answer.',
        ),
      )
      .finally(() => setBusy(false))
  }
  const cleanedAgain = rows.filter((row) => row.cleaning === 'again')
  const at = cap ? `, ${cap} at a time` : ''
  // Each tab plans its own: the battle picked, or back to one group, the default one.
  const openTab = (next: 'review' | 'battle') => {
    setTab(next)
    if (next === 'battle') {
      const battle = pickedBattle(step, choices, groups)
      if (battle && !step.battle && battle.a !== battle.b) {
        const first: StartChoices = { lenses: {}, remember: false, battle }
        onChoices(first)
        act(true, first)
      }
    } else if (step.battle || choices.battle) {
      const back: StartChoices = {
        lenses: {},
        remember: false,
        battle: null,
        group: groups?.default ?? null,
      }
      onChoices(back)
      act(true, back)
    }
  }
  const tabs = !step.own && (
    <div className="tr-tabs" role="tablist" aria-label="Kind of review">
      {(
        [
          ['review', 'Review'],
          ['battle', 'Battle review'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          className="tr-tab"
          aria-selected={tab === key}
          disabled={busy}
          onClick={() => {
            if (tab !== key) openTab(key)
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
  const why =
    step.wait === 'reset'
      ? 'The review was reset: its findings are gone'
      : step.wait === 'flag'
        ? 'This run was opened with --no-start'
        : step.wait === 'battle'
          ? 'This run was opened with --battle'
          : 'Start the review by itself is off in Settings'
  if (tab === 'battle')
    return (
      <main className="tr-ready" aria-labelledby="tr-ready-title">
        <div className="tr-ready-head">
          <h2 id="tr-ready-title">Ready to start the review</h2>
          <p className="tr-muted">
            {why}: the lenses are built, and no reviewer runs until you start.
          </p>
        </div>
        {tabs}
        {error && (
          <p className="tr-notice" role="alert">
            Not started: {error}
          </p>
        )}
        {step.problem && (
          <p className="tr-notice" role="alert">
            The lenses were not planned again, the last plan stands: {step.problem}
          </p>
        )}
        <GroupNotes notes={step.battle ? step.notes : undefined} />
        <BattleSetup
          step={step}
          review={review}
          groups={groups}
          choices={choices}
          cap={cap}
          busy={busy}
          onPick={(battle, build) => {
            const next: StartChoices = { lenses: {}, remember: false, battle }
            onChoices(next)
            if (build) act(true, next)
          }}
          onStart={(battle) => act(false, { lenses: {}, remember: false, battle })}
        />
      </main>
    )
  // Back from a battle: its rows are not the review's until the plan is made again.
  if (step.battle)
    return (
      <main className="tr-ready" aria-labelledby="tr-ready-title">
        <div className="tr-ready-head">
          <h2 id="tr-ready-title">Ready to start the review</h2>
          <p className="tr-muted">{why}: no reviewer runs until you start.</p>
        </div>
        {tabs}
        {error && (
          <p className="tr-notice" role="alert">
            Not started: {error}
          </p>
        )}
        {step.problem ? (
          <p className="tr-notice" role="alert">
            The review could not be planned again, the battle stands: {step.problem}. Pick
            the battle again, or change the groups in Settings › Lenses › Groups.
          </p>
        ) : (
          <p className="tr-muted" role="status">
            Building the lenses of the review…
          </p>
        )}
      </main>
    )
  // The lenses on, plus the summary agent's: the figure follows the switches.
  const costs = new Map(estimate?.lenses.map((one) => [one.name, one]))
  // One that cannot be built runs nothing: never in the figure.
  const buildable = running.filter((row) => row.state !== 'failed')
  const known = buildable.flatMap((row) => {
    const cost = costs.get(row.name)
    return cost ? [cost] : []
  })
  const unknown = buildable.length - known.length
  const summary = estimate?.summary
  const total = (summary?.tokens ?? 0) + known.reduce((sum, one) => sum + one.tokens, 0)
  const reviews = new Set([
    ...(summary?.reviews ?? []),
    ...known.flatMap((one) => one.reviews),
  ])
  const priced = !!estimate?.recorded && known.length > 0
  const about = `about ${formatTokens(total)} tokens`
  return (
    <main className="tr-ready" aria-labelledby="tr-ready-title">
      <div className="tr-ready-head">
        <h2 id="tr-ready-title">
          {blocking.length
            ? `The review cannot start: ${blocking.length > 1 ? `${blocking.length} lenses cannot` : 'a lens cannot'} be built`
            : 'Ready to start the review'}
        </h2>
        <p className="tr-muted">
          {why}
          {step.wait === 'reset' ? ', the lenses' : ': the lenses'} are built, and no
          reviewer runs until you start it.{' '}
          {step.wait === 'reset' &&
            'A fix made before the reset stays on the working tree, where the reviewers read the files. '}
          {hasGroups
            ? 'Pick the group this change needs, or turn off a lens for this review.'
            : 'Turn off the lenses this change does not need.'}
        </p>
      </div>
      {tabs}
      <dl className="tr-ready-facts">
        <dt>Target</dt>
        <dd>
          <code>
            {review.branch} → {review.base}
          </code>{' '}
          · {review.ownership === 'ours' ? 'your branch' : 'their branch'} ·{' '}
          {plural(changed, 'file')} changed
        </dd>
        {hasGroups && (
          <>
            <dt>
              <label htmlFor="tr-ready-group">Group</label>
            </dt>
            <dd className="tr-grp-select">
              <select
                id="tr-ready-group"
                className="tr-input tr-select"
                value={picked ?? ''}
                disabled={busy}
                onChange={(event) => {
                  const next: StartChoices = {
                    lenses: {},
                    remember: false,
                    group: event.currentTarget.value || null,
                  }
                  onChoices(next)
                  act(true, next)
                }}
              >
                <option value="">Every lens that is on</option>
                {groupNames.map((name) => (
                  <option key={name} value={name}>
                    {name} ·{' '}
                    {plural(
                      groups?.list.find((one) => one.name === name)?.lenses.length ?? 0,
                      'lens',
                      'lenses',
                    )}
                  </option>
                ))}
                {group && !groupNames.includes(group) && (
                  <option value={group}>{group}</option>
                )}
              </select>
              <span className="tr-muted">
                {pending && step.problem
                  ? 'This group could not be planned (above): pick another.'
                  : pending
                    ? 'Building the lenses of this group…'
                    : 'Changed here, the lenses below follow, for this review only.'}
              </span>
            </dd>
          </>
        )}
        <dt>Lenses</dt>
        <dd>
          {running.length} run on this change
          {idle.length > 0 &&
            `, ${idle.length} ${idle.length === 1 ? 'reads' : 'read'} none of its files`}
          {off.length > 0 &&
            (group && off.every((row) => !flipped(row))
              ? ` · ${off.length} not in ${group}`
              : ` · ${off.length} off: ${names(off)}`)}
          {cleanedAgain.length > 0 &&
            ` · ${names(cleanedAgain)} cleaned again, ${cleanedAgain.length > 1 ? 'their' : 'its'} source changed`}
        </dd>
        <dt>Agents</dt>
        <dd>
          {plural(running.length, 'reviewer')}
          {at}, then one verifier per finding{model ? ` · ${model}` : ''}
        </dd>
        {estimate && running.length > 0 && (
          <>
            <dt>Tokens</dt>
            <dd>
              {priced ? (
                <>
                  <span className="tr-tk-est">about {formatTokens(total)}</span>{' '}
                  <span className="tr-muted">
                    tokens, from {plural(reviews.size, 'past review')} in this project:
                    each lens’s tokens per file read
                    {summary ? ', its verifiers and the summary' : ' and its verifiers'}
                    {unknown > 0 &&
                      ` · + ${plural(unknown, 'lens', 'lenses')} with no past run, not counted`}
                  </span>
                </>
              ) : (
                <span className="tr-muted">
                  {estimate.recorded
                    ? 'no estimate: none of these lenses has a past run in this project with its prompt. The next review will record one.'
                    : 'no estimate yet: no review in this project has recorded its tokens. The next one will.'}
                </span>
              )}
            </dd>
          </>
        )}
      </dl>
      {blocking.map((row) => (
        <p className="tr-notice" role="alert" key={row.name}>
          Lens <strong>{row.name}</strong> (<code>{row.source}</code>): {row.reason}
          {row.fix && <span className="tr-muted">: {row.fix}</span>}. The review cannot
          start while a lens that is on cannot be built: turn it off below, or{' '}
          <a href={lensHref(row)}>fix it in Settings › Lenses</a> and build the lenses
          again.
        </p>
      ))}
      {/* With a figure, it says it better. */}
      {running.length > MANY_LENSES && !blocking.length && !priced && (
        <p className="tr-notice tr-notice--warn" role="note">
          <strong>{plural(running.length, 'reviewer')}.</strong> Each one reads the change
          on its own: a review this wide spends many tokens. Turn off below the lenses
          this change does not need.
        </p>
      )}
      {error && (
        <p className="tr-notice" role="alert">
          Not started: {error}
        </p>
      )}
      <GroupNotes notes={step.notes} />
      {step.problem && (
        <p className="tr-notice" role="alert">
          The lenses were not planned again, the last plan stands: {step.problem}
        </p>
      )}
      <ul
        className={`tr-lens-rows tr-lens-rows--switches${estimate?.recorded ? ' tr-lens-rows--estimate' : ''}`}
        aria-label={
          group
            ? `The lenses of ${group}, one per row: turn one off for this review`
            : 'The lenses, one per row: turn one off for this review'
        }
      >
        {rows.map((row) => {
          const lit = on(row)
          const moved = flipped(row)
          return (
            <li
              key={row.name}
              className={`tr-lens-row tr-lens-row--${lit ? row.state : 'off'}`}
            >
              <label className="tr-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`${row.name}: ${lit ? 'on' : 'off'} for this review`}
                  checked={lit}
                  disabled={busy}
                  onChange={() => toggle(row)}
                />
                <span aria-hidden="true" />
              </label>
              <span className="tr-lens-row-name">{row.name}</span>
              <code className="tr-lens-row-source" title="Its source">
                {row.source}
                {row.version && ` ${row.version}`}
                {row.scope && ` · ${SCOPE_WORDS[row.scope]}`}
                {lit && <ModelWords row={row} />}
              </code>
              <span
                className={`tr-lens-row-state${moved || row.cleaning ? ' tr-lens-row-state--updated' : ''}`}
              >
                {readyWords(row, lit, moved, choices, changed, group, shared)}
              </span>
              {estimate?.recorded && (
                <Cost row={row} lit={lit} cost={costs.get(row.name)} />
              )}
              {lit && row.state === 'failed' && row.reason && (
                <p className="tr-lens-row-reason">{row.reason}</p>
              )}
              {lit &&
                (row.cleaning === 'failed' || row.cleaning === 'held') &&
                row.reason && (
                  <p className="tr-lens-row-reason tr-lens-row-reason--warn">
                    {row.reason}
                  </p>
                )}
            </li>
          )
        })}
      </ul>
      {!step.own && (
        <div className="tr-ready-remember">
          <label className="tr-inline-check">
            <input
              type="checkbox"
              className="tr-check"
              checked={choices.remember}
              disabled={busy}
              onChange={() => onChoices({ ...choices, remember: !choices.remember })}
            />
            {group
              ? `Save these switches in the group ${group}`
              : 'Remember these choices'}
          </label>
          <span className="tr-field-help">
            {group
              ? changes === 0
                ? `Each switch acts on this review only, unless you check this: then Start removes the lenses turned off from ${group}, and adds those turned on.`
                : choices.remember
                  ? `On Start, ${plural(changes, 'change')} ${changes === 1 ? 'is' : 'are'} saved in ${group}: its next review runs the same lenses.`
                  : `${plural(changes, 'change')} for this review only: ${group} keeps its lenses.`
              : changes === 0
                ? 'Each switch acts on this review only, unless you check this: then Start saves them as Settings › Lenses does, outside the repository.'
                : choices.remember
                  ? `On Start, your ${plural(changes, 'change')} ${changes === 1 ? 'is' : 'are'} saved as Settings › Lenses saves ${changes === 1 ? 'it' : 'them'}, outside the repository: the next review runs the same lenses.`
                  : `${plural(changes, 'change')} for this review only: the next one runs the lenses as your settings say.`}
          </span>
        </div>
      )}
      <div className="tr-ready-foot">
        <button
          type="button"
          className="tr-btn tr-btn--primary tr-btn--big"
          disabled={!canStart}
          onClick={() => act(false)}
        >
          Start the review
        </button>
        {blocking.length > 0 && (
          <button
            type="button"
            className="tr-btn"
            disabled={busy}
            onClick={() => act(true)}
          >
            Build the lenses again
          </button>
        )}
        <span className="tr-muted">
          {busy
            ? 'Asking the server…'
            : pending
              ? 'The lenses of the group picked are being built.'
              : blocking.length
                ? `Turn ${names(blocking)} off above, or fix ${blocking.length > 1 ? 'them' : 'it'} and build again.`
                : running.length
                  ? `${plural(running.length, 'reviewer')}${group ? ` of ${group}` : ''} start${running.length === 1 ? 's' : ''}${at}${priced ? ` · ${about}` : '.'}`
                  : 'No lens that is on reads the change: turn one on to start.'}
        </span>
        <a className="tr-btn tr-btn--link tr-ready-change" href="#settings/lenses">
          Change the lenses
        </a>
        {hasGroups && (
          <a className="tr-btn tr-btn--link" href="#settings/lenses/groups">
            Change the groups
          </a>
        )}
      </div>
      <p className="tr-field-help">
        Back from Settings › Lenses, the lenses are built again before you start, as the
        settings then say; your switches here stay.
      </p>
    </main>
  )
}
