# The review file, the decisions file and the run files

Tranchant keeps everything about a review outside the project, in the state
folder: nothing is installed in a repository to review it.

| File                              | Where                                 | Holds                                                                                       | Written by                                                                                                             |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `review.json`                     | `<state>/<hash>/reviews/<review id>/` | The review's envelope as its producer wrote it: the change, its summary, its `status`       | The producer (any tool that follows this file), imported by `open.mjs`; `complete.mjs` sets its `status`               |
| `findings/<finding id>.json`      | Next to it                            | One finding: its excerpt, marks and diagram, and `addedAt`, when it landed                  | `open.mjs` for the findings a producer wrote inline; `add.mjs` for each one that lands while the review is `reviewing` |
| `decisions.json`                  | Next to it                            | What the reviewer decided on each finding, its state, its runs and the history of its moves | The store (`scripts/lib/store.mjs`), for the server and the agents' scripts                                            |
| `runs/<finding id>.jsonl`         | Next to it                            | The steps of the run in progress on that finding                                            | The hooks (`hooks/register.ts`)                                                                                        |
| `runs/<finding id>.history.jsonl` | Next to it                            | The steps of every run that ended                                                           | The store, when a run ends                                                                                             |
| `reviewers/<name>.jsonl`          | Next to it                            | The steps of one review agent of `/tranchant review`: `sm-summary`, `rv-<lens>` or `vf-<finding id>`; of a finding's discussing agent: `ds-<finding id>` | The hooks (`hooks/register.ts`, `hook.mjs --reviewer`)                                                                 |
| `discussions/<finding id>.json`   | Next to it                            | The finding's discussion: the reviewer's questions and the agent's answers                  | `lib/discussion.mjs`, for the server (a question, a change, and a change's answer or result on each move the reviewer makes and at start), `reply.mjs` (an answer), and `done.mjs`, `ask.mjs`, `hook.mjs ended` (a change's result) |
| `lenses.json`                     | Next to it                            | The Lenses step of `/tranchant review`: one row per lens, as it is resolved and built        | `lenses.mjs`                                                                                                           |
| `usage.json`                      | Next to it                            | What the review's agents spent that no run holds: `live`, `unclaimed`, `reset` ([what the agents spend](#what-the-agents-spend)) | The hooks (`hook.mjs live`, `note`, `ended`), and `reset.mjs`                                                          |
| `choices.json`                    | Next to it                            | A review waiting to start: the page's switches, `{ lenses: { <name>: true \| false }, remember, group? }` | The server, on Start the review and Build the lenses again                                                             |
| `lenses/<sha256>.md`              | `<state>/`                            | A lens's prompt as the Lenses step built it, one file per hash, shared by every review       | `lenses.mjs`, once per hash                                                                                            |
| `cleanings/<cleaning id>/`        | `<state>/<hash>/`                     | A lens's cleaning: `cleaning.json` (its source, the lens it makes or cleans again, where it stands), `lens.md` and `report.json` (what its agent wrote), `rules.md` (the rules the user edited, given back to the agent) | `clean.mjs`, the server's `/api/lens/*`; the cleaning agent (`lens.md` and `report.json` alone)                |
| `servers/<kind>-<pid>-<tag>.json` | `<state>/`                            | One running server: a review's or the dashboard's, its URL and what it serves ([the dashboard](dashboard.md#the-registry)) | The server itself, on `READY`; removed as it exits, or by a reader once its process is gone                       |

`<state>` is `TRANCHANT_STATE_DIR`, else `$XDG_CACHE_HOME/tranchant`, else
`~/.cache/tranchant`. `<hash>` is the first 12 hex digits of the SHA-1 of the
project's root, so each project has its own folder. The file locks the agents
take live in `<state>/<hash of the git toplevel>/locks/table.json`, one table
per repository, shared by every project in it: two agents never write the
same file at once, whichever review they work for. A lock's owner is the pair
(review folder, finding id), since finding ids repeat across reviews.

The reference for these files is
[`skills/tranchant/scripts/lib/format.mjs`](../skills/tranchant/scripts/lib/format.mjs):
its versions, states, moves and JSDoc types. The page mirrors them in
[`skills/tranchant/page/src/domain.ts`](../skills/tranchant/page/src/domain.ts).

## `review.json`

The producer's output. `open.mjs` validates it, imports it into a new review
folder (the envelope in `review.json`, each finding in `findings/<id>.json`)
and prints `REVIEW <dir>`; any other `version` is refused and the file is left
where it was.

A review may open before its findings: the producer writes the envelope with
`status: "reviewing"` and `findings: []`, opens it, adds each finding with
`add.mjs` as it lands and ends with `complete.mjs`. The page opens at once,
shows the review in progress with the count so far, and each finding as it
arrives. A producer that writes the whole review at once needs none of this:
`status` absent is `complete`.

### The envelope

```jsonc
{
  "version": 1,
  "id": "b96fae58-5cc3-426b-9632-77f3a7f8f866", // a UUID the producer mints
  "createdAt": "2026-10-30T15:44:37.597Z",
  "project": "/Users/me/dev/dashboard-ui", // the checkout the fixes land in, absolute
  "branch": "feature/QO-9678/classification-overview",
  "base": "origin/master",
  "headSha": "3552e3ef0c…", // what was reviewed; a fix on another HEAD is refused
  "ownership": "ours", // the default action: "ours" fix first, "theirs" post first
  "status": "reviewing", // optional: "preparing", "reviewing", "complete" or "refused"; absent, "complete"
  "title": "Classification overview page",
  "mr": {
    // optional; required to post, whatever the ownership
    "project": "qohash/dashboard-ui", // GitLab path or numeric id
    "iid": 5746,
    "url": "https://gitlab.com/qohash/dashboard-ui/-/merge_requests/5746",
    "author": "jfdoe",
    "diffRefs": { "baseSha": "…", "headSha": "…", "startSha": "…" },
  },
  "jira": { "key": "QO-9678", "url": "https://qohash.atlassian.net/browse/QO-9678" }, // optional
  "summary": "## Change Map\n…", // Markdown: the Change Map and the summary
  "strengths": ["Tests cover the empty state.", "…"],
  "sources": { "codeReview": 9, "reviewPr": 4, "both": 2 }, // optional
  "verify": true, // optional: findings land unverified, a verifier confirms each
  "findings": [/* Finding, in the order the report lists them */],
}
```

| Field         | Type                      | Notes                                                                                               |
| ------------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| `version`     | `1`                       |                                                                                                     |
| `id`          | string                    | A UUID. One folder per id; opening the same id again reuses its decisions.                          |
| `project`     | string                    | Absolute. The git repository it lies in is the lock root.                                           |
| `headSha`     | string                    | Full SHA. The page shows a warning when the checkout moved; a fix still runs, on the current files. |
| `ownership`   | `ours` or `theirs`        | Decides the default action: `ours`, fix first; `theirs`, post first. Either may post with `mr.diffRefs`. |
| `status`      | `preparing`, `reviewing`, `complete` or `refused` | Absent means `complete`. `reviewing`: findings still land through `add.mjs`, until `complete.mjs`. `preparing`: `/tranchant review` builds its lenses (`lenses.mjs`), then makes it `reviewing`, or waits for Start the review ([waiting to start](#waiting-to-start)). `refused`: a lens could not be built, no reviewer started, `refusal` says why; nothing lands, nothing completes it. |
| `lenses`      | array, optional           | The lenses `/tranchant review` ran, as the Lenses step built them: `{ name, source, version?, hash, files? }`, `source` as the recipe names it, `version` a plugin's, `hash` the SHA-256 of the prompt built (`<state>/lenses/<hash>.md`), `files` how many changed files it reviews, as the plan counted them. |
| `group`       | string, optional          | The group of lenses `/tranchant review` ran ([groups of lenses](settings.md#groups-of-lenses)), set once the Lenses step built them; the page's header and progress bar name it. Not part of what tells a review from another. |
| `refusal`     | object, optional          | With `refused`: `{ lens, source, reason, fix? }`, the lens that could not be built, its source, why, and what fixes it. |
| `paused`      | object, optional          | The page's **Pause** on a `/tranchant review` still `reviewing`: `{ at, now? }`; no review agent starts until **Resume** removes it, and the review does not complete. `now`: **Pause now** ended the agents at work, which run again from the start on Resume. See [pause, stop and reset](#pause-stop-and-reset). |
| `stopped`     | object, optional          | The page's **Stop the review**: `{ at }`; its agents ended, no Resume, nothing more lands (`add.mjs` and `summarize.mjs` refuse), and the hooks complete it. Only **Reset the review** runs it again. |
| `mr.forge`    | `github` or `gitlab`, optional | `gitlab` when absent. On GitHub (`/tranchant comments`), `mr.project` is `owner/repo` and `mr.iid` the pull request's number; it has no `diffRefs` (refused there): its findings are replied on, never posted as comments of their own. `mr.url` names no user or password before its host, the host a reply's token goes to. |
| `mr.viewer`   | string, optional          | Who imported its threads (`/tranchant comments`: GitHub's `viewer`, `glab api user`): the page marks their comments in a thread as theirs. |
| `mr.diffRefs` | object                    | GitLab's `diff_refs` of the MR version reviewed: a positioned comment needs all three, and its `headSha` to be the review's `headSha` (an `ours` branch ahead of or behind its MR cannot post: push it first). |
| `summary`     | string                    | Markdown, shown above the findings. May be blank: with no `strengths` either, the page hides the section. While the review is `reviewing`, `summarize.mjs` writes it and `strengths`; the page shows them as they land. |
| `verify`      | boolean, optional         | `true`: each finding lands unverified and a verifier confirms it (`verified`); the page dims the others; while the review is `reviewing`, the server prints `LANDED` once for each not verified yet. Only `/tranchant review` sets it: `open.mjs` drops it from any other file, and every finding's `verified`, so a review opened from a file is never dimmed. |
| `findings`    | Finding[]                 | At least one, unless the review is not `complete`. Ids unique within the review.                    |

### A finding

```jsonc
{
  "id": "f-03",
  "topic": "Bugs", // see Topics
  "bucket": "review", // "review" (🔴 needs your review) or "auto" (🟢 safe to auto-fix)
  "tag": "concern", // "concern" (the default), "question" or "suggestion"
  "title": "Null tenantId crashes the loop", // one line, under 80 characters
  "path": "src/people/usePeople.ts", // relative to project
  "line": 42, // the anchor line, new side, 1-based
  "excerpt": {
    "startLine": 36,
    "lines": ["export function usePeople(tenantId?: string) {", "…"], // the new-side text, 3–40 lines
  },
  "hunk": "@@ -30,8 +36,12 @@\n …", // optional: the unified-diff hunk instead of plain context
  "marks": [
    // what to highlight in the excerpt
    {
      "line": 42,
      "from": 10,
      "to": 18,
      "note": "undefined when the drawer opens before the query settles",
    },
    { "line": 45 }, // a whole line
  ],
  "problem": "This crashes when the drawer opens before the tenant query settles.",
  "why": "The person page then shows the error boundary instead of a skeleton.",
  "fix": "Return early while `tenantId` is undefined, as `useFiles` does three lines above.",
  "comment": "This crashes when … (the full text to post on the MR, in the author's language)",
  "diagram": {
    // optional, only when a flow needs proving
    "kind": "mermaid", // "mermaid", "svg" or "text"
    "source": "sequenceDiagram\n  PersonDrawer->>usePeople: mount (tenantId undefined)\n  …",
    "caption": "The drawer mounts before the tenant query resolves.",
  },
  "related": [
    // optional: other excerpts the finding relies on
    {
      "path": "src/people/useFiles.ts",
      "line": 12,
      "excerpt": { "startLine": 10, "lines": ["…"] },
      "marks": [],
    },
  ],
}
```

| Field                        | Type                                | Notes                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                         | string                              | `f-` and a number is the convention; any unique string works.                                                                                                                                    |
| `topic`                      | Topic                               | One of the seven below.                                                                                                                                                                          |
| `bucket`                     | `review` or `auto`                  | The findings model's split: judgment calls, or mechanical fixes an assistant applies from the text alone.                                                                                        |
| `tag`                        | `concern`, `question`, `suggestion` | The findings model's tags; `concern` when absent.                                                                                                                                                |
| `title`                      | string                              | Up to 120 characters.                                                                                                                                                                            |
| `path`, `line`               | string, integer ≥ 1                 | The anchor. `line` is on the new side of the diff; it must be in the excerpt.                                                                                                                    |
| `excerpt.startLine`          | integer ≥ 1                         | The number of `lines[0]`.                                                                                                                                                                        |
| `excerpt.lines`              | string[]                            | 1 to 80 lines, each up to 400 characters. Tabs allowed, no other control characters.                                                                                                             |
| `hunk`                       | string, optional                    | A unified-diff hunk (`@@ -a,b +c,d @@` then context, `+` and `-` lines) covering `line`; the page shows it in place of the excerpt when present.                                                        |
| `marks[].line`               | integer                             | Within the excerpt (or the hunk's new side).                                                                                                                                                     |
| `marks[].from`, `marks[].to` | integer ≥ 0, optional               | Columns, 0-based, `from` inclusive and `to` exclusive; absent, the whole line.                                                                                                                   |
| `marks[].note`               | string, optional                    | Up to 300 characters, shown beside the line.                                                                                                                                                     |
| `problem`, `why`, `fix`      | string                              | Markdown (inline code, bold, links, lists, fenced code), in plain words: one idea per sentence. No heading (one renders as bold text), no HTML (it stays text); only `http`, `https` and `mailto` links are links. |
| `comment`                    | string, optional                    | The text to post, whole. Required when `ownership` is `theirs`; optional on an `ours` review with an `mr`, where the page prefills the editor from `problem` and `fix` when it is absent. Up to 4000 characters. |
| `diagram.kind`               | `mermaid`, `svg` or `text`          | `mermaid`: [Mermaid](https://mermaid.js.org) source the page draws in its own colours, the way to show a sequence or a flow (`sequenceDiagram`, `flowchart`, `stateDiagram`); strict: no click, no HTML label, and a directive (`%%{init}%%`, front matter) cannot change the security level, the labels, the layout (dagre, `flowchart-elk` included), the theme, its CSS or its font; a source that does not parse shows as text with the parser's message. `svg`: inline SVG drawn by hand, for what Mermaid cannot draw, which the page sanitizes (no script, no event handler, no `foreignObject`, no external reference). `text`: preformatted, ASCII art or a Markdown list of steps. Up to 64 KiB. |
| `related[]`                  | object[], optional                  | Up to 4. Same shape as `path`, `line`, `excerpt`, `marks`.                                                                                                                                       |
| `addedAt`                    | string, optional                    | When it joined the review, set by `open.mjs` or `add.mjs`: the producer leaves it out. `/api/review` lists the findings in that order.                                                           |
| `lens`                       | string, optional                    | The name of the lens that found it (up to 40 letters, digits, `-` and `_`), set by `add.mjs --lens` when a reviewer of `/tranchant review` adds it; the page shows it on the finding. A producer's file may name one too; absent (most files, the threads of `/tranchant comments`), no lens found it. Never read from the id: a renamed lens and an imported file would break that. A verifier's amendment keeps it. |
| `thread`                     | object, optional                    | The pull or merge request thread the finding comes from, written by `comments.mjs` (see [`/tranchant comments`](#tranchant-comments)): `forge` (`github` or `gitlab`), `id` (GitHub's review thread node id, GitLab's discussion id), `url`, `comments` (1 to 100, the reviewer's first, then the replies: `author`, `body` up to 65,536 characters, a third party's Markdown, `at`, `url`), `outdated` (the code it was on is not at `line` in the head any more: `line` is only near it, its excerpt the code the comment read; the page puts it on its file's header) and `file` (on the whole file). Its `forge` is the review's `mr.forge` (`gitlab` when absent): a finding whose thread is on another forge, or in a review with no `mr`, is refused. A post on such a finding replies on the thread. |
| `verified`                   | boolean, optional                   | Set by `verify.mjs` once a verifier confirmed or amended it; read only when the review's `verify` is true. Like `addedAt`, left out when two findings are compared.                             |

#### Topics

`Bugs`, `Security & Permissions`, `Breaking Changes` default to the `review`
bucket; `Tests`, `Conventions`, `Code Quality`, `Deprecation & Feature Flags`
default to `auto`. The producer sets `bucket` itself (the model's nature
overrides apply); the page groups by bucket, then topic, then `path:line`.

## `decisions.json`

```jsonc
{
  "version": 1,
  "findings": {
    "f-03": {
      "state": "fixed",
      "decision": {
        "action": "fix",
        "context": "keep the early return, no throw",
        "resolve": true, // a post on a thread: resolve it once replied
        "proposal": "…", // a post on a thread: the `at` of the agent's message whose proposed reply it started from
        "change": "…", // a fix asked in its thread's discussion: the `at` of the reviewer's message that asked
        "at": "…",
      },
      "comment": "…", // a post: the text as posted, when the reviewer edited it
      "question": {
        "text": "…",
        "options": [{ "label": "…", "description": "…" }],
        "multiple": false,
        "at": "…",
      },
      "answer": { "text": "…", "choices": ["…"], "at": "…" },
      "reason": "…", // dropped: the reviewer's words; failed: the error
      "posted": { "discussionId": "…", "url": "…", "at": "…", "resolved": true }, // `unresolved`: why resolving the thread failed
      "reply": { "text": "…", "resolve": true, "proposal": "…", "at": "…", "failed": "…" }, // a reply on its thread aside from the moves (settled, or its fix under way): on its way, or why it failed
      "replies": [{ "text": "…", "url": "…", "at": "…", "resolved": true, "proposal": "…" }], // the replies posted on its thread, shown in it until an import holds them
      "issue": { "title": "…", "body": "…", "url": "…", "ref": "#12", "at": "…" }, // an issue: url, ref, at once created
      "runs": [/* Run */],
      "events": [/* Event */],
      "cancellation": {
        "at": "…",
        "changed": ["src/people/usePeople.ts"],
        "steps": 4,
        "run": "r1",
      },
    },
  },
}
```

A finding absent from `findings` is `open`. Every field but `state`, `runs`
and `events` is optional.

### States and moves

| State     | Meaning                                                                   | Moved by                            |
| --------- | ------------------------------------------------------------------------- | ----------------------------------- |
| `open`    | Nothing decided yet                                                       |                                     |
| `queued`  | A fix, a post or an issue is decided; waiting for an agent, glab or gh    | reviewer (`fix`, `post`, `issue`, `change`, an answer) |
| `working` | An agent is on it                                                         | agent (`claim.mjs`)                 |
| `asking`  | The agent asked the reviewer something; it stopped                        | agent (`ask.mjs`)                   |
| `fixed`   | The working tree holds the fix                                            | agent (`done.mjs`)                  |
| `posted`  | The comment is on the MR                                                  | server (`post.mjs`)                 |
| `moved`   | Moved to an issue, to settle later; `issue.url` links it                  | server (`issue.mjs`)                |
| `dropped` | The reviewer rejected the finding                                         | reviewer                            |
| `skipped` | Deferred                                                                  | reviewer                            |
| `failed`  | The fix, the post or the issue failed; `reason` says why                  | hooks, server                       |
| `stopped` | The reviewer stopped the agent; `cancellation` lists what it left changed | reviewer                            |

Moves the store accepts:

- `fix`: from `open`, `posted`, `dropped`, `skipped`, `failed`, `stopped` → `queued`. From `posted`, the comment or the reply stays where it is (`posted`, `replies`): commenting never rules out the fix. An `asking` finding leaves only through `answer`.
- `post`: from `open`, `dropped`, `skipped`, `failed` → `queued`; refused unless `mr.diffRefs` is set and its `headSha` is the review's, whatever the `ownership`, and unless the decision or the finding carries a `comment`. On a finding with a `thread`, a reply: it needs an `mr` and the decision's `comment` (the reviewer writes every reply), never the diff refs. On a `fixed` or `posted` thread finding, or one whose `fix` decision is under way (`queued`, `working`, `asking`, `stopped`), a reply is no move: it is kept in `reply` while `post.mjs` runs, the state and the fix (its run, its Stop) stay, `posted` records it once on the thread and `reply` goes, a failure leaves `reply.failed` (`store.fail` with `reply`); one at a time, refused while a post is `queued` or a reply on its way, again as often as the thread is answered back. On GitHub, `postBlocker` refuses any post but a reply.
- `issue`: from `open`, `dropped`, `skipped`, `failed` → `queued`, with `issue.title` and `issue.body` (the title cut to one line of 255 characters, the body to 60,000); refused when either is empty. Any ownership, with or without an MR.
- `drop`, `skip`: from `open`, `queued`, `asking`, `failed`, `stopped`, or from each other → `dropped`, `skipped`. Never from `working`, `fixed`, `posted` or `moved`.
- `posted`, `moved`: the server's, from `queued` → `posted`, `moved`.
- `answer`: from `asking` → `queued`, with `answer` set; the server prints `FIX <id>` again.
- `stop`: from `queued`, `working` → `stopped`.
- `change`: from `open`, `posted`, `skipped`, `failed`, `stopped`, `fixed` → `queued`, a `fix` decision whose `context` is the reviewer's request and `change` the `at` of their message, asked in the discussion of a finding with a `thread` only (see [a discussion](#a-discussion)); a `question` and `answer` an earlier run left go. The one move that leaves `fixed`: a follow-up change.
- `claim`: from `queued` → `working`, starting a run; refused on a finding queued for a post or an issue.
- `done`: from `working` → `fixed`. `ask`: from `working` → `asking`. `hook.mjs ended` moves a `working` finding whose agent ended without either to `failed` (`reason`: `the agent ended without done.mjs or ask.mjs`).

A `fixed` or `moved` finding is final: no move leaves it (the reviewer
reverts by hand, or asks for a follow-up in a new review), but a `change`
its thread's discussion asks for; a reply on its thread is no move. A
`posted` one is final but for a fix (`fix`, or a `change` on a thread).

The page's one-shot button (Post all to do) acts on the `open` findings (To do
on the page) only, in list order; a selection may apply any move the table
allows, but a reply on a thread, which is written finding by finding. At start, the server prints `FIX <id>` again for every `queued` fix
and runs the queued posts and issues again, and the replies still on their way; a `working` finding is left to its agent.

### A run

```jsonc
{
  "id": "r1",
  "agent": "a3fbb6e8bc0e856d1",
  "model": "claude-opus-5-5",
  "startedAt": "…",
  "endedAt": "…",
  "outcome": "fixed",
  "summary": "Returned early while tenantId is undefined.",
  "changed": ["src/people/usePeople.ts"],
  "usage": { "models": [{ "model": "claude-opus-5-5", "input": 18204, "output": 9310, "cacheRead": 1203551, "cacheWrite": 61877 }] }, // optional
}
```

`outcome` is `fixed`, `asking`, `failed` or `stopped`; absent while running.
`agent` is the agent that claimed it: `claim.mjs --agent`, else the hooks
stamp it from the claim's Bash call. `usage` is what that agent spent
([what the agents spend](#what-the-agents-spend)), written once the agent
ended, whatever the run's outcome (`done.mjs` and `ask.mjs` end the run
before the agent's turn ends); absent, not reported.

### An event

```jsonc
{
  "at": "2026-10-30T15:44:57.469Z",
  "state": "working",
  "by": "agent",
  "run": "r1",
  "agent": "a3fbb6e8bc0e856d1",
}
```

`by` is `reviewer`, `agent` or `server`. Events are appended, never
rewritten.

## A discussion

`discussions/<finding id>.json`: the reviewer asks about a finding, an agent
answers. A discussion is not a decision: no move of the finding goes through
it, but a change the reviewer asks for on a thread (see
[change requests](#change-requests)).

```jsonc
{
  "version": 1,
  "messages": [
    { "by": "reviewer", "text": "Is this really reachable?", "at": "…" },
    {
      "by": "agent",
      "text": "Yes: the drawer mounts before … (Markdown)",
      "at": "…",
      "proposal": {
        // optional, each field too
        "fix": "Return early in the hook, not in the drawer.", // the fix's context
        "comment": "This crashes when …", // the comment to post, whole
        "drop": "The query always settles first: `useTenant` suspends.", // the reason to drop
      },
    },
    { "by": "agent", "text": "The agent ended without answering: ask again.", "at": "…", "failed": true },
    { "by": "reviewer", "text": "Go ahead, keep the early return", "at": "…", "change": true },
    { "by": "agent", "text": "Returned early in the hook.", "at": "…", "runs": ["r1"], "outcome": "fixed" },
  ],
}
```

| Field                 | Notes                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `messages[].by`       | `reviewer` or `agent`. A last message by the `reviewer` waits for the agent's answer: no other question until it comes.        |
| `messages[].text`     | The reviewer's up to 4,000 characters, plain; the agent's up to 8,000, Markdown.                                              |
| `messages[].proposal` | The agent's: `fix`, `comment`, `drop`, each up to 4,000 characters. The page offers **Fix with this** (a `fix` decision, `fix` its `context`), **Post this** (`comment` in an editor in the thread, then a `post` with what it holds) and **Drop with this reason** (a `drop`, `drop` its `reason`) on the last answer, when the finding's state allows the move. |
| `messages[].failed`   | `true`: its agent ended, was stopped or could not start before it answered, or `/tranchant stop` ended the wait; or the change asked for went no further (its `outcome` says how).                                                                  |
| `messages[].change`   | The reviewer's, `true`: it asks for a change to the code, or answers the question that change's agent asked.                                                |
| `messages[].runs`, `messages[].outcome` | The agent's, after a change: the runs it took since it was asked (answers included), when any started, and the state they left the finding in: `fixed` (its text the last run's summary), `asking` (the question), `failed`, `stopped`, `dropped`, `skipped`, or another state with `you decided otherwise` when another decision replaced the change (all but `fixed` and `asking` with `failed`). |

The reviewer may write while the finding is `open`, `skipped`, `failed` or
`stopped`: nothing settled, no agent on it; on a finding with a `thread`,
also once `fixed` or `posted`, the thread living on until it is resolved.
In any other state the discussion reads as it stands. On a thread, the
agent's `comment` is a reply: **Reply with this** opens the reply editor
with it, for the reviewer to change and send, and the `post` carries the
answer's `at` as its `proposal`. While the finding's fix is under way
(`queued`, `working`, `asking`), the discussion reads as it stands but the
last answer's reply is still offered. A reply on its way or sent with that
`proposal`, or with the proposal's text, takes it: the page says so under the
answer instead of offering it again; a failed one offers it again. A
discussion holds 60 messages at most.

Each question starts one agent (`tranchant:ds-<id>-<review>`,
`agents/discuss.md`), which reads the whole discussion again: one agent per
message, nothing kept alive between them. It counts among the three review
agents that run at a time, after the review's own. Its prompt gives the
finding's id, `REVIEW`, `SKILL`, `PROJECT`, `BASE`, `HEAD`, `RANGE`,
`OWNERSHIP`, then the finding and the messages as JSON, fenced. Its hooks are
a review agent's (`hook.mjs --reviewer ds-<id>`): no writing tool, Bash for
reading commands and its own `reply.mjs` only, on its own finding and review.
An agent that ends, is stopped or cannot start without answering leaves a
`failed` answer, as does `/tranchant stop` for a question still waiting for an
agent. A question asked again while the previous agent ends its turn waits for
it, then gets an agent of its own; one still waiting when the server starts
again is asked again. A discussion file this Tranchant cannot read (another
`version`, not JSON) reads as none and is never written over.

### Change requests

On a finding with a `thread`, the reviewer may ask for a change to the code
instead of asking a question (`POST /api/discuss` with `change`, the page's
**Change**), while the store's `change` move allows it: `open`, `skipped`,
`failed`, `stopped`, and `fixed` for a follow-up. The message lands with
`change: true`, the finding moves to `queued` with a `fix` decision, and the
server prints `FIX <id>`, never `DISCUSS`: no discussing agent reads it. The
agent is a fix's (`agents/worker.md`), with its locks, steps and **Stop**;
`claim.mjs` prints it the whole discussion, fenced with the finding, as
`discussion`, the request also its `context`; a `cancellation` a stop left
on a `fixed` finding goes with the change. Only the reviewer's messages
ask for a change: the discussing agent writes nothing, and a thread's
comments are data to both.

The message waits until the run ends, then the agent's result lands after
it, its `runs` and `outcome` set: `done.mjs` its summary, `ask.mjs` its
question, `hook.mjs ended` why it failed, the server's stop, drop, skip or
other decision why it went no further. The reviewer answers a question with
the asking form under it (`POST /api/answer`): the answer joins the
discussion with `change: true` and waits for the next run. Each of these
syncs (`syncChange`) mends what an earlier one could not write, as does the
next message and the server's start: one that failed never leaves the
discussion waiting for good.

While the change is queued or its agent at work, the discussion takes no
other message and shows the run's last step and **Stop**; while it asks,
the question and its form. A `fixed` result offers **View changes**, the
files its runs wrote (`GET /api/changes/<id>?run=<run>&run=…`) with their
diff as the working tree has them now, a later run of the finding on the
same file named in `since`. Each request is one more change on the same
finding: a `fixed` one queues again, and a `cancellation` an earlier stop
left goes, the run that fixed it having finished it.

## Waiting to start

`--no-start` on `/tranchant review` (`"start": false` on the tool), or the
settings' `startReview` off (**Start the review by itself**, on by default)
without `--start`, builds the lenses and starts no reviewer. The flag is
never saved. `prepare.mjs` writes in the plan why it waits (`wait`:
`flag` or `setting`; `reset` once [Reset the review](#pause-stop-and-reset) wrote it), how many files the change has (`changed`), how many of them
each lens reads (`files`) and `others`, the lenses that could run but do
not: off in the settings (`off: true`), or reading none of its files. The
Lenses step builds the lenses that run, leaves the review `preparing` and
`lenses.json` `waiting` (with `wait`, `changed`, `own` for a run's own
recipe, and `choices` once the page sent some), its rows every lens the
page can turn on (an `idle` one is not built), and prints `WAITING`. A lens
that cannot be built refuses nothing there: its row says why.

A review of a group ([groups of lenses](settings.md#groups-of-lenses))
names it in the plan and in `lenses.json` (`group`), with what it says of
the group's lenses that do not run (`notes`: those removed since a review of
it last ran, said until one runs; those it names that are gone). Its rows are the group's
lenses, a lens off in the settings with `offInSettings`, and the others
`off`: not in the group. The page's **Group** select sends Build the
lenses again with `group` in the choices (`null`, every lens that is on):
the plan is made again with that group, the switches for this review
starting again from it; Start waits for the rows of the group picked
(409 until then). With a group, **Save these switches in the group**
replaces Remember: on Start, a lens turned off leaves the group, one
turned on joins it, in place of one of the same name; the settings are not
written.

The page's center shows why it waits, the target, the lenses that run and
the files each reads, the agents, the tokens it should spend (below), a
switch on each lens, **Remember these choices** and **Start the review**,
refused while a lens that is on cannot be built. A switch acts on this
review only; checked, Remember saves them on Start as Settings › Lenses
does (a recipe's lens in `disabledLenses`, an added lens in its
`lens.json`). Start writes `choices.json` and prints `START <review id>`;
the hooks run `lenses.mjs --start`, which makes the plan again from the
settings as they stand, applies the choices, builds the lenses on and goes
on as any review, or back to `waiting` when one cannot be built. **Build
the lenses again**, and the way back from Settings once they changed,
print `BUILD <review id>`: `lenses.mjs --replan`, waiting still. Either
runs `lenses.mjs --check` first, on the lenses then on: one whose source
changed is cleaned again before the build, as at the first one. A plan
that cannot be made again (the settings or the recipe unreadable, git
failing) leaves the last one standing, the review waiting, and says why in
`lenses.json`'s `problem`; it never falls back on the default settings.
The server takes no second Start or Build until `lenses.json` moves (409),
nor `remember` on a run's own recipe; Remember checks the settings file
before it writes anything. `/tranchant stop` refuses a review that waits,
or whose Start is at work.

**The estimate.** While a review waits, `/api/review` answers `estimate`
(`lib/estimate.mjs`), from the project's past reviews created before it,
the 20 whose `review.json` was last written: their `review.json` and their
run files' `end` steps (their `findings/` for the averages below), each review's sums kept in the
server's memory while those files stay the same (a `complete` review is
read once). A file that is not a regular file, or past 16 MiB, leaves its
review out; so does a `review.json` that does not parse or has no date:
said once on stderr, never a failure. Per lens that reads a changed file,
on or off: the median of its reviewer's tokens per file read (`files` on
`review.json`'s `lenses`) over its last 5 runs, times the files it reads
now, plus the median of its verifications (one per finding, its verifiers
summed, left out when one has no whole figure) times the median of the
findings it sent to verification over the same runs. A run is skipped when
it read no file or its reviewer has no whole figure (none, or `partial`);
its history stops at the first run whose prompt `hash` is not the row's
(`hash` on a ready row of `lenses.json`; a lens not built takes its last
run's), back to it later or not. A lens with no past run is left out.
`estimate` is `{ recorded, summary, lenses: [ { name, tokens, perFile, runs, reviews } ] }`:
`recorded` whether a past review recorded any figure, `summary`
`{ tokens, reviews }`, the summary agent's median over the last 5 that have
one (`null`: none), `reviews` the past reviews' folder names a figure comes
from. The page sums the lenses its switches turn on (one that cannot be
built left out) and the summary: the **Tokens** fact (`about 3.5M tokens`,
from how many past reviews, and the lenses on with no past run, not
counted), `~` on each row, the figure beside Start. With a figure, the
token note past 12 reviewers goes; with none (`recorded` false, or no lens
on with a past run), the fact says why and the note stays.

**A lens's average.** The same scan gives Settings › Lenses each lens's
average a review (`history` on `/api/settings`'s lenses, see
[the settings file](settings.md)): over its last 10 `complete` and
`verify` reviews of the project that no stop cut, the one the page serves
included, since its prompt `hash` last changed (the lens as built now; one
that cannot be built takes its last run's), its reviewer's and its
verifications' tokens, and its findings a verifier confirmed (`verified`; a
finding counts for the lens its `lens` names, never one read from its id).
A review run without verification confirmed nothing and is skipped, as is
a run whose reviewer or one of whose verifications has no whole figure, or
a finding it landed had no verifier. A finding's file past 256 KiB, or that
cannot be read, leaves its review out of the averages, said once on stderr;
its tokens still count for the estimate. On the page, a lens's line divides
its tokens by its confirmed findings (none confirmed, no ratio); a group's
sums its lenses' averages still there, the ratio over the sums, those with
none named and left out.

## Pause, stop and reset

The page's progress panel of a `/tranchant review` that runs has two
controls with two intents, **Pause** (I'll come back to it) and **Stop the
review** (I'm done with it), and a stopped one has a third, **Reset the
review**. Pause and Stop never touch a fix, a discussion or a post under
way: those belong to the findings, not to the review; Reset is refused
until they end.

- **Pause** writes `paused`: no agent of the review's queue starts, those at
  work finish theirs and their findings land (*Pausing*). **Pause now**,
  while it pauses, ends them; each is queued again first and runs from the
  start on Resume: its run file ends with an `end` step labelled
  `Interrupted` (`outcome: "interrupted"` in `/api/review`), and the page
  says *interrupted · runs again on Resume*. Once none runs: *Review
  paused*. **Resume**, paused or pausing, starts the queue where it stopped;
  with nothing left, the review completes. A reviewer queued again is told,
  in its prompt, that the findings of its lens landed already: to add none of
  them again, and to number its own after theirs.
- **Stop the review**, paused or not, asks first, inline: **Keep it
  running** (*Keep it paused*), **Stop the review** or **Stop and reset**. It
  writes `stopped`: the agents at work end now, the queued ones never start,
  there is no Resume, and the hooks complete the review. The lenses left are
  *not covered*; the findings that landed stay to read and settle. Stop,
  Pause now and Reset free the agents' places: a question, or another
  review's queued agent, gets one (an agent TaskStop did not end keeps its).
- **Reset the review** (and **Stop and reset**), the one control of a
  stopped review, with no confirmation (the stop had one): `reset.mjs`
  removes its findings and their decisions, keeps its plan file
  (`wait: "reset"`), which `lenses.mjs --replan` rebuilds from the settings
  as they stand, and brings the page to **Ready to start the review**
  ([waiting to start](#waiting-to-start)), the lenses it ran on turned on. **Start the review** runs it again from scratch, on the
  same commits (`headSha`): a fix already made stays on the working tree,
  where the reviewers read the files, but in the diff only once committed and
  reviewed again. It removes everything (findings, decisions, runs,
  discussions, review agents' run files), so it is refused (409, and the
  page's buttons are disabled, naming them) while a finding is `queued`,
  `working` or `asking`, or its discussion waits for an answer
  (`store.underWay()`): Reset is refused until it ends, never cut short.

An agent the hooks' TaskStop does not end runs on: a toast says so, its run
file gets a note `Could not be stopped: runs until its turn ends`
(`stuck: true` in `/api/review`, shown running), Pause now does not queue it
again, it keeps its place, and Reset is refused (409, and by the hooks) until
its `end` step. A note older than the moment the Claude Code session that
runs the server first served a review (the hooks pass it,
`TRANCHANT_SESSION_SINCE`) counts for nothing: the agent ended with the
session that ran it. An agent whose turn ends while it is stopped, or that
the list says completed, ended its work: its `end` says `Ended`, and Pause
now does not queue it again; one that failed, was killed or is no longer
listed ends stopped, and Pause now queues it again.

`/tranchant stop` still ends everything it can, a paused review's agents
included, and says how many agents TaskStop left running (a toast names each).

## The run files

One JSON object per line, as the hooks record the agent's tools:

```jsonc
{ "at": 1761838297469, "kind": "start", "label": "Started", "state": "done", "model": "claude-opus-5-5" }
{ "at": 1761838298102, "kind": "read", "label": "src/people/usePeople.ts", "state": "done" }
{ "at": 1761838301540, "kind": "edit", "label": "src/people/usePeople.ts", "file": "src/people/usePeople.ts", "state": "running" }
{ "at": 1761838304011, "kind": "bash", "label": "pnpm exec vitest run src/people", "state": "failed", "detail": "…" }
{ "at": 1761838310200, "kind": "note", "label": "Early return added; the drawer test passes.", "state": "done" }
```

`kind` is `start`, `read`, `edit`, `write`, `bash`, `search`, `note` or
`tool`; `state` is `running`, `done` or `failed`. An `edit` or `write` has
`file`, its path from `project` (`../` outside it): outside the repository, its
`label` is only the file's name. The server watches the
folder and tells the page to reload. A run that ends moves its file to
`.history.jsonl`.

A review agent's file, `reviewers/<name>.jsonl`, holds the same steps: the
hooks write its `start` when it starts (its label says the lens or the
finding), its tools and its notes (whole, line breaks kept, up to 8,000
characters: the page shows its last as the lens's report), and an `end`
step when it ends (`done`) or
is stopped (`failed`). It is never moved: `/api/review` lists every review
agent, running until the `end` after its last `start` (an agent Pause now
ended starts again in the same file); one whose session closed before it
ended keeps showing running. A reset removes them all; a review agent's step
that lands on a review back to `preparing` is not written. A verifier's
`start` carries its finding's `lens`, and an `end` its agent's `usage` when
it was reported.

## What the agents spend

Every agent the hooks start has its tokens recorded: the summary agent,
the reviewers, the verifiers, the discussing agents, the fixes' agents and
the cleanings. `/api/review` sums it; the page shows the total in the
header's chip and opens it, by agent kind and by lens, on its Tokens screen
(`#tokens`); a finding's Run section shows each of its runs', its
verification's and its discussion's, and their sum.

**The figure.** One shape everywhere, read by
[`format.mjs`'s `readUsage`](../skills/tranchant/scripts/lib/format.mjs):

```jsonc
"usage": {
  "models": [
    { "model": "claude-sonnet-5-5", "input": 18204, "output": 9310, "cacheRead": 1203551, "cacheWrite": 61877 }
  ],
  "usd": 0.84, // optional: /cost's estimate, never a bill
  "hasUnknownPrice": true, // optional, as Claude Code sets it
  "partial": true // optional: a last reading, not the agent's whole figure
}
```

One entry per model that answered the agent, 8 at most (past 7, the rest
summed as `other`, in a sum too), each with the four counts the API
reports, integers from 0 to 10¹²; `model` follows the settings' rule
(`[\w.:-]`, 80 characters at most); `usd` from 0 to 10⁹. Anything else, wherever
it comes from (a fix's agent can write the state folder), reads as **not
reported**: never as zero, and a sum never fails on it.

**Where it comes from.** The hooks read the agent's entry in Claude Code's
agent list (`usage`, `cost.usd`, `cost.hasUnknownPrice`) where each kind's
end is recorded: a fix's end, normal or stopped; a review agent's `end`
step, whichever path writes it (its turn's end, its report first, a stop, a
reload); a cleaning's check. A stop reads the list right after TaskStop,
before Claude Code drops the agent. Meanwhile the hooks keep each agent's
last figure, from a live read or from its turn's end (`turn.complete`'s
`usage`). An agent the list no longer holds at its end is written with that
figure, `partial`; with none, it is not reported. A figure that goes down
(`/clear` or `/resume` in the session start its count over) never replaces
a higher one: the higher stays, `partial`. The agent list holds usage from
Claude Code 2.1.326; on an older one, the turn's figure is the one written,
`partial`, and an agent whose final report reaches the hooks before its
turn's end is not reported.

**Where it is kept.**

| Agent | Where | Written by |
| --- | --- | --- |
| A summary agent, reviewer, verifier or discussing agent that ended | `usage` on its `end` step in `reviewers/<name>.jsonl` (Pause now: each agent's `end` its own) | The hooks |
| A fix's agent that ended | `usage` on the run it claimed in `decisions.json` | `hook.mjs ended --usage <json>`, after the finding is failed and its locks released: an unsound figure only goes unreported |
| A fix's agent that ended before its claim | `usage.json`'s `unclaimed`: `{ finding, agent, usage }` | `hook.mjs ended --usage` |
| A cleaning that ended | `usage` in its `cleaning.json`, beside `review` when a review cleaned it again | `clean.mjs --check [--stopped] --usage <json>` |
| An agent at work | `usage.json`'s `live`: `{ key, agent, at, usage }`, `key` its run file's name (`rv-bugs`, `vf-f-03`, `cl-…`) or `fix:<id>`, replaced at each write; a review agent's or a fix's removed at its end, a cleaning's ignored once it is checked | `hook.mjs live`, from the hooks, every ten seconds at most on the agent's steps, one write at a time; a cleaning only while a review waits for it |
| What a reset removed | `usage.json`'s `reset`: `{ kinds: [ { kind, agents, usage } ], lenses: [ { lens, reviewer?, verifiers? } ] }`, added to at each reset | `reset.mjs`: read before it removes anything, written once it did, so a reset refused or retried counts nothing twice; best effort, it never refuses a reset |

`usage.json` is `{ version: 1, live, unclaimed, reset? }`; a reset empties
`live` and `unclaimed`, and keeps the file: the review cost what it cost.
One that cannot be read, or of another version, is never written over: the
totals then read as `partial`.

**Attribution.** A fix's figure goes to the run its agent claimed; a
reviewer's to its lens (`rv-<lens>`); a verifier's to its finding and to
the lens on its `start` step (the hooks' `start`, the one with `model` and
no tool `id`), so a finding its verifier removed keeps its verification on
its lens; a discussing agent's to its finding. A lens the review cleans
again (its source changed) names the review in its `cleaning.json`
(`review`, from `clean.mjs --again --review`): the review counts it, stopped
or failed too. A cleaning from Settings › Lenses names none, and belongs to
no review.

**What `/api/review` answers**, as `usage`:

| Field | Holds |
| --- | --- |
| `total` | Every agent's figure summed, what resets removed included; `null` when no agent reported one |
| `kinds` | `[ { kind, agents, usage } ]`, `kind` `summary`, `reviewers`, `verifiers`, `fixes`, `discussions` or `cleanings`; a kind with no agent left out |
| `lenses` | `[ { lens, reviewer, verifiers, tokens } ]`, the most tokens first |
| `findings` | `[ { id, fixes, verifier, discussion, runs, unclaimed, usage, running? } ]`: `fixes` every fix's agent summed; `runs` `[ { id, usage, running? } ]`, one per run of `decisions.json` that has an `id`; `unclaimed` the fix's agents on no run (ended or at work before their claim); `verifier`, `discussion` and `unclaimed` `{ usage, running? }`, or `null` when the finding had no such agent (`usage` `null` when its agents reported nothing); `running` while one of its agents works |
| `reset` | `{ usage, kinds, lenses }`, or `null` with no reset |
| `notReported`, `partial` | The agents with no figure, and with a partial one, by run name (`rv-bugs`; `rv-bugs#1` and `rv-bugs#2` once Pause now started it again; `fix:f-03:r1`; `cl-…`) |
| `running` | Whether an agent counted still works: a live figure older than `TRANCHANT_SESSION_SINCE` is no longer live, and counts as `partial` |

Each figure there is the shape above with `tokens`, its four counts summed
over every model. A sum is `partial` when a part is, or is not reported;
`usd` only when every part reported has one.

## `/tranchant review`

`/tranchant review [<branch> | <merge request url> | <folder>] [--recipe <recipe.json> | --group <name>] [--start | --no-start]`
reviews a change with no producer of your own:

1. `prepare.mjs` runs in the session's folder, or in `<folder>` (a path
   starting with `.` or `/`, another repository), finds the change and reads
   the recipe in force ([where it comes from](#where-the-recipe-comes-from)):
   the
   current branch, or `<branch>`, against
   the repository's default branch (`origin/HEAD`, else the first of
   `origin/main`, `origin/master`, `main`, `master` that exists),
   `ownership: "ours"`, with the branch's open merge request as `mr` when
   `glab mr view <branch> -F json`, run from the project, finds one (none,
   glab missing or logged out: no `mr`, a line on stderr says why, and the
   review goes on); or a merge request read with `glab mr view <url> -F
   json` (its `diff_refs`, its head fetched when the checkout lacks it),
   `ownership: "theirs"`. It writes the envelope, `status: "preparing"`,
   `verify: true`, no finding, to `<state>/inbox/<id>.json`, and the lenses
   the change touches, with the recipe they come from, to `<id>.plan.json`
   next to it: the recipe's, and those the user added
   ([the lenses you add](settings.md#the-lenses-you-add)), under each name
   the first that is on; with `--group <name>`, or the project's default
   group with none, that group's lenses whatever their switches
   ([groups of lenses](settings.md#groups-of-lenses)). An unknown group, or
   `--group` with `--recipe`, refuses the review.
2. The hooks open it as any review file: the server starts and the page
   opens before any agent does.
3. The Lenses step. First, `lenses.mjs --check` hashes each added lens's
   source again: one that changed since its last cleaning prints `STALE
   {name, scope}`, its row says it is cleaned again, and the hooks start its
   cleaning agent (`clean.mjs --again`); the reviewers wait for every one. A
   cleaning that fails leaves the lens's last version, the failure recorded
   on it, so the next review does not clean it again for the same source. Then `lenses.mjs` resolves each lens's source, builds the
   prompt its reviewer runs ([the lenses](#the-lenses-built-at-every-review))
   and writes its progress to `lenses.json`, which the page shows in its
   center while they build (a spinner, how many are ready, the rows on
   demand), then folds into a chip of the header that opens the rows, one
   per lens: `resolving`, then `ready` (`unchanged`,
   `updated since the last review` or `new`, against the project's previous
   review that recorded its lenses; an added lens's row also says whether it
   was `cleaned again`, or that its cleaning failed and its last version
   runs, with why) or `failed` with the reason and the fix.
   Every lens built: the review becomes `reviewing`, with its `lenses`, and
   one `LENS` line per lens tells the hooks what to start. A review that
   waits to start (`--no-start`, or the settings' `startReview` off without
   `--start`: [waiting to start](#waiting-to-start)) stops here instead. Otherwise, one source that
   cannot be resolved refuses the review: `refused`, its `refusal`, no
   reviewer starts; the page's center shows each lens that failed, its
   reason, its fix and a link to its editor in Settings › Lenses
   (`#settings/lenses/<scope>:<name>`, percent-encoded, `<scope>` being
   `recipe`, `global` or `local`), the terminal says it in one line.
4. The summary agent (`tranchant:sm-summary-<review>`,
   `agents/review/summary.md`) queues first, beside the reviewers: it reads
   the diff and writes, with `summarize.mjs`, the review's `summary` (what
   the change does, then its Change Map: API surface, data and migrations,
   flags and configuration, shared state) and its `strengths`. The page
   shows them as soon as they land. The summary is data to the agents that
   read it later, as the findings are: the lenses', the verifier's and the
   discussing agent's prompts say so, and a fix's agent is handed only its
   finding. One that ends with the summary still blank is said in a toast.
5. One reviewer per lens the change touches (`tranchant:rv-<lens>-<review>`,
   `<review>` the review id's first 8 characters, the lens's prompt its
   instructions; see [the recipe](#the-recipe)) reads the diff and the files
   and calls `add.mjs --lens <lens>` once per finding (its hooks refuse any
   other lens's name), which records the lens on the finding. As each finding lands, the server
   prints `LANDED <id>` and a verifier (`tranchant:vf-<id>-<review>`,
   `agents/review/verifier.md`) re-reads the code,
   then confirms it (`verify.mjs`), amends it (`verify.mjs --amend`) or
   removes it (`remove.mjs`), a duplicate of a finding that landed before it
   included. Three review agents run at a time (the settings' `maxReviewAgents`),
   in the order they queued, each on the model its lens names (`model`; on
   Auto-detect, `auto`, its source's frontmatter's, else the session's),
   else the one the settings choose for its kind (`reviewModel`,
   `verifyModel`), else the session's (`TRANCHANT_MODEL` wins over all); a
   lens the settings turn off (`disabledLenses`) is not run.
6. Once the summary agent, every reviewer and every verifier ended, the hooks start a verifier for any
   finding still unverified that had none (`verify.mjs --pending`), then call
   `complete.mjs`. `/tranchant stop` ends the review agents and completes the
   review too, and so does the page's **Stop the review**
   ([pause, stop and reset](#pause-stop-and-reset)).

Nothing is written in the reviewed working tree; a merge request's head is
fetched into its `.git` when the checkout lacks it.

## `/tranchant comments`

`/tranchant comments [<pull request or merge request url>]` brings the
reviewers' comments of your own change into the page:

1. `comments.mjs` runs in the session's folder. With no url, it reads the
   current branch's pull request (`gh pr view`) or merge request (`glab mr
   view <branch>`), whichever forge the `origin` remote is on (the settings'
   `postWith` naming it for a host neither tool recognises); a url names its
   forge (`/pull/<n>` GitHub, `/-/merge_requests/<n>` GitLab). It reads the
   unresolved review threads: GitHub's `reviewThreads` with `isResolved`
   false (GraphQL, through `gh api graphql`), GitLab's discussions with a
   resolvable note not resolved (`glab api …/discussions`, system notes left
   out). Each becomes a finding, `t-` and 10 hex digits of its thread's id,
   so the same thread is the same finding on every import: the reviewer's
   comment its `title` (its first line outside a code block) and `problem`,
   `Code Quality`, `review`, tagged `question` when it ends with `?` and
   `suggestion` when it holds a suggestion, its `thread` whole, its excerpt
   the file at the head around its line, or for an `outdated` one at the
   commit it was written on (fetched once when the checkout lacks it, else
   the head), or for a deleted line at the change's merge base. A GitHub
   thread is `outdated` as GitHub says, when GitHub gives it no line, or on
   a deleted line; a GitLab one on a deleted line, or written on another
   version whose line does not read the same any more; either, when neither
   commit has its file, or its line is past the file's end. A GitLab
   discussion on no file is listed in the summary, with its link.
2. The review is `ours`, the PR/MR its `mr` (`forge` set, GitLab's with its
   `diffRefs`), its id `comments-` and 12 hex digits of the PR/MR's url,
   its title `Comments on <project>#<n>` (`!<iid>` on GitLab: the PR/MR's
   own title is a third party's words, and the review's title reaches the
   session): it is written to `<state>/inbox/<id>.json` and `INBOX <file>`
   is printed. A head or base the checkout lacks is fetched; a base still
   missing is the base branch's tip, said in a note. None unresolved, a
   PR/MR the tool cannot read, a head git cannot fetch (git's words said),
   or a merge request on another host than the `origin` (`glab api` and
   the replies go there), prints `REVIEW_REFUSED <reason>`, exit 2.
3. The hooks open it with `open.mjs --refresh`: run again, the same review
   is refreshed, its envelope replaced (a pushed head moves the diff the
   server serves), a finding new or changed written, but one an agent holds
   (`queued`, `working`, `asking`), which keeps what the reviewer decided
   on; the decisions kept, a thread resolved since left as it was. The
   answer says how many were added, updated and kept.

Each finding is then settled like any other. **Fix now** starts its agent,
the comment its brief, fenced as data as every finding is. **Reply on the
thread** opens an editor, empty, or after a fix prefilled with what changed,
on any thread not settled otherwise, beside its fix while that runs or
once stopped (the fix carries on), again once it is answered back;
**Resolve the thread once replied** is a separate choice, never made for the
reviewer. `post.mjs` replies (`addPullRequestReviewThreadReply`, or a note
on the GitLab discussion), then resolves when asked (`resolveReviewThread`,
or the discussion `resolved`), and records the thread resolved only when
the forge's answer says so. The page stays on the finding: the reply shows
in the thread at once, on its way, then sent (kept in the entry's
`replies` until an import holds it), or failed with why, and the thread's
head turns resolved. The importer's own comments (`mr.viewer`) read as
theirs. **Discuss** asks an agent about the comment, the thread's words
data to it, before or after a fix or a reply. Nothing is pushed: name the commit in the reply
once you pushed it.

## The server

`server.mjs --review <dir>` serves the page and its API on a free port of
127.0.0.1, prints one line per decision the hooks act on, and runs `post.mjs`
itself on each `post` decision and `issue.mjs` on each `issue` decision, one
at a time. It watches the review folder,
`findings/` and `runs/`, and tells the pages what changed. Only runs while a session
watches (`/tranchant`): no server, no page. It refuses to start outside the
plugin's hooks (`TRANCHANT_HOOKS` unset): without them a fix would run with no
locks and show no progress.

### Lines (stdout)

| Line                                                       | When                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `READY http://127.0.0.1:<port> review=<id> project=<root>` | Listening. First line on success.                                                |
| `FIX <id>`                                                 | The reviewer asked for a fix (or answered a question, or asked for a change in a thread's discussion): the hooks start an agent. |
| `STOP <id>`                                                | The reviewer stopped the finding's agent: the hooks end it.                      |
| `POSTED <id>`, `POST_FAILED <id> <reason>`                 | The server ran `post.mjs` itself; informational.                                 |
| `MOVED <id>`, `ISSUE_FAILED <id> <reason>`                 | The server ran `issue.mjs` itself; informational.                                |
| `DROPPED <id>`, `SKIPPED <id>`                             | Informational.                                                                   |
| `AGENT_ENDED <id>`                                         | `hook.mjs ended` found the finding still `working` and moved it to `failed`.     |
| `LANDED <id>`                                              | A finding not verified yet is there, in a `verify` review still `reviewing`: the hooks start its verifier. Once per finding, after `READY`. |
| `DISCUSS <id>`                                             | The reviewer asked about finding `id`: the hooks start its discussing agent. Again at start for each question still waiting. |
| `CLEAN <id>`                                               | The page added a lens, or asked for one to be cleaned again: the hooks start cleaning `id`'s agent (`clean.mjs --start`). |
| `START <review id>`, `BUILD <review id>`                   | The page's Start the review, or Build the lenses again, on a review waiting to start: the hooks run `lenses.mjs --start` or `--replan`. |
| `PAUSE <review id>`, `PAUSE_NOW <review id>`, `RESUME <review id>` | The page's Pause, Pause now and Resume, `paused` written already (removed, for `RESUME`): the hooks start no agent of its queue, end those at work and queue them again first, or start the queue again. |
| `HALT <review id>`                                         | The page's Stop the review, `stopped` written already: the hooks end the review's agents, empty its queue and complete it. |
| `RESET <review id>`                                        | The page's Reset the review, or Stop and reset after `HALT`: the hooks run `reset.mjs`, then `lenses.mjs --check --replan` on its plan; a review agent still running (TaskStop did not end it) refuses it, in a toast. |
| `PORT_BUSY <port> is used by <owner>`                      | Could not listen.                                                                |
| `REVIEW_REFUSED <reason>`                                  | The review folder is unreadable or its version unknown.                          |
| `HOOKS_MISSING …`                                          | Started outside the plugin's hooks (`TRANCHANT_HOOKS` unset).                    |

### Routes

| Route                 | Does                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /`               | The page.                                                                                                                                                                                                                                                                                                                                                          |
| `GET /page.js`        | Its bundle.                                                                                                                                                                                                                                                                                                                                                        |
| `GET /api/health`     | `{ ok: true, review: "<id>", version: "<plugin version>" }`.                                                                                                                                                                                                                                                                                                       |
| `GET /api/review`     | `{ review, findings, runs, reviewers, discussions, head, lenses?, usage?, estimate? }` (`usage`: [what the agents spend](#what-the-agents-spend); `estimate` while the review waits: [the estimate](#waiting-to-start)): `lenses` the Lenses step's `lenses.json` once it started (`{ state: "resolving" \| "ready" \| "refused" \| "waiting", group?, notes?, wait?, own?, changed?, choices?, problem?, lenses: [ { name, source, state: "resolving" \| "ready" \| "failed" \| "idle", files?, off?, offInSettings?, change?, version?, hash?, reason?, fix?, scope?, cleaning?: "running" \| "again" \| "failed" } ] }`); the review as it stands (its `status`, its findings in the order they landed), the decisions' `findings` map, the last 50 steps of each run in progress, the review agents (`{ name, running, outcome?, steps }`, their last 50 steps, in the order they started; the discussing agents left out), the discussions by finding id (`{ version, messages, step? }`, `step` its agent's last step while a question waits, unless that step is an `end`), and `head: { reviewed, current }` (`current` from `git rev-parse HEAD` in `project`, `null` when git cannot say; the page warns only when both are known and differ). |
| `GET /api/account`    | `{ username, tool }`: the account `tool` posts as, `glab api user`'s `username` or `gh api user`'s `login`, run from `project` and kept once known; `null` when the tool cannot say (not installed, not logged in, an error), asked again next time. `tool` is `?tool=glab` or `?tool=gh` when the query names one (the batch bar asks for glab's: MR comments go through glab), else the settings' `postWith`, or with `auto` `gh` on a GitHub tracker and `glab` otherwise. The page names it in a post's confirmation, or says "your glab account", and in the Settings. |
| `GET /api/settings`, `PUT /api/settings` | The user's settings file, read and written, with the recipe in force for the review's project, every lens that could run on it and the lenses being cleaned: see [the settings file](settings.md). |
| `POST /api/review/start`, `POST /api/review/build` | `{ lenses: { <name>: true \| false }, remember, group? }`: on a review `preparing` whose `lenses.json` is `waiting` (else 409), the page's choices to `choices.json`, then `START` or `BUILD`. `group`, a group's name or `null` for every lens that is on, plans the lenses again with it; Start with a group other than the one `lenses.json` names answers 409. With `remember`, Start saves them first as Settings › Lenses does, or in the group the review runs; a settings or groups file it cannot read, a lens it cannot change, or a group left with no lens answers 409. 400 for unsound choices. |
| `POST /api/review/pause`, `/resume`, `/halt`, `/reset` | The review's controls ([pause, stop and reset](#pause-stop-and-reset)), on a `/tranchant review` only. `pause` with `{ now? }` (Pause now) writes `paused` and prints `PAUSE` or `PAUSE_NOW`; `resume` removes it and prints `RESUME`; `halt` with `{ reset? }` writes `stopped` and prints `HALT`, then with `reset` `RESET`; each answers `{ review }`, its envelope, and 409 unless the review is `reviewing` and not stopped (`resume`: paused). `reset`, on a stopped review only, prints `RESET` and answers `{ ok: true }`; 409 for the same stop for 30 seconds, the hooks' reset still at work, then taken again. `reset`, and `halt` with `reset` (refused whole, nothing stopped), answer 409 while a finding is under way (`store.underWay()`), or a review agent other than a discussing one is `stuck`, naming them, and 500, with the error's code when it has one, when the review's files cannot be read (its path stays in the server's log). |
| `GET /api/lens/prompt`, `POST /api/lens/*` | The lenses the user adds, one by one: see [the settings file's routes](settings.md#the-routes). |
| `GET /api/tracker`    | `{ kind, web, prefix }`: where the project's issues go, from its `origin` remote, as `issue.mjs` reads it (both name the same project): `kind` `github` for `github.com`, `*.ghe.com` and `github.<domain>` hosts, `gitlab` for a host that names gitlab or any host when the review has an `mr`, and the settings' `postWith` (`glab` or `gh`) for a host neither names (one the other forge owns is refused, with the reason); an SSH endpoint (`ssh.github.com`, `altssh.gitlab.com`) or an account alias (`github.com-work`) names the forge itself. `web` the project's page; `prefix` the project's folder in its repository (the page links an issue's anchor to `<web>/blob/<ref>/<prefix><path>#L<line>`, `/-/blob/` on GitLab, `<ref>` the commit reviewed when it is the MR's head, else the branch). `{ kind: null, reason }` when there is none (no `origin`, not a url, another forge, git failing); a failure is read again on the next request. |
| `GET /api/diff`       | `{ base, head, files, diff }`: the change's unified diff, `git diff <base>...<headSha>` run in `project` (`baseSha..headSha` with `mr.diffRefs` at the review's `headSha`; on `theirs`, refs at another head are refused, on `ours` the branch's own range is used), its paths relative to `project` like the findings', and its files, each `{ path, oldPath?, additions, deletions, binary }`. Computed once; a failure is computed again on the next request. Answers 409 with the reason when git is missing, `project` is not a git repository, a commit is not there, `base` is not a revision, the diff is empty or past `TRANCHANT_MAX_DIFF_MIB` (32), or git fails; the server logs git's words on stderr, and the page shows its list view. |
| `GET /api/lines?path=&from=&to=` | `{ path, from, to, total, lines }`: lines `from` to `to` (1-based, `to` cut at the file's end) of `path` at the diff's head commit (`git cat-file blob <headSha>:./<path>`), and how many lines it has: what the diff view unfolds around its hunks. Only a path the diff names, not binary, is read: 404 for any other. Answers 400 when `from` or `to` is not a line number or `to` comes before `from`; 416 `{ error, total }` when `from` is past the file's end; 409 with the reason when the diff is unavailable or git cannot read the file (a file the change deletes). |
| `GET /api/events`     | Server-sent events: `changed` with `{ ids }` when a finding landed, was verified or removed, or its record or run changed (`ids` empty when the review's `status`, a review agent's file or `lenses.json` changed); `page` when the bundle was rebuilt; `settings` when the settings file changed (a page's `PUT`, another server's, an editor's), or a lens or a cleaning of the project did.                                                                                 |
| `POST /api/decisions` | `{ "decisions": [ { "id", "action": "fix" \| "post" \| "issue" \| "drop" \| "skip", "context"?, "comment"?, "reason"?, "title"?, "body"? } ] }` (`title` and `body`: an issue's). Applies each in order; answers `{ applied: [ids], refused: [ { id, reason } ] }`. A batch is one request.                                                                                                                                       |
| `POST /api/answer`    | `{ "id", "text", "choices"? }` on an `asking` finding; answers `{ finding }`. The answer to a change's question joins its discussion.                                                                                                                                                                                                                                                                                     |
| `POST /api/discuss`   | `{ "id", "text", "change"? }`: a question on finding `id`, refused (409) when `id` is not a finding of the review, its state allows no discussion, a message still waits, the text is empty, the discussion holds 60 messages, or its file is one this Tranchant cannot read; answers `{ discussion }` and prints `DISCUSS <id>`. With `change: true`, a change to the code instead (see [change requests](#change-requests)), refused too on a finding with no `thread` or a state the `change` move does not leave; prints `FIX <id>`. |
| `POST /api/stop`      | `{ "id" }`; answers `{ finding }`. A change asked in the discussion gets its `stopped` result there.                                                                                                                                                                                                                                                                                                                                |
| `GET /api/changes/<id>` | `{ files, diff }`: what finding `id`'s fix changed. `files`, each `{ path, since }`, are the paths of the `edit` and `write` steps (not `failed`) of its run that ended `fixed` (else its last run that ended; with `?run=<run>`, repeated up to 50 times, those runs once they ended, none otherwise, 400 for a value that is no run id; this finding's other runs that wrote a file later are then in its `since`, as `<id> (<run>)`), in `.history.jsonl`: their `file` (their `label` in runs recorded before it), relative to `project`, those outside it left out; `since` names the other findings whose runs, ended or in progress, wrote that file after this run last did: the diff then shows their changes too. `diff` is their unified diff against `HEAD` on the working tree, run in `project` (`git diff HEAD` for the tracked files, from `/dev/null` for an untracked regular file whose real path is in `project` and not in `.git`; anything else untracked left out). A finding with no run, or whose run wrote nothing, answers `{ files: [], diff: "" }`; an id not in the review, 404. Answers 409 with the reason when git is missing, `project` is not a git repository or has no commit, the diff is past `TRANCHANT_MAX_DIFF_MIB`, or git fails. |
| `GET /api/runs/<id>`  | `{ progress, history }`: the steps of the run in progress, then those of the runs that ended, each a list.                                                                                                                                                                                                                                                         |

Everything is same-origin; the server refuses a request whose `Origin` is not
its own, or whose `Host` is not `127.0.0.1` or `localhost` on its port (403). A malformed body answers 400 and a move the store refuses 409,
both as `{ error: "<reason>" }`. `GET /` carries a content security policy
(`script-src 'self'`, inline styles, nothing external).

## The scripts the agents run

`node SKILL/scripts/<name>.mjs`, `SKILL` being `skills/tranchant`. Every
script takes `--review <dir>`, `prepare.mjs` aside. `open.mjs`, `add.mjs` and
`complete.mjs` are the producer's; `prepare.mjs`, `summarize.mjs`,
`verify.mjs` and `remove.mjs`, those of `/tranchant review`; the others, an agent's or the
server's.

| Script                                                                                                                      | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claim.mjs <id>`                                                                                                            | `queued` → `working`; starts a run; prints the finding as JSON, fenced, for the agent, with its `discussion` when a change asked there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `done.mjs <id> "<summary>"`                                                                                                 | `working` → `fixed`, with the files the run changed; a change asked in the discussion gets the summary there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ask.mjs <id> "<question>" [--option "<label>: <description>"]… [--multiple]`                                               | `working` → `asking`; a change asked in the discussion gets the question there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `comments.mjs [<url>]`                                                                                                      | Run from the session's folder: writes the review of a pull or merge request's unresolved threads to `<state>/inbox/<id>.json` and prints `INBOX <file>`; notes on stderr (`note: …`). See [`/tranchant comments`](#tranchant-comments). |
| `post.mjs <id>`                                                                                                             | Posts `comment` (the reviewer's edit when there is one) as a positioned discussion on the MR: `glab api --method POST --header 'Content-Type: application/json' --input -` with a JSON body (`position` of type `text`, the three `diffRefs` SHAs, `old_path` and `new_path` both set to `path`, `new_line`), run from `project` so glab picks the host from the remote; then `queued` → `posted` with `posted.url`, or `failed` with glab's first error line. On a finding with a `thread`, replies on it instead: on GitHub `gh api graphql --method POST --hostname <the PR's host> --input -` (`addPullRequestReviewThreadReply`), on GitLab `glab api --method POST … projects/<project>/merge_requests/<iid>/discussions/<id>/notes` with `{ body }`; then, with the decision's `resolve`, `resolveReviewThread` or a `PUT` of the discussion with `{ resolved: true }`. A resolve that fails leaves the reply `posted`, its reason in `posted.unresolved`. Run by the server on a `post` decision, never by an agent.                                                                                                  |
| `issue.mjs <id>`                                                                                                            | Opens the issue the reviewer wrote (`issue.title`, `issue.body`) on the project `/api/tracker` names (the settings' `postWith` naming the forge for a host neither tool recognises), run from `project`: on GitHub `gh api --method POST --hostname <host> --header 'Content-Type: application/json' --input - repos/<owner>/<repo>/issues` with `{ title, body }`; on GitLab `glab api --method POST --hostname <host> … projects/<the remote's path, encoded>/issues` with `{ title, description }`. The tool has 60 seconds (`TRANCHANT_TOOL_TIMEOUT_MS`). Then `queued` → `moved` with `issue.url` and `issue.ref` (`#<number>`, `#<iid>`, absent when the answer has none), or `failed` with the tool's first error line; an answer without the issue's url fails saying where to check, since the issue may be open. Prints `moved <url>` or `failed <reason>`. Run by the server on an `issue` decision, never by an agent; a run that ends without a reason (a crash) is failed by the server, as a post is. |
| `open.mjs <review.json> [--verify \| --refresh]`                                                                                         | Validates and imports a review: the envelope into `review.json`, each inline finding into `findings/<id>.json`; prints `REVIEW <dir>`. `verify` and `verified` are dropped; `--verify`, which `/tranchant review` passes, keeps `verify`. Review and finding ids match `[\w-]{1,64}`: they become folder names and words on protocol lines. An id already imported with the same envelope (`status`, `verify` and `findings` aside: a review grows) is reused, decisions kept, its inline findings not there yet added; with another envelope, or a finding of other content, it is refused (`REVIEW_REFUSED id <id> exists with other content`, `REVIEW_REFUSED finding <id> exists with other content`): the producer mints a new id. `--refresh`, which `/tranchant comments` passes, takes the same PR/MR of the same project again: the envelope replaced (its `createdAt` kept), the findings new or changed written (their `addedAt` kept), the decisions untouched. |
| `add.mjs --review <dir> [--lens <name>] [--file <finding.json>]`                                                            | Adds one finding, from the file or stdin, to a review still `reviewing`: checked as a review's are (id, anchor, `comment` when `theirs`), written to `findings/<id>.json` with `addedAt`, and with `--lens` the lens that found it (`lens`); prints `ADDED <id>`. The same finding again is accepted silently; another one under the same id, an unsound one, or any once the review is complete prints `ADD_REFUSED <reason>` and exits 2.                                                                                                                                                                                                                                   |
| `reset.mjs --review <dir>` | The page's Reset the review, run by the hooks once the review's agents ended: on a review `stopped`, its plan (`<state>/inbox/<id>.plan.json`) read first, then the review back to `preparing`, its summary and strengths blank, and all its findings, their decisions, runs and discussions and the review agents' run files removed; the plan written back with `wait: "reset"`, and `choices.json`, unless the page wrote one, turning on the lenses the review ran. Prints `RESET <plan file>`. `RESET_REFUSED <reason>`, exit 2, removing nothing: not stopped, a finding a fix, a post or an issue holds (`queued`, `working`, `asking`) or whose discussion waits for its answer (named), or no sound plan. The plan and the choices are written before anything is removed, and put back if the store refuses. |
| `complete.mjs --review <dir>`                                                                                               | Sets `status` to `complete`; prints `COMPLETE`. On a review complete already, `COMPLETE_REFUSED <reason>`, exit 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `prepare.mjs [<branch> \| <mr url>] [--recipe <file> \| --group <name>] [--start \| --no-start]` | Run from the session's folder: writes the envelope of `/tranchant review`, `preparing`, to `<state>/inbox/<id>.json` and prints `INBOX <file>`, then the plan, `{ recipe, lenses }`, the lenses the change touches: the recipe in force's ([where it comes from](#where-the-recipe-comes-from)) and, unless `--recipe`, those the user added, under each name the first that is on (the settings' `disabledLenses` turn a recipe's lens off, `lensModels` set its model; one `otherwise` lens at most, the first); a settings file it cannot read is said on stderr and read as none), to `<id>.plan.json` and prints `PLAN <file>`. `REVIEW_REFUSED <reason>`, exit 2: not a repository, an unknown branch, no change, a recipe unsound or none of its lenses applying (or every one turned off), a merge request glab cannot read (glab's reason), both `--start` and `--no-start`. A review that waits ([waiting to start](#waiting-to-start)) plans `others` too, and is refused only when no lens could read the change. With `--group`, or the project's default group, the plan runs that group's lenses, whatever their switches, and names it (`group`), with its `notes`, each also on stderr as `group: <note>`; an unknown group, a groups file it cannot read with `--group`, or `--group` with `--recipe` is refused; a groups file it cannot read without `--group` is said on stderr (`groups: …`) and read as none. |
| `lenses.mjs --review <dir> --plan <file> [--check \| --replan \| --start]` | The Lenses step, once the page is open. With `--check`, first: each added lens's source hashed again; one changed since its last cleaning, and not by the change under review, prints `STALE {name, scope}`, its row `cleaning: "running"`. Without: builds each lens of the plan, writing `lenses.json` as it goes (an added lens's row with its `scope` and, when its source changed, `cleaning`: `again`, `failed` or `held`, with the reason); every lens built, the review becomes `reviewing` with its `lenses` and it prints one `LENS <json>` per lens (`{ name, prompt, paths, model?, topics? }`, `prompt` the built file, `model` on Auto-detect its source's frontmatter's or `inherit`, the session's), each ready row naming the model its reviewer runs on (`model`, absent the session's; `modelFrom`: `forced`, `auto`, `lens` or `reviewers`; `autoWhy` on Auto-detect's fallback: `none`, `inherit`, `foreign`, `unreadable`, or `held` when the change under review edits an added lens's source). A source that cannot be resolved makes the review `refused` and prints `REVIEW_REFUSED lens <name> (<source>): <reason>; <fix>`, exit 2, no `LENS` line. A plan that waits prints `WAITING` instead ([waiting to start](#waiting-to-start)); `--replan` and `--start` make the plan again, the page's `choices.json` applied. |
| `clean.mjs [--project <root>] --find \| --prepare <source> --to <global \| local> [--name <lens>] \| --again <name> --scope <global \| local> \| --start <id> \| --check <folder> [--stopped]` | A lens's cleaning ([`/tranchant import`](#tranchant-import)), for the git repository of `--project`, else of the session's folder. `--find`: `CANDIDATE <path>` per `.claude/skills/*review*` and `.claude/agents/*review*` of the project, else `NO_CANDIDATE`. `--prepare`, `--again` and `--start` print `CLEANING <json>`, what the agent is given (`{ id, dir, project, name, scope, again, source, file, folder, version?, rules?, lens, report }`). `--check`: what the agent wrote checked and the lens built; prints `CLEANED <ready \| added> <scope> <name>` or `CLEAN_FAILED <reason>`; `--stopped` when the agent was stopped or never started, which records no failure on a lens's source. `CLEAN_REFUSED <reason>`, exit 2. |
| `summarize.mjs` | The summary agent's: `{ "summary": "<Markdown>", "strengths": ["…"] }` on stdin replaces the review's `summary` (non-blank, 12,000 characters at most) and `strengths` (10 at most, 500 characters each) while it is `reviewing`; prints `SUMMARIZED`. An unsound one, or any once the review is complete, prints `SUMMARY_REFUSED <reason>`, exit 2. |
| `verify.mjs <id> [--file <finding.json> \| --amend]`, `verify.mjs --pending`                                                                         | A verifier's verdict: `VERIFIED <id>` sets `verified: true`; with the finding whole (same id) from the file or stdin, `AMENDED <id>` replaces it, verified, its `addedAt` kept. Amending a finding the reviewer decided on is refused. `--pending` prints `UNVERIFIED <id>` per finding not verified. A refusal prints `VERIFY_REFUSED <reason>`, exit 2.                                                                                                                                                                                                                                                                                                                   |
| `reply.mjs <id> [--ended]`                                                                                                  | A discussing agent's answer to the question that waits on finding `id`, as JSON on stdin: `{ "text", "fix"?, "comment"?, "drop"? }`; prints `REPLIED <id>`. No question waiting, not JSON, a `text` missing, or a proposal that is not a text: `REPLY_REFUSED <reason>`, exit 2. `--ended`, the hooks' once its agent ended: a question left waiting gets a `failed` answer and `UNANSWERED <id>` is printed. |
| `remove.mjs <id>`                                                                                                           | Removes a finding a verifier rejected or found duplicated: `REMOVED <id>`. A finding the reviewer decided on, or one inline in `review.json`, stays: `REMOVE_REFUSED <reason>`, exit 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `hook.mjs <pre\|post\|stop\|note\|ended> --finding <id> --review <dir> --project <root> [--lock-root <dir>] [--agent <id>]` | The settings hooks of one finding's agent: file locks, refused Bash writes, steps. With `--reviewer <name>` in place of `--finding`, a review agent's: no lock, no writing tool, and its Bash runs only reading commands (git's reading subcommands, `cat`, `head`, `grep`…, chained; `sort` without `-o` or a compressor, `uniq` without an output file; no redirection but `2>&1` and `>/dev/null`, no substitution outside single quotes, no unquoted heredoc) and its own review script, a reviewer's `add.mjs`, the summary agent's `summarize.mjs`, a verifier's `verify.mjs`/`remove.mjs` or a discussing agent's `reply.mjs` on its own finding, run by its path in the skill's `scripts/` (no node option before it) with `--review` its own review and never `--ended`, a reviewer's `add.mjs` with `--lens` once and its own lens's name (`--lens <name>`; `--lens=<name>` for a name that starts with `-`), the finding or the answer in a quoted heredoc, no comment (`#`); steps into `reviewers/<name>.jsonl`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## The recipe

`/tranchant review` runs one reviewer agent per lens of a recipe, a JSON
file; the plugin's default is
[`agents/review/recipe.json`](../agents/review/recipe.json).

```jsonc
{
  "version": 1,
  "extends": "tranchant", // optional: Tranchant's own lenses run beside these; one of the same name is replaced
  "lenses": [
    {
      "name": "correctness", // [\w-]{1,40}, unique; the agents' finding ids start with it
      "prompt": "correctness.md", // a whole prompt, relative to the recipe file; or tranchant:<lens>
      "paths": ["**/*.ts", "**/*.tsx"], // the lens runs when a changed file matches one; ["**"] when absent
    },
    {
      "name": "abac",
      "source": "workflow:code-reviewer-abac", // a plugin's skill, agent or command, or a path: the lens's domain
      "skills": ["workflow:abac-rules"], // optional: references passed to the lens, never through the Skill tool
      "topics": ["Security & Permissions"], // optional: the topics its findings file under
      "model": "claude-opus-5-5", // optional: its reviewer's model; auto, its source's frontmatter's, else the session's
    },
    { "name": "bugs", "use": "tranchant:bugs", "add": "../checks/money.md" }, // an add-on to a lens of Tranchant's
    { "name": "rest", "prompt": "rest.md", "otherwise": true }, // or: the files no other lens matched
  ],
}
```

A lens names one of `prompt`, `source`, or `use` with `add`. A glob is a git
`:(glob)` pathspec, matched against each changed file's path relative to the
repository, with `**` crossing folders and `*` staying within a name. A lens
runs once per review, when at least one changed file matches one of its
globs; the lens with `otherwise` (one at most, no `paths`) runs when a
changed file matches no other lens's globs, its `PATHS` those files.
The agent's prompt gives `LENS`, `REVIEW`, `SKILL`, `PROJECT`, `BASE`,
`HEAD`, `RANGE` (the git range of the change), `OWNERSHIP`, `PATHS` and,
when the lens declares them, `TOPICS`; it adds its findings with
`add.mjs --lens LENS` (its hooks refuse the call without its lens's name),
their ids `<name>-<n>`. The verifier (`agents/review/verifier.md`) gets the
finding's id on its first line, then the same but `LENS`, `PATHS` and
`TOPICS`, and runs once per finding as they land.

### Where the recipe comes from

The first given: `--recipe <path>` on the run; the local recipe, when its
file exists,
`$XDG_CONFIG_HOME/tranchant/projects/<project hash>/recipe.json` (else
`~/.config/…`), the user's alone, outside the repository, its paths read
from the working tree; the project's, when it exists at BASE,
`.tranchant/recipe.json`, **read at BASE** (`git show BASE:.tranchant/recipe.json`)
with every source it names inside the repository, so the change under review
cannot rewrite the lenses that review it, on someone else's merge request
included; the settings' `recipe`; the plugin's. A recipe given whose file is
missing refuses the review: nothing falls through to the next. Tranchant
writes neither the local nor the project's recipe: a project recipe already
committed is still read, read-only; a lens is added one by one instead
([the lenses you add](settings.md#the-lenses-you-add)), never in the
repository. Without `--recipe`, those lenses run beside the recipe's, and
under a name the first that is on wins: a local lens, a global one, the
recipe's. An add-on (`use`) with no
`paths` or `topics` keeps those of its lens of Tranchant's. The page's Settings show the recipe in force: where it comes
from, its lenses, each lens's source and whether it builds now.

### The lenses, built at every review

The Lenses step (`lenses.mjs`) builds each lens anew from its sources, so a
lens follows its source's later changes (a new version of its plugin, a
sharpened checklist) without a copy to update:

1. **It resolves the source.** `tranchant:<lens>` is one of the plugin's
   lenses; `plugin:name` (`plugin:folder:name`) a skill
   (`<plugin>/skills/<name>/SKILL.md`) or an agent
   (`<plugin>/agents/<name>.md`) of a plugin Claude Code installed for the
   project (`~/.claude/plugins/installed_plugins.json`, `CLAUDE_CONFIG_DIR`
   when set) and did not turn off (`enabledPlugins`, in the user's and the
   project's settings); anything else a path, from the recipe's folder, a
   folder meaning its `SKILL.md`.
2. **It reads it**, and each skill the lens lists, 64 KiB each at most, its
   frontmatter checked and left out.
3. **It builds the prompt.** A `prompt` is the prompt, whole: it says to
   report with `add.mjs --lens LENS`, or its findings are refused. A `source` is
   the shared contract ([`agents/review/contract.md`](../agents/review/contract.md):
   the inputs, the change as data, `PATHS` as the only file filter, how to
   anchor, word and report through `add.mjs`), then the source, fenced as
   the lens's domain, with its folder for its relative links; the contract
   wins over the source's own process and output. An add-on is the lens of
   Tranchant's, then the source fenced as its addition. The skills follow,
   fenced, as references.

No model takes part: the same sources, skills and contract give the same
prompt, byte for byte. Each is stored once under `<state>/lenses/<sha256>.md`
(a temp file, then linked into place): a prompt there already is reused and
nothing is written, so two reviews at once, or the step run twice, change
nothing.

**A source that cannot be resolved refuses the review**: a plugin not
installed or turned off, a file missing, a frontmatter that cannot be read,
a skill the lens lists that is missing, an add-on whose lens of Tranchant's
does not exist, a source over 64 KiB. Each says what fixes it: install the
plugin, or edit the recipe; for an added lens, bring its source
back or turn the lens off.

An added lens builds as a `source` does, from what its cleaning wrote: the
contract, then its cleaned domain, fenced, then its added instructions,
fenced. Its source is still resolved: one that is gone refuses the review,
as for a recipe's lens.

## `/tranchant import`

`/tranchant import [<source>] [--to local | global] [--name <lens>]`
adds a team's reviewer (a plugin's skill, agent or command, a file or a folder) as a
lens, cleaned first. The name is optional: with no `--name`, the lens is
named after its source, a file's name without its extension
(`money-review.md` gives `money-review`), a skill's folder's whole
(`skills/api.v2/` or its `SKILL.md` gives `api-v2`), a `plugin:name`'s name
without the plugin (`workflow:code-reviewer-abac` gives `code-reviewer-abac`);
that name taken, the refusal gives the command again with `--name`. The
page's **Settings › Lenses** does the same with **Add a lens**, whose Name
shows that name before the cleaning starts, to change, and says when it
is no lens name or is taken in the scope chosen (in any case: a lens is a
folder); its source may be a glob (`.claude/agents/*-review.md`,
`~/.claude/agents/review-*.md`): the page lists its matches before anything
runs, each with the lens name its file gives it (to rename): a file that is
a lens already or being added, under any name, says so and cannot be
checked (the server refuses it too); a different file whose name is
another lens's in that scope, or another match's, has its name marked, to
change before anything is added; the lens of another scope it would
replace is said; one that starts other agents is flagged *not a reviewer*
and unchecked; **Add the N lenses** makes one cleaning per checked match, the
same scope for all. The page's cleanings (Add a lens, Clean it again now)
wait for a free cleaning agent: `maxReviewAgents` clean at a time, the
others say so; one that fails stops none, and the server announces again
those still waiting when it starts, for a session that ended before them:

1. With no source, `clean.mjs --find` lists the project's
   `.claude/skills/*review*` and `.claude/agents/*review*`; the user names
   one. Nothing picks a source for them.
2. With no scope, the two are offered: `local` (this project) or `global`
   (every project), both under `~/.config/tranchant/`, never in the
   repository: `--to project` is refused. Nothing is written before the user
   chooses.
3. `clean.mjs --prepare` finds the source, refuses a name already taken in
   that scope, and makes the cleaning's folder,
   `<state>/<project hash>/cleanings/<id>/` (with `extract.md` for one
   reviewer written inline in its source). The cleaning agent
   (`tranchant:cl-<cleaning>`, [`agents/clean.md`](../agents/clean.md)),
   started by the hooks in the background, reads the source as data and
   writes two files: `lens.md`, the source's review in its own words
   without its orchestration (planning, starting other agents, merging
   reports), its output format, posting, questions to the user, scripts and
   frontmatter; and `report.json`, the lens's `paths` (or `otherwise`), its
   `topics`, its **added instructions**, what it `removed` and why, what it
   `added`. A source that is a whole review process (a skill, an agent or a
   command that routes the review to other reviewers, by name or in prose)
   writes no lens: its `report.json` is `{ process, reviewers }`, each
   reviewer it starts `{ name, file }` (its agent's or skill's file as an
   absolute path, a `plugin:name` resolved by the agent in the source's own
   plugin from its marketplace, installed or not) or `{ name, inline }` (instructions written in the
   source itself). The paths are data: `lib/reviewers.mjs` keeps a file only
   when it is a regular Markdown file or a skill's folder under the source's
   plugin or marketplace root, or the agents, skills and commands of the
   project's `.claude` and `~/.claude` (and `~/.claude/plugins`), its links
   followed, a skill's `SKILL.md` too, each segment below its root a plain
   name; any other is listed with why. The source itself, a file or an
   inline one of its name, and a file given twice are left out. The page lists them to pick, and **Add the checked ones** starts one
   cleaning each. An inline reviewer's lens records the source and the
   reviewer's name (`reviewer`), its agent given `REVIEWER` and the
   extract (`EXTRACT`); cleaned again when the source changes, its agent
   extracts it anew. A source that holds no review at all is
   `{ refused }`. `hook.mjs --cleaner` lets the agent write those two files and run
   reading commands only, git none; its hook refuses on any error.
4. When it ends, `clean.mjs --check` checks what it wrote and builds the
   lens as a review would. The page shows it whole (what was removed and
   added, where it runs, its topics, its rules, the lens itself);
   **Add this lens** writes it to its scope, with what the user changed; the
   cleaning alone never does. A lens cleaned again (its source changed, or
   **Clean it again now**) takes its new version at once, the rules the user
   edited kept; a review already running keeps the version it started with.
