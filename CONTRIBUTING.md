# Contributing to Tranchant

Thanks for helping! By taking part, you agree to follow the
[code of conduct](CODE_OF_CONDUCT.md).

**Found a vulnerability?** Do not open an issue: follow the
[security policy](SECURITY.md).

## Before you start

- **Bugs**: open an issue first, unless the fix is obvious and small.
- **Features and larger changes**: open an issue and wait for a maintainer's
  go-ahead before writing code. Tranchant stays small on purpose.
- One pull request does one thing.

## Set up

You need [Node.js](https://nodejs.org) 22.12 or later (CI uses the version in
[`.nvmrc`](.nvmrc)), npm, [Claude Code](https://claude.com/claude-code)
2.1.287 or later, and `glab` to post on GitLab.

```sh
git clone https://github.com/<you>/tranchant
cd tranchant
npm ci
npm run build
```

`npm ci` never runs install scripts: [`.npmrc`](.npmrc) sets
`ignore-scripts=true`. Keep it that way.

## Trying your changes

Build the playground, a throwaway git repository holding the files the
fixture review names, with a base commit and a head commit so the page has
a diff to show, then start Claude Code in your clone and open that review:

```sh
node test/fixtures/playground.mjs    # --theirs for the MR variant, --fresh to rebuild
claude
```

`--front-end` builds the front-end fixture instead: a small cart app on
`main` and, on `feature/cart-discounts`, a discount feature with seven
planted defects (see [the fixture](test/fixtures/front-end/README.md)), its
`review.json` the review of those defects, so you can fix real bugs in a real
project. It also writes `.playground/review-live.json`, the same review in
progress, for a lens run by hand to fill. To run the lenses themselves, start
Claude Code in the playground, `cd .playground && claude --plugin-dir ..`,
then `/tranchant review feature/cart-discounts`: the findings the lenses land
can be held against the fixture's.

```
/tranchant .playground/review.json
```

In this repository, Claude Code loads Tranchant from your clone, with no
flag: `.claude/skills/tranchant` is a link to the repository root, which
Claude Code loads as a plugin (`tranchant@skills-dir` in `claude plugin
list`), and `.claude/settings.json` disables the copy installed from the
marketplace, in this project only. It loads once you trust the folder, on
the first start. Do not add `--plugin-dir .`: the plugin would load twice.
On Windows, git creates the link only with `core.symlinks` enabled
(Developer Mode, then `git config core.symlinks true` before cloning).

The page opens in your browser. Fix a finding: its agent edits
`.playground/`, which `git -C .playground diff` shows. Posting needs a real
MR, so the `theirs` variant only exercises the comment forms.

To look at the page without Claude, run the server by hand: decisions are
recorded but nothing acts on them.

```sh
TRANCHANT_HOOKS=1 node skills/tranchant/scripts/server.mjs \
  --review "$(node skills/tranchant/scripts/open.mjs .playground/review.json | cut -d' ' -f2)"
```

After a change to `skills/tranchant/SKILL.md`, `agents/` or `hooks/`, run
`/reload-plugins`; after one to `page/src`, `npm run build` (or `npm run
watch`).

The review's lenses (`agents/review/*.md`) share their sections on inputs,
anchoring, wording and reporting word for word: a change to one of those
sections goes into every lens. Try a lens on the playground's planted defects
as [the fixture](test/fixtures/front-end/README.md) describes before changing
its prompt.

## Before opening a pull request

`npm run check` must pass: format, lint, unused code, types, build and tests.
`npm run test:hooks` runs the hooks' tests in Claude Code when `hooks/`
changed.

If the change is visible to users, add it under `## Unreleased` in
[`CHANGELOG.md`](CHANGELOG.md).

## Dependencies

Tranchant has no runtime dependencies: the scripts use Node.js only, and the
page bundles React. Adding one is a design decision; ask in an issue first.

- Versions are pinned exactly (`save-exact=true`); the lockfile is committed.
- Dependabot proposes updates weekly, a week after their release, grouped.
  Minor and patch updates merge on their own once every required check passes;
  majors wait for a maintainer, who reads their changelogs first.
- CI rejects dependencies with known vulnerabilities or non-permissive licenses.

## Pull requests

- Branch from `main` and name the branch after its intent: `feature/…`,
  `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `test/…`, `ci/…`.
- **The pull request title is the commit message**: pull requests are squashed
  on merge. It must follow
  `<type>: <summary>` (a scope is allowed: `<type>(page): <summary>`), with
  `type` one of `feature`, `fix`, `docs`, `chore`, `refactor`, `perf`, `test`,
  `ci`, and a lowercase summary in the imperative
  (`fix: keep the batch bar above the detail panel`). CI checks it.
- Fill in the pull request template: what changes, why, and how you tested it.
- Keep your branch up to date with `main`. The maintainer reviews every pull
  request and is the one who merges it.
- Signed commits are welcome but not required: the squashed commit that lands
  on `main` is signed by GitHub.

## Releases

Maintainers release; contributors only add their change under `## Unreleased`
in [`CHANGELOG.md`](CHANGELOG.md).

Users install from the `stable` branch, which only the Release workflow
updates: merging to `main` ships nothing. `page/dist/` is not committed on
`main`; the release commits it on `stable`. To release:

1. Open a `chore: release x.y.z` pull request that sets `version` in
   `.claude-plugin/plugin.json` ([semver](https://semver.org): patch for
   fixes, minor for features, major for breaking changes to commands or to the
   review file) and moves the `Unreleased` entries under a
   `## x.y.z - YYYY-MM-DD` heading.
2. Once it is merged, run **Actions → Release → Run workflow** on `main`, with
   the version. Nothing is tagged or published otherwise: merging to `main`
   never releases.
3. The **Verify** job re-runs every CI check on that commit and builds the
   page, then checks what a release needs: the version matches `plugin.json`
   and is greater than the last release, its tag is new, its changelog section
   is dated and filled with `Unreleased` empty, no dependency has a known
   vulnerability, and no CodeQL or zizmor alert is open (Scorecard's alerts
   rate the project's practices and do not block).
4. The **Publish to stable** job waits for a maintainer's approval in the
   `release` environment. It then commits the verified tree with its built
   page on `stable` (its parents: the previous release and the verified commit
   on `main`), tags that commit `vx.y.z`, and publishes the GitHub release: the
   changelog section as notes, the plugin archive, and its signed provenance
   attestation as `tranchant-x.y.z.intoto.jsonl`, checked against the archive
   before the release is created. Releases are immutable: once published,
   neither the tag nor the files can change.

Verify a release's archive with
`gh attestation verify tranchant-x.y.z.tar.gz -R annotant/tranchant --signer-workflow annotant/tranchant/.github/workflows/release.yml`,
adding `--bundle tranchant-x.y.z.intoto.jsonl` to check it against the attached
bundle instead of GitHub's attestation store (`gh` still fetches Sigstore's
trust root).

## Using Claude Code on this repository

Contributions made with Claude Code are welcome. [`CLAUDE.md`](CLAUDE.md) gives
it the project's rules. You remain responsible for every line you submit:
review it as if you had written it.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE), like the rest of the project.
