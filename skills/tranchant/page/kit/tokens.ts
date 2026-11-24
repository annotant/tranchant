// The kit's ground, shared by the review page and the dashboard: the font,
// the palette (light, dark, and the pick on `<html data-theme>`) and the
// base rules every page starts from. Each page's stylesheet comes after it.

import figtree from './fonts/figtree-latin.woff2'
import figtreeItalic from './fonts/figtree-latin-italic.woff2'

declare module 'react' {
  interface CSSProperties {
    [variable: `--tr-${string}`]: string | number
  }
}

// Used by both the system's dark scheme and a dark pick: one palette, never two to keep in step.
const DARK_PALETTE = `
  color-scheme: dark;
  --tr-bg: #15181d;
  --tr-bg-2: #1c2026;
  --tr-bg-3: #242931;
  --tr-text: #e6e9ee;
  --tr-muted: #9aa4b2;
  --tr-border: #333a44;
  --tr-accent: #6aa7e8;
  --tr-accent-weak: #1f3147;
  --tr-busy: #c4a8f4;
  --tr-busy-bg: #2c2441;
  --tr-on-accent: #0d1b2a;
  --tr-review: #e9807c;
  --tr-review-bg: #3a2222;
  --tr-auto: #7ccf98;
  --tr-auto-bg: #1f3a2a;
  --tr-warn: #f0c36b;
  --tr-warn-bg: #3a2f14;
  --tr-danger: #e9807c;
  --tr-danger-bg: #3a2222;
  --tr-mark: rgba(255, 196, 0, 0.22);
  --tr-mark-line: rgba(255, 196, 0, 0.09);
  --tr-added: #1f3a2a;
  --tr-removed: #3a2222;
  --tr-code-keyword: #e0bdff;
  --tr-code-string: #8fdca2;
  --tr-code-number: #ffbb8a;
  --tr-code-comment: #c4cdd8;
  --tr-code-tag: #9ad0ff;
  --tr-code-attr: #f2cc60;
`

// A name of its own, so a local Figtree never takes over; rebalanced (95%/25% as shipped), or text sits high.
export const TOKENS_CSS = `
@font-face { font-family: 'Tranchant Figtree'; font-style: normal; font-weight: 400 700; font-display: swap; ascent-override: 100%; descent-override: 20%; src: url(${figtree}) format('woff2'); }
@font-face { font-family: 'Tranchant Figtree'; font-style: italic; font-weight: 400; font-display: swap; ascent-override: 100%; descent-override: 20%; src: url(${figtreeItalic}) format('woff2'); }
:root {
  color-scheme: light dark;
  --tr-font: 'Tranchant Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --tr-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  --tr-bg: #ffffff;
  --tr-bg-2: #f6f7f9;
  --tr-bg-3: #eceef2;
  --tr-text: #1c2129;
  --tr-muted: #5f6b7a;
  --tr-border: #d9dde3;
  --tr-accent: #2b6cb0;
  --tr-accent-weak: #e7f0fb;
  --tr-busy: #6a3fb0;
  --tr-busy-bg: #f1ebfb;
  --tr-on-accent: #ffffff;
  --tr-review: #b3423f;
  --tr-review-bg: #fbecec;
  --tr-auto: #2a7349;
  --tr-auto-bg: #e8f5ec;
  --tr-warn: #8a5a0c;
  --tr-warn-bg: #fff4dc;
  --tr-danger: #b3423f;
  --tr-danger-bg: #fbecec;
  --tr-mark: rgba(255, 196, 0, 0.45);
  --tr-mark-line: rgba(255, 196, 0, 0.16);
  --tr-added: #e6f6ea;
  --tr-removed: #fbe9e9;
  --tr-code-keyword: #8b2fb8;
  --tr-code-string: #106634;
  --tr-code-number: #9a4100;
  --tr-code-comment: #526076;
  --tr-code-tag: #1a5aab;
  --tr-code-attr: #7a5000;
  --tr-radius: 6px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_PALETTE}}
}
:root[data-theme="dark"] {${DARK_PALETTE}}
:root[data-theme="light"] { color-scheme: light; }

* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font: 14px/1.45 var(--tr-font); color: var(--tr-text); background: var(--tr-bg); }
#root { height: 100%; }
button, input, textarea { font: inherit; color: inherit; }
a { color: var(--tr-accent); }
code { font-family: var(--tr-mono); font-size: 0.92em; }
h1, h2, h3, h4 { margin: 0; font-weight: 600; line-height: 1.3; }
p { margin: 0; }
dl { margin: 0; }
.tr-muted { color: var(--tr-muted); }
.tr-error { color: var(--tr-danger); }
`
