# The review file, the decisions file and the run files

Tranchant keeps everything about a review outside the project, in the state
folder: nothing is installed in a repository to review it.

| File                              | Where                                 | Holds                                                                                             | Written by                                                                                        |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `review.json`                     | `<state>/<hash>/reviews/<review id>/` | The review as its producer wrote it: the change, its findings, their excerpts, marks and diagrams | The producer (`combined-review --tranchant`, or by hand), imported by `open.mjs`; never rewritten |
| `decisions.json`                  | Next to it                            | What the reviewer decided on each finding, its state, its runs and the history of its moves       | The store (`scripts/lib/store.mjs`), for the server and the agents' scripts                       |
| `runs/<finding id>.jsonl`         | Next to it                            | The steps of the run in progress on that finding                                                  | The hooks (`hooks/register.ts`)                                                                   |
| `runs/<finding id>.history.jsonl` | Next to it                            | The steps of every run that ended                                                                 | The store, when a run ends                                                                        |

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

The producer's output. `open.mjs` validates it, copies it into a new review
folder and prints `REVIEW <dir>`; any other `version` is refused and the file
is left where it was.

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
  "ownership": "ours", // "ours": fixes only; "theirs": posting too
  "title": "Classification overview page",
  "mr": {
    // optional; required to post
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
  "findings": [/* Finding, in the order the report lists them */],
}
```

| Field         | Type               | Notes                                                                                               |
| ------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `version`     | `1`                |                                                                                                     |
| `id`          | string             | A UUID. One folder per id; opening the same id again reuses its decisions.                          |
| `project`     | string             | Absolute. The git repository it lies in is the lock root.                                           |
| `headSha`     | string             | Full SHA. The page shows a warning when the checkout moved; a fix still runs, on the current files. |
| `ownership`   | `ours` or `theirs` | Decides the actions the page offers; `post` needs `theirs` and `mr`.                                |
| `mr.diffRefs` | object             | GitLab's `diff_refs` of the MR version reviewed: a positioned comment needs all three.              |
| `summary`     | string             | Markdown, shown above the findings.                                                                 |
| `findings`    | Finding[]          | At least one. Ids unique within the review.                                                         |

### A finding

```jsonc
{
  "id": "f-03",
  "topic": "Bugs", // see Topics
  "bucket": "review", // "review" (🔴 needs your review) or "auto" (🟢 auto-addressable)
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
    "kind": "svg", // "svg" or "text"
    "source": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 600 240\">…</svg>",
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
| `problem`, `why`, `fix`      | string                              | Plain words, as the findings model asks: one idea per sentence.                                                                                                                                  |
| `comment`                    | string, optional                    | The text to post, whole. Required when `ownership` is `theirs`. Up to 4000 characters.                                                                                                           |
| `diagram.kind`               | `svg` or `text`                     | `svg`: inline SVG, which the page sanitizes (no script, no event handler, no `foreignObject`, no external reference); `text`: preformatted, ASCII art or a Markdown list of steps. Up to 64 KiB. |
| `related[]`                  | object[], optional                  | Up to 4. Same shape as `path`, `line`, `excerpt`, `marks`.                                                                                                                                       |

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
        "at": "…",
      },
      "comment": "…", // "theirs": the text as posted, when the reviewer edited it
      "question": {
        "text": "…",
        "options": [{ "label": "…", "description": "…" }],
        "multiple": false,
        "at": "…",
      },
      "answer": { "text": "…", "choices": ["…"], "at": "…" },
      "reason": "…", // dropped: the reviewer's words; failed: the error
      "posted": { "discussionId": "…", "url": "…", "at": "…" },
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
| `queued`  | A fix or a post is decided; waiting for an agent or for glab              | reviewer (`fix`, `post`, an answer) |
| `working` | An agent is on it                                                         | agent (`claim.mjs`)                 |
| `asking`  | The agent asked the reviewer something; it stopped                        | agent (`ask.mjs`)                   |
| `fixed`   | The working tree holds the fix                                            | agent (`done.mjs`)                  |
| `posted`  | The comment is on the MR                                                  | server (`post.mjs`)                 |
| `dropped` | The reviewer rejected the finding                                         | reviewer                            |
| `skipped` | Deferred                                                                  | reviewer                            |
| `failed`  | The fix or the post failed; `reason` says why                             | hooks, server                       |
| `stopped` | The reviewer stopped the agent; `cancellation` lists what it left changed | reviewer                            |

Moves the store accepts:

- `fix`: from `open`, `dropped`, `skipped`, `failed`, `stopped` → `queued`. An `asking` finding leaves only through `answer`.
- `post`: from `open`, `dropped`, `skipped`, `failed` → `queued`; refused unless `ownership` is `theirs` and `mr.diffRefs` is set.
- `drop`, `skip`: from `open`, `queued`, `asking`, `failed`, `stopped`, or from each other → `dropped`, `skipped`. Never from `working`, `fixed` or `posted`.
- `answer`: from `asking` → `queued`, with `answer` set; the server prints `FIX <id>` again.
- `stop`: from `queued`, `working` → `stopped`.
- `claim`: from `queued` → `working`, starting a run; refused on a finding queued for a post.
- `done`: from `working` → `fixed`. `ask`: from `working` → `asking`. `hook.mjs ended` moves a `working` finding whose agent ended without either to `failed` (`reason`: `the agent ended without done.mjs or ask.mjs`).

A `fixed` or `posted` finding is final: no move leaves it (the reviewer
reverts by hand, or asks for a follow-up in a new review).

The page's one-shot buttons (Fix all auto-addressable, Post all) act on the
`open` findings only, in list order; a selection may apply any move the table
allows. At start, the server prints `FIX <id>` again for every `queued` fix
and runs the queued posts again; a `working` finding is left to its agent.

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

## The run files

One JSON object per line, as the hooks record the agent's tools:

```jsonc
{ "at": 1761838297469, "kind": "start", "label": "Started", "state": "done", "model": "claude-opus-5-5" }
{ "at": 1761838298102, "kind": "read", "label": "src/people/usePeople.ts", "state": "done" }
{ "at": 1761838301540, "kind": "edit", "label": "src/people/usePeople.ts", "state": "running" }
{ "at": 1761838304011, "kind": "bash", "label": "pnpm exec vitest run src/people", "state": "failed", "detail": "…" }
{ "at": 1761838310200, "kind": "note", "label": "Early return added; the drawer test passes.", "state": "done" }
```

`kind` is `start`, `read`, `edit`, `write`, `bash`, `search`, `note` or
`tool`; `state` is `running`, `done` or `failed`. The server watches the
folder and tells the page to reload. A run that ends moves its file to
`.history.jsonl`.

## The server

`server.mjs --review <dir>` serves the page and its API on a free port of
127.0.0.1, prints one line per decision the hooks act on, and runs `post.mjs`
itself on each `post` decision, one at a time. Only runs while a session
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
| `DROPPED <id>`, `SKIPPED <id>`                             | Informational.                                                                   |
| `AGENT_ENDED <id>`                                         | `hook.mjs ended` found the finding still `working` and moved it to `failed`.     |
| `PORT_BUSY <port> is used by <owner>`                      | Could not listen.                                                                |
| `REVIEW_REFUSED <reason>`                                  | The review folder is unreadable or its version unknown.                          |
| `HOOKS_MISSING …`                                          | Started outside the plugin's hooks (`TRANCHANT_HOOKS` unset).                    |

### Routes

| Route                 | Does                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`               | The page.                                                                                                                                                                                                                                                                                       |
| `GET /page.js`        | Its bundle.                                                                                                                                                                                                                                                                                     |
| `GET /api/health`     | `{ ok: true, review: "<id>", version: "<plugin version>" }`.                                                                                                                                                                                                                                    |
| `GET /api/review`     | `{ review, findings, runs, head }`: the review, the decisions' `findings` map, the last 50 steps of each run in progress, and `head: { reviewed, current }` (`current` from `git rev-parse HEAD` in `project`, `null` when git cannot say; the page warns only when both are known and differ). |
| `GET /api/diff`       | `{ base, head, files, diff }`: the change's unified diff, `git diff <base>...<headSha>` run in `project` (`baseSha..headSha` with `mr.diffRefs`), its paths relative to `project` like the findings', and its files, each `{ path, oldPath?, additions, deletions, binary }`. Computed once. Answers 409 with the reason when `project` is not a git repository, the head commit is not there, or git fails: the page then shows its list view.                                               |
| `GET /api/events`     | Server-sent events: `changed` with `{ ids }` when a finding's record or run changed (`ids` empty when the review folder changed otherwise); `page` when the bundle was rebuilt.                                                                                                                 |
| `POST /api/decisions` | `{ "decisions": [ { "id", "action": "fix" \| "post" \| "drop" \| "skip", "context"?, "comment"?, "reason"? } ] }`. Applies each in order; answers `{ applied: [ids], refused: [ { id, reason } ] }`. A batch is one request.                                                                    |
| `POST /api/answer`    | `{ "id", "text", "choices"? }` on an `asking` finding; answers `{ ok: true }`.                                                                                                                                                                                                                  |
| `POST /api/stop`      | `{ "id" }`; answers `{ ok: true }`.                                                                                                                                                                                                                                                             |
| `GET /api/runs/<id>`  | `{ progress, history }`: the steps of the run in progress, then those of the runs that ended, each a list.                                                                                                                                                                                      |

Everything is same-origin; the server refuses a request whose `Origin` is not
its own (403). A malformed body answers 400 and a move the store refuses 409,
both as `{ error: "<reason>" }`. `GET /` carries a content security policy
(`script-src 'self'`, inline styles, nothing external).

## The scripts the agents run

`node SKILL/scripts/<name>.mjs`, `SKILL` being `skills/tranchant`. Every
script takes `--review <dir>`.

| Script                                                                                                                      | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claim.mjs <id>`                                                                                                            | `queued` → `working`; starts a run; prints the finding as JSON, fenced, for the agent.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `done.mjs <id> "<summary>"`                                                                                                 | `working` → `fixed`, with the files the run changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ask.mjs <id> "<question>" [--option "<label>: <description>"]… [--multiple]`                                               | `working` → `asking`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `post.mjs <id>`                                                                                                             | Posts `comment` (the reviewer's edit when there is one) as a positioned discussion on the MR: `glab api --method POST --header 'Content-Type: application/json' --input -` with a JSON body (`position` of type `text`, the three `diffRefs` SHAs, `old_path` and `new_path` both set to `path`, `new_line`), run from `project` so glab picks the host from the remote; then `queued` → `posted` with `posted.url`, or `failed` with glab's first error line. Run by the server on a `post` decision, never by an agent. |
| `open.mjs <review.json>`                                                                                                    | Validates and imports a review; prints `REVIEW <dir>`. Review and finding ids match `[\w-]{1,64}`: they become folder names and words on protocol lines. An id already imported with the same content is reused, decisions kept; with other content it is refused (`REVIEW_REFUSED id <id> exists with other content`): the producer mints a new id.                                                                                                                                                                      |
| `hook.mjs <pre\|post\|stop\|note\|ended> --finding <id> --review <dir> --project <root> [--lock-root <dir>] [--agent <id>]` | The settings hooks of one finding's agent: file locks, refused Bash writes, steps.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
