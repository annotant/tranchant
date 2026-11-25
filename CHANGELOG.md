# Changelog

Notable changes to Tranchant. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org). Users receive a change when it is
released to the `stable` branch.

## Unreleased

### Added

- **Battle review: two groups of lenses on one change, compared.** Ready
  to start the review has two tabs, **Review** and **Battle review**: pick
  group A and group B, see the lenses they share and those only one has,
  then **Start the battle** (`/tranchant review --battle A,B` opens on that
  tab). Both run in one review and share its queue, A and B in turn; a lens
  in both groups runs once and counts for both, unless **Run the shared
  lenses twice**. The progress panel shows the shared lenses above A and B
  side by side, each with its lenses, verifiers, findings, tokens and time.
  The header's **A · B · Compare** switch shows one group's findings at a
  time, each saying `A + B`, `also B` or `only A`; a finding both found is
  settled once. **Compare**, once both are done: a scorecard (findings,
  found by both, only this group, dropped by the verifier, kept and
  dropped by you, reviewers, tokens, time, the better side marked), the
  pairs found by both (**Not the same** splits one), what only A and only
  B found, and **Copy as Markdown**.

## 0.8.0 - 2026-11-24

### Added

- **Pick several sources at once in Settings › Lenses › Browse.** A box on
  each item: a click checks one, Shift-click a range over the list as
  shown, a source that is a lens already skipped. **Add N** opens one row
  each under **Picked**, renamable, with one Where it lives.
- **Each agent's tokens are recorded.** The summary agent, the reviewers,
  the verifiers, the discussions, the fixes and the cleanings: on their
  runs, and in a review's `usage.json` while they work and once a reset
  removed them. `/api/review` sums them by kind, lens and finding.
- **A review's tokens in the header.** A chip beside the review's status,
  `2.90M tokens` (`so far` while an agent works, `paused` while
  the review is paused and nothing runs, `at least` with an agent not reported or partial), opens the Tokens screen
  (`#tokens`): by agent kind, and by lens with what each lens found,
  confirmed and dropped, its tokens per confirmed finding and **nothing
  confirmed** marked. A lens's name opens its reviewer's report.
- **A finding's tokens in its Run section.** Each run's figure, a line for
  its verification and one for its discussion, and the finding's sum under
  them, `at least` when a part did not report.
- **A lens's and a group's average in Settings › Lenses.** Under each lens,
  `~140k tokens · 0.8 confirmed findings a review · ~175k tokens per
  confirmed finding`, over its last 10 complete and verified reviews in the
  project since its prompt last changed, a finding counted once a verifier
  confirmed it; under each group, its lenses' averages summed, those with no
  history named.

### Changed

- **Add a lens is Global by default**, for one source as for many.

## 0.7.0 - 2026-11-22

### Added

- **A website.** A landing page and the docs on GitHub Pages
  (https://annotant.github.io/tranchant/), built from the README and
  `docs/`, linked to Annotant, its sibling.
- **A skill or command added as a lens is analysed into one lens, or the
  reviewers it starts.** A whole review process (a team's skill that
  launches its reviewers in prose, a command whose agents are written in
  it) is no longer a failed cleaning: its card reads "code-review starts 9
  reviewers: pick the lenses to make", one checkbox each, its name
  editable, one that is a lens already locked, and **Add the checked ones**
  cleans each into a lens of its own. A reviewer is the agent's or skill's
  file it starts, found in the source's own plugin and marketplace even
  when that plugin is not installed, or instructions written in the source
  itself: that lens records its source and the reviewer's name, and is
  extracted again when the source changes. The agent's paths are data: a
  file is offered only under the source's plugin or marketplace, or the
  agents, skills and commands of the project's `.claude` and `~/.claude`;
  any other is listed with why. A command can become a lens, and one whose
  read finds no agent offers **Ask an agent to look**.
- **Pause, stop and reset a review.** The progress panel of a
  `/tranchant review` gets **Pause**: no new agent starts, those at work
  finish (*Pausing*), and **Pause now** ends them, each running again from
  the start on **Resume**. **Stop the review**, paused or not, asks inline
  (**Keep it running**, **Stop the review**, **Stop and reset**): the agents
  at work end, the queued ones never start, the lenses left are *not
  covered*, and the findings that landed stay to read and settle, with no
  Resume. **Reset the review** removes every finding, decision and
  discussion, keeps its plan, and brings the page back to **Ready to
  start the review**. A fix, a post, an issue or a discussion under way goes
  on through Pause and Stop; Reset is refused until it ends. An agent the hooks
  fail to stop (TaskStop) is said, keeps showing running, and Reset is
  refused until it ends (a discussing agent TaskStop did not end aside: it
  belongs to its finding, and only its question, waiting, holds Reset).
- **A lens's model on Auto-detect: its source's, else the session's.** A
  lens's **Model** select starts with **Auto-detect**, the default of a lens
  you add: the model its agent's, skill's or command's frontmatter names
  (`model: opus` runs on Opus), else the model of the session that ran
  `/tranchant review` (no model, `inherit`, or a model that is not
  Claude's). The source is read again at each review, and a change to its
  `model:` line alone cleans nothing again (a lens cleaned before this
  version is cleaned once more the first time); a branch that edits an
  added lens's source never picks that lens's model. Beside the select, a line says
  what it resolves to and why; the Source field shows the frontmatter it
  reads; each lens's row, and each reviewer's on Ready to start, names the
  model it runs on (*auto · claude-opus-5-5*). `TRANCHANT_MODEL` still wins
  (#121).
- **Groups of lenses, one review process per group.** Settings › Lenses has
  a **Groups** tab beside **Lenses**: a group is a named set of lenses (the
  project's, the global ones, the built-in ones), made, edited, duplicated
  (B starts from A) and deleted there, with a name filter, **Check the N
  shown** and a checkbox on each scope's heading, one lens per name.
  `/tranchant review --group <name>` runs a group's lenses whatever their
  switches; with no `--group`, the project's **default group**, *Every lens
  that is on* until another is picked. Before Start, a **Group** select
  changes the lenses, and **Save these switches in the group** saves them
  in it. The header and the progress bar name the group a review runs;
  each lens on the Lenses tab names its groups, and the filter has a
  **Group** select. A lens removed leaves every group of the project,
  and the group's reviews say so until one runs. Groups live with the project's lenses, outside the
  repository.

- **Only a lens's source is required.** Its name comes from the source: a
  file's name without its extension (a skill's folder's whole), a
  `plugin:name`'s name without the plugin; `money-review.md` is no longer
  shortened to `money`, nor `workflow:code-reviewer-abac` to `abac`. In
  **Add a lens**, Name shows that name once the source is read, to change,
  and says before the cleaning starts when it is no lens name or is taken
  where it would live; `/tranchant import` refused for a taken name gives
  the command again with `--name`.

- **Filter the lenses.** Settings › Lenses has a filter above the groups: a
  name (as typed, any case), the origin (**All**, **Built-in**, **Picked
  up**, **Custom**) and the finding kind; they combine, each group counts
  its matches (*2 of 5*) and hides with none, a count says how many lenses
  match, and **Clear the filters** sets them back; no match says which
  filters are set. Each row names its origin: *built-in*, *picked up ·
  agent* (or skill, or command: a plugin's, or a file in an `agents` or
  `commands` folder, or a skill's), *custom · checklist*. The lens whose
  editor is open stays shown while filtering. The plugin's lenses now
  declare the topics their prompts file under.

- **Pick a lens's source.** In Settings › Lenses, **Add a lens** has
  **Browse…** beside Source: a picker under the field, with a search box
  and four tabs, the three lists counting their matches. **Plugins** lists each installed
  plugin's skills, agents and commands, with its version and folder; a
  plugin turned off for this project is said so, its items still pickable
  (*plugin off here: the lens would not build*). **This project** and
  **~/.claude** list their `.claude`'s agents, skills and commands.
  **Files** browses three roots, this project, `~/.claude/` and the
  plugins' folders, with a breadcrumb and **Go to a folder**: only Markdown
  files are offered; hidden files, links leaving their root and unreadable
  folders are shown dimmed with why, never opened; a folder outside the
  roots is refused, the roots named. An item that is a lens already says so
  and stays pickable: once picked, Source's help says adding it makes a
  second lens. Picking fills Source, which stays editable. Names only while
  browsing: a file's first lines are read once it is in Source, as for a
  source typed, to list the agents it starts. A plugin's own skill, agent or
  command is written `plugin:name` in Files too. Tranchant's own lenses are
  built in, not listed.

- **The lenses inside a command.** In Settings › Lenses, **Add a lens**
  takes a command as its source, a plugin's (`pr-review-toolkit:review-pr`)
  or a file in a `commands` folder, and any agent or skill that starts other
  agents: Tranchant reads it, with no agent (*Reading review-pr for the
  agents it starts…*), and lists in place of the name the agents and skills
  it names that resolve, its plugin's, the project's, the user's, or any
  installed plugin's written `plugin:name`; one that starts agents itself
  is left out. Each one is checked and renamable, one that is a lens
  already locked; **Add the N lenses** cleans
  them as a glob's matches. Among a glob's matches, a command is a group
  with the agents it starts under it, its checkbox checking or unchecking
  them all; an agent the glob matched too is listed once, under it. A
  command is never a lens itself: one that names no agent Tranchant finds
  (written in it, or a plugin's not installed or turned off) says so and
  adds nothing, and `/tranchant import` refuses a command, or a
  source that starts the agents it names, before any cleaning, naming them.

- **Add several lenses at once, from a glob.** In Settings › Lenses, **Add
  a lens** takes a glob as its source (`.claude/agents/*-review.md`,
  `~/.claude/agents/review-*.md`): before anything runs, the page lists its
  matches, each named after its file and renamable, with **Check all** /
  **Check none**. A file that is a lens already, or being added, under any
  name, says so (*added already*, *being added*) and cannot be checked; a
  different file whose name is another lens's where it would live, or
  another match's, has its name marked: the lenses are added once it is
  changed. A lens it would replace is said, and a file that starts other
  agents is flagged *not a reviewer* and starts unchecked. **Add the N lenses** cleans
  each checked match with its own agent, `maxReviewAgents` at a time; under
  *Lenses being added* a bar counts the lenses cleaned, those still at work
  folded behind **Show the details**, those to check or failed listed. One
  that fails stops none. A
  glob that matches nothing says so, with the files of the folder it looked
  in.

- **Start the review yourself, once the lenses are built.** A new setting,
  **Start the review by itself** (on by default), and `/tranchant review
  --no-start` for one run (`--start` forces it on; neither is saved): the
  lenses build, then the page waits in its center with what will run (the
  target, the lenses on and the files each reads, the agents, the token note
  past 12 reviewers), a switch on each lens for this review and **Start the
  review**. **Remember these choices** saves them on Start as Settings ›
  Lenses does. A lens that cannot be built no longer refuses the review
  there: turned off, the review starts; **Build the lenses again** builds
  them anew, as the way back from Settings does.

- **The lens that found each finding.** After `/tranchant review`, each row
  of the findings list and the finding's detail name the lens that found
  it, on a quiet chip. A finding no lens found (a review opened from a
  file, the threads of `/tranchant comments`) shows none.

### Changed

- **The lenses build in the center of the page, then fold into the
  header.** While `/tranchant review` builds its lenses (or cleans one
  again first), the page shows a spinner, how many are ready and the rows
  on demand, in place of the accordion above the review. Once built, a
  chip in the header (*13 lenses*, amber with a warning when a lens runs
  its last version) opens the same rows over the page. A refused review
  names each lens that could not be built, with a link to its editor in
  Settings › Lenses.
- A reviewer names its lens when it adds a finding
  (`add.mjs --lens LENS`), and its hooks refuse the call otherwise. A
  recipe's whole `prompt` written before this must say so.
- A review agent's Bash command with a comment (`#`) is refused: the
  shell drops the words after it, which the hooks would still have read.
- **Small polish of the page.** The findings' rows and the diff's markers
  light up on hover; the open finding's *To do* chip, and the file being
  read's finding count, keep their background on the highlighted row; a
  truncated title shows whole on hover; the Summary and Related toggles get
  one chevron, the same open and closed; the keyboard hints wrap between
  two keys, never inside one; *Waiting for the first finding…* gets the
  list's padding; *Select among 0 findings* is greyed with its checkbox;
  in Add a lens's picker, each plugin's (or kind's) head stays at the top
  of the list while its rows scroll.

### Removed

- **A lens's context skill.** Add a lens and the lens editor no longer ask
  for one, `/tranchant import` no longer takes `--context`, and a reviewer's
  prompt no longer has a Context block: only a lens's source decides when it
  is cleaned again. A lens saved with a `context` still runs, without it; the
  key is dropped at its next save.

### Fixed

- **A lens's new name, as it is typed.** In Settings › Lenses, the row of
  an added lens being renamed now shows the name typed in its editor. Once
  saved, the lens is listed under its new name (or its new scope) with its
  editor still open, and a page opened at its link follows it instead of
  saying it is gone.

## 0.6.0 - 2026-11-19

### Added

- **Lenses, one by one.** Settings › Lenses lists every lens that could
  run on the project, the recipe's and those you add, each with its switch,
  its settings and what its reviewer reads, whole. **Add a lens** takes a
  team's reviewer (a plugin's skill or agent, or a file): an agent cleans
  it first, keeping its review and leaving its orchestration, output
  format, posting and questions out, with added instructions you can edit,
  and the page shows what it removed and added before you add it. A lens
  is local (this project) or global (every project), always in
  `~/.config/tranchant/`, never in the repository. A recipe's lens can be
  turned off and given its own model.
- **Lenses cleaned again when their source changes.** Each
  `/tranchant review` hashes the sources of the added lenses it runs and
  cleans the changed ones first, your edited rules kept; a cleaning that
  fails runs the lens's last version and says so, and a source the change
  under review touches is never cleaned from it.

### Changed

- **`/tranchant import` adds one lens.** It cleans one reviewer into a
  lens, `--to local` or `--to global`, instead of writing a whole recipe;
  a whole review process is refused, naming the reviewers to add one by
  one. Settings › Lenses replaces the recipe in force, the Lenses
  checkboxes and the imported recipes of the Settings page. A project
  recipe already committed is still read, but Tranchant writes none.

## 0.5.1 - 2026-11-11

### Fixed

- **Fix after commenting.** Once a comment was posted on the MR, or a
  reply on a comment's thread, the finding was settled: **Fix now**, **Fix
  with this** and **Change** were gone, even when the reply promised the
  fix. They are now offered then too; the comment or the reply stays, with
  its link.

## 0.5.0 - 2026-11-11

### Added

- **Ask for a change from a comment's discussion.** On a finding from
  `/tranchant comments`, **Change** sends your message ("go ahead", "also
  cover the empty case") to an agent that makes the change in the working
  tree, with the whole discussion in hand, under a fix's rules (file locks,
  **Stop**). Its current step, its questions and what it changed (**View
  changes**) show in the discussion; ask again for the next change, even
  once the finding is fixed. Questions still go to the read-only agent.
- **Your team's review process, as lenses.** `/tranchant import [<source>]`
  reads a skill and the agents it starts, an agent or a file, and writes a
  recipe that references them, in the project (`.tranchant/recipe.json`,
  shared) or for you alone; the page's Settings show it, with what could not
  become a lens, before **Use this recipe** puts it in force. A preview:
  marked as such in the Settings, it may change before it is stable.
- **Lenses rebuilt at every review.** `/tranchant review` builds each lens
  from its source (a plugin's skill or agent, a path, or one of Tranchant's,
  with an add-on), wrapped in a shared contract, before any reviewer starts:
  the page shows the step, lens by lens, and what changed since the last
  review. A source that cannot be found refuses the review, with the reason
  and the fix, on the page and in the terminal. A recipe can set a lens's
  model, its topics, the skills it reads, and extend Tranchant's own lenses.

### Changed

- **The project's recipe first.** It is read at the review's base, never
  from the change under review; the local recipe and the project's come
  before the settings'. The Settings show the recipe in force, where it
  comes from, and each lens's source and status.

### Fixed

- **An agent's proposed reply is offered once.** On a thread, **Reply with
  this** stayed under the discussion once the reply was sent, one click
  from posting it twice. It now hides while the editor holds it, and once a
  reply from it is on its way or posted, even edited, it turns into a note,
  like Fix and Drop. A failed reply, or a later answer, offers it again.
- **Reply on a thread while its fix runs.** Once a comment's finding went
  to **Fix now**, **Reply on the thread** (and **Reply with this**) was gone
  while the fix was queued, running or waiting on your answer, and for good
  after a **Stop**. It is now offered then too: the reply is posted beside
  the fix, which carries on untouched, and shows in the thread like the
  others.

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
