import {
  plural,
  type BattlePick,
  type LensRow,
  type LensesProgress,
  type Review,
  type StartChoices,
} from './domain'
import type { GroupMember, GroupsPayload } from './settings'

const WHERE: Record<GroupMember['scope'], string> = {
  local: 'this project',
  global: 'global',
  recipe: '',
}

const same = (x: GroupMember, y: GroupMember) => x.scope === y.scope && x.name === y.name

/** A lens of a group as the battle tab names it: `money (this project)`, a built-in one by its name. */
const named = (one: GroupMember) =>
  one.scope === 'recipe' ? one.name : `${one.name} (${WHERE[one.scope]})`

/** Whether the plan's battle is the one picked: its rows are then that battle's. */
const sameBattle = (x: BattlePick | undefined, y: BattlePick | undefined) =>
  !!x && !!y && x.a === y.a && x.b === y.b && !x.twice === !y.twice

/** The battle a waiting review shows: the one picked, else the plan's, else the project's first two groups. */
export function pickedBattle(
  step: Pick<LensesProgress, 'battle'>,
  choices: StartChoices,
  groups: GroupsPayload | undefined,
): BattlePick | undefined {
  const picked = choices.battle ?? (choices.battle === null ? undefined : step.battle)
  if (picked) return picked
  const [a, b] = groups?.list ?? []
  return a && b ? { a: a.name, b: b.name } : undefined
}

/**
 * The ready screen's Battle review tab: groups A and B, the lenses each
 * runs (the shared ones dashed), what they share, Run the shared lenses
 * twice, and Start the battle once the plan is the battle picked.
 */
export function BattleSetup({
  step,
  review,
  groups,
  choices,
  cap,
  busy,
  onPick,
  onStart,
}: {
  step: LensesProgress
  review: Pick<Review, 'branch' | 'base'>
  groups: GroupsPayload | undefined
  choices: StartChoices
  cap: number | undefined
  busy: boolean
  /** Picks `battle`, and builds its lenses when its two groups differ, the review still waiting. */
  onPick: (battle: BattlePick, build: boolean) => void
  onStart: (battle: BattlePick) => void
}) {
  const list = groups?.list ?? []
  const changed = step.changed ?? 0
  const target = (
    <>
      <code>
        {review.branch} → {review.base}
      </code>{' '}
      · {plural(changed, 'file')} changed
    </>
  )
  if (list.length < 2)
    return (
      <div className="tr-lns-empty tr-grp-empty">
        <strong>A battle needs two groups of lenses.</strong>
        <span className="tr-muted">
          This project has {list.length === 1 ? `one: ${list[0]?.name ?? ''}` : 'none'}.
          Make them in Settings › Lenses › Groups: say A with the built-in reviewers, B
          with your team’s.
        </span>
        <a className="tr-btn tr-btn--small" href="#settings/lenses/groups">
          Make the groups
        </a>
      </div>
    )
  const picked = pickedBattle(step, choices, groups) ?? { a: '', b: '' }
  const membersOf = (name: string) => list.find((one) => one.name === name)?.lenses ?? []
  const lensesA = membersOf(picked.a)
  const lensesB = membersOf(picked.b)
  const shared = lensesA.filter((one) => lensesB.some((other) => same(one, other)))
  const onlyA = lensesA.filter((one) => !lensesB.some((other) => same(one, other)))
  const onlyB = lensesB.filter((one) => !lensesA.some((other) => same(one, other)))
  const twin = picked.a === picked.b
  const built = sameBattle(step.battle, picked)
  const rows: LensRow[] = built ? step.lenses : []
  const blocking = rows.filter((row) => row.state === 'failed')
  const count = (side: 'a' | 'b') =>
    rows.filter((row) => row.side === side || row.side === 'both').length
  const sharedOnce = rows.filter((row) => row.side === 'both').length
  // A lens of a group that reads none of the change's files has no row: it does not run.
  const runs = new Set(rows.map((row) => row.of ?? row.name))
  const idle = built
    ? [...new Set([...lensesA, ...lensesB].map((one) => one.name))].filter(
        (name) => !runs.has(name),
      )
    : []
  const canStart = !busy && built && !twin && !blocking.length && rows.length > 0
  const pick = (next: BattlePick) => onPick(next, next.a !== next.b)
  const at = cap ? `, ${cap} at a time across both` : ''
  const side = (
    letter: 'A' | 'B',
    key: 'a' | 'b',
    members: GroupMember[],
    other: GroupMember[],
  ) => (
    <section
      className={`tr-bt-side tr-bt-side--${key}`}
      aria-labelledby={`tr-bt-head-${key}`}
    >
      <div className="tr-bt-side-head">
        <span className="tr-bt-badge" aria-hidden="true">
          {letter}
        </span>
        <label id={`tr-bt-head-${key}`} htmlFor={`tr-bt-select-${key}`}>
          Group {letter}
        </label>
        <select
          id={`tr-bt-select-${key}`}
          className="tr-input tr-select"
          value={picked[key]}
          disabled={busy}
          onChange={(event) => pick({ ...picked, [key]: event.currentTarget.value })}
        >
          {list.map((one) => (
            <option key={one.name} value={one.name}>
              {one.name} · {plural(one.lenses.length, 'lens', 'lenses')}
            </option>
          ))}
        </select>
      </div>
      <ul className="tr-bt-lenses" aria-label={`The lenses of ${picked[key]}`}>
        {members.map((one) => {
          const both = other.some((that) => same(one, that))
          return (
            <li
              key={`${one.scope}:${one.name}`}
              className={`tr-bt-lens${both ? ' tr-bt-lens--shared' : ''}`}
              title={both ? 'In both groups' : `Only in ${letter}`}
            >
              {one.name}
              {WHERE[one.scope] && (
                <span className="tr-bt-lens-where">{WHERE[one.scope]}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
  return (
    <>
      <p className="tr-bt-lead">
        Two groups of lenses review this change at the same time. Then the page shows each
        one’s findings, and compares them: what both found, what only one did, what each
        cost.
      </p>
      <div className="tr-bt-sides">
        {side('A', 'a', lensesA, lensesB)}
        {side('B', 'b', lensesB, lensesA)}
      </div>
      {twin && (
        <p className="tr-lns-reason" role="alert">
          A and B are the same group: pick two different ones. To measure how much one
          group’s findings vary from run to run, see <em>Run the shared lenses twice</em>{' '}
          below.
        </p>
      )}
      <div className="tr-bt-overlap" aria-label="What the two groups share">
        <div>
          <span className="tr-bt-overlap-label">Only in A</span>
          <span>{onlyA.map(named).join(', ') || 'none'}</span>
        </div>
        <div>
          <span className="tr-bt-overlap-label">In both</span>
          <span>{shared.map(named).join(', ') || 'none'}</span>
        </div>
        <div>
          <span className="tr-bt-overlap-label">Only in B</span>
          <span>{onlyB.map(named).join(', ') || 'none'}</span>
        </div>
      </div>
      <div className="tr-bt-twice">
        <label className="tr-inline-check">
          <input
            type="checkbox"
            className="tr-check"
            checked={picked.twice === true}
            disabled={busy || twin}
            onChange={() => {
              const { twice: _was, ...rest } = picked
              pick(picked.twice ? rest : { ...rest, twice: true })
            }}
          />
          Run the shared lenses twice, once per group
        </label>
        <span className="tr-field-help">
          {picked.twice
            ? `Each shared lens runs once per group: ${plural(shared.length, 'more reviewer')}. Their findings may differ between the two runs, and that difference is the noise any comparison has to beat (#112).`
            : `Off: each shared lens (${shared.map((one) => one.name).join(', ') || 'none'}) runs once, and its findings count for both groups. Cheaper, and the comparison shows only what the groups do differently.`}
        </span>
      </div>
      <dl className="tr-ready-facts">
        <dt>Target</dt>
        <dd>{target}</dd>
        <dt>Agents</dt>
        <dd>
          {twin
            ? '—'
            : built
              ? `${plural(rows.length, 'reviewer')} (${count('a')} for A, ${count('b')} for B${sharedOnce ? `, ${sharedOnce} shared once` : ''})${at}, A and B in turn · then one verifier per finding`
              : 'Building the lenses of this battle…'}
        </dd>
        {idle.length > 0 && (
          <>
            <dt>Not run</dt>
            <dd className="tr-muted">
              {idle.join(', ')}: {idle.length > 1 ? 'they read' : 'it reads'} none of the
              change’s files
            </dd>
          </>
        )}
      </dl>
      {blocking.map((row) => (
        <p className="tr-notice" role="alert" key={row.name}>
          Lens <strong>{row.name}</strong> (<code>{row.source}</code>): {row.reason}
          {row.fix && <span className="tr-muted">: {row.fix}</span>}. The battle cannot
          start while one of its lenses cannot be built: fix it in Settings › Lenses, or
          take it out of its group.
        </p>
      ))}
      <div className="tr-ready-foot">
        <button
          type="button"
          className="tr-btn tr-btn--primary tr-btn--big"
          disabled={!canStart}
          onClick={() => onStart(picked)}
        >
          Start the battle
        </button>
        <span className="tr-muted">
          {busy
            ? 'Asking the server…'
            : twin
              ? 'Pick two different groups.'
              : !built
                ? step.problem
                  ? 'This battle could not be planned (above): pick other groups.'
                  : 'The lenses of the battle picked are being built.'
                : 'Both reviews start at once and fill the page side by side.'}
        </span>
        <span className="tr-muted tr-bt-cli">
          From the terminal:{' '}
          <code>
            /tranchant review --battle {picked.a},{picked.b}
          </code>
        </span>
      </div>
    </>
  )
}
