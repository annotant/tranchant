# The dashboard

`/tranchant dashboard` opens one page that lists every review of every
project on the machine, so you stop hunting for the right tab and port. It
runs nothing: a Claude Code session runs each review, as before. This file
is the structure the later stories build on (opening a review in the
dashboard, its actions, a new review, the other tabs, the cap on agents).

## Decided

| Question                     | Answer                                                                                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What serves it               | `scripts/dashboard.mjs`, a server of its own, apart from every review's.                                                                                                                                                                     |
| How long it lives            | The session's life, like a review's server: the hooks start it, and it ends with the session or `/tranchant stop`. Nothing outlives a session until the dashboard runs reviews itself (story 4), which will need a process of its own. |
| How many                     | One per machine. Started while another runs, it prints `RUNNING <url>` and exits: the session opens that page. Two sessions asking at once start one, under a lock.                                                                         |
| Its port                     | A free one, as a review's server; `TRANCHANT_DASHBOARD_PORT` fixes it. The registry gives the URL, and `/tranchant dashboard` opens it from any session: no port to remember, no setting to add.                                            |
| Where the registry lives     | `<state>/servers/`, one JSON file per running server, beside the reviews it points at.                                                                                                                                                       |

## Where it lives

| Part                                    | Holds                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `skills/tranchant/scripts/dashboard.mjs` | The server: the page, its API, the watch on the state folder.                                                                     |
| `scripts/lib/catalog.mjs`               | Every review, read from the state folder with the store, as its own server reads it. Read only.                                   |
| `scripts/lib/registry.mjs`              | The registry of running servers: written by each server, read by the dashboard.                                                  |
| `scripts/lib/http.mjs`                  | What both servers answer alike: JSON, a client's errors, a capped body, the CSP, the origin check.                                |
| `skills/tranchant/page/dashboard/`      | The dashboard's page (React), bundled on its own into `page/dist/dashboard/dashboard.js`.                                         |
| `skills/tranchant/page/kit/`            | What the review page and the dashboard both build on: the palette and font (`tokens.ts`), the theme, Annotant's UI kit components. |

The two pages share the kit, never each other's code: the dashboard imports
nothing from `page/src/`, the review page nothing from `page/dashboard/`.
They are two esbuild builds, so a change to one never changes the other's
bundle. Annotant's components (github.com/annotant/annotant,
`widget/src/components`) are copied into `kit/` one at a time, as a page
needs them, on Tranchant's `--tr-*` palette: `Button`, `IconButton`,
`Icon`, `Checkbox`, `Chip` so far. No UI library.

## The server

```
node SKILL/scripts/dashboard.mjs
```

| Line            | Means                                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| `READY <url>`   | It serves the page at `<url>`, registered; it runs until told to stop.            |
| `RUNNING <url>` | Another session's dashboard serves `<url>`; this one exited.                       |
| `PAGE_MISSING`  | A clone with no page built: `npm ci && npm run build`.                             |
| `PORT_BUSY`     | `TRANCHANT_DASHBOARD_PORT` is taken by another program.                            |

| Route              | Answers                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /`            | The shell; the theme the settings pick is on `<html>`.                                                                         |
| `GET /dashboard.js`| The bundle.                                                                                                                   |
| `GET /api/health`  | `{ ok, dashboard: true, version }`.                                                                                           |
| `GET /api/reviews` | `{ state, home, reviews }`: the state folder as the page names it, the home folder (for `~`), and every review (below).      |
| `GET /api/events`  | Server-sent events: `reviews`, with the same body as `/api/reviews`, each time the list changes.                             |
| `PUT /api/theme`   | `{ theme }`: `light`, `dark` or `system`, written in the settings every page reads.                                          |

A request from another origin, or with another `Host` (a rebound DNS name),
is refused (403), as on a review's server. The dashboard writes no review's
file: the theme alone, through the settings' lock.

## A review, as listed

`lib/catalog.mjs` reads `<state>/<project hash>/reviews/<id>/` for every
project: `review.json` and its findings, `decisions.json`, `lenses.json`
while it prepares, its reviewers' run files, and what its agents spent
(`lib/usage.mjs`, as `/api/review` sums it). A folder it cannot read as a
review (one being imported, another version) is left out. Each review is
read again only once one of its files changed (their sizes and times), and
each project's repository once: the worktrees of one repository are one
project, named after its main checkout.

| `state`     | When                                                                                                    | Group           |
| ----------- | ------------------------------------------------------------------------------------------------------- | --------------- |
| `preparing` | `preparing`, building its lenses, a server serving it                                                  | Running         |
| `ready`     | `preparing`, its lenses built, waiting for Start the review                                            | Ready to start  |
| `running`   | `reviewing`, a server serving it (`paused` when the page paused it)                                     | Running         |
| `stopped`   | `preparing` or `reviewing` with no server any more: its session ended mid-way                         | Needs you       |
| `needs`     | `complete` with a finding not settled (open, asking, queued, working, failed, stopped), or `refused`   | Needs you       |
| `settled`   | `complete`, every finding fixed, posted, moved, dropped or skipped                                    | Done            |

Each review carries its project and repository, title, `branch` and `base`,
its ownership and MR (`PR #12` on GitHub, `!12` on GitLab, its author),
its lenses done of all (`lenses`), the findings a verifier checked
(`verified`), its findings by state, its tokens, and `live` when a server
serves it: that server's URL and its session's folder. The page words the
rest.

## The registry

Each server writes its entry as it prints `READY`, and removes it as it
exits (`lib/registry.mjs`): `<state>/servers/<kind>-<pid>-<tag>.json`,
written whole, a temp file (its name starting with a dot) renamed over it.
There is no index: two servers starting at once write two files, and a
reader never sees half of one.

```jsonc
{
  "version": 1,
  "kind": "review", // or "dashboard"
  "pid": 41230,
  "port": 4599,
  "url": "http://127.0.0.1:4599",
  "startedAt": "2026-11-24T15:00:00.000Z",
  "review": "b96fae58-…", // a review's server: its review id, folder and project
  "dir": "/Users/me/.cache/tranchant/0123456789ab/reviews/b96fae58-…",
  "project": "/Users/me/dev/web",
  "target": { "branch": "feature/people-drawer", "base": "origin/master", "mr": "https://…" },
  "runner": { "kind": "session", "cwd": "/Users/me/dev/web" }, // the session's folder (TRANCHANT_SESSION_CWD)
}
```

The hooks stop a server with a signal: `removeOnExit` turns `SIGINT`,
`SIGTERM` and `SIGHUP` into an exit, so its `exit` handler removes the
file. A server killed outright leaves it: a reader drops an entry whose
process is gone, and removes its file. A review with an entry is live, and
its row's **Open** goes to its URL.

## Live updates

The dashboard watches the whole state folder (a project's first review
makes its folder), reads the list again 150 ms after a change, and pushes
`reviews` to its pages when the list's JSON differs from the last one sent.
It also reads it every 5 seconds (`TRANCHANT_POLL_MS`): a server killed
outright changes no file, and some mounts lose watch events. The page holds
no state of its own but the filter and what is folded; when its stream
drops it says **Reconnecting**, and reads the list again once it is back.

## Several instances at once

The skill runs from several worktrees and projects at once. What they
share, and how each piece is written:

| Piece                                              | Two worktrees of one repository                         | Two projects            | Two sessions in one checkout | Written                                                                 |
| -------------------------------------------------- | ------------------------------------------------------- | ----------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| Settings (`~/.config/tranchant/settings.json`)     | shared                                                  | shared                  | shared                       | `updateSettings`, under the file's lock (was: read, then write)         |
| Global lenses (`~/.config/tranchant/lenses/`)      | shared                                                  | shared                  | shared                       | `withLensFiles`, one lock for every lens write (was: none)              |
| Local lenses (`…/projects/<hash>/lenses/`)         | apart (each worktree its toplevel)                      | apart                   | shared                       | the same lock                                                           |
| Groups (`…/groups.json`)                           | apart                                                   | apart                   | shared                       | under its lock already                                                  |
| Cleanings (`<state>/<hash>/cleanings/`)            | apart                                                   | apart                   | shared                       | each record under its lock (was: read, then write)                      |
| A review's folder (`decisions.json`, findings…)    | apart                                                   | apart                   | shared when one review is opened twice | the store, under its locks already; `claim.mjs` refuses a second agent |
| File locks (`<state>/<hash>/locks/table.json`)     | apart (each worktree its files)                         | apart                   | shared                       | under its lock already                                                  |
| `usage.json`, discussions                          | per review                                              | per review              | shared per review            | under their locks already                                               |
| Inbox (`<state>/inbox/<id>.json`)                  | one file per review id                                  | the same                | the same                     | never shared                                                            |
| Built lenses (`<state>/lenses/<sha256>.md`)        | shared                                                  | shared                  | shared                       | one file per hash, a temp file of its own: two writes write the same   |
| The mod's `$.state` (one session, several reviews) | —                                                       | —                       | —                            | the fixes keyed by review and finding (was: by finding id alone)        |
| The registry (`<state>/servers/`)                  | shared                                                  | shared                  | shared                       | one file per server, written whole; the dashboard's start under a lock  |

What raced, how a test proved it (two processes at once, `test/races.test.mjs`
and `test/dashboard.test.mjs`; one session serving two reviews,
`test/hooks.test.ts`), and the fix:

| Race                                                                                                                                                      | Proved by                                                                                       | Fixed by                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Two servers' Remember these choices read the settings, then wrote them back: one lost the other's lenses.                                                 | 20 changes each, at once: 20 of 40 kept before the fix.                                         | `updateSettings`: read and written under the settings file's lock; `writeSettings` takes it too. |
| Two projects changing one global lens (its model, its rules) read lens.json, then wrote it back; and a name checked free could be taken twice.            | 25 changes each, at once: the rules ended at the 12th of 25.                                    | `withLensFiles` around every lens write: `updateUserLens`, `removeUserLens`, an add, a cleaning again. |
| Two sessions with the page open both start a queued cleaning: each read `queued`, each wrote `started`, two cleaning agents.                              | 8 cleanings, both sessions starting each: every one started twice.                              | Each cleaning's record read and written under its lock: start, check, add, add reviewers, discard. |
| One session serving two reviews: the fixes, their hand-overs and agent types were keyed by finding id, so review B's `f-01` was "already handed over", B's stop ended A's agent, and B's type took over A's agent's hooks. | `f-01` asked in both reviews: one agent before the fix.                                         | `fixKey` (finding id and review folder) in `$.state`; the type `tranchant:tr-<id>-<review>`. |
| Two dashboards started at once both listened.                                                                                                             | Two at once: both `READY` without the lock.                                                     | Checking the registry and registering under one lock.                                        |
