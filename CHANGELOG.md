# Changelog

Notable changes to Tranchant. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org). Users receive a change when it is
released to the `stable` branch.

## Unreleased

### Added

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
