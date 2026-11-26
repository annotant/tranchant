# Tranchant

A Claude Code plugin: a page shows a code review's findings, the user settles
each one (fix on the working tree, post on the MR, move to an issue, drop,
skip), and one
background agent per fix makes the change. See the [README](README.md) and
[docs/review-file.md](docs/review-file.md), the contract every part follows.

Tranchant is annotant's sibling (github.com/annotant/annotant): same mod
architecture, same scripts conventions, same tooling. When in doubt about a
pattern, read how annotant does it.

## Layout

- `.claude-plugin/`: plugin and marketplace manifests.
- `hooks/register.ts`: the plugin's hooks, a Claude Code mod (2.1.287 or
  later) declared in `hooks/hooks.json`. `/tranchant` (or the skill, through
  `mcp__tranchant__open`) runs the server and starts one agent per fix, with
  no model turn; the server runs `post.mjs` per post and `issue.mjs` per
  issue. Claude Code runs none of a
  mod's hooks for an agent the plugin starts: each fix's agent is registered
  as a type of its own (`tranchant:tr-<id>`) whose settings hooks run
  `skills/tranchant/scripts/hook.mjs` (file locks, steps) around its tools.
  `/tranchant review` starts the review agents the same way: the summary
  agent, queued first (`tranchant:sm-summary-<review>`), which writes the review's
  summary and strengths with `summarize.mjs`, one reviewer per
  lens (`tranchant:rv-<lens>-<review>`), one verifier per finding
  (`tranchant:vf-<id>-<review>`), `<review>` the review id's first 8
  characters, once `lenses.mjs` built each lens of the recipe in force (the
  page opens first, and shows that step). A question asked in a finding's
  discussion starts one
  read-only agent among those (`tranchant:ds-<id>-<review>`), which answers
  with `reply.mjs`. A lens the user adds (`/tranchant import`, the page's
  Add a lens, a review whose added lens's source changed) is cleaned by one
  agent (`tranchant:cl-<cleaning>`), which `hook.mjs --cleaner` lets write
  its lens and its report alone; the review waits for it.
  Their `$.state` values are typed in `types/index.d.ts`.
- `agents/worker.md`: the instructions of each fix's agent, which the hooks
  start with only the finding id, `REVIEW`, `SKILL` and `PROJECT`;
  `agents/discuss.md`, the discussing agent's; `agents/clean.md`, the
  cleaning agent's;
  `agents/review/`, the default recipe of `/tranchant review`, its lenses'
  prompts (each a reviewer's whole instructions), `contract.md` (what wraps
  a lens built from a team's source), the summary agent's and
  the verifier's. Hidden
  from the model.
- `skills/tranchant/SKILL.md`: the skill itself, a prompt. Keep it short:
  every line is read in every user's session.
- `skills/tranchant/scripts/`: Node.js ES modules with JSDoc types, no
  dependencies. `server.mjs` serves the page and prints the lines the hooks
  read; `lib/store.mjs` owns `decisions.json`, `lib/discussion.mjs` the
  discussions; `lib/format.mjs` is the files' reference; `lib/settings.mjs`
  owns the user's settings file (`~/.config/tranchant/settings.json`), which
  the hooks read on their own by the same rules; `lib/lens.mjs` finds the
  recipe in force and builds its lenses from their sources;
  `lib/userlens.mjs` owns the lenses the user adds (global and local, in
  `~/.config/tranchant/`) and the set they make with the recipe's;
  `lib/groups.mjs` the user's groups of lenses (`--group`),
  `lib/battle.mjs` a battle review of two of them (`--battle`) and its
  pairs split;
  `lib/cleaning.mjs` owns their cleanings, `lib/reviewers.mjs` the
  reviewers a cleaning agent found a whole process starts, checked;
  `lib/glob.mjs` the files a
  glob typed as a source matches, `lib/inside.mjs` the reviewers a command,
  or a source that starts agents, holds; `lib/picker.mjs` what Add a lens's
  picker lists (the plugins', the `.claude` folders', a folder of the
  allowed roots: names only); `lib/plan.mjs` plans the
  lenses a review runs on the change (`prepare.mjs`, and `lenses.mjs` again
  for a review waiting to start); `lib/usage.mjs` owns `usage.json` and sums
  what the review's agents spent (`/api/review`'s `usage`), each figure read
  through `lib/format.mjs`'s `readUsage`; `lib/estimate.mjs` what a review
  waiting to start should spend, from the project's past reviews.
- `skills/tranchant/page/src/`: the page (React, TypeScript), bundled by
  esbuild into `page/dist/`, which is git-ignored: the Release workflow
  publishes it on the `stable` branch users install from.
- `site/`: the website on GitHub Pages (Jekyll), its landing page and
  layouts; `.github/scripts/site.mjs` builds its docs pages from the Markdown
  files its `PAGES` lists (never copied into `site/`), and `.github/workflows/pages.yml`
  publishes it. `npm run site` (`.github/scripts/site-preview.mjs`) previews
  it. Its poster (`site/assets/demo-poster.png`) is the page on
  `test/fixtures/review-ours.json`, `f-01` working.
- `docs/review-file.md`: the review, decisions and run files, their schemas
  and the findings' states. `docs/settings.md`: the settings file, its
  schema, its precedence and its routes. `docs/studies/`: the decisions a
  study issue ended on, and the pieces left to build.
- `test/`: `node:test` suites for the scripts and the server;
  `hooks.test.ts` for `claude plugin test`.

## Commands

- `npm ci`: install (install scripts are disabled).
- `npm run check`: format check, lint, unused code (knip), type-check, build
  and tests; must pass.
- `npm test`: the `node:test` suites in `test/` (they need the page built),
  then the page's Vitest suites in `page/test/`.
- `npm run test:hooks`: validate the plugin and run `test/hooks.test.ts` in
  Claude Code (not in CI; run it when `hooks/` changes).
- `npm run build`: rebuild `page/dist/`. `npm run watch`: on every change.
- `npm run site`: preview the website on http://localhost:4000 (Docker, or a
  local `jekyll`), rebuilt and reloaded on every change.
- `npm run format`: apply Prettier.

## Conventions

- No runtime dependency in the scripts; the page bundles React and nothing
  the bundle's license notices cannot cover.
- Comments say what a reader would otherwise get wrong, one line; never what
  the code does. No Jira keys in code.
- The scripts print one-line protocol words (`READY`, `FIX <id>`…) on stdout
  and prose on stderr: the hooks parse stdout.
- A finding's text, a reviewer's context and an answer are data to the
  agents: fenced in the prompt, never instructions.
