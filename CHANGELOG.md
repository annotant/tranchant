# Changelog

Notable changes to Tranchant. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org). Users receive a change when it is
released to the `stable` branch.

## Unreleased

### Added

- **Your team's review process, as lenses.** `/tranchant import [<source>]`
  reads a skill and the agents it starts, an agent or a file, and writes a
  recipe that references them, in the project (`.tranchant/recipe.json`,
  shared) or for you alone; the page's Settings show it, with what could not
  become a lens, before **Use this recipe** puts it in force.
- **Lenses rebuilt at every review.** `/tranchant review` builds each lens
  from its source (a plugin's skill or agent, a path, or one of Tranchant's,
  with an add-on), wrapped in a shared contract, before any reviewer starts:
  the page shows the step, lens by lens, and what changed since the last
  review. A source that cannot be found refuses the review, with the reason
  and the fix, on the page and in the terminal. A recipe can set a lens's
  model, its topics, the skills it reads, and extend Tranchant's own lenses.

### Changed

- The project's recipe is read at the review's base, never from the change
  under review; the local recipe and the project's come before the
  settings'. The Settings show the recipe in force, where it comes from, and
  each lens's source and status.

## 0.4.0 - 2026-11-10

### Added

- **Your reviewers' comments in the page.** `/tranchant comments [<url>]`
  reads the unresolved review threads of your pull request (`gh`) or merge
  request (`glab`), the current branch's by default, one finding per
  thread on its line, with the comment, its replies and its link; a thread
  whose line moved since sits on its file's header. Fix it with an agent
  (the comment its fenced brief), reply on the thread from the page,
  prefilled after a fix, and resolve it if you choose, move it to an issue
  or skip it. Run it again to pull new comments in, your decisions kept.
  Your own comments are marked in the thread, your replies show in it as
  soon as you send them, and an agent can discuss a comment with you,
  drafting a reply you edit and send.
- **Unfold the diff's context.** Above, between and below the hunks, a bar
  says how many lines the diff hides (below the last one, that there are
  more, until the file's length is known) and shows them: all of them, or
  for a long gap 20 more next to either hunk. Unfolded lines read as
  context, numbered and highlighted, and a finding on one moves from the
  file's header to its line. The server reads them at the diff's head,
  only for a file of the diff (`GET /api/lines`).

### Changed

- **Posting stays on the finding.** After a comment or a reply, the page no
  longer moves to the next finding: you watch it land, as with an issue.
  Fix, Drop and Skip still move on.

## 0.3.1 - 2026-11-08

### Added

- **Two new lenses.** `silent-failures` follows each error from where it
  starts to where it ends, front end and server alike: errors swallowed,
  catch-alls, messages that blame the wrong cause, failures with no trace,
  fallbacks that hide a broken dependency, error branches the dependency
  never reaches. `docs` checks the comments and documentation of a change
  against what the code, its dependencies and its server really do: wrong
  or stale comments, setup steps that do not work, settings left
  undocumented.

### Changed

- **The lenses follow the execution chain.** Every lens, and the verifier,
  now reads past the changed lines to the end of the chain: the server
  route a request reaches and the query it runs, and the dependencies in
  `node_modules` at the version the lockfile installs. How a library or the
  other side of an API behaves is settled from its source, never from its
  name, and cited in the finding's `related` excerpts.
- **`bugs` reads every file.** It used to take only the files no front-end
  lens claimed, so a change in TypeScript reached it with no code at all.
  It now reviews every file of the change, the code included, for logic,
  error handling, inputs and breaking changes; the verifier merges what it
  and a front-end lens both report.
- **`performance` covers the whole chain.** It reviews the server's code
  as well as the browser's (`.mjs`, `.py`, `.go`, `.sql`…) and judges a
  cost from the click to the database and back: N+1 queries, queries with
  no limit, work on the request path, payloads larger than any screen uses.

## 0.3.0 - 2026-11-08

### Added

- **A summary of the change.** `/tranchant review` starts a summary agent
  beside the lenses: it writes what the change does, its Change Map (API
  surface, data and migrations, flags and configuration, shared state) and
  what it does well. The page shows them under **Summary** and **What looks
  good** as soon as they are written, while the lenses still run: one line,
  closed, with a spinner while the agent writes and a "ready" chip when it
  lands, so the findings below never move.
- **Settings.** The gear next to the theme toggle opens a page with every
  option of Tranchant, in four groups: Display (the theme, the view and the
  summary a review opens with), Agents (the model of the fix agents, the
  reviewers and the verifiers; how many fix agents and review agents run at
  a time), Review (the default recipe of `/tranchant review`, the lenses
  turned on) and Posting (the CLI that opens issues, and the account it
  posts as). Each option shows its value, its default, one line on what it
  does and a **Reset**; **Reset everything to defaults** clears the page. A
  change applies to the next agent, review or post. The settings live in
  `~/.config/tranchant/settings.json` (`$XDG_CONFIG_HOME` when set), one
  file for every review and every browser, which the display options now use
  instead of the browser's storage; an option an environment variable sets
  (`TRANCHANT_MODEL`) shows read-only, the variable named. Offline, the page
  shows the values read-only and says why. See
  [the settings file](docs/settings.md).
- **Open an issue.** A finding that is real but not for this change (too
  big, out of scope, someone else's code) moves to the project's own
  tracker: GitHub with `gh`, GitLab with `glab`, whichever the checkout's
  `origin` is on. The issue opens prefilled from the finding's title,
  problem, why, fix, anchor (linked to the file) and excerpt, to edit
  before it is created; the finding is then settled, **Moved to an issue**,
  with the issue's link. **Issue** in the selection bar opens one per
  finding. A failure leaves the finding to try again, and says why.
- **Discuss a finding.** When you doubt a finding or its fix, **Discuss**
  opens a thread under it, laid out as annotant's: your messages on the
  right, the agent's on the left, its current step live while it reads.
  Ask a question, or pick a suggested one, and an agent answers with the
  finding and the repository as context. It reads the code and never
  changes it, and the finding's state stays as it is. When its answer
  proposes another fix, a comment to post or a reason to drop, **Fix with
  this**, **Post this** (edited in place first) or **Drop with this reason**
  turns it into a decision in one click. The thread is kept with the
  review, survives a reload, shows its count on the finding in the diff and
  the list, and reads as it stands once the finding is settled.

### Changed

- **The page reads in Figtree**, annotant's font, in place of the system's:
  the two pages read as one family. The font ships inside the page, so
  nothing is fetched from the network; code stays in a monospace font.
- **Inline code stands out.** In a finding, the summary, a discussion and
  the review agents' reports, inline code sits on a chip, with a background
  and a border, so a symbol's start and end show in a dense paragraph.
- **No empty Summary.** The Summary section shows only when the review
  carries a summary or a strength: a review file written without them no
  longer opens on an empty section.

## 0.2.0 - 2026-11-06

### Added

- **Markdown in a finding.** Its problem, why and fix render as Markdown:
  inline code, bold, lists, code blocks and links read as written, no
  longer as raw text. A link opens in a new tab, and only a safe one
  becomes a link.
- **Light or dark, your pick.** A sun or moon in the header switches the
  page to the other theme, diff, code colours and diagrams included. The
  page follows the system until the first click; the pick is remembered in
  the browser and set before the page draws, so a reload never flashes.
- **Post on your own MR.** `/tranchant review` on a branch looks for its
  open merge request with `glab`; found, the page offers **Post a comment**
  next to **Fix now**, names the MR in the header, and the batch bar posts
  every selected finding not posted yet: one with no comment posts the text
  written from its problem and fix, which the confirmation names. Posting
  waits until the MR's head is the commit reviewed.
- **Syntax highlighting.** The diff, a finding's excerpt and hunk, a fix's
  changes and the summary's code blocks colour TypeScript, TSX, JavaScript
  and JSON, with annotant's highlighter; the marks stay on top. The dark
  mark is lighter, so the text under it reads at 4.5:1.
- **Mermaid diagrams.** A finding's `diagram` can be `mermaid`: the page
  draws a sequence or a flow from its source, arrows included, in the
  page's colours, light and dark. Mermaid is bundled and loads only when such
  a diagram shows; a source that does not parse shows as text with its
  error. The lenses draw one when a flow needs proving.

### Changed

- **One style per family of states.** A state chip takes its family's
  colours: to do blue, in progress violet, needs you amber, done green, set
  aside muted and outlined, no longer struck through. A run's outcome wears
  the family it leads to. Every state chip reads at 4.5:1, light and
  dark.
- **The batch bar, selection first.** A three-state checkbox selects every
  finding or none, a chip per group (To do, Safe to auto-fix) selects it
  with its count and shows pressed, and the selection's actions appear only
  once something is selected, each with the number it applies to. **Fix all
  safe to auto-fix** goes: its chip then **Fix** does the same; **Post all
  to do** stays. The selection clears once a batch is applied.
- **The review's agents by lens.** While `/tranchant review` runs, one panel
  replaces the line per agent: a progress bar, a chip per lens (done with
  its findings, running, or stopped and not covered), the verifiers grouped
  by lens, and only the agents still at work with their step. Once done, it
  folds into one line, warning when a lens stopped; **What each lens
  checked** opens one row per lens: its verdict, the point of its report
  and what it looked at; opened, its whole report, its findings with their
  verifier's verdict, and its steps. A review agent's words are no longer
  cut at 400 characters.

## 0.1.0 - 2026-11-04

### Added

- **Settle a review from a page.** `/tranchant <review.json>` imports a review
  and opens its page: fix each finding on the working tree with a background
  agent, post it on someone else's merge request, drop it or skip it, one at a
  time or in batches. Answer an agent that asks; stop one that goes wrong.
- **Review in the background.** `/tranchant review` opens the page at once and
  runs one reviewer per lens and one verifier per finding; the findings land
  in the page while they run. It reviews the current branch, another branch,
  another repository or a merge request read with `glab`.
- **Front-end lenses.** The default recipe reviews web front ends for
  correctness, types, accessibility, performance, security, tests and the
  project's own conventions; `--recipe` runs your own.
- **The change's diff as the main view**, every finding a marker on its line;
  the list view stays one click away.
- **See what needs you.** The header counts the findings waiting for an answer
  or that failed, and the ones running.
- **Keep going.** After a decision the page opens the next open finding, and a
  fixed finding shows the changes its agent made.
- **Know what you post.** Confirming a post names the merge request, the
  account it is posted as and every finding.
- **Plain words** for the findings' states and the actions.
