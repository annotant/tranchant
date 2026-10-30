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
- **A producer writes the review.** In the Qohash setup, `combined-review
--tranchant` runs the reviewers, verifies the findings, and hands the
  result to Tranchant. Any tool that writes the review file works.
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
/tranchant <review.json>     # import a review and open its page
/tranchant status            # what is running
/tranchant stop              # stop the server and every agent
```

With the Qohash skills, `/combined-review --tranchant` writes the review and
opens the page itself.

In the page:

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
