# Changelog

Notable changes to Tranchant. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org). Users receive a change when it is
released to the `stable` branch.

## Unreleased

### Added

- **Post on your own MR.** `/tranchant review` on a branch looks for its
  open merge request with `glab`; found, the page offers **Post a comment**
  next to **Fix now**, names the MR in the header, and the batch bar posts the
  findings that carry a comment. Posting waits until the MR's head is the commit reviewed.
- **Syntax highlighting.** The diff, a finding's excerpt and hunk, a fix's
  changes and the summary's code blocks colour TypeScript, TSX, JavaScript
  and JSON, with annotant's highlighter; the marks stay on top. The dark
  mark is lighter, so the text under it reads at 4.5:1.

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
