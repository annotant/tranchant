# The settings file

Tranchant's options live in one file per user, outside any reviewed
repository: `$XDG_CONFIG_HOME/tranchant/settings.json`, else
`~/.config/tranchant/settings.json`. The page's **Settings** (the gear next to
the theme toggle) shows every option, its value, its default and what it
does, and writes the file; the server owns it. Every review on the machine
reads the same file, so every page and every browser agree.

The reference is
[`skills/tranchant/scripts/lib/settings.mjs`](../skills/tranchant/scripts/lib/settings.mjs);
the page mirrors it in
[`skills/tranchant/page/src/settings.ts`](../skills/tranchant/page/src/settings.ts),
and the hooks ([`hooks/register.ts`](../hooks/register.ts)) read the file by
the same rules, on their own.

## Precedence

A run's flag (`--recipe` on `/tranchant review`), then an environment
variable, then the settings file, then the default. When an environment
variable wins, the page shows the option read-only and names the variable:
`TRANCHANT_MODEL` sets the three models, and wins over a lens's own `model`.
The recipe has two more places, between the flag and the settings' `recipe`:
the local recipe, then the project's (see
[where the recipe comes from](review-file.md#where-the-recipe-comes-from)).
Tranchant reads both and writes neither: a lens is added one by one instead.

A change applies to the next agent started, the next review, the next post:
never to an agent already running.

## The lenses you add

**Settings › Lenses** (and `/tranchant import`) adds a team's reviewer as a
lens of its own, cleaned first by an agent
([how](review-file.md#tranchant-import)). Each lens is one folder, outside
any repository, in one of two scopes:

- **global**: `$XDG_CONFIG_HOME/tranchant/lenses/<name>/` (else
  `~/.config/…`): it runs on every project;
- **local**: `$XDG_CONFIG_HOME/tranchant/projects/<project hash>/lenses/<name>/`,
  `<project hash>` the first 12 hex digits of the SHA-1 of the project's
  root: this project only.

**Tranchant's configuration is never committed nor pushed.** Under a name,
the first lens that is on runs: the project's, then a global one, then the
recipe's (turned off by `disabledLenses`). The number of lenses has no cap:
past 12 that run on the project, Settings › Lenses warns that each one is one
more reviewer agent on every review. A run with `--recipe` runs that recipe
whole, no lens added, and is not warned.

The folder holds `lens.md`, the lens's domain as the cleaning agent wrote it,
and `lens.json`:

```jsonc
{
  "version": 1,
  "name": "abac", // [\w-]{1,40}: its findings' ids start with it
  "source": "workflow:code-reviewer-abac", // a plugin's skill or agent, or a path (absolute for a global lens)
  "on": true,
  "paths": ["**/*.ts"], // or "otherwise": true, with "paths": []
  "topics": ["Security & Permissions"], // optional: what its findings file under
  "model": "claude-opus-5-5", // optional: its reviewer's model
  "context": "workflow:abac-rules", // optional: a skill that frames its run, given as data
  "rules": "- A route with no policy check is a finding, bucket review.", // its added instructions
  "rulesEdited": true, // the user edited them: kept as they are when it is cleaned again
  "cleaned": {
    "at": "2026-11-18T09:12:00Z",
    "sourceHash": "3f9a…", // SHA-256 of the source's text at its last cleaning
    "contextHash": "a81d…", // and of its context skill's
    "version": "2.4.0", // its plugin's, when it has one
    "removed": [{ "what": "Sliced mode", "why": "orchestration" }],
    "added": ["Topic: Security & Permissions only."],
  },
  "failedCleaning": { "at": "…", "reason": "…", "sourceHash": "…", "contextHash": "…" }, // the last cleaning again that failed, for that source
}
```

**The re-import.** Each `/tranchant review`, in its Lenses step, hashes
again the source and context skill of every added lens it runs. Both are read
where they lie (a plugin's install, a path from the project's working tree),
never at BASE. A changed hash cleans that lens again before the reviewers
start, the rules the user edited given to the agent and kept; the rest of its
settings stay as the user set them. When the change under review is what
changed the source (a file of the repository it touches), the lens is not
cleaned again: its last version runs, said on the page, so a branch never
rewrites the lens that reviews it. A cleaning that fails leaves the lens's
last version running, said on the page, and is not tried again for the same
source (Clean it again now does); a cleaning stopped by `/tranchant stop`
counts as none. A source that cannot be found (a file gone, a plugin turned
off) refuses the review, as a recipe's lens does. A review already running
keeps the version it started with. A lens's files are its own even turned
off: the `otherwise` lens never takes them, and one `otherwise` lens runs at
most, the first in precedence.

The page shows each lens with its switch, where it comes from, where it
runs, its topics and model, and, opened, its settings and **What the
reviewer reads**: the prompt whole, and what the cleaning removed and added.
A recipe's lens is read-only but its switch (`disabledLenses`) and its model
(`lensModels`).

## The file

```jsonc
{
  "version": 1,
  "theme": "dark", // "light", "dark" or "system" (the default)
  "view": "list", // the view a review opens in: "diff" (the default) or "list"
  "summary": "closed", // the summary when a review opens: "open" (the default) or "closed"
  "fixModel": "claude-sonnet-5-5", // each fix's agent; absent, the session's model
  "reviewModel": "claude-opus-5-5", // each lens's reviewer, and the agent answering a discussion
  "verifyModel": "claude-haiku-5-5", // each finding's verifier
  "maxFixAgents": 3, // fix agents at a time, 1 to 8 (3)
  "maxReviewAgents": 3, // review agents at a time: reviewers, verifiers and discussions (3); as many lens cleanings
  "recipe": "~/recipes/mine.json", // the recipe a run without --recipe uses; absent, the plugin's
  "disabledLenses": ["performance"], // lenses of the recipe not run; absent, every lens runs
  "lensModels": { "bugs": "claude-haiku-5-5" }, // by lens of the recipe, its reviewer's model
  "postWith": "gh", // the CLI that opens issues: "auto" (from the remote, the default), "glab" or "gh"
  "startReview": false, // /tranchant review builds the lenses, then waits for Start the review on the page (true, the default: it starts)
}
```

Only the keys set are written; an absent key is its default. The file is
validated like the review file: an unknown key, a wrong type or a value out
of its range is refused with a reason naming the key. A file this Tranchant
cannot read (not JSON, another `version`, a refused value) reads as none,
the page says why, and nothing is written over it until it is mended or
removed.

| Key               | Type                              | Read by                                                                                                                                                      |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `theme`           | `light`, `dark`, `system`         | The server puts it on `<html data-theme>` before the page loads; the page follows a change. The header's toggle writes it.                                   |
| `view`            | `diff`, `list`                    | The page, when a review opens. The Diff / List toggle switches the view for the visit only.                                                                  |
| `summary`         | `open`, `closed`                  | The page, when a review opens. Opening or closing the summary is for the visit only.                                                                         |
| `fixModel`        | a model id or alias, `[\w.:-]{1,80}` | The hooks, registering each fix's agent type; `hook.mjs`, for the run's Started step when `claim.mjs` recorded no model.                                |
| `reviewModel`     | the same                          | The hooks, for each reviewer, the summary agent and each discussing agent.                                                                                                      |
| `verifyModel`     | the same                          | The hooks, for each verifier.                                                                                                                                |
| `maxFixAgents`    | integer, 1 to 8                   | The hooks, before each round of starts: the fixes waiting start up to it.                                                                                    |
| `maxReviewAgents` | integer, 1 to 8                   | The hooks, for the reviewers, verifiers and discussing agents together; and, counted apart, for the cleaning agents of the lenses the page adds (a glob's matches wait for a free one). |
| `recipe`          | an absolute path, or `~`, `~/…`   | `prepare.mjs`, when the run names no `--recipe` and the project has no local or project recipe: a regular JSON file under 1 MiB. The page shows the recipe in force, its lenses and their sources, or says why it cannot read it. |
| `disabledLenses`  | lens names, `[\w-]{1,40}` | `prepare.mjs`, when the run names no `--recipe` (a run's own recipe runs whole): a lens of the recipe named is not run, and no other lens takes its files. Every lens off refuses the review (`every lens is turned off…`), unless it waits to start: the page can turn one on. The page's Settings › Lenses switches it. |
| `lensModels`      | lens names, each with a model id | `prepare.mjs`, when the run names no `--recipe`: the model of a lens of the recipe's reviewer, over the recipe's own `model`. `TRANCHANT_MODEL` still wins. |
| `startReview`     | `true`, `false`                   | `prepare.mjs`: off, `/tranchant review` builds the lenses, then waits for the page's **Start the review**, a switch on each lens for this review ([waiting to start](review-file.md#waiting-to-start)). `--no-start` and `--start` on a run win, never saved. The page's Settings › Review: **Start the review by itself**. |
| `postWith`        | `auto`, `glab`, `gh`              | The server (`/api/tracker`, `/api/account`) and `issue.mjs`: `glab` or `gh` names the forge for a host neither tool recognises; on a host the other forge owns (`github.com` with `glab`) the tracker is refused, with the reason, so a token never goes to the wrong forge. `auto` reads the host, as before. MR comments always go through `glab`, whose account the batch bar names. |

Options meant for tests and development stay environment variables:
`TRANCHANT_PORT`, `TRANCHANT_STATE_DIR`, `TRANCHANT_HOOKS`, `TRANCHANT_PAGE`,
`TRANCHANT_POLL_MS`, `TRANCHANT_GLAB` and `TRANCHANT_GH` (other executables),
`TRANCHANT_TOOL_TIMEOUT_MS`, `TRANCHANT_LOCK_WAIT_MS`, `TRANCHANT_MAX_DIFF_MIB`.

## The routes

| Route               | Does                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/settings` | `{ path, settings, values, defaults, locked, recipe, recipeFrom, lenses, lensSet, cleanings, recipeProblem?, problem? }`: the file's path, the file as it stands (the keys set), the values in force (every key, `null` where nothing is chosen), the defaults, by key the environment variable that locks it, the recipe in force for the review's project (`recipe` its file, `BASE:<path>` for the project's; `recipeFrom` `local`, `project`, `settings` or `plugin`; `lenses` its lenses' names; `recipeProblem` when it cannot be read); `lensSet`, `{ dirs: { global, local }, lenses }`, every lens that could run on the project, the project's, the global ones and the recipe's, each `{ name, scope: "local" \| "global" \| "recipe", on, runs, replaces?, source, version?, paths, otherwise?, topics?, model?, context?, rules?, rulesEdited?, cleaned?, failedCleaning?, stale?: "stale" \| "failed", problem?, fix? }`; `cleanings`, the lenses being cleaned or waiting to be added, each `{ id, createdAt, name, scope, again, source, version?, context?, from?, state: "cleaning" \| "ready" \| "failed", waiting?, reason?, instead?, report?, domain? }` (`waiting` while it waits for a free cleaning agent, `from` the glob it was matched by); and `problem` when the file reads as none, and why. |
| `GET /api/lens/prompt?scope=&name=` | `{ prompt }`: the prompt a lens's reviewer reads, built as a review builds it (`scope` `recipe`, `global` or `local`). 404 for no such lens, 409 with the reason when it cannot be built. |
| `GET /api/lens/matches?source=` | `{ matches, more?, folder? }`: the files a glob (`*`, `?`, within one folder: no `**`; a `[` is part of the path) matches from the project's root, `~/` or an absolute path, each `{ source, name, notReviewer?, already? }`: a Markdown file or a skill's folder, the lens name from its file (a skill's from its folder), why it reads as no reviewer (it starts other agents), and the lenses made from this same file, `[{ scope, name, adding? }]` (`adding` for a cleaning not added yet, a failed one left out). At most 40, `more` saying how many were left out. Matching nothing, `folder` `{ label, files, count, missing?, unreadable? }`: the folder it looked in and its names (`unreadable` the error code of one that is there but cannot be read). 409 for a glob refused (`**`, a plugin's name). |
| `POST /api/lens/import` | `{ source, scope, name?, context? }`: Add a lens. The source found, the name free in its scope, a cleaning made, waiting for a free cleaning agent; prints `CLEAN <id>` and answers `{ cleaning, settings }`. With `{ sources: [{ source, name? }], scope, context?, from? }` in place of `source` (a glob's checked matches, 1 to 40): one cleaning each, the same scope; one refused (not found, its name taken, twice in the batch) stops none, and is answered in `refused`, `[{ source, reason }]`, beside `{ cleanings, settings }`; all refused is a 409. |
| `POST /api/lens/add` | `{ id, lens? }`: Add this lens, on a cleaning that is `ready`, with the user's changes (`name`, `scope`, `paths` or `otherwise`, `topics`, `model`, `rules`) checked as `lens.json` is; answers `{ scope, name, settings }`. |
| `POST /api/lens/discard` | `{ id }`: a cleaning's folder removed, unless its agent is still at work; one still waiting for an agent is removed, and none starts on it. |
| `POST /api/lens/save` | `{ scope, name, lens }`: a change to an added lens, any of `on`, `name`, `scope` (its folder moves), `paths` or `otherwise`, `topics`, `model`, `context` and `rules` (`rulesEdited` set when they change); `null` unsets `model` or `context`, `null` or `[]` `topics`. A lens moved to global has its paths recorded absolute. |
| `POST /api/lens/remove` | `{ scope, name }`: an added lens's folder removed. |
| `POST /api/lens/clean` | `{ scope, name }`: Clean it again now: a cleaning made, waiting for a free cleaning agent as Add a lens's, `CLEAN <id>` printed; the lens keeps its version until it ends. |
| `PUT /api/settings` | The whole file, as `settings` comes back from the GET: `{ "theme": "dark", … }`, a `null` or an absent key unsetting it; `{}` resets everything. Writes run one after the other. Answers what the GET does, written; 400 `{ error }` with the key when refused; 409 when the file reads as none; 500 with the file's path when it cannot be written (rights, disk). Every page learns of it through the `settings` event of `/api/events`, as of a page of another server's write, or an editor's. |

`save`, `remove` and `clean` answer 400 for a scope or a name they cannot read; each `/api/lens/*` answers 409
`{ error }` when it refuses the change (a name taken, a cleaning not ready, a
value `lens.json` refuses), and the settings as they then stand otherwise.

The page's **Reset** on an option sends the file without its key; **Reset
everything to defaults** sends the file with only the keys an environment
variable locks, which the page cannot show. Each save builds on the file as
last read, one after the other: two quick changes both land. Offline (the
server unreachable), the page shows the values read-only and says why. A fix
agent never writes the file: `hook.mjs` refuses it, as it would its own
instructions.
