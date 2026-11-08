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
`TRANCHANT_MODEL` sets the three models.

A change applies to the next agent started, the next review, the next post:
never to an agent already running.

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
  "maxReviewAgents": 3, // review agents at a time: reviewers, verifiers and discussions (3)
  "recipe": "~/recipes/mine.json", // the recipe a run without --recipe uses; absent, the plugin's
  "disabledLenses": ["performance"], // lenses of the recipe not run; absent, every lens runs
  "postWith": "gh", // the CLI that opens issues: "auto" (from the remote, the default), "glab" or "gh"
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
| `maxReviewAgents` | integer, 1 to 8                   | The hooks, for the reviewers, verifiers and discussing agents together.                                                                                      |
| `recipe`          | an absolute path, or `~`, `~/…`   | `prepare.mjs`, when the run names no `--recipe`: a regular JSON file under 1 MiB. The page lists its lenses, or says why it cannot read it.                 |
| `disabledLenses`  | up to 12 lens names, `[\w-]{1,40}` | `prepare.mjs`, when the run names no `--recipe` (a run's own recipe runs whole): a lens named is not run, and no other lens takes its files. Every lens off refuses the review: `every lens of the recipe is turned off…`. |
| `postWith`        | `auto`, `glab`, `gh`              | The server (`/api/tracker`, `/api/account`) and `issue.mjs`: `glab` or `gh` names the forge for a host neither tool recognises; on a host the other forge owns (`github.com` with `glab`) the tracker is refused, with the reason, so a token never goes to the wrong forge. `auto` reads the host, as before. MR comments always go through `glab`, whose account the batch bar names. |

Options meant for tests and development stay environment variables:
`TRANCHANT_PORT`, `TRANCHANT_STATE_DIR`, `TRANCHANT_HOOKS`, `TRANCHANT_PAGE`,
`TRANCHANT_POLL_MS`, `TRANCHANT_GLAB` and `TRANCHANT_GH` (other executables),
`TRANCHANT_TOOL_TIMEOUT_MS`, `TRANCHANT_LOCK_WAIT_MS`, `TRANCHANT_MAX_DIFF_MIB`.

## The routes

| Route               | Does                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/settings` | `{ path, settings, values, defaults, locked, recipe, lenses, recipeProblem?, problem? }`: the file's path, the file as it stands (the keys set), the values in force (every key, `null` where nothing is chosen), the defaults, by key the environment variable that locks it, the recipe in force and its lenses' names (`recipeProblem` when it cannot be read), and `problem` when the file reads as none, and why. |
| `PUT /api/settings` | The whole file, as `settings` comes back from the GET: `{ "theme": "dark", … }`, a `null` or an absent key unsetting it; `{}` resets everything. Writes run one after the other. Answers what the GET does, written; 400 `{ error }` with the key when refused; 409 when the file reads as none; 500 with the file's path when it cannot be written (rights, disk). Every page learns of it through the `settings` event of `/api/events`, as of a page of another server's write, or an editor's. |

The page's **Reset** on an option sends the file without its key; **Reset
everything to defaults** sends the file with only the keys an environment
variable locks, which the page cannot show. Each save builds on the file as
last read, one after the other: two quick changes both land. Offline (the
server unreachable), the page shows the values read-only and says why. A fix
agent never writes the file: `hook.mjs` refuses it, as it would its own
instructions.
