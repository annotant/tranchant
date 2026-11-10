// The page's stylesheet, injected by main.tsx: no CSS file to serve.

import figtree from './assets/fonts/figtree-latin.woff2'
import figtreeItalic from './assets/fonts/figtree-latin-italic.woff2'

declare module 'react' {
  interface CSSProperties {
    [variable: `--tr-${string}`]: string | number
  }
}

// A "↳" the gutter repeats under a wrapped line, so a wrap is never read as a new line.
const WRAP_MARK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M5 2v8h7M9.5 7.5 12 10l-2.5 2.5" fill="none" stroke="#8a8f98" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}")`

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
export const PAGE_CSS = `
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

.tr-app { display: flex; flex-direction: column; height: 100%; min-width: 800px; }
.tr-loading { padding: 32px; color: var(--tr-muted); }
.tr-empty { padding: 24px 16px; }
.tr-banner {
  padding: 8px 16px; background: var(--tr-danger-bg); color: var(--tr-danger);
  border-bottom: 1px solid var(--tr-border); font-weight: 600;
}
.tr-notice {
  display: flex; gap: 12px; align-items: center; padding: 6px 16px;
  background: var(--tr-warn-bg); color: var(--tr-warn); border-bottom: 1px solid var(--tr-border);
}

.tr-header {
  display: flex; align-items: flex-start; gap: 24px; padding: 12px 16px;
  border-bottom: 1px solid var(--tr-border); background: var(--tr-bg-2);
}
.tr-header-main { flex: 1; min-width: 0; }
.tr-header h1 { font-size: 18px; }
.tr-header-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; }
.tr-branch { color: var(--tr-muted); }
.tr-attention { display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
.tr-attention-item {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px;
  border: 1px solid transparent; border-radius: 12px; background: none;
  font-size: 12px; color: var(--tr-muted); white-space: nowrap;
}
.tr-attention-item strong { margin-left: auto; padding-left: 6px; }
button.tr-attention-item:not(:disabled) { cursor: pointer; }
.tr-attention-item--alert { background: var(--tr-warn-bg); color: var(--tr-warn); border-color: var(--tr-warn); font-weight: 600; }
.tr-attention-item--alert:hover { filter: brightness(0.97); }
.tr-attention-item--live { background: var(--tr-busy-bg); color: var(--tr-busy); }
.tr-attention-item .tr-spinner { width: 8px; height: 8px; border-width: 1.5px; }
.tr-counts { display: flex; gap: 16px; }
.tr-counts > div { text-align: center; }
.tr-counts dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--tr-muted); }
.tr-counts dd { margin: 0; font-size: 18px; font-weight: 600; }
.tr-header-end { display: flex; flex-direction: column; align-items: flex-end; justify-content: space-between; align-self: stretch; gap: 6px; }
.tr-version { font-size: 11px; color: var(--tr-muted); white-space: nowrap; }
.tr-theme-toggle {
  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  padding: 0; border: 1px solid transparent; border-radius: var(--tr-radius);
  background: none; color: var(--tr-muted); cursor: pointer;
}
.tr-theme-toggle:hover { color: var(--tr-text); border-color: var(--tr-border); background: var(--tr-bg-3); }
.tr-theme-toggle:focus-visible { outline: 2px solid var(--tr-accent); outline-offset: 1px; }
.tr-header-tools { display: flex; gap: 6px; }
a.tr-theme-toggle { text-decoration: none; }
.tr-theme-toggle[aria-current="page"] { color: var(--tr-accent); border-color: var(--tr-accent); background: var(--tr-accent-weak); }

.tr-settings { max-width: 900px; padding: 20px 24px 40px; display: flex; flex-direction: column; gap: 28px; overflow: auto; }
.tr-settings-head { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.tr-settings-head h2 { font-size: 20px; font-weight: 700; }
.tr-settings-back { display: inline-flex; align-items: center; gap: 4px; }
.tr-settings .tr-notice { border: 1px solid var(--tr-border); border-radius: var(--tr-radius); }
.tr-settings .tr-section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--tr-muted); }
.tr-setting { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 8px 24px; padding: 14px 0; }
.tr-setting + .tr-setting { border-top: 1px solid var(--tr-border); }
.tr-setting-label { font-weight: 600; }
.tr-setting-help { margin-top: 2px; font-size: 13px; color: var(--tr-muted); }
.tr-setting-control { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.tr-setting-value { line-height: 32px; }
.tr-setting-default { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--tr-muted); }
.tr-setting-default .tr-btn--link { font-size: 12px; }
.tr-setting-lock { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--tr-muted); }
.tr-segment { display: inline-flex; gap: 6px; }
.tr-settings .tr-input { height: 32px; padding: 0 10px; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg); }
.tr-settings .tr-input:focus { outline: none; border-color: var(--tr-accent); }
.tr-settings .tr-text { width: 100%; max-width: 380px; min-width: 0; flex: none; }
.tr-settings .tr-number { width: 88px; min-width: 0; flex: none; }
.tr-checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 16px; width: 100%; }
.tr-checks label { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; }
.tr-checks .tr-check { margin: 0; accent-color: var(--tr-accent); }
.tr-settings .tr-input:disabled, .tr-checks .tr-check:disabled, .tr-segment .tr-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.tr-settings-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding-top: 16px; border-top: 1px solid var(--tr-border); }

.tr-chip {
  display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 10px;
  font-size: 11.5px; font-weight: 600; white-space: nowrap; text-decoration: none;
  background: var(--tr-bg-3); color: var(--tr-muted);
}
.tr-chip--ours { background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-chip--theirs { background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-chip--warn { background: var(--tr-warn-bg); color: var(--tr-warn); }
.tr-chip--live { background: var(--tr-accent-weak); color: var(--tr-accent); gap: 6px; }
.tr-chip--live .tr-spinner { width: 8px; height: 8px; border-width: 1.5px; }
.tr-unverified { opacity: 0.55; }
.tr-progress { display: flex; flex-direction: column; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--tr-border); font-size: 13px; }
.tr-progress-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.tr-progress-title { font-weight: 700; }
.tr-progress-ok { color: var(--tr-auto); flex: none; }
.tr-progress-warn { color: var(--tr-warn); font-weight: 600; }
.tr-progress-bar { flex: 0 1 200px; height: 6px; border-radius: 3px; background: var(--tr-bg-3); overflow: hidden; }
.tr-progress-bar > span { display: block; height: 100%; border-radius: 3px; background: var(--tr-accent); }
.tr-progress-toggle { margin-left: auto; font-size: 13px; }
.tr-progress-rows { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: start; gap: 8px 16px; }
.tr-progress-label { padding-top: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--tr-muted); }
.tr-lenses { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.tr-lens { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--tr-border); border-radius: 999px; background: var(--tr-bg); font-size: 12px; font-weight: 600; white-space: nowrap; }
.tr-lens-icon { flex: none; }
.tr-lens--done { color: var(--tr-muted); }
.tr-lens--done .tr-lens-icon { color: var(--tr-auto); }
.tr-lens--running { border-color: var(--tr-accent); background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-lens--failed { border-color: var(--tr-danger); background: var(--tr-danger-bg); color: var(--tr-danger); }
.tr-lens .tr-spinner { width: 9px; height: 9px; border-width: 1.5px; }
.tr-lens-count { min-width: 14px; padding: 0 5px; border-radius: 8px; background: var(--tr-bg-3); color: var(--tr-muted); font-size: 11px; font-weight: 600; text-align: center; }
.tr-lens-rows { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; border: 1px solid var(--tr-border); border-radius: 8px; overflow: hidden; }
.tr-lens-row { display: grid; grid-template-columns: 14px minmax(90px, max-content) minmax(0, 1fr) max-content; align-items: center; gap: 4px 12px; padding: 8px 12px; background: var(--tr-bg); }
.tr-lens-row + .tr-lens-row { border-top: 1px solid var(--tr-border); }
.tr-lens-row .tr-spinner { width: 9px; height: 9px; border-width: 1.5px; }
.tr-lens-mark { font-size: 12px; font-weight: 700; text-align: center; }
.tr-lens-mark--ready { color: var(--tr-auto); }
.tr-lens-mark--failed { color: var(--tr-danger); }
.tr-lens-row-name { font-weight: 600; }
.tr-lens-row-source { overflow: hidden; color: var(--tr-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.tr-lens-row-state { color: var(--tr-muted); font-size: 12px; }
.tr-lens-row-state--updated { color: var(--tr-accent); font-weight: 600; }
.tr-lens-row--failed .tr-lens-row-state { color: var(--tr-danger); font-weight: 600; }
.tr-lens-row-reason { grid-column: 2 / -1; margin: 0; color: var(--tr-danger); font-size: 12.5px; }
.tr-recipe-lenses { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; width: 100%; }
.tr-recipe-lenses li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font-size: 13px; }
.tr-recipe-lenses code { color: var(--tr-muted); font-size: 12px; }
.tr-recipe-problem { color: var(--tr-danger); font-size: 12.5px; }
.tr-import { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 10px 12px; border: 1px solid var(--tr-border); border-radius: 8px; }
.tr-import-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.tr-now { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 0; padding: 4px 0 0; list-style: none; }
.tr-now li { display: contents; }
.tr-now-who { font-weight: 600; white-space: nowrap; }
.tr-reports { margin: 0; padding: 0; list-style: none; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); overflow: hidden; }
.tr-report + .tr-report { border-top: 1px solid var(--tr-border); }
.tr-report-row { display: grid; grid-template-columns: 14px minmax(90px, max-content) max-content minmax(0, 1fr) max-content; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 8px 12px; border: 0; background: var(--tr-bg); color: var(--tr-text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.tr-report-row:hover, .tr-report-row[aria-expanded="true"] { background: var(--tr-bg-2); }
.tr-report-row .tr-lens-icon { color: var(--tr-auto); }
.tr-report-row .tr-spinner { width: 9px; height: 9px; border-width: 1.5px; }
.tr-report-row .tr-lens-icon[aria-label="stopped"] { color: var(--tr-danger); }
.tr-report-lens { font-weight: 700; }
.tr-report-verdict { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 10px; font-size: 11.5px; font-weight: 600; white-space: nowrap; background: var(--tr-bg-3); color: var(--tr-muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.tr-report-verdict--found, .tr-report-verdict--running { background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-report-verdict--failed { background: var(--tr-danger-bg); color: var(--tr-danger); }
.tr-report-gist { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tr-muted); }
.tr-report-looked { font-size: 12px; color: var(--tr-muted); white-space: nowrap; }
.tr-report-body { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 24px; padding: 12px 12px 16px 38px; background: var(--tr-bg-2); border-top: 1px dashed var(--tr-border); }
.tr-report-h { margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--tr-muted); }
.tr-report-findings { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.tr-report-findings li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tr-report-findings .tr-btn--link { text-align: left; }
.tr-chip--check-verified { background: var(--tr-auto-bg); color: var(--tr-auto); }
.tr-chip--check-amended { background: var(--tr-warn-bg); color: var(--tr-warn); }
.tr-chip--check-verifying { background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-report-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; color: var(--tr-muted); overflow-wrap: anywhere; }
.tr-report-more { margin-top: 6px; font-size: 12.5px; }
@media (max-width: 720px) {
  .tr-lens-row { grid-template-columns: 14px minmax(0, 1fr) max-content; }
  .tr-lens-row-source { grid-row: 2; grid-column: 2 / -1; }
  .tr-report-row { grid-template-columns: 14px minmax(0, 1fr) max-content; }
  .tr-report-gist, .tr-report-looked { display: none; }
  .tr-report-body { grid-template-columns: minmax(0, 1fr); padding-left: 12px; }
}
.tr-agent-step { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tr-muted); }
/* One rule per class of GROUP_CLASSES (domain.ts); the label still reads without the colour. */
.tr-chip--to-do { background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-chip--in-progress { background: var(--tr-busy-bg); color: var(--tr-busy); }
.tr-chip--needs-you { background: var(--tr-warn-bg); color: var(--tr-warn); }
.tr-chip--done { background: var(--tr-auto-bg); color: var(--tr-auto); }
.tr-chip--set-aside { background: transparent; color: var(--tr-muted); box-shadow: inset 0 0 0 1px var(--tr-border); }
.tr-chip--bucket-review { background: var(--tr-review-bg); color: var(--tr-review); }
.tr-chip--bucket-auto { background: var(--tr-auto-bg); color: var(--tr-auto); }
.tr-chip--tag-question { background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-chip--tag-suggestion { background: var(--tr-bg-3); color: var(--tr-text); }

.tr-summary { border-bottom: 1px solid var(--tr-border); }
.tr-summary > summary { padding: 6px 16px; cursor: pointer; font-weight: 600; color: var(--tr-muted); font-size: 13px; }
.tr-summary-body { max-height: 38vh; overflow: auto; padding: 4px 16px 12px; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 24px; }
.tr-summary-body h3 { font-size: 13px; margin-bottom: 4px; }
.tr-summary-body ul { margin: 0; padding-left: 20px; }
.tr-summary-line { display: flex; align-items: center; gap: 8px; padding: 6px 16px; font-weight: 600; color: var(--tr-muted); font-size: 13px; }
.tr-summary > summary > span { margin-left: 8px; }
.tr-summary-hint { font-weight: 400; }
.tr-summary-ready { display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border-radius: 999px; background: var(--tr-accent-weak); color: var(--tr-accent); font-size: 11.5px; }
.tr-shimmer { display: flex; gap: 6px; flex: 1; max-width: 360px; }
.tr-shimmer i { height: 8px; flex: 1; border-radius: 4px; background: linear-gradient(90deg, var(--tr-bg-3) 25%, var(--tr-bg-2) 50%, var(--tr-bg-3) 75%); background-size: 200% 100%; animation: tr-shine 1.6s linear infinite; }
@keyframes tr-shine { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.tr-summary--landed { animation: tr-land 2.4s ease-out; }
@keyframes tr-land { from { background: var(--tr-accent-weak); } to { background: transparent; } }
@media (prefers-reduced-motion: reduce) { .tr-shimmer i, .tr-summary--landed { animation: none; } }
.tr-summary-body .tr-praise { align-self: start; padding: 10px 12px; border-radius: var(--tr-radius); background: var(--tr-auto-bg); }
.tr-praise h3 { display: flex; align-items: center; gap: 6px; color: var(--tr-auto); }
.tr-summary-body .tr-praise ul { list-style: none; padding-left: 0; }
.tr-praise li { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 6px; }
.tr-praise li > svg { margin-top: 3px; color: var(--tr-auto); }
.tr-md > * { margin: 0 0 8px; }
.tr-md > :last-child { margin-bottom: 0; }
.tr-md ul, .tr-md ol { padding-left: 20px; }
.tr-md h2, .tr-md h3, .tr-md h4 { font-size: 13px; margin-top: 8px; }
.tr-md pre { padding: 8px 10px; background: var(--tr-bg-2); border: 1px solid var(--tr-border); border-radius: var(--tr-radius); overflow: auto; font-size: 12.5px; }
.tr-md li { margin: 2px 0; }
/* A chip cut by a line break keeps its padding and border on each line; a long name breaks rather than overflows. */
.tr-md :not(pre) > code { padding: 0 0.3em; background: var(--tr-bg-3); border: 1px solid var(--tr-border); border-radius: 4px; overflow-wrap: anywhere; -webkit-box-decoration-break: clone; box-decoration-break: clone; }

.tr-batch {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; padding: 8px 16px;
  border-bottom: 1px solid var(--tr-border);
}
.tr-batch-group { display: inline-flex; align-items: center; gap: 6px; }
.tr-count {
  display: inline-block; min-width: 18px; margin-left: 6px; padding: 0 5px; border-radius: 9px;
  background: var(--tr-bg-3); color: var(--tr-muted); font-size: 11px; text-align: center;
}
.tr-btn--primary .tr-count { background: rgba(255,255,255,0.25); color: inherit; }
.tr-batch-end { margin-left: auto; }
.tr-master {
  display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0;
  border: 1.5px solid var(--tr-muted); border-radius: 4px; background: var(--tr-bg); color: var(--tr-on-accent); cursor: pointer;
}
.tr-master svg { fill: none; stroke: currentColor; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
.tr-master[aria-checked="true"], .tr-master[aria-checked="mixed"] { background: var(--tr-accent); border-color: var(--tr-accent); }
.tr-master:disabled, .tr-pick:disabled { cursor: default; opacity: 0.45; }
.tr-master:focus-visible, .tr-pick:focus-visible { outline: 2px solid var(--tr-accent); outline-offset: 2px; }
.tr-selection { min-width: 24ch; font-weight: 600; font-variant-numeric: tabular-nums; }
.tr-picks { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.tr-pick {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--tr-border);
  border-radius: 999px; background: var(--tr-bg); color: var(--tr-text); font-size: 13px; font-weight: 600; cursor: pointer;
}
.tr-pick:hover:not(:disabled) { border-color: var(--tr-accent); }
.tr-pick[aria-pressed="true"] { background: var(--tr-accent-weak); border-color: var(--tr-accent); color: var(--tr-accent); }
.tr-pick-count {
  min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--tr-bg-3); color: var(--tr-muted);
  font-size: 11px; text-align: center;
}
.tr-pick[aria-pressed="true"] .tr-pick-count { background: var(--tr-bg); color: var(--tr-accent); }
.tr-clear { font-size: 13px; }
.tr-confirm {
  display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px;
  background: var(--tr-warn-bg); color: var(--tr-warn); border-radius: var(--tr-radius);
}

.tr-confirm-post ul { margin: 4px 0 0; padding-left: 18px; }

.tr-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: var(--tr-radius);
  border: 1px solid var(--tr-border); background: var(--tr-bg); cursor: pointer; font-weight: 500; white-space: nowrap;
}
.tr-btn:hover { background: var(--tr-bg-2); }
.tr-btn:disabled { cursor: default; opacity: 0.45; }
.tr-btn--primary { background: var(--tr-accent); color: var(--tr-on-accent); border-color: var(--tr-accent); }
.tr-btn--primary:hover { filter: brightness(1.08); background: var(--tr-accent); }
.tr-btn--secondary { background: var(--tr-accent-weak); color: var(--tr-accent); border-color: transparent; }
.tr-btn--danger { color: var(--tr-danger); }
.tr-btn--danger:hover { background: var(--tr-danger-bg); }
.tr-btn--small { height: 26px; padding: 0 10px; font-size: 13px; }
.tr-btn--link { height: auto; padding: 0; border: 0; background: none; color: var(--tr-accent); font-weight: 500; }
.tr-btn--link:hover { background: none; text-decoration: underline; }

.tr-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); }
.tr-main--diff { grid-template-columns: minmax(220px, 280px) minmax(0, 3fr) minmax(380px, 2fr); }
.tr-list-pane { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--tr-border); }
.tr-view { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--tr-border); }
.tr-view-reason { flex-basis: 100%; font-size: 11.5px; }
.tr-pad { padding: 12px; }
.tr-list { flex: 1; overflow: auto; margin: 0; padding: 0; list-style: none; outline: none; }
.tr-list:focus-visible { box-shadow: inset 0 0 0 2px var(--tr-accent); }
.tr-keys { padding: 6px 12px; font-size: 11.5px; border-top: 1px solid var(--tr-border); }
.tr-bucket { list-style: none; }
.tr-bucket-title { display: flex; align-items: center; gap: 8px; padding: 10px 12px 4px; font-size: 13px; }
.tr-bucket-dot { width: 9px; height: 9px; border-radius: 50%; }
.tr-bucket--review .tr-bucket-dot { background: var(--tr-review); }
.tr-bucket--auto .tr-bucket-dot { background: var(--tr-auto); }
.tr-bucket--review .tr-bucket-title { color: var(--tr-review); }
.tr-bucket--auto .tr-bucket-title { color: var(--tr-auto); }
.tr-topic { margin: 0; padding: 0; list-style: none; }
.tr-topic-title { padding: 6px 12px 2px; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--tr-muted); }
.tr-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 12px 6px 10px; border-left: 3px solid transparent; }
.tr-item--focused { background: var(--tr-bg-2); border-left-color: var(--tr-accent); }
.tr-item--open { background: var(--tr-accent-weak); }
.tr-check { margin: 4px 0 0; }
.tr-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; }
.tr-item-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tr-item-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tr-item-anchor { font-family: var(--tr-mono); font-size: 11.5px; color: var(--tr-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tr-detail-pane { overflow: auto; min-height: 0; }

.tr-files { flex: 1; overflow: auto; margin: 0; padding: 4px 0; list-style: none; }
.tr-file-item { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 5px 12px; border: 0; background: none; text-align: left; cursor: pointer; }
.tr-file-item:hover { background: var(--tr-bg-2); }
.tr-file-item--reading { background: var(--tr-accent-weak); box-shadow: inset 3px 0 0 var(--tr-accent); }
.tr-file-item--reading .tr-file-base { font-weight: 600; }
.tr-file-name { display: flex; min-width: 0; font-family: var(--tr-mono); font-size: 12px; }
.tr-file-dir { color: var(--tr-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tr-file-base { white-space: nowrap; }
.tr-file-meta { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--tr-muted); }
.tr-file-meta .tr-count { margin-left: 0; background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-stat { font-family: var(--tr-mono); font-size: 11.5px; white-space: nowrap; }
.tr-stat-add { color: var(--tr-auto); }
.tr-stat-del { color: var(--tr-review); }

.tr-diff-pane { overflow: auto; min-height: 0; border-right: 1px solid var(--tr-border); }
.tr-diff { display: flex; flex-direction: column; gap: 20px; padding: 12px 16px 48px; }
.tr-file { display: flex; flex-direction: column; gap: 6px; }
.tr-file-head {
  position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 6px 0; background: var(--tr-bg); border-bottom: 1px solid var(--tr-border);
}
.tr-file-path { font-weight: 600; }
.tr-markers { display: flex; flex-direction: column; gap: 2px; padding: 3px 8px 3px calc(var(--tr-digits, 2ch) + 3ch); font-family: var(--tr-font); background: var(--tr-bg); border-top: 1px solid var(--tr-border); border-bottom: 1px solid var(--tr-border); }
.tr-file > .tr-markers { padding-left: 0; border: 0; }
.tr-marker { display: flex; align-items: center; gap: 8px; padding: 2px 6px; border-left: 3px solid transparent; border-radius: var(--tr-radius); }
.tr-marker--focused { background: var(--tr-bg-2); border-left-color: var(--tr-accent); }
.tr-marker--open { background: var(--tr-accent-weak); }
.tr-marker .tr-check { margin: 0; }
.tr-marker-main { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; font: 13px/1.4 var(--tr-font); }
.tr-marker-title { font-weight: 500; }
.tr-comment-mark { display: inline-flex; flex: none; color: var(--tr-accent); }
.tr-discussion-mark { display: inline-flex; flex: none; align-items: center; gap: 3px; font-size: 12px; font-weight: 600; color: var(--tr-accent); font-variant-numeric: tabular-nums; }
.tr-marker-note { color: var(--tr-warn); font-size: 12px; }
.tr-detail { display: flex; flex-direction: column; gap: 16px; padding: 16px 20px 32px; max-width: 1100px; }
.tr-detail-head h2 { font-size: 17px; }
.tr-detail-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; }
.tr-anchor { display: inline-flex; align-items: center; gap: 6px; }
.tr-section { display: flex; flex-direction: column; gap: 8px; }
.tr-section:empty { display: none; }
.tr-section-head { display: flex; align-items: baseline; justify-content: space-between; }
.tr-section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--tr-muted); }
.tr-pwf { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; }
.tr-pwf dt { font-weight: 600; color: var(--tr-muted); }
.tr-pwf dd { margin: 0; }
.tr-related > summary { cursor: pointer; color: var(--tr-muted); font-weight: 500; }
.tr-related-item { margin-top: 8px; }
.tr-related-anchor { display: block; margin-bottom: 4px; color: var(--tr-muted); }

.tr-code {
  font: 12.5px/1.55 var(--tr-mono); border: 1px solid var(--tr-border); border-radius: var(--tr-radius);
  background: var(--tr-bg-2); overflow: hidden; tab-size: 4;
}
.tr-row { display: grid; grid-template-columns: calc(var(--tr-digits, 2ch) + 2ch) minmax(0, 1fr); }
.tr-gutter {
  position: relative; text-align: right; padding: 0 1ch; color: var(--tr-muted); user-select: none;
  background: var(--tr-bg-3);
}
.tr-gutter::after {
  content: ''; position: absolute; left: 0; right: 0; top: 1lh; bottom: 0;
  background: ${WRAP_MARK} center top / 1.1em 1lh repeat-y;
}
.tr-text { padding: 0 1ch; white-space: pre-wrap; overflow-wrap: anywhere; }
.tr-sign { color: var(--tr-muted); }
.tr-row--added { background: var(--tr-added); }
.tr-row--removed { background: var(--tr-removed); }
.tr-row--header, .tr-row--meta { color: var(--tr-muted); font-style: italic; }
.tr-row--marked .tr-text { background: var(--tr-mark-line); }
.tr-row--anchor .tr-gutter { color: var(--tr-text); font-weight: 600; box-shadow: inset 3px 0 0 var(--tr-accent); }
.tr-code mark { background: var(--tr-mark); color: inherit; border-radius: 2px; }
.tr-hunk + .tr-hunk { border-top: 1px solid var(--tr-border); }
.tr-gap {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 2px 14px; padding: 3px 12px;
  background: var(--tr-bg-3); border-top: 1px solid var(--tr-border); border-bottom: 1px solid var(--tr-border);
  color: var(--tr-muted); font: 12px/1.6 var(--tr-font);
}
.tr-gap:first-child { border-top: 0; }
.tr-gap:last-child { border-bottom: 0; }
.tr-gap-sep { color: var(--tr-border); }
.tr-gap-action {
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px; border: 0; border-radius: 4px;
  background: none; color: var(--tr-accent); font: inherit; font-weight: 600; cursor: pointer;
}
.tr-gap-action svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.tr-gap-action:hover:not(:disabled) { text-decoration: underline; }
.tr-gap-action:focus-visible { outline: 2px solid var(--tr-accent); outline-offset: 1px; }
.tr-gap-action:disabled { color: var(--tr-muted); opacity: 0.6; cursor: default; }
.tr-gap-reason { color: var(--tr-warn); font-weight: 600; }
.tr-tok--keyword { color: var(--tr-code-keyword); }
.tr-tok--string { color: var(--tr-code-string); }
.tr-tok--number { color: var(--tr-code-number); }
.tr-tok--comment { color: var(--tr-code-comment); font-style: italic; }
.tr-tok--tag, .tr-tok--key { color: var(--tr-code-tag); }
.tr-tok--attr { color: var(--tr-code-attr); }
.tr-callout {
  position: relative; display: flex; margin: 0 0 4px;
  padding-left: min(calc(var(--tr-digits, 2ch) + 3ch + var(--tr-sign, 0ch) + var(--tr-col, 0) * 1ch), 50%);
}
.tr-callout::before {
  content: ''; position: absolute; top: 0; height: 100%; width: 2px; background: var(--tr-warn);
  left: min(calc(var(--tr-digits, 2ch) + 3ch + var(--tr-sign, 0ch) + var(--tr-col, 0) * 1ch), 50%);
}
.tr-callout-body {
  display: block; max-width: 64ch; margin: 2px 0 2px 2px; padding: 3px 8px;
  font: 12.5px/1.4 var(--tr-font); background: var(--tr-warn-bg); color: var(--tr-warn);
  border-radius: 0 4px 4px 0; white-space: normal;
}

.tr-diagram { margin: 0; }
.tr-diagram-svg, .tr-diagram-text {
  max-height: 360px; overflow: auto; padding: 8px; margin: 0;
  border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg-2);
}
.tr-diagram-svg svg { max-width: 100%; height: auto; display: block; }
.tr-diagram-text { font: 12.5px/1.45 var(--tr-mono); white-space: pre; }
.tr-diagram figcaption { margin-top: 4px; font-size: 12.5px; color: var(--tr-muted); }

.tr-outcome { padding: 8px 10px; background: var(--tr-bg-2); border-radius: var(--tr-radius); }
.tr-pending { display: flex; align-items: center; gap: 8px; }
.tr-changed { margin: 4px 0 0; padding-left: 20px; }
.tr-warn { color: var(--tr-warn); }
.tr-fix-changes { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.tr-settled { margin: 0 0 12px; padding: 8px 10px; border-radius: var(--tr-radius); background: var(--tr-bg-2); font-weight: 600; }
.tr-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tr-context { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.tr-inline-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tr-inline-form--column { flex-direction: column; align-items: stretch; }
/* In a column, flex: 1 would size the input's height from nothing: it keeps a button's. */
.tr-inline-form--column .tr-input { flex: none; }
.tr-input { flex: 1; min-width: 240px; height: 30px; padding: 0 10px; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg); }
.tr-textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg); resize: vertical; }
.tr-input:focus, .tr-textarea:focus { outline: none; border-color: var(--tr-accent); }
/* A finding's discussion, after annotant's thread: yours right in the accent, the agent's left. */
.tr-dsc { display: flex; flex-direction: column; gap: 14px; padding: 16px; border: 1px solid var(--tr-border); border-radius: 12px; background: var(--tr-bg-2); }
.tr-dsc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tr-dsc-head h3 { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--tr-muted); }
.tr-dsc-note { font-size: 12px; color: var(--tr-muted); }
.tr-dsc-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 8px 0; text-align: center; }
.tr-dsc-empty p { margin: 0; max-width: 380px; }
.tr-dsc-empty-icon { color: var(--tr-accent); }
.tr-dsc-empty-title { font-size: 15px; font-weight: 700; }
.tr-suggest { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; padding-top: 4px; }
.tr-suggest button { height: 30px; padding: 0 12px; border: 1px solid var(--tr-border); border-radius: 999px; background: var(--tr-bg); color: var(--tr-text); font: inherit; font-size: 13px; cursor: pointer; }
.tr-suggest button:hover { border-color: var(--tr-accent); }
.tr-chat { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 16px; }
.tr-msg { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tr-msg--you { align-items: flex-end; padding-left: 48px; }
.tr-msg--agent { align-items: stretch; }
.tr-msg-who { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--tr-muted); }
/* Long words, URLs and code break inside the bubble rather than spilling out of it. */
.tr-bubble { max-width: 100%; padding: 8px 14px; border-radius: 14px; overflow-wrap: anywhere; }
.tr-bubble--you { background: var(--tr-accent); color: var(--tr-on-accent); border-bottom-right-radius: 4px; white-space: pre-wrap; }
.tr-bubble--agent { background: var(--tr-bg); border: 1px solid var(--tr-border); border-bottom-left-radius: 4px; }
.tr-bubble--agent > :first-child { margin-top: 0; }
.tr-bubble--agent > :last-child { margin-bottom: 0; }
/* One line, the agent's latest step: a pulsing icon, then what it does. */
.tr-step-now { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--tr-radius); background: var(--tr-accent-weak); color: var(--tr-accent); font-size: 13px; font-weight: 600; white-space: nowrap; }
.tr-step-now > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tr-step-icon { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--tr-accent); color: var(--tr-on-accent); animation: tr-pulse 1.6s ease-out infinite; }
@keyframes tr-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--tr-accent) 45%, transparent); } 70%, 100% { box-shadow: 0 0 0 7px transparent; } }
@media (prefers-reduced-motion: reduce) { .tr-step-icon { animation: none; } }
/* What the agent proposes: one card each, its action on its right. */
.tr-proposals { display: flex; flex-direction: column; gap: 8px; }
.tr-proposal { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--tr-warn) 30%, var(--tr-border)); border-radius: var(--tr-radius); background: var(--tr-bg); }
.tr-proposal-icon { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; background: var(--tr-warn-bg); color: var(--tr-warn); }
.tr-proposal-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.tr-proposal-body { color: var(--tr-muted); overflow-wrap: anywhere; }
.tr-proposal-body p { margin: 0; }
.tr-proposal > .tr-btn { flex-shrink: 0; }
.tr-proposal--editing { flex-direction: column; align-items: stretch; border-color: var(--tr-accent); }
.tr-proposal-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--tr-muted); }
.tr-proposal-foot strong { font-size: 13px; color: var(--tr-text); }
.tr-clamp { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; white-space: pre-wrap; }
.tr-taken { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg); font-size: 13px; color: var(--tr-muted); }
.tr-taken svg { flex-shrink: 0; color: var(--tr-auto); }
.tr-unanswered { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: var(--tr-radius); background: var(--tr-danger-bg); color: var(--tr-danger); font-size: 13px; }
.tr-unanswered svg { flex-shrink: 0; margin-top: 1px; }
.tr-unanswered-body { display: flex; flex-direction: column; gap: 6px; }
/* The message box: grows with its text up to its max-height, then scrolls. */
.tr-composer { display: flex; align-items: flex-end; gap: 8px; padding: 8px 8px 8px 12px; border: 1px solid var(--tr-border); border-radius: 12px; background: var(--tr-bg); transition: border-color .15s; }
.tr-composer:focus-within { border-color: var(--tr-accent); }
.tr-composer textarea { flex: 1; min-width: 0; min-height: 36px; max-height: 160px; padding: 7px 0; border: 0; outline: none; resize: none; overflow-y: auto; background: transparent; font: inherit; font-size: 15px; line-height: 1.45; color: var(--tr-text); }
.tr-composer textarea::placeholder { color: var(--tr-muted); }
.tr-send { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px; background: var(--tr-accent); color: var(--tr-on-accent); cursor: pointer; }
.tr-send:disabled { background: var(--tr-accent-weak); color: var(--tr-muted); cursor: default; }
.tr-composer-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 8px; font-size: 12px; color: var(--tr-muted); }
.tr-composer-foot kbd { font: inherit; font-weight: 600; color: var(--tr-text); }
.tr-dsc-closed { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; border: 1px dashed var(--tr-border); border-radius: 12px; font-size: 13px; color: var(--tr-muted); }
.tr-btn--on { background: var(--tr-accent-weak); border-color: var(--tr-accent); color: var(--tr-accent); }
.tr-btn svg { flex-shrink: 0; }
.tr-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tr-ask { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: var(--tr-warn-bg); border-radius: var(--tr-radius); }
.tr-ask-text { font-weight: 600; }
.tr-options { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.tr-option { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.tr-option input { margin: 3px 0 0; }
/* A PR/MR thread: the reviewer's comment, then its replies, each under its author. */
.tr-thread { display: flex; flex-direction: column; gap: 8px; }
.tr-thread-comments { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.tr-thread-comment { padding: 8px 12px; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg-2); overflow-wrap: anywhere; }
.tr-thread-comment + .tr-thread-comment { margin-left: 16px; }
.tr-thread-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 4px; font-size: 13px; }
.tr-thread-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.tr-thread-head--resolved { color: var(--tr-auto); font-weight: 600; }
.tr-thread-comment--mine { background: var(--tr-accent-weak); border-color: var(--tr-accent); box-shadow: inset 3px 0 0 var(--tr-accent); }
.tr-thread-comment--sending { border-style: dashed; }
.tr-thread-comment--failed { background: var(--tr-danger-bg); border-color: var(--tr-danger); box-shadow: inset 3px 0 0 var(--tr-danger); }
.tr-thread-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0 0; font-size: 12px; }
.tr-chip--you { height: 18px; padding: 0 7px; font-size: 11px; background: var(--tr-accent); color: var(--tr-on-accent); }

.tr-steps { max-height: 260px; overflow: auto; margin: 0; padding: 6px 10px; list-style: none; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg-2); font-size: 13px; }
.tr-step { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.tr-step--failed .tr-step-text { color: var(--tr-danger); }
.tr-step-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--tr-muted); flex-shrink: 0; }
.tr-step--failed .tr-step-dot { background: var(--tr-danger); }
.tr-step-text { font-family: var(--tr-mono); font-size: 12.5px; overflow-wrap: anywhere; }
.tr-spinner {
  width: 10px; height: 10px; flex-shrink: 0; border-radius: 50%;
  border: 2px solid var(--tr-accent-weak); border-top-color: var(--tr-accent);
  animation: tr-spin 0.8s linear infinite;
}
@keyframes tr-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tr-spinner { animation-duration: 2s; } }
.tr-runs { margin: 0; padding: 0; list-style: none; font-size: 13px; display: flex; flex-direction: column; gap: 2px; }
.tr-runs li { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tr-run-id { font-family: var(--tr-mono); color: var(--tr-muted); }

@media (max-width: 1100px) {
  .tr-main { grid-template-columns: 300px minmax(0, 1fr); }
  .tr-main--diff { grid-template-columns: 200px minmax(0, 1fr) 340px; }
  .tr-summary-body { grid-template-columns: 1fr; }
  .tr-header { flex-wrap: wrap; }
}
`
