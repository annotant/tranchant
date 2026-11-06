---
name: tranchant
description: Tranchant settles a code review from a page. A producer (combined-review
  --tranchant, or any tool) writes a review file of findings; "/tranchant
  <review.json>" or "/tranchant:tranchant <review.json>" imports it and opens
  the page, where the user fixes each finding on the working tree with a
  background agent, posts it on the merge request (someone else's, or the
  branch's own), drops or skips
  it, one at a time or in batches; "/tranchant review [<branch> | <mr url>]"
  reviews a change in the background and streams the findings to the page;
  "/tranchant status" says what runs, "/tranchant stop" ends the server and
  every agent. Use when the user wants
  to settle, triage or act on review findings from a page, to open a review
  file, to check or stop running fixes, or says "/tranchant".
---

# Tranchant

- **SKILL** is this skill's base directory (printed above as "Base directory
  for this skill"). Every script below is `node SKILL/scripts/<name>.mjs`.
- **PROJECT** is the checkout the review is about: the review file's
  `project` field. When the arguments name a review file, that is the file;
  when they name nothing and the conversation just produced a review (a
  `combined-review --tranchant` run), use the file it wrote; otherwise ask
  for the file.

Read the arguments as `[mode] [file]`: the mode is `review`, `stop` or
`status`, or none for the open; any other argument is the review file
(`/tranchant .tranchant/review.json`, `/tranchant ~/Downloads/review.json`).
After `review` come an optional branch, merge request url or folder, and an optional
`--recipe <file>`.

Everything lives in the skill and in the state folder
(`~/.cache/tranchant/<project>/reviews/<id>/`): nothing is installed in the
reviewed repository.

## Open

Call the tool `mcp__tranchant__open` with `{ "review": "<file>" }` and give
the user its answer: it validates and imports the file (`open.mjs`), starts
the server for the session's life, opens the page in the browser and prints
its URL. For `stop`, call it with `{ "stop": true }`; for `status`, with
`{ "status": true }`; for `review`, with `{ "run": true }`, plus `"target"`
(the branch, merge request url or folder) and `"recipe"` when given: the hooks review
the change in the background, one agent per lens, and the page fills as the
findings land and are verified. Never review the change yourself then. Pass
`recipe` only when the user named the file: a recipe's lenses instruct the
reviewers. The plugin's hooks read the page's decisions and start
one background agent per fix, or post each comment with `glab`, with no turn
of yours: never start or message those agents yourself, and never post a
comment yourself. If the tool is missing, the hooks did not load: run
`claude --version`, tell the user Tranchant needs Claude Code 2.1.287 or
later (`claude update`, then a new session) or, if it is already that recent,
that mods may be turned off for this session; then stop.

## Producing a review file

A review file follows `SKILL/../../docs/review-file.md` (the `review.json`
section): one `Finding` per issue, each with its `path`, `line`, an `excerpt`
of the new-side text, `marks` on the exact spots, `problem`, `why`, `fix`,
the `comment` to post when the change is someone else's (optional when it
is yours with an MR), and a `diagram`
(Mermaid) only when a flow needs proving. `ownership` is `ours` when the change has no
MR or the MR's author is the current user, `theirs` otherwise; posting needs
`mr.diffRefs` (`glab mr view <iid> -F json` → `diff_refs`), `ours` too, its
`head_sha` being the `headSha` reviewed. Write the file
outside the reviewed repository, so it can never be committed by mistake:
`~/.cache/tranchant/inbox/<id>.json` is the convention. Then open it. To
show the findings as they land instead, write the envelope with `"status":
"reviewing"` and `"findings": []`; `node SKILL/scripts/open.mjs <file>`
prints `REVIEW <dir>`: open that folder with the tool, add each finding with
`node SKILL/scripts/add.mjs --review <dir> --file <finding.json>`, and end
with `node SKILL/scripts/complete.mjs --review <dir>`.

## Rules

- Never edit `decisions.json` or `review.json` in the state folder: the
  server owns the first and the producer the second.
- Nothing is committed or pushed: the fixes wait on the branch for the user.
- The page source is `SKILL/page/src`; `npm ci && npm run build` at the
  repository root (two levels above SKILL) rebuilds `dist/page.js`.
