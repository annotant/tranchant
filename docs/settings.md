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
  "name": "abac", // [\w-]{1,40}: its findings' ids start with it; given (--name abac), else from its source: code-reviewer-abac
  "source": "workflow:code-reviewer-abac", // a plugin's skill, agent or command, or a path (absolute for a global lens)
  "reviewer": "perf", // optional: one reviewer written inline in the source (a process's agent with a prompt of its own), by its name as the agent wrote it; the lens is that one alone, cleaned again from the source, by this name, when the source changes, with its last extract (extract.md, beside lens.json)
  "on": true,
  "paths": ["**/*.ts"], // or "otherwise": true, with "paths": []
  "topics": ["Security & Permissions"], // optional: what its findings file under
  "model": "auto", // optional: its reviewer's model; auto (Auto-detect, a lens added's default) or an id; absent, the reviewers'
  "rules": "- A route with no policy check is a finding, bucket review.", // its added instructions
  "rulesEdited": true, // the user edited them: kept as they are when it is cleaned again
  "cleaned": {
    "at": "2026-11-18T09:12:00Z",
    "sourceHash": "3f9a…", // SHA-256 of the source's text at its last cleaning, its frontmatter's model: line left out
    "version": "2.4.0", // its plugin's, when it has one
    "removed": [{ "what": "Sliced mode", "why": "orchestration" }],
    "added": ["Topic: Security & Permissions only."],
  },
  "failedCleaning": { "at": "…", "reason": "…", "sourceHash": "…" }, // the last cleaning again that failed, for that source
}
```

A `lens.json` an earlier Tranchant wrote with a `context` key runs without
it: the key is ignored, and dropped at the lens's next save.

**A lens's model.** `auto`, **Auto-detect**, the default of a lens the user
adds: the model its source's frontmatter names (`model:` of an agent, a
skill or a command), an alias (`opus`, `sonnet`, `haiku`, with `[1m]` or
not) passed as Claude Code takes it; else, when the source names none, says
`inherit`, names a model that is not Claude's or has a frontmatter that
cannot be read, the model of the session that runs `/tranchant review`,
read when the reviewer starts (Settings › Agents' *Model for reviewers* is
skipped). The source is read again at each review's Lenses step, where its
hash is: its `model:` line is left out of the hash, so a source that changes
only its model changes the lens's with no new cleaning (a lens cleaned by
an earlier Tranchant, which hashed the whole source, is cleaned once more
the first time). When the change under review edits an added lens's
source, its model is not read from it: the session's runs, said on its
row, so a branch never picks the model of the lens that reviews it. Absent, the reviewers' model (`reviewModel`, else the
session's); an id, that model. `TRANCHANT_MODEL` wins over all three. A
recipe's lens takes `auto` too, in the recipe or in `lensModels`.

**The re-import.** Each `/tranchant review`, in its Lenses step, hashes
again the source of every added lens it runs. It is read where it lies (a
plugin's install, a path from the project's working tree), never at BASE. A
changed hash cleans that lens again before the reviewers start, the rules the
user edited given to the agent and kept; the rest of its settings stay as the
user set them. When the change under review is what
changed the source (a file of the repository it touches), the lens is not
cleaned again: its last version runs, said on the page, so a branch never
rewrites the lens that reviews it. A cleaning that fails leaves the lens's
last version running, said on the page, and is not tried again for the same
source (Clean it again now does); a cleaning stopped by `/tranchant stop`
counts as none (one whose turn ended meanwhile, or that had completed, is
checked as any). A source that cannot be found (a file gone, a plugin turned
off) refuses the review, as a recipe's lens does. A review already running
keeps the version it started with. A lens's files are its own even turned
off: the `otherwise` lens never takes them, and one `otherwise` lens runs at
most, the first in precedence.

The page shows each lens with its switch, where it comes from, where it
runs, its topics and the model a review would run it on (*auto ·
claude-opus-5-5*, *reviewers' · the session's model*, an id; on
Auto-detect, amber when its source asks for a model that is not Claude's or
its frontmatter cannot be read), and, opened, its settings (the Model select
says beside it what it resolves to, and why; the Source field, its
frontmatter's `name`, `tools` and `model`) and **What the
reviewer reads**: the prompt whole, and what the cleaning removed and added.
A recipe's lens is read-only but its switch (`disabledLenses`) and its model
(`lensModels`).

Each row names its origin: **built-in** (the recipe's), **picked up** (added
from an agent, a skill or a command: a plugin's, or a file in an `agents` or
`commands` folder, or a skill's `SKILL.md`) or **custom** (added from any
other file, a checklist); a lens whose `lens.json` cannot be read names
none, and shows under no origin but all. A filter above the groups narrows them by name (as
typed, any case), by origin and by finding kind (a topic the lens files
under; one that declares none files under any); the filters combine, each
group counts its matches and hides with none, and **Clear the filters** sets
them back; the lens whose editor is open stays shown. The plugin's recipe declares each lens's topics, the ones its
prompt names.

## Groups of lenses

A **group** is a named set of lenses, chosen among every lens that can run
on the project: the project's own, the global ones and the built-in ones;
a lens can be in several groups. `/tranchant review --group <name>` (`group`
on the tool) runs that group's lenses, **whatever their switches**: the
switches are *Every lens that is on*, what a review runs with no
`--group` until the project's **default group** names one. A lens keeps
its paths in a group: it still reads only the files of the change they
match. One lens per name in a group (a finding's id starts with its lens's
name); outside groups, the project's lens still replaces the built-in one
of its name. A run with `--recipe` runs that recipe whole, no group.

The groups live with the project, outside any repository:
`$XDG_CONFIG_HOME/tranchant/projects/<project hash>/groups.json` (else
`~/.config/…`), beside its local lenses:

```jsonc
{
  "version": 1,
  "default": "backend", // optional: what a review runs with no --group; absent, every lens that is on
  "groups": [
    {
      "name": "backend", // [\w-]{1,40}, unique: --group backend
      "lenses": [
        { "scope": "local", "name": "money" }, // local, global or recipe; one lens per name
        { "scope": "recipe", "name": "security" },
      ],
      "removed": [{ "scope": "global", "name": "sql" }], // the lenses removed since a review of it last ran: each review of it says them until one runs
    },
  ],
}
```

A lens removed from Settings › Lenses leaves every group of the project,
recorded in `removed`, which every review of the group says until one
runs (saving the group forgets them: the person saw it as it is); renamed
or moved to the other scope, it stays in them. A group naming a lens that is not among the lenses any more (a
global lens removed from another project, a recipe changed) runs without
it, and its review says so. Deleting a group never deletes its lenses; the
default, when it was, is every lens that is on again. A groups file this
Tranchant cannot read is never written over: a review with no `--group`
then runs every lens that is on, said, and one with `--group` is refused.

**Settings › Lenses** has two tabs, **Lenses** and **Groups**, each with its
count. Groups lists each group, its lenses, its `--group` and **Edit**: a
name, and its lenses checked in one list laid out like the Lenses tab, with
a name filter, **Check the N shown**, a checkbox on each scope's heading
(a lens whose name is checked already stays; else the first in precedence, this project, global, built-in, is checked; a note names those left
unchecked), and the token warning past 12; **Save the group**,
**Duplicate** (B starts from A) and **Delete the group**. The **Default
group** select sits above them. On the Lenses tab, each lens names its
groups (a chip opens the group), and the filter has a **Group** select.
Before Start ([waiting to start](review-file.md#waiting-to-start)), a
**Group** select changes the lenses the review runs, and the **Battle
review** tab runs two groups on the same change at once and compares them
([a battle review](review-file.md#a-battle-review)).

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
  "lensModels": { "bugs": "claude-haiku-5-5" }, // by lens of the recipe, its reviewer's model, or auto
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
| `GET /api/settings` | `{ path, settings, values, defaults, locked, recipe, recipeFrom, lenses, lensSet, cleanings, groups, recipeProblem?, problem? }`: the file's path, the file as it stands (the keys set), the values in force (every key, `null` where nothing is chosen), the defaults, by key the environment variable that locks it, the recipe in force for the review's project (`recipe` its file, `BASE:<path>` for the project's; `recipeFrom` `local`, `project`, `settings` or `plugin`; `lenses` its lenses' names; `recipeProblem` when it cannot be read); `lensSet`, `{ dirs: { global, local }, lenses }`, every lens that could run on the project, the project's, the global ones and the recipe's, each `{ name, scope: "local" \| "global" \| "recipe", on, runs, replaces?, source, version?, origin?: "picked" \| "custom", sourceKind?: "agent" \| "skill" \| "command", paths, otherwise?, topics?, model?, detected?, frontmatter?, rules?, rulesEdited?, cleaned?, failedCleaning?, stale?: "stale" \| "failed", problem?, fix?, history? }` (`history`, its average a review over its last complete reviews of the project, `{ tokens, confirmed, runs }`: [a lens's average](review-file.md#waiting-to-start); `detected`, what Auto-detect finds in its source whatever its model, `{ file, why: "source" \| "none" \| "inherit" \| "foreign" \| "unreadable", model?, id?, asked?, problem? }` (`model`, `id` and `asked` with `source`, `asked` with `inherit` and `foreign`, `problem` with `unreadable`); `frontmatter`, its source's `name`, `tools` and `model`); `cleanings`, the lenses being cleaned or waiting to be added, each `{ id, createdAt, name, scope, again, source, version?, from?, reviewer?, state: "cleaning" \| "ready" \| "process" \| "failed", waiting?, reason?, process?, reviewers?, more?, report?, domain? }` (`waiting` while it waits for a free cleaning agent, `from` the glob or the process it was matched by, `reviewer` the one written inline in the source it is; `process`, a whole review process its agent found: `process` how it routes the review, `reviewers` those it starts, the ones offered first (12 at most, `more` past them), then those refused (12 at most), each `{ name, kind: "file", source, already? }`, `{ name, kind: "inline", label, already? }` (`label` its name as its agent wrote it; its instructions stay on the server) or `{ name, kind: "refused", file, reason }`; it is listed until each one offered is added, `picked` recording those that are); `groups`, the project's groups of lenses, `{ file, default?, list: [{ name, lenses: [{ scope, name }] }], problem? }` (`problem` when `groups.json` reads as none); and `problem` when the file reads as none, and why. |
| `GET /api/lens/prompt?scope=&name=` | `{ prompt }`: the prompt a lens's reviewer reads, built as a review builds it (`scope` `recipe`, `global` or `local`). 404 for no such lens, 409 with the reason when it cannot be built. |
| `GET /api/lens/matches?source=` | `{ matches, more?, folder? }`: the files a glob (`*`, `?`, within one folder: no `**`; a `[` is part of the path) matches from the project's root, `~/` or an absolute path, each `{ source, name, kind?, notReviewer?, already?, starts?, more? }`: a Markdown file or a skill's folder, the lens name from its file (a skill's from its folder), `agent`, `skill` or `command` from the folder right above it, why it reads as no reviewer (it starts other agents), and the lenses made from this same file, `[{ scope, name, adding? }]` (`adding` for a cleaning not added yet, a failed one left out). A command, or a file that starts agents it names, has `starts` (and `more`, those past 12): the reviewers it starts, as `GET /api/lens/inside` lists them but written as the glob is (from the project, `~/` or absolute), each with its `already`; it is never a lens itself. At most 40, `more` saying how many were left out. Matching nothing, `folder` `{ label, files, count, missing?, unreadable? }`: the folder it looked in and its names (`unreadable` the error code of one that is there but cannot be read). 409 for a glob refused (`**`, a plugin's name). |
| `GET /api/lens/inside?source=` | `{ inside, name? }`: the reviewers inside a source typed in Add a lens (`plugin:name`, a plugin's command among them, or a path), read from its file with no agent. `null` for a single reviewer, or a source not found (the import says why), with `name`, the lens name it gets when none is given: a file's name without its extension (a skill's `SKILL.md`, its folder's), a `plugin:name`'s name without the plugin. Else `{ kind, label, starts, more? }`: `kind` `command`, `agent` or `skill`, from the folder the file lies in right above it (`commands/`, `agents/`; a skill's `SKILL.md`); `starts` the skills and agents it names that resolve, in the order it names them, each file once: beside it (its plugin's root, or the folder its `commands`, `agents` or `skills` folder lies in), the project's `.claude`, then the user's, by name (a name of one plain word only quoted, in backticks or as `/name`; never the name part of a `plugin:name`), and an installed plugin's turned on written `plugin:name` (not `tranchant:`). One that itself starts agents is left out. Each `{ source, name, kind, already? }`, 12 at most, `more` saying how many were left out. A file of the source's own name (a copy of it, `~/.claude/skills/<its name>`) is never among them. A command always has `inside`, `starts` empty when it names none that resolves (its agents written in it, or a plugin's not installed or turned off), with `name`, the lens name it gets: imported, its cleaning agent reads it and makes one lens of it, or lists the reviewers it starts. An agent or a skill has `inside` only when it starts other agents (its `tools` or `allowed-tools` give it `Task` or `Agent`, or it names `subagent_type`) and names one that resolves. A source whose `starts` is not empty is refused by the import, before any cleaning, with the reviewers to add instead. |
| `GET /api/lens/catalog` | What Add a lens's picker lists, names only, no file read: `{ plugins, pluginsError?, project, user, roots }`. `plugins`, each installed plugin (Tranchant's own left out, its lenses built in), sorted, `{ name, version?, folder, enabled, items, problem?, more? }`: `enabled` false for one a settings file turns off for this project (its lens would not build); `folder` its install folder from `~/` or absolute; `problem` why some of its items cannot be listed (its install folder missing, a `skills/`, `agents/` or `commands/` folder unreadable); `more` the items past the 500 listed per folder. `items`, its `skills/<name>/SKILL.md`, `agents/*.md` and `commands/*.md`, each `{ kind, name, source, already? }`, `source` `plugin:name` unless a skill or an agent of the same name takes it first, or the name is not one `plugin:name` can write (then its path), `already` as `GET /api/lens/matches` says it. `pluginsError` when Claude Code's register cannot be read. `project` and `user`, the project's `.claude` and Claude Code's folder, `{ folder, items, problem?, more? }`, each item's `source` its path (a skill's folder). `roots`, the folders `GET /api/lens/folder` may list, as the user reads them. |
| `GET /api/lens/folder?root=&path=` or `?go=` | A folder for the picker's Files tab, names only: `{ root, path, label, entries, more? }`. `root` `project`, `user` (Claude Code's folder) or `plugins` (its `path` starts with a plugin's name; empty, the installed plugins, Tranchant's left out); `path` inside it, `/`-separated. `go`, a folder typed (from the project, `~/` or absolute), placed by its path alone in the deepest root it lies in. The way down is walked one folder at a time and refused at the first link leaving its root or leading to a hidden place, before anything past it is looked at. Each entry `{ name, kind, source?, reason?, already? }`, folders first, 500 at most (`more` the rest): `folder`; `file`, a Markdown file, with its `source` (a plugin's own skill, agent or command `plugin:name` when that resolves to it, else its path); and shown, never opened: `hidden` (a name starting with a dot, `.claude` aside), `link` (one leaving its root, leading to a hidden place, or broken), `unreadable` (a folder that cannot be read), `other` (not a Markdown file, a name holding `*` or `?`, or one that cannot be told). 409 `{ error, roots }` for a folder outside the roots, hidden, through a link leaving one, missing, unreadable or not a folder, an unknown plugin (Tranchant's own among them), or a register of plugins that cannot be read: the same refusal outside the roots whether it is there or not. 400 without a valid `root` or `go`, or a path past 1024 characters. |
| `POST /api/lens/import` | `{ source, scope, name? }`: Add a lens. The source found, the name (absent, the one `GET /api/lens/inside` gives) free in its scope, a cleaning made, waiting for a free cleaning agent; prints `CLEAN <id>` and answers `{ cleaning, settings }`. With `{ sources: [{ source, name? }], scope, from? }` in place of `source` (a glob's checked matches, 1 to 40): one cleaning each, the same scope; one refused (not found, its name taken, twice in the batch) stops none, and is answered in `refused`, `[{ source, reason }]`, beside `{ cleanings, settings }`; all refused is a 409. |
| `POST /api/lens/reviewers` | `{ id, picks: [{ index, name? }], scope? }`: Add the checked ones, on a cleaning that is `process`: one cleaning per reviewer picked (by its index in `reviewers`, with the name given, absent its own), queued as if each had been added on its own, in the process's scope unless `scope` names another; a file is cleaned as its own source, an inline reviewer from the process's source with its name (`reviewer`). One refused stops none and is answered in `refused`; all refused is a 409, and so is a cleaning that is no process, or an index of a `refused` reviewer. The process is done (`added`) once each reviewer it offers is made a lens of; one refused, or left unchecked, stays to pick; prints `CLEAN <id>` for each, answers `{ cleanings, refused, settings }`. |
| `POST /api/lens/add` | `{ id, lens? }`: Add this lens, on a cleaning that is `ready`, with the user's changes (`name`, `scope`, `paths` or `otherwise`, `topics`, `model`, `rules`) checked as `lens.json` is, its `model` `auto` unless the changes name one (`null`, the reviewers'); answers `{ scope, name, settings }`. |
| `POST /api/lens/discard` | `{ id }`: a cleaning's folder removed, unless its agent is still at work; one still waiting for an agent is removed, and none starts on it. |
| `POST /api/lens/save` | `{ scope, name, lens }`: a change to an added lens, any of `on`, `name`, `scope` (its folder moves), `paths` or `otherwise`, `topics`, `model` and `rules` (`rulesEdited` set when they change); `null` unsets `model`, `null` or `[]` `topics`. A lens moved to global has its paths recorded absolute; renamed or moved, it stays in its groups. |
| `POST /api/lens/remove` | `{ scope, name }`: an added lens's folder removed, and the lens out of every group of the project; answers `removedFrom`, the groups it left. |
| `POST /api/lens/group/save` | `{ name?, group: { name, lenses: [{ scope, name }] } }`: a group made, or the group `name` changed (renamed, it stays the default when it was): a name free among the groups, one lens at least, one per name. |
| `POST /api/lens/group/remove` | `{ name }`: a group deleted, never its lenses; the default, when it was, is every lens that is on again. |
| `POST /api/lens/group/default` | `{ name }`: the group a review runs with no `--group`; `null`, every lens that is on. |
| `POST /api/lens/clean` | `{ scope, name }`: Clean it again now: a cleaning made, waiting for a free cleaning agent as Add a lens's, `CLEAN <id>` printed; the lens keeps its version until it ends. |
| `PUT /api/settings` | The whole file, as `settings` comes back from the GET: `{ "theme": "dark", … }`, a `null` or an absent key unsetting it; `{}` resets everything. Writes run one after the other. Answers what the GET does, written; 400 `{ error }` with the key when refused; 409 when the file reads as none; 500 with the file's path when it cannot be written (rights, disk). Every page learns of it through the `settings` event of `/api/events`, as of a page of another server's write, or an editor's. |

`save`, `remove` and `clean` answer 400 for a scope or a name they cannot read, the group routes for a group's name; each `/api/lens/*` answers 409
`{ error }` when it refuses the change (a name taken, a cleaning not ready, a
value `lens.json` refuses), and the settings as they then stand otherwise.

The page's **Reset** on an option sends the file without its key; **Reset
everything to defaults** sends the file with only the keys an environment
variable locks, which the page cannot show. Each save builds on the file as
last read, one after the other: two quick changes both land. Offline (the
server unreachable), the page shows the values read-only and says why. A fix
agent never writes the file: `hook.mjs` refuses it, as it would its own
instructions.
