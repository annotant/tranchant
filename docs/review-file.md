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
| `discussions/<finding id>.json`   | Next to it                            | The finding's discussion: the reviewer's questions and the agent's answers                  | `lib/discussion.mjs`, for the server (a question) and `reply.mjs` (an answer)                                          |
| `lenses.json`                     | Next to it                            | The Lenses step of `/tranchant review`: one row per lens, as it is resolved and built        | `lenses.mjs`                                                                                                           |
| `lenses/<sha256>.md`              | `<state>/`                            | A lens's prompt as the Lenses step built it, one file per hash, shared by every review       | `lenses.mjs`, once per hash                                                                                            |
| `imports/<import id>/`            | `<state>/<hash>/`                     | An import of `/tranchant import`: `import.json` (its source, its location, where it stands) and `recipe.json`, the recipe its agent wrote | `import.mjs` and the import agent (`recipe.json` alone); the server, when the user uses it                    |

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
| `status`      | `preparing`, `reviewing`, `complete` or `refused` | Absent means `complete`. `reviewing`: findings still land through `add.mjs`, until `complete.mjs`. `preparing`: `/tranchant review` builds its lenses (`lenses.mjs`), then makes it `reviewing`. `refused`: a lens could not be built, no reviewer started, `refusal` says why; nothing lands, nothing completes it. |
| `lenses`      | array, optional           | The lenses `/tranchant review` ran, as the Lenses step built them: `{ name, source, version?, hash }`, `source` as the recipe names it, `version` a plugin's, `hash` the SHA-256 of the prompt built (`<state>/lenses/<hash>.md`). |
| `refusal`     | object, optional          | With `refused`: `{ lens, source, reason, fix? }`, the lens that could not be built, its source, why, and what fixes it. |
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
| `hunk`                       | string, optional                    | A unified-diff hunk (`@@ -a,b +c,d @@` then ` `, `+`, `-` lines) covering `line`; the page shows it in place of the excerpt when present.                                                        |
| `marks[].line`               | integer                             | Within the excerpt (or the hunk's new side).                                                                                                                                                     |
| `marks[].from`, `marks[].to` | integer ≥ 0, optional               | Columns, 0-based, `from` inclusive and `to` exclusive; absent, the whole line.                                                                                                                   |
| `marks[].note`               | string, optional                    | Up to 300 characters, shown beside the line.                                                                                                                                                     |
| `problem`, `why`, `fix`      | string                              | Markdown (inline code, bold, links, lists, fenced code), in plain words: one idea per sentence. No heading (one renders as bold text), no HTML (it stays text); only `http`, `https` and `mailto` links are links. |
| `comment`                    | string, optional                    | The text to post, whole. Required when `ownership` is `theirs`; optional on an `ours` review with an `mr`, where the page prefills the editor from `problem` and `fix` when it is absent. Up to 4000 characters. |
| `diagram.kind`               | `mermaid`, `svg` or `text`          | `mermaid`: [Mermaid](https://mermaid.js.org) source the page draws in its own colours, the way to show a sequence or a flow (`sequenceDiagram`, `flowchart`, `stateDiagram`); strict: no click, no HTML label, and a directive (`%%{init}%%`, front matter) cannot change the security level, the labels, the layout (dagre, `flowchart-elk` included), the theme, its CSS or its font; a source that does not parse shows as text with the parser's message. `svg`: inline SVG drawn by hand, for what Mermaid cannot draw, which the page sanitizes (no script, no event handler, no `foreignObject`, no external reference). `text`: preformatted, ASCII art or a Markdown list of steps. Up to 64 KiB. |
| `related[]`                  | object[], optional                  | Up to 4. Same shape as `path`, `line`, `excerpt`, `marks`.                                                                                                                                       |
| `addedAt`                    | string, optional                    | When it joined the review, set by `open.mjs` or `add.mjs`: the producer leaves it out. `/api/review` lists the findings in that order.                                                           |
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
      "reply": { "text": "…", "resolve": true, "at": "…", "failed": "…" }, // a reply on a settled finding's thread: on its way, or why it failed
      "replies": [{ "text": "…", "url": "…", "at": "…", "resolved": true }], // the replies posted on its thread, shown in it until an import holds them
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
| `queued`  | A fix, a post or an issue is decided; waiting for an agent, glab or gh    | reviewer (`fix`, `post`, `issue`, an answer) |
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

- `fix`: from `open`, `dropped`, `skipped`, `failed`, `stopped` → `queued`. An `asking` finding leaves only through `answer`.
- `post`: from `open`, `dropped`, `skipped`, `failed` → `queued`; refused unless `mr.diffRefs` is set and its `headSha` is the review's, whatever the `ownership`, and unless the decision or the finding carries a `comment`. On a finding with a `thread`, a reply: it needs an `mr` and the decision's `comment` (the reviewer writes every reply), never the diff refs. On a `fixed` or `posted` thread finding, a reply is no move: it is kept in `reply` while `post.mjs` runs, the state stays, `posted` records it once on the thread and `reply` goes, a failure leaves `reply.failed`; one at a time, again as often as the thread is answered back. On GitHub, `postBlocker` refuses any post but a reply.
- `issue`: from `open`, `dropped`, `skipped`, `failed` → `queued`, with `issue.title` and `issue.body` (the title cut to one line of 255 characters, the body to 60,000); refused when either is empty. Any ownership, with or without an MR.
- `drop`, `skip`: from `open`, `queued`, `asking`, `failed`, `stopped`, or from each other → `dropped`, `skipped`. Never from `working`, `fixed`, `posted` or `moved`.
- `posted`, `moved`: the server's, from `queued` → `posted`, `moved`.
- `answer`: from `asking` → `queued`, with `answer` set; the server prints `FIX <id>` again.
- `stop`: from `queued`, `working` → `stopped`.
- `claim`: from `queued` → `working`, starting a run; refused on a finding queued for a post or an issue.
- `done`: from `working` → `fixed`. `ask`: from `working` → `asking`. `hook.mjs ended` moves a `working` finding whose agent ended without either to `failed` (`reason`: `the agent ended without done.mjs or ask.mjs`).

A `fixed`, `posted` or `moved` finding is final: no move leaves it (the
reviewer reverts by hand, or asks for a follow-up in a new review); a reply
on its thread is no move.

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
}
```

`outcome` is `fixed`, `asking`, `failed` or `stopped`; absent while running.

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
it.

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
  ],
}
```

| Field                 | Notes                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `messages[].by`       | `reviewer` or `agent`. A last message by the `reviewer` waits for the agent's answer: no other question until it comes.        |
| `messages[].text`     | The reviewer's up to 4,000 characters, plain; the agent's up to 8,000, Markdown.                                              |
| `messages[].proposal` | The agent's: `fix`, `comment`, `drop`, each up to 4,000 characters. The page offers **Fix with this** (a `fix` decision, `fix` its `context`), **Post this** (`comment` in an editor in the thread, then a `post` with what it holds) and **Drop with this reason** (a `drop`, `drop` its `reason`) on the last answer, when the finding's state allows the move. |
| `messages[].failed`   | `true`: its agent ended, was stopped or could not start before it answered, or `/tranchant stop` ended the wait.                                                                  |

The reviewer may write while the finding is `open`, `skipped`, `failed` or
`stopped`: nothing settled, no agent on it; on a finding with a `thread`,
also once `fixed` or `posted`, the thread living on until it is resolved.
In any other state the discussion reads as it stands. On a thread, the
agent's `comment` is a reply: **Reply with this** opens the reply editor
with it, for the reviewer to change and send. A discussion holds 60 messages at most.

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
agent, running until its `end`; one whose session closed before it ended
keeps showing running.

## `/tranchant review`

`/tranchant review [<branch> | <merge request url> | <folder>] [--recipe <recipe.json>]`
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
   next to it.
2. The hooks open it as any review file: the server starts and the page
   opens before any agent does.
3. The Lenses step: `lenses.mjs` resolves each lens's source, builds the
   prompt its reviewer runs ([the lenses](#the-lenses-built-at-every-review))
   and writes its progress to `lenses.json`, which the page shows above the
   reviewers, one row per lens: `resolving`, then `ready` (`unchanged`,
   `updated since the last review` or `new`, against the project's previous
   review that recorded its lenses) or `failed` with the reason and the fix.
   Every lens built: the review becomes `reviewing`, with its `lenses`, and
   one `LENS` line per lens tells the hooks what to start. One source that
   cannot be resolved refuses the review: `refused`, its `refusal`, no
   reviewer starts; the page shows the reason and the fix, the terminal says
   it in one line.
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
   and calls `add.mjs` once per finding. As each finding lands, the server
   prints `LANDED <id>` and a verifier (`tranchant:vf-<id>-<review>`,
   `agents/review/verifier.md`) re-reads the code,
   then confirms it (`verify.mjs`), amends it (`verify.mjs --amend`) or
   removes it (`remove.mjs`), a duplicate of a finding that landed before it
   included. Three review agents run at a time (the settings' `maxReviewAgents`),
   in the order they queued, each on the model its lens names (`model`),
   else the one the settings choose for its kind (`reviewModel`,
   `verifyModel`), else the session's (`TRANCHANT_MODEL` wins over all); a
   lens the settings turn off (`disabledLenses`) is not run.
6. Once the summary agent, every reviewer and every verifier ended, the hooks start a verifier for any
   finding still unverified that had none (`verify.mjs --pending`), then call
   `complete.mjs`. `/tranchant stop` ends the review agents and completes the
   review too.

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
on any thread not settled otherwise, again once it is answered back;
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
| `FIX <id>`                                                 | The reviewer asked for a fix (or answered a question): the hooks start an agent. |
| `STOP <id>`                                                | The reviewer stopped the finding's agent: the hooks end it.                      |
| `POSTED <id>`, `POST_FAILED <id> <reason>`                 | The server ran `post.mjs` itself; informational.                                 |
| `MOVED <id>`, `ISSUE_FAILED <id> <reason>`                 | The server ran `issue.mjs` itself; informational.                                |
| `DROPPED <id>`, `SKIPPED <id>`                             | Informational.                                                                   |
| `AGENT_ENDED <id>`                                         | `hook.mjs ended` found the finding still `working` and moved it to `failed`.     |
| `LANDED <id>`                                              | A finding not verified yet is there, in a `verify` review still `reviewing`: the hooks start its verifier. Once per finding, after `READY`. |
| `DISCUSS <id>`                                             | The reviewer asked about finding `id`: the hooks start its discussing agent. Again at start for each question still waiting. |
| `PORT_BUSY <port> is used by <owner>`                      | Could not listen.                                                                |
| `REVIEW_REFUSED <reason>`                                  | The review folder is unreadable or its version unknown.                          |
| `HOOKS_MISSING …`                                          | Started outside the plugin's hooks (`TRANCHANT_HOOKS` unset).                    |

### Routes

| Route                 | Does                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /`               | The page.                                                                                                                                                                                                                                                                                                                                                          |
| `GET /page.js`        | Its bundle.                                                                                                                                                                                                                                                                                                                                                        |
| `GET /api/health`     | `{ ok: true, review: "<id>", version: "<plugin version>" }`.                                                                                                                                                                                                                                                                                                       |
| `GET /api/review`     | `{ review, findings, runs, reviewers, discussions, head, lenses? }`: `lenses` the Lenses step's `lenses.json` once it started (`{ state: "resolving" \| "ready" \| "refused", lenses: [ { name, source, state: "resolving" \| "ready" \| "failed", change?, version?, reason?, fix? } ] }`); the review as it stands (its `status`, its findings in the order they landed), the decisions' `findings` map, the last 50 steps of each run in progress, the review agents (`{ name, running, outcome?, steps }`, their last 50 steps, in the order they started; the discussing agents left out), the discussions by finding id (`{ version, messages, step? }`, `step` its agent's last step while a question waits, unless that step is an `end`), and `head: { reviewed, current }` (`current` from `git rev-parse HEAD` in `project`, `null` when git cannot say; the page warns only when both are known and differ). |
| `GET /api/account`    | `{ username, tool }`: the account `tool` posts as, `glab api user`'s `username` or `gh api user`'s `login`, run from `project` and kept once known; `null` when the tool cannot say (not installed, not logged in, an error), asked again next time. `tool` is `?tool=glab` or `?tool=gh` when the query names one (the batch bar asks for glab's: MR comments go through glab), else the settings' `postWith`, or with `auto` `gh` on a GitHub tracker and `glab` otherwise. The page names it in a post's confirmation, or says "your glab account", and in the Settings. |
| `GET /api/settings`, `PUT /api/settings` | The user's settings file, read and written, with the recipe in force for the review's project and the recipes imported for it: see [the settings file](settings.md). |
| `POST /api/recipe/use` | `{ "id" }`: Use this recipe, on an import of the project that is `ready`: its recipe checked again and written to its location (the project's `.tranchant/recipe.json`, or the local recipe); answers `{ target, to, settings }`. 409 `{ error }` when it is not ready, failed its check or is in use already. |
| `GET /api/tracker`    | `{ kind, web, prefix }`: where the project's issues go, from its `origin` remote, as `issue.mjs` reads it (both name the same project): `kind` `github` for `github.com`, `*.ghe.com` and `github.<domain>` hosts, `gitlab` for a host that names gitlab or any host when the review has an `mr`, and the settings' `postWith` (`glab` or `gh`) for a host neither names (one the other forge owns is refused, with the reason); an SSH endpoint (`ssh.github.com`, `altssh.gitlab.com`) or an account alias (`github.com-work`) names the forge itself. `web` the project's page; `prefix` the project's folder in its repository (the page links an issue's anchor to `<web>/blob/<ref>/<prefix><path>#L<line>`, `/-/blob/` on GitLab, `<ref>` the commit reviewed when it is the MR's head, else the branch). `{ kind: null, reason }` when there is none (no `origin`, not a url, another forge, git failing); a failure is read again on the next request. |
| `GET /api/diff`       | `{ base, head, files, diff }`: the change's unified diff, `git diff <base>...<headSha>` run in `project` (`baseSha..headSha` with `mr.diffRefs` at the review's `headSha`; on `theirs`, refs at another head are refused, on `ours` the branch's own range is used), its paths relative to `project` like the findings', and its files, each `{ path, oldPath?, additions, deletions, binary }`. Computed once; a failure is computed again on the next request. Answers 409 with the reason when git is missing, `project` is not a git repository, a commit is not there, `base` is not a revision, the diff is empty or past `TRANCHANT_MAX_DIFF_MIB` (32), or git fails; the server logs git's words on stderr, and the page shows its list view. |
| `GET /api/lines?path=&from=&to=` | `{ path, from, to, total, lines }`: lines `from` to `to` (1-based, `to` cut at the file's end) of `path` at the diff's head commit (`git cat-file blob <headSha>:./<path>`), and how many lines it has: what the diff view unfolds around its hunks. Only a path the diff names, not binary, is read: 404 for any other. Answers 400 when `from` or `to` is not a line number or `to` comes before `from`; 416 `{ error, total }` when `from` is past the file's end; 409 with the reason when the diff is unavailable or git cannot read the file (a file the change deletes). |
| `GET /api/events`     | Server-sent events: `changed` with `{ ids }` when a finding landed, was verified or removed, or its record or run changed (`ids` empty when the review's `status`, a review agent's file or `lenses.json` changed); `page` when the bundle was rebuilt; `settings` when the settings file changed (a page's `PUT`, another server's, an editor's), or an import of the project did.                                                                                 |
| `POST /api/decisions` | `{ "decisions": [ { "id", "action": "fix" \| "post" \| "issue" \| "drop" \| "skip", "context"?, "comment"?, "reason"?, "title"?, "body"? } ] }` (`title` and `body`: an issue's). Applies each in order; answers `{ applied: [ids], refused: [ { id, reason } ] }`. A batch is one request.                                                                                                                                       |
| `POST /api/answer`    | `{ "id", "text", "choices"? }` on an `asking` finding; answers `{ ok: true }`.                                                                                                                                                                                                                                                                                     |
| `POST /api/discuss`   | `{ "id", "text" }`: a question on finding `id`, refused (409) when `id` is not a finding of the review, its state allows no discussion, a question still waits, the text is empty, the discussion holds 60 messages, or its file is one this Tranchant cannot read; answers `{ discussion }` and prints `DISCUSS <id>`. |
| `POST /api/stop`      | `{ "id" }`; answers `{ ok: true }`.                                                                                                                                                                                                                                                                                                                                |
| `GET /api/changes/<id>` | `{ files, diff }`: what finding `id`'s fix changed. `files`, each `{ path, since }`, are the paths of the `edit` and `write` steps (not `failed`) of its run that ended `fixed` (else its last run that ended), in `.history.jsonl`: their `file` (their `label` in runs recorded before it), relative to `project`, those outside it left out; `since` names the other findings whose runs, ended or in progress, wrote that file after this run last did: the diff then shows their changes too. `diff` is their unified diff against `HEAD` on the working tree, run in `project` (`git diff HEAD` for the tracked files, from `/dev/null` for an untracked regular file whose real path is in `project` and not in `.git`; anything else untracked left out). A finding with no run, or whose run wrote nothing, answers `{ files: [], diff: "" }`; an id not in the review, 404. Answers 409 with the reason when git is missing, `project` is not a git repository or has no commit, the diff is past `TRANCHANT_MAX_DIFF_MIB`, or git fails. |
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
| `claim.mjs <id>`                                                                                                            | `queued` → `working`; starts a run; prints the finding as JSON, fenced, for the agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `done.mjs <id> "<summary>"`                                                                                                 | `working` → `fixed`, with the files the run changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ask.mjs <id> "<question>" [--option "<label>: <description>"]… [--multiple]`                                               | `working` → `asking`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `comments.mjs [<url>]`                                                                                                      | Run from the session's folder: writes the review of a pull or merge request's unresolved threads to `<state>/inbox/<id>.json` and prints `INBOX <file>`; notes on stderr (`note: …`). See [`/tranchant comments`](#tranchant-comments). |
| `post.mjs <id>`                                                                                                             | Posts `comment` (the reviewer's edit when there is one) as a positioned discussion on the MR: `glab api --method POST --header 'Content-Type: application/json' --input -` with a JSON body (`position` of type `text`, the three `diffRefs` SHAs, `old_path` and `new_path` both set to `path`, `new_line`), run from `project` so glab picks the host from the remote; then `queued` → `posted` with `posted.url`, or `failed` with glab's first error line. On a finding with a `thread`, replies on it instead: on GitHub `gh api graphql --method POST --hostname <the PR's host> --input -` (`addPullRequestReviewThreadReply`), on GitLab `glab api --method POST … projects/<project>/merge_requests/<iid>/discussions/<id>/notes` with `{ body }`; then, with the decision's `resolve`, `resolveReviewThread` or a `PUT` of the discussion with `{ resolved: true }`. A resolve that fails leaves the reply `posted`, its reason in `posted.unresolved`. Run by the server on a `post` decision, never by an agent.                                                                                                  |
| `issue.mjs <id>`                                                                                                            | Opens the issue the reviewer wrote (`issue.title`, `issue.body`) on the project `/api/tracker` names (the settings' `postWith` naming the forge for a host neither tool recognises), run from `project`: on GitHub `gh api --method POST --hostname <host> --header 'Content-Type: application/json' --input - repos/<owner>/<repo>/issues` with `{ title, body }`; on GitLab `glab api --method POST --hostname <host> … projects/<the remote's path, encoded>/issues` with `{ title, description }`. The tool has 60 seconds (`TRANCHANT_TOOL_TIMEOUT_MS`). Then `queued` → `moved` with `issue.url` and `issue.ref` (`#<number>`, `#<iid>`, absent when the answer has none), or `failed` with the tool's first error line; an answer without the issue's url fails saying where to check, since the issue may be open. Prints `moved <url>` or `failed <reason>`. Run by the server on an `issue` decision, never by an agent; a run that ends without a reason (a crash) is failed by the server, as a post is. |
| `open.mjs <review.json> [--verify \| --refresh]`                                                                                         | Validates and imports a review: the envelope into `review.json`, each inline finding into `findings/<id>.json`; prints `REVIEW <dir>`. `verify` and `verified` are dropped; `--verify`, which `/tranchant review` passes, keeps `verify`. Review and finding ids match `[\w-]{1,64}`: they become folder names and words on protocol lines. An id already imported with the same envelope (`status`, `verify` and `findings` aside: a review grows) is reused, decisions kept, its inline findings not there yet added; with another envelope, or a finding of other content, it is refused (`REVIEW_REFUSED id <id> exists with other content`, `REVIEW_REFUSED finding <id> exists with other content`): the producer mints a new id. `--refresh`, which `/tranchant comments` passes, takes the same PR/MR of the same project again: the envelope replaced (its `createdAt` kept), the findings new or changed written (their `addedAt` kept), the decisions untouched. |
| `add.mjs --review <dir> [--file <finding.json>]`                                                                            | Adds one finding, from the file or stdin, to a review still `reviewing`: checked as a review's are (id, anchor, `comment` when `theirs`), written to `findings/<id>.json` with `addedAt`; prints `ADDED <id>`. The same finding again is accepted silently; another one under the same id, an unsound one, or any once the review is complete prints `ADD_REFUSED <reason>` and exits 2.                                                                                                                                                                                                                                   |
| `complete.mjs --review <dir>`                                                                                               | Sets `status` to `complete`; prints `COMPLETE`. On a review complete already, `COMPLETE_REFUSED <reason>`, exit 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `prepare.mjs [<branch> \| <mr url>] [--recipe <file>]` | Run from the session's folder: writes the envelope of `/tranchant review`, `preparing`, to `<state>/inbox/<id>.json` and prints `INBOX <file>`, then the plan, `{ recipe, lenses }`, the lenses the change touches with the recipe in force ([where it comes from](#where-the-recipe-comes-from); the settings' `disabledLenses` left out unless `--recipe`; a settings file it cannot read is said on stderr and read as none), to `<id>.plan.json` and prints `PLAN <file>`. `REVIEW_REFUSED <reason>`, exit 2: not a repository, an unknown branch, no change, a recipe unsound or none of its lenses applying (or every one turned off), a merge request glab cannot read (glab's reason). |
| `lenses.mjs --review <dir> --plan <file>` | The Lenses step, once the page is open: builds each lens of the plan, writing `lenses.json` as it goes; every lens built, the review becomes `reviewing` with its `lenses` and it prints one `LENS <json>` per lens (`{ name, prompt, paths, model?, topics? }`, `prompt` the built file). A source that cannot be resolved makes the review `refused` and prints `REVIEW_REFUSED lens <name> (<source>): <reason>; <fix>`, exit 2, no `LENS` line. |
| `import.mjs --find \| --prepare <source> --to <project \| local> \| --check <folder>` | `/tranchant import`'s, run from the session's folder. `--find`: `CANDIDATE <path>` per `.claude/skills/*review*` and `.claude/agents/*review*` of the project, else `NO_CANDIDATE`. `--prepare`: finds the source, makes the import's folder and prints `IMPORT <json>` (`{ id, dir, recipe, source, file, folder, version?, to, target, project }`). `--check`: the agent's recipe checked as `prepare.mjs` reads one, each lens built from its location; prints `IMPORTED <target>`. `IMPORT_REFUSED <reason>`, exit 2. |
| `summarize.mjs` | The summary agent's: `{ "summary": "<Markdown>", "strengths": ["…"] }` on stdin replaces the review's `summary` (non-blank, 12,000 characters at most) and `strengths` (10 at most, 500 characters each) while it is `reviewing`; prints `SUMMARIZED`. An unsound one, or any once the review is complete, prints `SUMMARY_REFUSED <reason>`, exit 2. |
| `verify.mjs <id> [--file <finding.json> \| --amend]`, `verify.mjs --pending`                                                                         | A verifier's verdict: `VERIFIED <id>` sets `verified: true`; with the finding whole (same id) from the file or stdin, `AMENDED <id>` replaces it, verified, its `addedAt` kept. Amending a finding the reviewer decided on is refused. `--pending` prints `UNVERIFIED <id>` per finding not verified. A refusal prints `VERIFY_REFUSED <reason>`, exit 2.                                                                                                                                                                                                                                                                                                                   |
| `reply.mjs <id> [--ended]`                                                                                                  | A discussing agent's answer to the question that waits on finding `id`, as JSON on stdin: `{ "text", "fix"?, "comment"?, "drop"? }`; prints `REPLIED <id>`. No question waiting, not JSON, a `text` missing, or a proposal that is not a text: `REPLY_REFUSED <reason>`, exit 2. `--ended`, the hooks' once its agent ended: a question left waiting gets a `failed` answer and `UNANSWERED <id>` is printed. |
| `remove.mjs <id>`                                                                                                           | Removes a finding a verifier rejected or found duplicated: `REMOVED <id>`. A finding the reviewer decided on, or one inline in `review.json`, stays: `REMOVE_REFUSED <reason>`, exit 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `hook.mjs <pre\|post\|stop\|note\|ended> --finding <id> --review <dir> --project <root> [--lock-root <dir>] [--agent <id>]` | The settings hooks of one finding's agent: file locks, refused Bash writes, steps. With `--reviewer <name>` in place of `--finding`, a review agent's: no lock, no writing tool, and its Bash runs only reading commands (git's reading subcommands, `cat`, `head`, `grep`…, chained; `sort` without `-o` or a compressor, `uniq` without an output file; no redirection but `2>&1` and `>/dev/null`, no substitution outside single quotes, no unquoted heredoc) and its own review script, a reviewer's `add.mjs`, the summary agent's `summarize.mjs`, a verifier's `verify.mjs`/`remove.mjs` or a discussing agent's `reply.mjs` on its own finding, run by its path in the skill's `scripts/` (no node option before it) with `--review` its own review and never `--ended`, the finding or the answer in a quoted heredoc; steps into `reviewers/<name>.jsonl`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

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
      "source": "workflow:code-reviewer-abac", // a plugin's skill or agent, or a path: the lens's domain
      "skills": ["workflow:abac-rules"], // optional: references passed to the lens, never through the Skill tool
      "topics": ["Security & Permissions"], // optional: the topics its findings file under
      "model": "claude-opus-5-5", // optional: its reviewer's model
    },
    { "name": "bugs", "use": "tranchant:bugs", "add": "../checks/money.md" }, // an add-on to a lens of Tranchant's
    { "name": "rest", "prompt": "rest.md", "otherwise": true }, // or: the files no other lens matched
  ],
  "imported": { "source": "workflow:code-review", "leftOut": [{ "what": "…", "why": "…" }] }, // optional, /tranchant import's
}
```

A lens names one of `prompt`, `source`, or `use` with `add`. A glob is a git
`:(glob)` pathspec, matched against each changed file's path relative to the
repository, with `**` crossing folders and `*` staying within a name. A lens
runs once per review, when at least one changed file matches one of its
globs; the lens with `otherwise` (one at most, no `paths`) runs when a
changed file matches no other lens's globs, its `PATHS` those files. A
recipe has 12 lenses at most, Tranchant's included when it `extends` them.
The agent's prompt gives `LENS`, `REVIEW`, `SKILL`, `PROJECT`, `BASE`,
`HEAD`, `RANGE` (the git range of the change), `OWNERSHIP`, `PATHS` and,
when the lens declares them, `TOPICS`; it adds its findings with `add.mjs`,
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
missing refuses the review: nothing falls through to the next. `/tranchant
import` writes the local and the project's. An add-on (`use`) with no
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
3. **It builds the prompt.** A `prompt` is the prompt, whole. A `source` is
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
plugin, re-import, or edit the recipe.

## `/tranchant import`

`/tranchant import [<source>] [--to project | local]` turns a team's review
process (a skill and the agents it starts, an agent, a file or a folder)
into a recipe that **references** it:

1. With no source, `import.mjs --find` lists the project's
   `.claude/skills/*review*` and `.claude/agents/*review*`; the user names
   one. Nothing picks a source for them.
2. With no location, the two are offered: `project`
   (`<repository>/.tranchant/recipe.json`, committed and shared with the
   team) or `local` (outside the repository, the user's alone). Nothing is
   written before the user chooses.
3. `import.mjs --prepare` finds the source, then the import agent
   (`tranchant:im-<import>`, [`agents/import.md`](../agents/import.md)),
   started by the hooks in the background, reads it and writes the recipe:
   each reviewer a lens of its own or an add-on to a lens of Tranchant's, by
   name or path (a project recipe's inside the repository), never a copy of
   its text nor a whole `prompt`; what cannot become a lens
   (orchestration, scripts, MCP calls, posting, questions to the user) in
   `imported.leftOut`, with the reason. `hook.mjs --importer` lets it write
   that one file and run reading commands only, git none; its hook refuses
   on any error.
4. When it ends, `import.mjs --check` checks the recipe as a review reads
   it (12 lenses at most, Tranchant's included; a project recipe's paths
   inside the repository; no `prompt`), each lens built from its location;
   one that fails is checked again when used. The page's Settings show it whole (its lenses, their
   sources, what was left out); **Use this recipe** puts it in force at its
   location. The import alone never does. A project recipe is read at the
   base of each review: it reviews the changes made after it is committed.
