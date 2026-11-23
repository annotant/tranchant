# Study: custom lenses, what a team writes and what Tranchant adds

The outcome of [#75](https://github.com/annotant/tranchant/issues/75): the
form chosen for a lens a team writes, where its recipe lives, what that costs
the plugin's own lenses and the review file's contract, and the pieces left
to build. It records decisions; [the review file](../review-file.md) stays
the reference for what the code does.

## Where the code stands

The issue was written before
[#77](https://github.com/annotant/tranchant/pull/77), which shipped part of
what it lists. Read against the code at 0.5.1:

| Lead of the issue                  | Today                                                                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A short lens, wrapped by Tranchant | Shipped for a team's lens: a recipe's `source` is wrapped in `agents/review/contract.md` at every review (`lib/lens.mjs`, `buildLens`). Not for the plugin's ten lenses, still whole prompts.                                                       |
| `PATHS` as the only file list      | Shipped in the contract ("PATHS is the only file filter"). The plugin's ten prompts never mention `PATHS`: each has a sentence of its own on which files to review. Six restrict to front-end files ("Review only the files that…"), `bugs` takes every file, and `docs`, `performance` and `silent-failures` each name their own set. |
| The topic declared                 | A lens's `topics` exist in the recipe and reach the prompt as `TOPICS`. Nothing checks them: `add.mjs` accepts any of the seven topics. The plugin's recipe declares none. A finding records its `lens` (`add.mjs --lens`, held by the hook) and the list shows it; the list groups by bucket, then topic.    |
| A recipe in the project            | Shipped: `.tranchant/recipe.json`, read at BASE with every path inside the repository, after `--recipe` and the local recipe.                                                                                                                       |
| The excerpt filled for producers   | Not started: `excerpt` is required by `open.mjs` and `add.mjs`, with a `hunk` or without.                                                                                                                                                           |

Measured on `agents/review/`:

- A plugin lens is 201 to 234 lines. Its domain ("What to look at" and "What
  counts") is 49 to 82 of them, headings and blank lines included; 94 to 96
  of its non-blank lines are in `contract.md` word for word.
- From "How to work" to the end, a lens differs from `correctness.md` by 6
  to 12 lines: the sentence on which files to review, the topic and bucket
  rule, the lens's name in the id. Nothing else there belongs to one lens.
- `conventions.md`, `security.md` and `tests.md` still show `"topic": "Bugs"`
  in their example while their rule names another topic.
- `contract.md` has fallen behind the lenses it was cut from: it has no
  `diagram`, a `fix` with no list or fenced block, a shorter word on when a
  `comment` is worth posting, and a shorter step 4. A team's lens is never
  told it can attach a diagram: `add.mjs` would accept one, but the contract
  does not say the field exists.

## Decisions

### 1. A team writes the domain; the recipe says where it applies

A custom lens is a Markdown file that says what to look at and what counts,
in any shape, named by a recipe as a `source`. Tranchant adds the contract:
the inputs, the change as data, how to work, anchor, word and report. This
is what #77 built, and it stays.

The lens's `name`, `paths`, `topics` and `model` stay in the recipe. A
frontmatter in the lens file was the issue's lead; it is not taken:

- A source is often someone else's skill or agent. Its frontmatter already
  speaks to Claude Code (`name`, `description`, `model`, `tools`), with
  other meanings. Tranchant drops it today, and reading keys from it would
  give two readers to one block.
- Two places for the same key need an order of precedence, and a reviewer
  who reads the recipe would no longer see which files a lens takes.
- `splitFrontmatter` reads one-line `key: value` pairs. A list of globs
  needs a YAML reader, and the scripts take no dependency.

The bucket rule is prose in the domain ("`auto` when…"); the contract's
default applies when the domain says nothing.

A whole `prompt` keeps working as today, untouched by the contract. It is
the way out for a lens the contract does not fit, at the cost the issue
describes: it follows no later change of the contract. `/tranchant import`
keeps refusing it, and so does a project recipe (decision 5).

### 2. The plugin's lenses become domain files, under the same contract

Each `agents/review/<lens>.md` keeps its frontmatter (Claude Code loads the
folder), one sentence of framing ("a web front end"), "What to look at",
"What counts" with the paragraph that hands defects to the neighbouring
lenses, and its topic and bucket rule: about 60 to 90 lines. The plugin's
recipe names it as a `source`; `tranchant:<lens>`, an add-on's `use`
included, builds as the contract then the domain.

What it costs:

- **The contract first.** It takes back what the plugin's lenses have and
  it lacks: `diagram`, the `fix` formats, the `comment` guidance, and the
  general part of step 4 (following the chain across the front end and the
  server of the same repository; what a library throws, returns, retries or
  caches). What is front-end only (`tsconfig` in step 1, `node_modules` in
  step 4) goes to the domains.
- **`lib/lens.mjs` learns the two forms.** Today `builtIn` rewrites every
  plugin lens to `prompt: tranchant:<name>`, `builtInLenses` knows only the
  lenses with a `prompt`, and `buildLens` takes a `prompt` whole. They must
  carry the form the plugin's recipe gives each lens, keep resolving
  `tranchant:<lens>` to the plugin's own file whichever recipe names it,
  and wrap a built-in `source`, and an add-on on one, in the contract.
- **One lens at a time**, once that is in: the plugin's recipe names each
  lens as a `prompt` or a `source`, so the two forms run side by side. A
  lens moves when it finds on `test/fixtures/front-end` what its whole
  prompt found; that fixture's planted defects are the gate.
- **Every built lens changes hash once**, and shows `updated since the last
  review` on the next review.
- An add-on with its own `paths` on a plugin lens starts working: today the
  built-in prompt never reads `PATHS`, and its own sentence on which files
  to review (every lens but `bugs`) still narrows it.

### 3. `PATHS` is the only file list

Nothing to decide beyond decision 2: the contract already says it, and the
sentences on which files to review go with the whole prompts.

### 4. The topic is declared, and Tranchant holds the lens to it

- The plugin's recipe declares `topics` for its ten lenses, from the rule
  each prompt states today.
- The reviewer calls `add.mjs --lens LENS`; `hook.mjs` refuses another lens
  than its own, as it already holds `--review` to its own review.
- The store stamps `lens` on the finding (from `--lens`, never from the
  finding's text), and
  checks `topic` against the lens's `topics`, recorded in
  `review.json`'s `lenses`: one topic declared sets it; several refuse a
  topic outside them, naming them. A lens with no `topics` is checked as
  today.
- Both happen before the store compares a finding with the one it holds, so
  the same finding added twice is still accepted silently; and a verifier's
  amend goes through them too: `lens` is the known finding's, and the
  amended `topic` is checked against the same list.
- The page groups a review's list by lens, in the recipe's order, when its
  findings carry `lens`; the topic stays a chip. A producer's review, with
  no `lens`, keeps the grouping by bucket and topic.

What it costs:

- The review file: a finding gains an optional `lens` (`[\w-]{1,40}`); a
  lens record gains an optional `topics`. Both are additive: a file written
  today stays valid.
- An add-on with no `topics` of its own keeps its plugin lens's. Today that
  only fills the prompt's `TOPICS`; once they are checked, a team's
  checklist added to `tranchant:correctness` files under `Bugs` and nothing
  else. One that files elsewhere declares its own `topics`: the guide says
  so.

### 5. The project's recipe stays where #77 put it, without whole prompts

`.tranchant/recipe.json` is read at BASE (a merge request's base commit),
so a change cannot rewrite the lenses that review it, and the local recipe
and `--recipe` win over it. Its lenses run in the reviewers' sandbox.

One gap closes: today a project recipe may name a whole `prompt`, which is
read at BASE and becomes a reviewer's whole instructions, with no contract
above it. Only `/tranchant import` refuses one. A recipe read at BASE takes
the same rule: a `source` or an add-on, each fenced as a domain under the
contract, never a `prompt`. A project recipe that names one today is
refused, saying to name it as a `source`; the local recipe, the settings'
and `--recipe`, the user's own files, keep it.

### 6. A producer gives the anchor; Tranchant fills the excerpt

`open.mjs` and `add.mjs` fill a missing `excerpt`, a finding's or a
`related` one's, from `path` and `line` at the envelope's `headSha`, before
the finding is checked: a fixed window around `line`, read as the server
already reads the file for the diff (`git cat-file blob <headSha>:./<path>`
in the project, which may be a folder of the repository, the path's `..`
refused). A finding with a `hunk` is filled too: the page shows the hunk,
but the agents that fix and discuss a finding read its excerpt. A `headSha` the checkout
lacks, or a line past the file's end, is refused with the reason.

Stored findings always have their excerpt: the page and the agents read the
same shape as today. Only the producers' contract loosens (`excerpt`
optional on the way in); the lenses keep choosing their own window.

### 7. The sandbox, the summary agent and the verifier do not move

A lens is instructions: Read, Grep, Glob, reading commands, and `add.mjs`.
A skill that runs scripts or other skills stays a producer (decision 6 is
for it). The summary agent and the verifier keep their fixed prompts; only
their models are settings. Opening the verifier would let a recipe lower
the bar every finding passes.

## The pieces

One issue each. Pieces 1 to 4 follow one another; 5 and 6 are independent.

1. **The contract catches up with the lenses, and a guide to write one.**
   `contract.md` gains `diagram`, the `fix` formats, the `comment` guidance
   and the general part of step 4; the README and the review file say how a
   team writes a lens (a domain file, a `source` entry, its `topics`), in
   place of "`--recipe` runs your own, in the same shape".
2. **The plugin's lenses as domain files.** `lib/lens.mjs` builds a
   built-in lens from either form; then one lens per change, gated by the
   front-end fixture.
3. **A lens's topics declared and checked, `lens` on the finding.** The
   plugin recipe's `topics`, `add.mjs --lens`, the hook, the store's add
   and amend, the review file's schema.
4. **The list grouped by lens.** The page, for a review whose findings
   carry `lens`.
5. **A project recipe takes no whole prompt.** `readRecipe`, for a recipe
   read at BASE; the Settings page says why and what fixes it.
6. **The excerpt filled from the anchor.** `open.mjs`, `add.mjs`, the
   review file's schema.

## Open questions

- **Grouping by lens** replaces a heading reviewers know. The alternative
  is to keep topics as headings and show the lens as a chip; piece 4 can
  be dropped without touching piece 3.
- **Refusing a project recipe's `prompt`** breaks a recipe a team wrote by
  hand that way. The alternative is to keep it and say on the page, before
  the reviewers start, that a lens runs the repository's own prompt.
- **A repository one does not trust.** Its recipe at BASE still says what
  the reviewers look for, and they can read any file the user can. A local
  recipe replaces it; whether a setting should ignore project recipes is
  not decided here.
- **The lenses' own excerpts.** Tranchant could fill them too, from a
  `startLine` and an end line, and the contract would lose its rule on
  copying exactly. Left out until piece 6 shows how the fixed window reads.
