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
fixture review names, then start Claude Code in your clone and open that
review:

```sh
node test/fixtures/playground.mjs    # --theirs for the MR variant, --fresh to rebuild
claude
```

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

## Before opening a pull request

`npm run check` must pass: format, lint, unused code, types, build and tests.
`npm run test:hooks` runs the hooks' tests in Claude Code when `hooks/`
changed.

Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`,
`chore:`…).
