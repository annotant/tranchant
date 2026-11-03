<h1 align="center">Tranchant</h1>

<p align="center">
  <strong>Settle a code review, one finding at a time, from a page.</strong><br>
  A <a href="https://claude.com/claude-code">Claude Code</a> plugin that turns a review's
  findings into fixes on your branch, or comments on someone else's merge request.
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
  page at once and runs the reviewers in the background: one agent per lens
  of a recipe, then a verifier on each finding as it lands, which confirms,
  corrects or removes it. Unverified findings show dimmed. A producer of
  your own works too: any tool that writes the review file. A review
  can also open before its findings: the producer opens it `reviewing`, the
  page shows it in progress, and each finding appears as the producer adds
  it, until it marks the review complete.
- **Ours or theirs.** On your own branch, a finding is fixed in place, with
  the context you add. On someone else's MR, a finding becomes a comment you
  approve as written or edit first; you can still fix it locally when you
  checked their branch out.
- **One shot, or piece by piece.** Fix or post everything, only the
  auto-addressable findings, or a selection. A batch is one request; each
  finding keeps its own state.
- **No session waits on another.** The plugin's hooks read the server and
  start each fix's agent at once, in the background, with no model turn.
  Three agents run at a time; a fourth starts when one ends. Each agent takes
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
change is someone else's.

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

```
/plugin install tranchant --marketplace annotant/tranchant
```

The page is served on 127.0.0.1 only, under a strict content security
policy: it loads nothing from the network, and an SVG a review carries cannot
run script.

## Use

```
/tranchant review                     # review the current branch, findings streamed to the page
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
run at a time; nothing is written in the reviewed working tree (a merge
request's head is fetched when the checkout lacks it).

In the page:

- **The diff** of the change is the main view, every finding a marker on
  its line; **List** shows them by bucket and topic instead, and is what
  you get when the diff cannot be computed (no repository, commits not
  fetched).
- **Fix now** applies the finding to the working tree. Add context first when
  the fix needs a choice the agent cannot make.
- **Keep & post** / **Edit & post** put the comment on the MR, as suggested or
  as you rewrote it. The author sees your name: the comment is posted with
  your `glab` login.
- **Drop** records why the finding is wrong or intentional; **Skip** defers
  it.
- The bar at the top applies one action to all findings, to the
  auto-addressable ones, or to the ones you ticked.

Nothing is committed or pushed: the fixes wait on your branch for your
review.

## Troubleshooting

- The page shows "checkout moved": the branch's HEAD is not the one reviewed.
  Fixes still run on the current files; re-run the review when in doubt.
- A post fails with "line not in diff": the MR changed since the review.
  Re-run the review on the new version.
- An agent shows no progress: `/tranchant status` names it; `/tranchant
stop` ends everything.

## License

[MIT](LICENSE).
