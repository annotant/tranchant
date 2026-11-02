# Cart demo

A small shopping cart: React 19, TypeScript, Vitest with Testing Library.

This copy is a throwaway one, made by Tranchant's `test/fixtures/playground.mjs`
to try the plugin on: nothing is installed here, so no test, typecheck or
linter can run. Make the change a finding asks for with the Edit tool, and
finish.

## Conventions

- Every amount shown to the user goes through `formatPrice` in
  `src/cart/format.ts`: never format cents by hand.
- Every call to the API goes through `request` in `src/api/client.ts`.
- A component is a named function export; its props type is
  `<Component>Props`, declared in the same file.
- Styles live in `src/cart/cart.css`, with the colours and spacing of its
  `:root` custom properties; class names are `block__element`.
- Tests sit next to what they test, as `<name>.spec.ts(x)`, and query the
  page by role.
