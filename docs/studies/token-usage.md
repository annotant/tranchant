# Study: the tokens a review spends, by agent, lens and finding

The outcome of [#136](https://github.com/annotant/tranchant/issues/136):
where each agent's usage comes from, where Tranchant keeps it, the views
that show it, and what is left out. It records decisions;
[the review file](../review-file.md) stays the reference for what the code
does.

The mockups are the row *Tokens · what a review spends, by agent, lens and
finding (#136)* on the
[Tranchant canvas](https://claude.ai/artifact/USF4hJz6gChV5iVTvYiHUr).

## Where the code stands

- **Nothing records tokens.** A review agent's `reviewers/<name>.jsonl`
  has a `start` step with its `model` and an `end` step, each with `at`; a
  fix's run in `decisions.json` has `model`, `startedAt` and `endedAt`. The
  wall time per agent can be read; the tokens cannot.
- **The one hint is the count of reviewers.** Past 12 lenses
  (`MANY_LENSES`, #108), **Ready to start the review** says "a review this
  wide spends many tokens"; Settings › Lenses says "more lenses use more
  tokens" past 12 lenses on (`MANY_LENSES` too), and a group past 12
  members says it (`LensGroups.tsx`'s own `MANY`). None knows what a lens
  costs.
- **The hooks hold every agent's id, but a fix's run does not.** `$.state`
  keeps each fix's `Worker`, each `ReviewAgent` (summary, reviewer,
  verifier, discussion) and each `Cleaning` with its `agent`. A fix's run
  records `agent` only when `claim.mjs` gets `--agent` or
  `TRANCHANT_AGENT`; `agents/worker.md` claims with neither, and nothing
  sets the variable, so the runs the hooks start carry no `agent`.
- **An agent ends by several paths.** A fix's end, normal or stopped,
  always runs `ended()` (`hook.mjs ended`). A review agent's end is
  `endReviewAgent`, reached from `turn.complete` (`reviewAgentDone`), from
  its final report when it comes first (`ownReport`), from its start when
  its turn ended before it was recorded, after a reload, and from the stop
  path. A cleaning ends in `cleanDone`, or, stopped by `/tranchant stop`,
  in `clean.mjs --check --stopped`. `stopAgent` reads `$.agent.list()` only
  when `TaskStop` errs.
- **A removed finding leaves its verifier's file.** `remove.mjs` deletes
  `findings/<id>.json`, but `reviewers/vf-<id>.jsonl` stays. Which lens the
  finding came from does not: only the finding's file held `lens`.
- **Reset deletes the runs.** `store.reset()` removes every
  `reviewers/*.jsonl`, every `runs/` file, the discussions, and empties
  `decisions.json`'s `findings`.
- **Past reviews stay, but not what each lens read.** Nothing prunes
  `<state>/<hash>/reviews/`; `lenses.mjs` already reads the project's
  previous review (`unchanged`, `updated`, `new`). How many changed files a
  lens read is kept only in a waiting review's `lenses.json` rows and in the
  plan in `<state>/inbox/`, not in the review folder: `review.json`'s
  `lenses` holds `{ name, source, version?, hash }`.

What Claude Code 2.1.329 gives a mod (`claude-code.d.ts`):

| Source | What it holds | When |
| --- | --- | --- |
| `$.agent.list()`, an agent's `usage` | One `TurnUsage` per model that answered it: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` (with the 5-minute and one-hour parts), `model`. Every request `/cost` counts for it: its steps and retries, its compactions, its settings hooks' calls; a request stopped or cut mid-stream counts too, its output estimated from what had streamed. It starts over where the session's total does: `/clear`, `/resume`, a new process. | While the agent is listed: until the engine drops its task, some time after it ends. |
| `$.agent.list()`, an agent's `cost` | `{ usd, hasUnknownPrice? }`: what `/cost` credited for the same requests. The engine calls it an estimate, not the bill; on a subscription it is no charge at all. | Same. |
| `turn.complete`'s `usage` | One `TurnUsage` for the turn: its real requests' counts summed, the last one's model. | At the end of each of the agent's turns; absent when nothing counted (an interrupt, an API error). |
| `turn.step`'s result `usage` | One response's `TurnUsage`, with `agentId` on the input. | After each response, while the agent runs. |

## Decisions

### 1. The source is the agent list, read on every path an agent ends by

The hooks read the agent's entry in `$.agent.list()` where each kind's end
is recorded, whichever path reaches it: `ended()` for a fix, normal or
stopped; `endReviewAgent` for a review agent (it covers the turn's end, the
report that comes first, the start that finds the turn ended, a reload, the
stop path); `cleanDone` and the `--stopped` path for a cleaning. In the
stop path the read comes right after `TaskStop`, before the engine drops
the task; `stopAgent` reads the list every time, not only when `TaskStop`
errs.

They keep its `usage` (every model it ran on), its `cost.usd` and, when
set, `hasUnknownPrice`. The list is preferred over `turn.complete`'s
`usage` because it counts every request `/cost` counts, the one a stop cut
mid-stream included (its output estimated), and keeps one entry per model
where the turn's figure names the last model only.

**What the hooks keep meanwhile.** Each agent's last figure, from a live
read or from its `turn.complete`, is kept in `$.state` beside its
`Worker`, `ReviewAgent` or `Cleaning`. When the agent is no longer listed
at its end (dropped already, or a stop that found it gone), that figure is
written instead, marked `partial`: the page says `at least`. With neither,
the agent is **not reported**: `—` on its row, `at least` on the total,
never zero. So a stopped agent reports what it spent when the list still
holds it, and at least its last reading otherwise.

**A figure that goes down** (the session's `/clear` or `/resume` during
the review, which starts the agent's count over) never replaces a higher
one: the higher stays, marked `partial`.

**Live**, while it runs: on each `turn.step` of an agent the hooks
started, when ten seconds or more passed since its last write, the hooks
read its entry again and write its figure so far (decision 3). After a
reload of the module the next read is whole again, `/clear` aside.

**An engine without `usage` on the list** (older than the one the hooks
are tried on) falls back on `turn.complete`'s figure, marked `partial`.
Piece 1 finds which Claude Code version brought `AgentInfo.usage` and
raises the README's floor only if the fallback is not enough.

### 2. Tokens on the page; the price recorded, not shown

The page counts **tokens**: the four counts summed, by model. The
breakdown always shows the four (input, output, cache reads, cache writes),
so a reader sees why a reviewer that read 14 files reaches a million: cache
reads are most of it.

`cost.usd` and `hasUnknownPrice` are recorded beside the counts, because
they are free, take fast mode and long prompts into account, and the
hill-climbing bench (#112) needs a cost it can compare. The page does not
show them: prices change and differ by account, a subscription pays none of
it per review, and a dollar figure on the page reads as a bill. The panel's
total could show it later, labelled as `/cost`'s estimate; that is an open
question.

### 3. Where it is kept: on what each agent already writes, and one small file

An agent's final figure goes where its run already is; what has no run, or
no longer has one, goes in one file of the review's own, `usage.json`.
`/api/review` sums them.

| What | Where | Written by |
| --- | --- | --- |
| A summary, reviewer, verifier or discussion that ended | `reviewers/<name>.jsonl`: `usage` on its `end` step | The hooks, as they write `end` today |
| A fix that ended | `decisions.json`: `usage` on its run | `hook.mjs ended --usage <json>`, which the hooks already run when a fix's agent ends |
| A cleaning that ended | `cleaning.json`: `usage` | `clean.mjs`, from `cleanDone` and from `--check --stopped` |
| Any agent still running | `usage.json`'s `live`, by run file (`rv-correctness`, `vf-f-03`, `fix:f-03`…): its figure so far, replaced at each write, removed at its end | The hooks, the only writer while agents run |
| A fix that ended before its claim (no run) | `usage.json`'s `unclaimed`, by finding | The hooks |
| What a Reset removed | `usage.json`'s `reset`: the removed figures summed, by kind and by lens | `reset.mjs`, before it removes anything |

`usage` lines in the run files were the first idea: they are left out
because every reader of those files takes each line for a step (the
discussion's progress line, the review agents' last 50 steps, a fix's
history once its run ends). `usage.json` is read by `/api/review` alone.

Reset keeps `usage.json`: the review cost what it cost, and the chip says
it (decision 4). Reset is refused while an agent runs, so `live` is empty
when it writes `reset`.

The shape is the same everywhere:

```jsonc
"usage": {
  "models": [
    { "model": "claude-sonnet-5-5", "input": 18204, "output": 9310, "cacheRead": 1203551, "cacheWrite": 61877 }
  ],
  "usd": 0.84, // optional: /cost's estimate, absent where the engine kept none
  "hasUnknownPrice": true, // optional, as the engine sets it
  "partial": true // optional: a last reading, not the agent's whole figure
}
```

So that every figure can be attributed:

- **A fix's run records its agent.** `hook.mjs` sees the claim's Bash
  call with the agent's id (`agent_id`, as every tool event carries it) and
  stamps it on the run the claim opened. `ended` then puts the usage on the
  run with that `agent`, ended or not (`done.mjs` and `ask.mjs` end the run
  before the turn does); no run with it, it goes to `unclaimed`.
- **A verifier's `start` step records its finding's `lens`**, written by
  the hooks. It is read from that step only (the one with `model` and no
  tool id), never from a `start` a Bash `claim.mjs` command recorded. A
  finding the verifier removes keeps its verification on its lens.
- **`review.json`'s `lenses` records each lens's `files`**: the changed
  files the lens read, as the plan counted them. The estimate needs it on
  every past review, not only on a review that waited to start.
- **A lens row of `lenses.json` records its cleaning's id** when the
  review cleaned it again (`cleaned again`): the review counts that
  cleaning. A cleaning started from Settings › Lenses (Add a lens,
  `/tranchant import`) belongs to no review, and shows on its lens's report
  in Settings.

Pause now ends an agent and starts another in the same run file: each
`end` carries its own agent's usage, and the file's total is their sum. An
interrupted run spent its tokens; they count.

**Read as data.** A fix's agent can write outside the repository, the
state folder included, and the figures feed every view. One reader in
`lib/format.mjs` checks a `usage` object wherever it comes from: counts
finite non-negative integers, `model` by the `MODEL` rule, a few models at
most. Anything else reads as **not reported**; the sum never throws. The
sums by finding and by lens are built in `Map`s, never plain objects keyed
by an id or a lens name. `ended --usage` is left out when there is no
figure, and read after the finding is failed and its locks released, so a
bad value never keeps a finding `working`.

The review file documents `usage`, `usage.json`, the `--usage` flag and
the attributions. All of it is additive: a file written today stays valid,
and reads as a review with no usage.

### 4. The views

`/api/review` returns, beside what it returns today, a `usage` block: the
total, by kind, by lens, by finding, what a reset removed, the agents not
reported or partial, and whether any agent still runs. The page draws it;
nothing is summed in the browser.

- **The review: a chip in the header.** `2.90M tokens` beside the
  review's status chip, as the Lenses chip sits there once folded (#96). It
  counts every agent the review ran, fixes, discussions and its cleanings
  included, and what a reset removed: what the review cost so far.
  - While any agent it counts runs, it reads `1.98M tokens so far` and
    moves at each write. Pause and Stop the review do not touch a fix or a
    discussion under way, and Pause lets the reviewers at work finish: the
    chip says `paused` only once nothing it counts runs, and `so far`
    until then.
  - An agent not reported or partial: `at least 2.86M tokens`, and the
    panel names it.
  - An agent whose Claude Code session closed before it ended (its run
    file keeps showing it running) is counted from its last figure,
    `partial`, and not as running: a live figure older than the serving
    session's start (`TRANCHANT_SESSION_SINCE`) is no longer live.
  - A review with no usage at all (opened from a producer's file before any
    fix, or written before this) shows no chip: no zero.
- **The panel, by agent kind.** The chip opens the panel over the page,
  as the Lenses chip opens its rows (`LensesControl`): anchored on the
  chip, closed by Close, Escape or a click outside, and the list and the
  finding open under it stay where they were; nothing navigates. One row
  per kind, Summary, Reviewers, Verifiers, Fixes, Discussions,
  Cleanings, then *Before the reset* when there was one, with its agents'
  count, its tokens and its share of the total as a bar; the four counts
  and the models under it, one line. A kind with no agent is left out.
- **The panel, by lens.** The same panel's second tab: one row per lens
  the review ran, its model, its reviewer's tokens, its verifications'
  tokens, then what it found: landed, confirmed, dropped (removed by its
  verifier, or dropped by you), settled (fixed, posted or moved), and its
  tokens per confirmed finding. Sorted by tokens, the most first. A lens
  that confirmed nothing is marked **nothing confirmed**, in amber: sorted
  by cost, the one that costs much and finds nothing is the first such
  mark. "Tokens per dropped finding" is not shown: a reviewer's cost does
  not split by finding, and the dropped count beside the cost says what the
  issue asked. Each row links to its reviewer's report in the reviewers
  section (`ReviewAgents`): no link reaches it from a lens today, piece 2
  builds it.
- **By finding, in its run.** The finding's Run section adds the figure
  to each run (`run-1 · opus · Fixed · 182k tokens`), and one line for its
  verification (`Verified · 38k tokens`) and its discussion when it had
  one, with the finding's sum under them. The finding's header shows
  nothing: cost is not a reason to settle a finding one way or the other.
- **Before starting: an estimate on Ready to start the review.** A
  Tokens fact under Agents says `about 3.5M tokens, from this project's
  last 5 reviews`, each lens row says what it should cost (`~350k`), and
  the hint beside Start repeats the figure, which follows the switches.
  Per lens: the median of its reviewer's tokens per changed file it read
  (`review.json`'s `files`) over its last five runs in this project, times
  the files it reads in this change; plus its verifiers, the median
  verification times the lens's median findings; plus the summary's median.
  A past run that read no file is skipped. A lens with no past run is left
  out of the figure and said (`+ 1 lens with no past run, not counted`).
  With an estimate, the warning past 12 goes: the figure says it better.
  With none (no review of the project has recorded its tokens yet), the
  Tokens fact says so and the warning stays as it is.
- **Across reviews: the past reviews are the history.** No history file
  and none across projects: the estimate, a lens's average in Settings ›
  Lenses (`~140k tokens a review · 0.8 confirmed`, over its last ten
  reviews in this project) and a group's in Settings › Lenses › Groups
  (its lenses' averages summed: whether a group is worth running on every
  change) read the review folders the state already keeps. The scan is
  bounded: the newest 20 reviews at most, `review.json`, `end` steps and
  runs only, and a completed review's sums cached once read. A lens whose
  prompt hash changed starts its history over (the same rule as `updated
  since the last review`).

The states each view has, as the mockups draw them: running (`so far`, the
running agents' rows moving), paused (`paused` once nothing runs), stopped
(the stopped agents counted, their last request estimated, said once in the
panel), an agent not reported (`—` on its row, `at least` on the total), a
review with no usage (no chip, no panel), and Ready to start with no
history (no estimate, the warning past 12).

### 5. Out of scope: a budget

A cap per review or per lens, or a warning when one is passed, is a
follow-up. It needs the live figure first, and a decision this study cannot
make from mockups: what happens when the cap is reached. **Pause** exists
and would be the natural answer (a review over budget pauses itself and
says why), but it takes a setting, its default and its words in the page.
Once pieces 1 and 2 are in, the issue can be written from real figures.

## The pieces

One issue each. Piece 1 comes first; 2 to 5 follow it, in any order.

1. **Each agent's tokens, recorded** (#139). The hooks read `$.agent.list()` on
   every end path and on `turn.step` every ten seconds, keep the last
   figure in `$.state`; `usage` on the review agents' `end` steps, the
   fix's run (`hook.mjs ended --usage`, the claim stamping the agent),
   `cleaning.json`; `usage.json` (`live`, `unclaimed`, `reset`); `lens` on
   a verifier's `start` step; `files` on `review.json`'s `lenses`; the
   cleaning's id on its `lenses.json` row; the checked reader; the
   version floor; `/api/review`'s `usage` block; the review file. This is
   the "what it cost" half of the hill-climbing study's piece 2 (#112);
   whichever lands first, the other reads it.
2. **The total in the header and the panel by kind and by lens** (#140). The
   chip, its states, the panel's two tabs, the link from a lens's row to
   its reviewer's report.
3. **A finding's cost in its run** (#141). The Run section's figures, the
   verification's and the discussion's lines, the finding's sum.
4. **The estimate on Ready to start the review** (#142). The per-lens medians
   from the project's past reviews, the Tokens fact, the rows, the warning
   past 12 kept only without history.
5. **A lens's and a group's cost in Settings › Lenses** (#143). Its average
   tokens a review and confirmed findings, over its last ten reviews in the
   project; a group's, its lenses' summed.

## Open questions

- **One number for unlike tokens.** Summing cache reads with output
  counts what the API processed, not what it costs: a cache read is priced
  at a tenth of an input token, an output token at several. Lenses on the
  same model compare fairly; a lens on opus against one on haiku does not.
  The alternative is to weight the counts by their price ratios, which
  brings prices back in.
- **Showing `/cost`'s estimate.** Recorded by piece 1; shown nowhere. The
  panel's total could carry it, labelled as an estimate, when no agent has
  `hasUnknownPrice`.
- **The estimate's method.** Tokens per file read is a guess at what
  drives a reviewer's cost; the diff's lines may track it better. Piece 4
  can start with files and keep the medians' spread to judge.
- **A budget** (decision 5), once the figures are real.
