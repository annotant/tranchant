# The front-end fixture

A small shopping cart (React 19, TypeScript, Vitest), in two trees:

- `base/`: the clean app, the playground's `main`.
- `change/`: the files `feature/cart-discounts` adds or changes, copied over
  the base. `diff -r base change` shows the change.

`node test/fixtures/playground.mjs --front-end` builds the repository and
writes `.playground/review.json`, the review of the planted defects
(`test/fixtures/review-front-end.json`, pointed at the playground), and
`.playground/review-live.json`, the envelope of a review in progress for a
lens run by hand to fill. `test/playground.test.mjs` checks the review's
excerpts against the files, so the two cannot drift.

## The planted defects

Seven, one per lens of the default recipe and two for correctness, in four
files of the change. The review's findings are the answer key: each names
its file, its line and its marks.

| Finding           | Lens          | File                         | Defect                                                                                      |
| ----------------- | ------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `correctness-1`   | correctness   | `src/cart/Cart.tsx`          | A stale closure: `useMemo` reads `discount` but lists only `items`; the total never updates |
| `correctness-2`   | correctness   | `src/cart/DiscountForm.tsx`  | A missing error state: a refused code puts the form back to `idle` and shows nothing        |
| `types-1`         | types         | `src/cart/discount.ts`       | An `any` hiding a bug: `data.percentage` where the response has `percent`                   |
| `accessibility-1` | accessibility | `src/cart/DiscountForm.tsx`  | An unlabelled control: the code field has a placeholder and no label                        |
| `security-1`      | security      | `src/cart/DiscountForm.tsx`  | User text through `innerHTML`: the typed (or `?code=`) code set as HTML                     |
| `tests-1`         | tests         | `src/cart/DiscountForm.test.tsx` | An assertion that cannot fail: `toBeDefined()` on a `queryByText` result               |
| `conventions-1`   | conventions   | `src/cart/Cart.tsx`          | A rule of the project's `CLAUDE.md` broken: the discount amount is formatted by hand        |

The other files of the change are clean: `src/api/types.ts`,
`src/cart/types.ts`, `src/cart/total.ts`, `src/cart/useCart.ts`,
`src/cart/cart.css` and `src/cart/discount.test.ts`. A finding on one of
them is a false positive. A lens may add a true finding next to the planted
ones (the discounted total is untested, for instance): it is not wrong, but
it is not in the key either.

## Running a lens by hand

The lenses can be tried before the review driver exists, one agent at a
time. Build the playground, import the live envelope (this needs the
streaming contract's `open.mjs`, which accepts a `reviewing` review with no
finding), then start Claude Code at the repository root and give an agent a
lens's prompt with the inputs the driver would:

```sh
node test/fixtures/playground.mjs --front-end --fresh
node skills/tranchant/scripts/open.mjs .playground/review-live.json   # prints REVIEW <dir>
claude
```

```
Start a general-purpose agent whose prompt is the body of
agents/review/correctness.md, followed by these lines:
REVIEW=<the folder open.mjs printed>
SKILL=<this repository>/skills/tranchant
PROJECT=<this repository>/.playground
BASE=main
HEAD=feature/cart-discounts
```

The agent's `add.mjs` calls write `findings/<id>.json` in the review folder;
compare them with the key. Until `add.mjs` exists, tell the agent to print
each finding's JSON in its reply instead of calling it. The verifier is tried
the same way, with a finding's id as the prompt's first line.

The expected outcome of a full run: the seven planted defects, each as one
finding of its lens, nothing on the clean files, and the verifier keeping all
seven.
