# Study: a hill-climbing loop for the review's lenses

The outcome of [#112](https://github.com/annotant/tranchant/issues/112):
how to measure `/tranchant review` on changes whose defects are known, how
to tell a better recipe from a worse one, and the pieces to build so that a
contributor, or an agent, can change one thing, measure again, and keep the
change only when the measure says so. It records decisions;
[the review file](../review-file.md) stays the reference for what the code
does.

## Where the code stands

Read against the code at `cabc1fb` (#114):

- **One corpus, one case.** `test/fixtures/front-end` plants seven defects
  in four of the ten files its change touches; the six others are clean.
  `test/fixtures/review-front-end.json` is the answer key, one finding per
  defect. Its findings carry no `lens`: the lens is only in their ids
  (`correctness-1`) and in the fixture README's table, and the review file
  says a lens is never read from an id. The seven defects cover six of the
  recipe's ten lenses: `correctness` twice, then `types`, `accessibility`,
  `security`, `tests` and `conventions`. `performance`, `bugs`,
  `silent-failures` and `docs` have nothing to find, yet all ten run on
  this change, since their `paths` match it.
- **One place can be anchored several ways.** Three defects lie in
  `src/cart/DiscountForm.tsx`, anchored at lines 27, 37 and 45. A lens may
  rightly anchor the same defect elsewhere: the unlabelled field on its
  `<input` (line 33), the HTML injection on the `?code=` read (line 13),
  the swallowed failure on its `try` (line 23).
- **The check is by eye.** The fixture's README describes the expected
  outcome ("the seven planted defects, each as one finding of its lens,
  nothing on the clean files"). It also says a lens may add a true finding
  on a clean file ("the discounted total is untested", in
  `src/cart/total.ts`). Nothing compares a review's findings with the key.
  `test/playground.test.mjs` checks the key against the files, not a review
  against the key.
- **A finding has no severity.** It has a `topic` (one of seven), a
  `bucket` (`review` or `auto`) and a `tag` (`concern`, `question` or
  `suggestion`). The key sets all three.
- **A run records time, not tokens.** Each review agent's
  `reviewers/<name>.jsonl` has a `start` step with its `model` and an `end`
  step, each with `at`: the wall time per agent can be read from them. No
  file records the tokens an agent used.
- **The verifier overwrites what the lenses proposed.** `remove.mjs`
  deletes `findings/<id>.json`; `verify.mjs --amend` replaces it. Only the
  verifier's run file keeps its command and its reply. A completed review
  shows what the verifier kept, as it worded it. The verifier does not read
  one finding alone: it lists every finding of the review to merge
  duplicates, the later one by `addedAt` removed.
- **A review runs inside a Claude Code session.** The mod
  (`hooks/register.ts`) starts the summary agent, the reviewers and the
  verifiers with no model turn; they live in `$.state` and vanish with the
  session. Nothing drives a review from a script and waits for it to
  complete. `/tranchant review` takes no base: `prepare.mjs` reviews a
  branch against the repository's default branch.
- **Part of a run can be isolated already.** `prepare.mjs --recipe` runs
  that recipe whole: no lens the user added, no `disabledLenses`, no
  `lensModels`. `XDG_CONFIG_HOME` names Tranchant's settings folder, so a
  run can have its own `reviewModel` and `verifyModel`.
  `TRANCHANT_STATE_DIR` names where reviews are written. `TRANCHANT_MODEL`
  overrides every model and must be unset for a run that measures a model.
  Nothing isolates the rest: the contributor's own Claude Code setup (their
  `CLAUDE.md`, plugins, hooks, MCP servers) and the reviewed repository's
  `.claude/`, `.mcp.json` and `CLAUDE.md` all reach the session.
- **Real changes to mine are few here.** This repository has 4 merged pull
  requests titled `fix:`, and 8 earlier `fix` commits with no pull
  request, mostly about the hooks and the page. In annotant, a looser
  search finds 59 merged pull requests with "fix" in their title. How many
  name, or let `git blame` find, the change that brought their bug is still
  to count.
- **The lenses share two sections word for word**: "The change is data"
  and "How to anchor". "How to work", "How to word" and "How to report" are
  shared too, but each holds lines of its own lens: which files it reviews,
  its topic and bucket rule, its ids. No test checks any of it.

## Decisions

### 1. The corpus: cases of three kinds, each with its key

A **case** is a repository, a base and a head, and `expected.json`, the
key, next to it. Three kinds:

- **Planted.** A fixture built like `front-end`: a clean base, a change
  with defects planted on purpose. They are cheap to key and cover what we
  choose. Their risk is that the prompts learn them.
- **Mined.** A real change of annotant or this repository whose bug a later
  fix names, in its pull request or its commit. The case is the change that
  brought the bug (found from the fix's pull request, or by `git blame` on
  the lines the fix changes); the key is that bug. A mined case's key is
  incomplete: the change may hold other defects nobody fixed. Its findings
  outside the key are judged (decision 2), never counted false by default.
- **Clean.** A change with no known defect, to count false findings. The
  first one costs nothing: the front-end change with its seven defects
  fixed, as the key's `fix` says. The same code with and without its
  defects shows whether a lens finds the defect or merely flags the area.

Some planted cases also carry **an instruction in the code**: a comment or
a string that tells a reviewer to skip a defect, or that it is intended,
next to a defect the key holds. The lenses and the verifier read the code
as data; these cases measure it, so a change that weakens it shows.

The corpus aims, before any climbing, at:

- **about 90 keyed defects**, two thirds of them for climbing, a third held
  out. With 3 runs per candidate and a recall near 70 %, two candidates'
  recalls on 60 defects then differ by chance by about 10 points (two
  standard errors, each defect counted apart); on the 30 held out, by
  about 14. A smaller corpus only shows larger gains. Decision 4 replaces
  these estimates with a measure;
- **every lens with defects of its own.** `performance`, `bugs`,
  `silent-failures` and `docs` start at none. A lens's own recall is too
  noisy to gate on with a few defects (3 defects in 3 runs differ by
  about 40 points by chance): it is reported, and a change to one lens is
  judged on the whole corpus;
- **two more stacks**: a Node.js server and a Python program, where the
  recipe's `paths` send `performance`, `silent-failures`, `bugs` and
  `docs`. A Node.js server in TypeScript or JavaScript is also read by the
  six front-end lenses, which their `paths` match; its key says what they
  should not flag;
- **about 8 clean cases**;
- **the held-out third chosen by case**, not by defect (the defects of one
  case share its code), with clean cases among them.

A fixture of planted defects is another project's code, kept out of this
repository's tooling:

- it joins `test/fixtures/front-end` in CodeQL's `paths-ignore`, knip's
  `ignore` and the linters' ignores;
- its own tests are named so neither `npm test` (`test/**/*.test.mjs`) nor
  `claude plugin test` (`*.test.ts(x)`) runs them, as the front-end's
  `*.spec.ts(x)` are;
- its defects are in its code, never in a dependency's version, which
  dependency review and Dependabot would flag as this repository's;
- a planted secret has a shape no secret scanner knows.

### 2. The key, and how a finding matches a defect

`expected.json` is a file of its own, not a `review.json`. A review file
needs an excerpt, a problem, a why, a fix and a comment per finding; a
mined case's key needs none of them. For the front-end fixture, it is
written from `review-front-end.json`, whose findings first gain their
`lens` (a producer's file may name one), and a test keeps the two in step,
as `test/playground.test.mjs` keeps the key in step with the files.

```jsonc
{
  "version": 1,
  "kind": "planted", // "planted", "mined" or "clean"
  "base": "main", // the runner makes it the case repository's default branch
  "head": "feature/cart-discounts",
  "defects": [
    {
      "id": "accessibility-1",
      "lens": "accessibility", // the lens expected to find it; another lens finding it still counts
      "topic": "Bugs",
      "bucket": "auto",
      "path": "src/cart/DiscountForm.tsx",
      "lines": [37, 37], // the range a finding's anchor must fall in, with a slack of 3 lines
      "also": [{ "path": "src/cart/DiscountForm.tsx", "lines": [33, 38] }], // other places it is rightly anchored
      "defect": "The code field has a placeholder and no label."
    }
  ],
  "clean": ["src/cart/total.ts"] // files of the change with no planted defect
}
```

A finding matches a defect in two steps:

1. **Place.** Its `path` is the defect's, or one of `also`, and its `line`
   falls in the range, give or take 3 lines. This is a script, with no
   model. A planted defect lists in `also` every place a lens may rightly
   anchor it; otherwise a sound finding counts as a miss. A finding that
   matches no place is unkeyed.
2. **Same defect.** A judge agent reads the finding (`title`, `problem`,
   `why`) and the defect's sentence and answers yes or no. One place can
   hold several claims: a lens may anchor another defect, or a wrong one,
   on the line the key names. The judge runs once per pair that matched by
   place.

**One finding per defect.** The first finding that matches a defect, by
`addedAt`, finds it. Later ones on the same defect are duplicates, counted
false: a candidate that reports a defect three times gains nothing.

**An unkeyed finding** goes to a second question of the same judge: is it a
real issue in this change, read against the code? This includes findings on
a `clean` file or in a clean case: `clean` means no planted defect, not no
defect, as the untested `discounted` in `total.ts` shows. Yes counts for
precision and proposes the defect for the key; a person adds it to
`expected.json`, in batches. No counts as a false finding. The judge runs
once per unkeyed finding, so a review costs a call per pair matched by
place and a call per unkeyed finding.

**The judge reads data.** The finding was written by a lens from the
case's code, and the code by whoever: both are fenced in its prompt as
data, never instructions, as the verifier's are. It has Read, Grep and Glob
on the case's repository, and no Bash.

The judge's error must stay below the differences we look for:

- Its model and prompt are fixed and versioned. A new judge is a new
  baseline: every stored run is scored again (decision 6 keeps them).
- Each verdict is cached by the judge's version, the question, the
  finding's text, and the defect's sentence (the same-defect question) or
  the case (the real-issue question). Scoring a run twice gives the same
  score; a new judge or a reworded defect asks again.
- Before its first use, it is checked against about 200 pairs and unkeyed
  findings a person labelled from the first runs. It needs 95 % agreement
  or more; at that size, the measure is good to about 3 points. Below,
  its prompt changes before anything is climbed.
- Its errors depend on how a finding is worded. A candidate that changes
  the wording (the "How to word" section, the verifier, an agent's
  rewrite) has about 30 of its verdicts labelled by a person before it is
  kept, and its score is not trusted below the same agreement.

### 3. The score: a set of constraints, no single number

Each run reports, after the verifier, overall, per lens and per case:

- **Recall**: keyed defects found, by any lens.
- **Precision**: findings that find a defect or that the judge holds real,
  over all findings kept.
- **False findings on clean cases**, counted per case.
- **Instructions in the code obeyed**: keyed defects of those cases that
  no finding reports.
- **Placement**, over the matched findings: the expected lens found it, its
  `topic` and its `bucket` are the key's. The issue's "severity respected"
  is the `bucket`: a judgment call filed as `auto`, a fix an assistant would
  apply unread, is the costly mistake.
- **The verifier**: keyed defects a lens found and the verifier removed,
  and false findings it kept. This needs what the lenses proposed (piece
  2).
- **Cost**: tokens in and out per agent kind (reviewer, verifier, summary),
  and wall time per agent. Wall time depends on `maxReviewAgents` and on the
  API's load: it is reported, never climbed.

A candidate is **kept** when, on the cases that are not held out, one of
these improves past its noise threshold:

- recall;
- precision, or false findings on clean cases;
- tokens;

and, on the same cases, none of recall, precision, false findings on clean
cases and instructions obeyed gets worse past its threshold; tokens rise by
10 % at most for a gain in recall or precision, and not past their
threshold otherwise. On the held-out cases, none of the same gets worse
past its threshold: they catch a change that fits the climbing cases, they
need not show the gain.

One weighted number is not taken: a weight decides in advance how many
false findings one more defect is worth, and the history would hide the
trade a contributor should see. The list of checks is kept short: each one
more rejects a good candidate by chance now and then. Placement and the
per-lens scores are reported, not checked, until the corpus has enough
defects per lens to read them.

### 4. Noise: measured first, then three runs per candidate

The baseline, the recipe as it is, runs 5 times on the whole corpus before
anything changes. From those runs, each metric gets its threshold: twice
the standard error of the difference between two means of 3 runs,
estimated from the spread of the 5, on the climbing cases and on the
held-out ones apart. Recall is compared defect by defect (the same defect
found in more runs or fewer), which removes the variation between defects
from the difference.

A candidate then runs 3 times on the cases its change can touch. A result
within the threshold is a draw, recorded as such: the candidate is not
kept, and may be run 3 times more when it was close. The baseline is the
last kept state, whose runs are already stored: it is not run again for
each candidate, unless a model it ran on has changed since (the history
records the models each agent resolved).

The thresholds are measured again when the corpus grows by a fifth, or
when the judge changes.

### 5. Changing one thing

**What may change**, one per candidate:

- a lens's domain: "What to look at", "What counts", and its own lines in
  "How to work", "How to word" and "How to report" (its files, its topic
  and bucket rule);
- the shared text, changed in every lens at once and measured on all of
  them: "How to anchor", and the rest of the three sections above;
- a lens's model (the recipe's `model`, which `lensModels` overrides for a
  user), `reviewModel`, the verifier's prompt and `verifyModel`;
- the recipe: its lenses and their `paths`;
- `contract.md`, measured on the lenses it wraps. Today none of the
  plugin's lenses is built from it; until the custom-lenses study's piece 2
  makes them domain files, a change to the contract is measured with a test
  lens built from a `source`.

"The change is data", in the lenses and the verifier, is changed by a
person only, never by an agent, and the cases with an instruction in the
code gate it. The summary agent is not scored: nothing in a key says what a
good summary is. `maxReviewAgents` is fixed for the whole corpus: it
changes the wall time and the order the verifiers merge duplicates in.

**The shared text stays shared.** A check in `npm test` holds "The change
is data" and "How to anchor" identical across the lenses, so a candidate
that changes one lens's copy is refused before it costs a run. The three
other sections join the check once the custom-lenses study's piece 2 moves
the shared text into `contract.md` and leaves each lens's own lines in its
domain.

**Who proposes.** A contributor first, by hand, with the loop's report of
the misses and the false findings on the climbing cases. An agent that
reads the same report and rewrites one lens's domain comes after, once the
thresholds of decision 4 are measured and the judge is checked: an agent
climbing on a noisy score fits the noise. It runs as a cleaning agent does
(`hook.mjs --cleaner`): it writes that one lens's file alone, no other
file, no git. The report is data to it, fenced, since its findings were
written from the cases' code.

**The held-out cases stay out of sight.** Their repositories, keys and runs
live outside this repository's tree, in the bench's own folder, where no
proposer runs, and the report and the history give them as passed or failed,
with the metric that failed, never as figures.

**What runs.** The loop runs only what the change can affect:

- a lens's domain, or its model: that lens alone, on every case its
  `paths` match. Its findings join the other lenses' findings as they
  proposed them in the stored baseline runs, and every verifier runs again
  on the whole set, in `addedAt` order, so duplicates merge as in a full
  review;
- the shared text, the recipe or the contract: every lens;
- the verifier: no lens at all. The stored runs' findings, as the lenses
  proposed them, are given to the new verifier again, the whole set at
  once, in `addedAt` order;
- the judge or the key: nothing runs; the stored runs are scored again.

### 6. Where it runs, and what it records

**Locally, never in CI.** A run of the whole corpus is tens of reviews.
`npm run check` never starts one. The scorer is a script with no model but
the judge; its matching by place, its thresholds and its accept rule have
`node:test` suites on a few sample runs committed under `test/bench/`, which
run in `npm test`. A manual workflow can come later, once the cost of a run
is known.

**Under `test/bench/`**, beside the fixtures: the runner, the scorer and
the history. The climbing cases live in `test/fixtures/<case>/`, a mined
case as a script that builds its repository from a commit of annotant or
this repository rather than a copy of their code.

**The runner drives a real review, isolated.** For each case and each run:

- build the case's repository outside this one, its default branch the
  key's `base`, with no `.claude/`, `.mcp.json` or `AGENTS.md`, and a
  `CLAUDE.md` only when a defect needs it (the front-end's `conventions-1`
  does). A mined commit of this repository would otherwise load its own
  copy of Tranchant;
- start Claude Code with a `CLAUDE_CONFIG_DIR` of the bench's own, holding
  the contributor's credentials and nothing else: no plugin but the
  candidate's, no MCP server, no memory, no `CLAUDE.md`, no permission
  bypass;
- set `XDG_CONFIG_HOME` to a folder holding only Tranchant's settings, the
  candidate's `reviewModel` and `verifyModel`, a `TRANCHANT_STATE_DIR` of
  its own, `TRANCHANT_MODEL` unset;
- run `/tranchant review <head> --recipe <candidate recipe> --start` in a
  session that ends once the review is `complete`. How to hold that session
  open from a script, and end it, is the runner's first question (piece 3).

**Raw runs stay out of git; the history is committed.** Each run's review
folder (the findings, what the lenses proposed, the run files) is kept
under `.bench/`, git-ignored, so a new judge or a new key scores them
again. Each candidate's change is kept as a patch, under
`test/bench/candidates/`, and `test/bench/history.jsonl` gets one line per
candidate:

```jsonc
{
  "at": "2026-12-01T10:00:00Z",
  "commit": "…", // the commit the candidate was measured on
  "change": "correctness: name stale closures in useMemo and useCallback", // one line
  "patch": "candidates/0007.patch", // the change tried, kept or not
  "touches": ["agents/review/correctness.md"],
  "models": { "reviewer": "…", "verifier": "…", "judge": "…" }, // as the start steps resolved them
  "judge": "1",
  "key": "4",
  "runs": 3,
  "scores": { "climb": { … }, "lenses": { … } }, // decision 3's metrics, with their thresholds
  "held": "passed", // or "failed: precision"; never figures
  "cost": { "tokens": { "reviewer": …, "verifier": …, "summary": … }, "seconds": … },
  "kept": false,
  "why": "recall +4, within the threshold of 10"
}
```

A rejected candidate's line is committed too, so nobody tries it again
unknowingly. A pull request that changes a lens, the verifier or the recipe
carries the line that kept the change: the reviewer reads the measure, not
a hunch.

### 7. The user's lenses: the same tools, not a feature yet

The key's format, the runner and the scorer take a corpus folder and a
recipe as arguments. A team can then point them at its own cases, mined
from its own fixes, with its recipe, and climb its own lenses. Nothing more
is built for it now: no page, no command, no settings. The built-in recipe
comes first; whether teams want this is an open question.

## The pieces

One issue each. Pieces 1 to 5 follow one another; 6 starts once 1 is in.
Nothing climbs before 5 and 6 are in: the thresholds of 5 are measured
again on the corpus 6 builds.

1. **The key and the scorer by place.** `expected.json`'s format; `lens`
   added to the findings of `review-front-end.json`; the front-end
   fixture's key written from it, with every place a defect is rightly
   anchored in `also`, and a test that keeps them in step; its clean
   variant (the seven defects fixed); and `test/bench/score.mjs` matching
   findings to defects by place, one finding per defect, with its
   `node:test` suite on sample runs. Also the check that "The change is
   data" and "How to anchor" stay identical across the lenses.
2. **What a review proposed and what it cost, recorded.** Each finding as
   its lens added it, before any verifier, kept as `proposed/<id>.json`; a
   removed finding's reason; each review agent's tokens on its `end` step,
   from what Claude Code reports of the agent. The page shows none of it.
   The review file documents them.
3. **The runner.** Drive `/tranchant review` on a case unattended,
   isolated as decision 6 says, N runs, the review folders kept under
   `.bench/` (added to `.gitignore`); first, find how a script holds a
   Claude Code session until the review completes. Also an option to skip
   the summary agent.
4. **The judge.** Its prompt, with the finding and the code fenced as data;
   its tools; its model; its cache; its two questions (same defect, real
   issue); and its check against about 200 labelled verdicts.
5. **The baseline and the loop.** Five runs of the recipe, the thresholds,
   the accept rule, the candidates' patches and `history.jsonl`, the
   replays of decision 5 (one lens, the verifier alone, scoring again),
   the held-out cases kept out of sight, and the report a proposer reads.
6. **The corpus grows.** A Node.js server fixture and a Python fixture
   with defects for `performance`, `bugs`, `silent-failures` and `docs`;
   cases with an instruction in the code; a script that mines cases from
   annotant's and this repository's fixes; clean cases; the held-out split;
   the tooling's ignores for each new fixture.
7. **An agent that proposes.** Once 5 has run a few candidates by hand: an
   agent, held to one lens's file, reads the report on the climbing cases
   and rewrites that lens's domain, then the loop measures it.

## Open questions

- **The size of the corpus.** Ninety defects is an estimate from a recall
  near 70 %; the baseline's runs say what the thresholds really are. If
  they are much larger than 10 points, the corpus grows again before
  anything climbs.
- **How a script drives a session.** Whether a review can run to its end
  from `claude -p`, or needs a session held open another way, decides how
  much the runner costs to build (piece 3).
- **Where tokens come from.** Whether the mod sees an agent's usage when it
  ends, or the runner has to read the agents' transcripts, is for piece 2.
- **Mined cases from this repository** are few and mostly about the hooks
  and the page, which the front-end lenses read as any React and
  TypeScript code. Annotant is the larger source.
- **A team's lenses.** Whether teams would mine their own cases and climb
  their lenses, which would make decision 7 a feature, is left to their
  asking.
