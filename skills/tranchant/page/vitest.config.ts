import { defineConfig } from 'vitest/config'

// The page's component tests; the scripts' and the server's stay on node:test.
// `*.spec.tsx`, not `*.test.tsx`: `claude plugin test` (test:hooks) runs every *.test.ts(x).
export default defineConfig({
  define: { TRANCHANT_VERSION: JSON.stringify('0.0.0-test') },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.spec.tsx'],
    setupFiles: ['test/setup.ts'],
    unstubGlobals: true,
    // Run through Vitest, not Node: mermaid.spec.tsx mocks what Mermaid imports.
    server: { deps: { inline: ['mermaid'] } },
  },
})
