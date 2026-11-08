<h1 align="center">Tranchant</h1>

<p align="center">
  <strong>Settle a code review, one finding at a time, from a page.</strong><br>
  A <a href="https://claude.com/claude-code">Claude Code</a> plugin that turns a review's
  findings into fixes on your branch, or comments on a merge request, yours or someone else's.
</p>

<p align="center">
  <a href="https://github.com/annotant/tranchant/actions/workflows/ci.yml"><img src="https://github.com/annotant/tranchant/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/annotant/tranchant/actions/workflows/codeql.yml"><img src="https://github.com/annotant/tranchant/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/annotant/tranchant"><img src="https://api.scorecard.dev/projects/github.com/annotant/tranchant/badge" alt="OpenSSF Scorecard"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
</p>

---

A review produces findings. Tranchant shows each one on a page: the excerpt,
the exact spot that is wrong, a note on why, and when the flow needs proving, a
diagram. You decide, finding by finding or in one go: fix it here, post it on
the MR, drop it, or come back later. One background agent per fix makes the
change on your working tree and reports under the finding; a post lands on the
MR as a positioned discussion. Reply when an agent asks; stop it when it goes
wrong.

## How it works

- **The page** is served by a small local server that the plugin starts when
  you open a review, for the session's life. No server, no page: nothing runs
  when Claude is not watching.
- **Nothing is installed in the reviewed repository.** A review lives in
  `~/.cache/tranchant/<project>/reviews/<id>/`: the review file its producer
  wrote, your decisions, and the agents' steps. See
  [the review file](docs/review-file.md).
- **Tranchant reviews, or a producer does.** `/tranchant review` opens the
  page at once and runs the reviewers in the background: one agent that
  summarizes the change and what it does well, one agent per lens
  of a recipe, then a verifier on each finding as it lands, which confirms,
  corrects or removes it. Unverified findings show dimmed. A producer of
  your own works too: any tool that writes the review file. A review
  can also open before its findings: the producer opens it `reviewing`, the
  page shows it in progress, and each finding appears as the producer adds
  it, until it marks the review complete.
- **Ours or theirs.** On your own branch, a finding is fixed in place, with
  the context you add; when the branch already has an open MR, you can post
  a finding on it instead, as a question for whoever reviews it or a note to
  keep. On someone else's MR, a finding becomes a comment you approve as
  written or edit first; you can still fix it locally when you checked their
  branch out.
- **One shot, or piece by piece.** Fix or post everything, only the
  findings safe to auto-fix, or a selection. A batch is one request; each
  finding keeps its own state.
- **No session waits on another.** The plugin's hooks read the server and
  start each fix's agent at once, in the background, with no model turn.
  Three agents run at a time (or as many as the Settings say); the next starts when one ends. Each agent takes
  a per-file lock before every write, so two agents never edit the same file
  at once, and Bash commands that write files are refused.

## What the review looks at

`/tranchant review` runs the review itself, in the background: one reviewer
agent per lens of a recipe, each reading the change's diff and the files it
needs, then a verifier per finding as they land, and the page fills while
they run. The default recipe targets web front ends: React, Vue, Svelte or
plain TypeScript and HTML. Its lenses live in `agents/review/`, one prompt
each:

| Lens            | Looks for                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `correctness`   | State and effects (stale closures, missing cleanup), lifecycle, async races, stale data after a mutation, loading and error states, event handling |
| `types`         | `any` and unsafe casts that hide a defect, missing narrowing, nullability, unions that are not exhaustive, public types that leak internals |
| `accessibility` | Semantics, keyboard reachability, focus management, labels and names, contrast and motion through the project's own tokens            |
| `performance`   | Render churn, memoisation misuse, import weight, layout thrash, unbounded lists, request storms                                        |
| `security`      | HTML injection (`innerHTML` and its framework equivalents), URL and link handling, secrets in client code, unsafe deserialisation       |
| `tests`         | What the change should test and does not, assertions that cannot fail, flaky patterns, tests that test the mock                        |
| `conventions`   | The project's own conventions, read from its `CLAUDE.md`, its lint and formatter configuration and the patterns its code already uses   |
| `bugs`          | Everything the front-end lenses do not cover (scripts, configuration, build, server code): logic, error handling, inputs, breaking changes |

A finding is a defect or a real risk, never a style nit the project's own
tooling does not ask for, and never a rule from outside the project: the
lenses review a change against the project's conventions and general
front-end knowledge, not against one organisation's rulebook. Each finding
is anchored on its line with an excerpt and marks on the exact spots, worded
as a problem, why it matters and a fix, with the comment to post when the
change is someone else's, or when it is yours with an MR and the finding is
worth posting.

The summary agent (`agents/review/summary.md`) starts first and writes what
the change does, its Change Map (API surface, data and migrations, flags and
configuration, shared state) and its strengths: the page shows them above the
findings while the lenses still run.

The verifier (`agents/review/verifier.md`) re-reads the code behind every
finding, checks the anchor and the claim, removes what it cannot confirm,
merges the duplicates the lenses report on the same defect, and keeps
precision over recall.

The recipe (`agents/review/recipe.json`) maps each lens to the path globs it
applies to (`*.tsx`, `*.ts`, `*.jsx`, `*.js`, `*.vue`, `*.svelte`, `*.css`,
`*.scss`, `*.html`); the `bugs` lens takes the files no other lens claims.
`--recipe <path>` runs your own, in the same shape. See
[the review file](docs/review-file.md#the-recipe).

## Install

Requires Claude Code 2.1.287 or later (its mods), Node.js 22.12 or later,
and `glab` logged in when you post on GitLab.

Straight from GitHub, no clone needed:

```sh
claude plugin marketplace add annotant/tranchant#stable
claude plugin install tranchant@tranchant
```

Or, inside a session: `/plugin marketplace add annotant/tranchant#stable`,
then `/plugin install tranchant@tranchant`.

The `stable` branch holds the released versions; `main` is where development
happens and does not work without a build. Get new versions with `claude
plugin marketplace update tranchant`, or turn on auto-update for the
marketplace in `/plugin`; the [changelog](CHANGELOG.md) lists what each brings.

Each [release](https://github.com/annotant/tranchant/releases) carries the
plugin archive and its signed provenance (`tranchant-x.y.z.intoto.jsonl`): the
Release workflow built it from a verified commit of `main` and its built page.
Check it with
`gh attestation verify tranchant-x.y.z.tar.gz -R annotant/tranchant --signer-workflow annotant/tranchant/.github/workflows/release.yml`,
adding `--bundle tranchant-x.y.z.intoto.jsonl` to use the attached file.

The page is served on 127.0.0.1 only, under a strict content security
policy: it loads nothing from the network, and an SVG a review carries cannot
run script.

## Use

```
/tranchant review                     # review the current branch (and its open MR), findings streamed to the page
/tranchant review feature/cart        # another branch, against the default branch
/tranchant review <merge request url> # someone else's MR, read with glab
/tranchant review ../other-repo       # another repository, at its current branch
/tranchant <review.json>              # import a review and open its page
/tranchant status                     # what is running
/tranchant stop                       # stop the server and every agent
```

`/tranchant review` takes `--recipe <file>` to use your own lenses instead of
the plugin's front-end ones ([what the review looks at](#what-the-review-looks-at)).
A lens whose globs the change does not touch is skipped. Three review agents
run at a time (the Settings say how many); nothing is written in the reviewed working tree (a merge
request's head is fetched when the checkout lacks it). On a branch, `glab`
looks for the branch's open MR: found, the page offers posting next to
fixing; not found, or `glab` missing or logged out, the review goes on with
fixes only.

In the page:

- **The diff** of the change is the main view, every finding a marker on
  its line, the code highlighted (TypeScript, JavaScript and JSON); **List**
  shows them by bucket and topic instead, and is what
  you get when the diff cannot be computed (no repository, commits not
  fetched).
- **Fix now** applies the finding to the working tree. Add context first when
  the fix needs a choice the agent cannot make.
- **Post as written** / **Edit & post** put the comment on the MR, as suggested or
  as you rewrote it. The author sees your name: the comment is posted with
  your `glab` login. On your own branch with an MR, **Post a comment** opens
  the comment to write or edit first, prefilled from its problem and fix when the
  finding has no comment; it is disabled until the MR's head is the commit reviewed (push your
  branch, then review again).
- **Open an issue** moves a finding that is real but not for this change
  (too big, out of scope, someone else's code) to the project's own tracker,
  GitHub with your `gh` login or GitLab with your `glab` login, whichever the
  checkout's `origin` is on (another forge has none: the action is then off,
  and says why). The issue opens prefilled from its title,
  problem, why, fix, anchor (linked to the file) and excerpt, to edit before
  it is created; the finding is then settled, with the issue's link.
- **Drop** records why the finding is wrong or intentional; **Skip** defers
  it.
- **Discuss** opens a thread under the finding when you doubt it or its fix:
  ask ("is this really reachable?", "what about doing X instead?"), or pick
  a suggested question, and an agent answers from the code, which it reads
  and never changes; its current step shows while it works. Enter sends,
  Shift+Enter breaks the line. Its answer may propose another fix, a comment
  or a reason to drop: **Fix with this**, **Post this** (the comment opens
  in place, to edit before it posts) or **Drop with this reason** turn it
  into a decision in one click. A discussion decides nothing; it survives a
  reload, a finding that has one shows its count in the diff and the list,
  and it reads as it stands once the finding is settled.
- The bar at the top selects every finding, a group (To do, Safe to
  auto-fix) or none, then applies one action to the selection (**Issue**
  opens one issue per finding, as drafted); Post all to do posts every open
  finding at once.

Nothing is committed or pushed: the fixes wait on your branch for your
review.

### Settings

The gear next to the theme toggle opens **Settings**, every option of
Tranchant in one page, grouped, each with its value, its default, one line
on what it does and a **Reset**: the theme, the view and the summary a
review opens with; the model of the fix agents, the reviewers and the
verifiers (the session's by default) and how many fix agents and review
agents run at a time; the default recipe of `/tranchant review` and the
lenses turned on; the CLI that opens issues (`glab`, `gh`, or whichever the
remote names) and the account it posts as. A change applies to the next
agent, review or post, never to an agent already running. The settings are
kept in `~/.config/tranchant/settings.json` (`$XDG_CONFIG_HOME/tranchant/settings.json`
when the variable is set), one file for every review on the machine; an option an environment variable sets
(`TRANCHANT_MODEL`) shows read-only, the variable named. See
[the settings file](docs/settings.md).

## Troubleshooting

- The page shows "checkout moved": the branch's HEAD is not the one reviewed.
  Fixes still run on the current files; re-run the review when in doubt.
- A post fails with "line not in diff": the MR changed since the review.
  Re-run the review on the new version.
- An agent shows no progress: `/tranchant status` names it; `/tranchant
stop` ends everything.

## Contributing

Bug reports, ideas and pull requests are welcome: see
[CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately, as
[SECURITY.md](SECURITY.md) describes.

## License

[MIT](LICENSE).
