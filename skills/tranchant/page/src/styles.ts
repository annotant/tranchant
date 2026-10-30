// The page's stylesheet, injected by main.tsx: no CSS file to serve.

declare module 'react' {
  interface CSSProperties {
    [variable: `--tr-${string}`]: string | number
  }
}

// A "↳" the gutter repeats under a wrapped line, so a wrap is never read as a new line.
const WRAP_MARK = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M5 2v8h7M9.5 7.5 12 10l-2.5 2.5" fill="none" stroke="#8a8f98" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}")`

export const PAGE_CSS = `
:root {
  color-scheme: light dark;
  --tr-font: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --tr-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  --tr-bg: #ffffff;
  --tr-bg-2: #f6f7f9;
  --tr-bg-3: #eceef2;
  --tr-text: #1c2129;
  --tr-muted: #5f6b7a;
  --tr-border: #d9dde3;
  --tr-accent: #2b6cb0;
  --tr-accent-weak: #e7f0fb;
  --tr-on-accent: #ffffff;
  --tr-review: #b3423f;
  --tr-review-bg: #fbecec;
  --tr-auto: #2f7d4f;
  --tr-auto-bg: #e8f5ec;
  --tr-warn: #8a5a0c;
  --tr-warn-bg: #fff4dc;
  --tr-danger: #b3423f;
  --tr-danger-bg: #fbecec;
  --tr-mark: rgba(255, 196, 0, 0.45);
  --tr-mark-line: rgba(255, 196, 0, 0.16);
  --tr-added: #e6f6ea;
  --tr-removed: #fbe9e9;
  --tr-radius: 6px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --tr-bg: #15181d;
    --tr-bg-2: #1c2026;
    --tr-bg-3: #242931;
    --tr-text: #e6e9ee;
    --tr-muted: #9aa4b2;
    --tr-border: #333a44;
    --tr-accent: #6aa7e8;
    --tr-accent-weak: #1f3147;
    --tr-on-accent: #0d1b2a;
    --tr-review: #e9807c;
    --tr-review-bg: #3a2222;
    --tr-auto: #7ccf98;
    --tr-auto-bg: #1f3a2a;
    --tr-warn: #f0c36b;
    --tr-warn-bg: #3a2f14;
    --tr-danger: #e9807c;
    --tr-danger-bg: #3a2222;
    --tr-mark: rgba(255, 196, 0, 0.35);
    --tr-mark-line: rgba(255, 196, 0, 0.12);
    --tr-added: #1f3a2a;
    --tr-removed: #3a2222;
  }
}

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
.tr-counts { display: flex; gap: 16px; }
.tr-counts > div { text-align: center; }
.tr-counts dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--tr-muted); }
.tr-counts dd { margin: 0; font-size: 18px; font-weight: 600; }
.tr-version { font-size: 11px; color: var(--tr-muted); align-self: flex-end; white-space: nowrap; }

.tr-chip {
  display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 10px;
  font-size: 11.5px; font-weight: 600; white-space: nowrap; text-decoration: none;
  background: var(--tr-bg-3); color: var(--tr-muted);
}
.tr-chip--ours, .tr-chip--open { background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-chip--theirs { background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-chip--warn { background: var(--tr-warn-bg); color: var(--tr-warn); }
.tr-chip--queued, .tr-chip--working, .tr-chip--asking { background: var(--tr-warn-bg); color: var(--tr-warn); }
.tr-chip--fixed, .tr-chip--posted { background: var(--tr-auto-bg); color: var(--tr-auto); }
.tr-chip--failed, .tr-chip--stopped { background: var(--tr-danger-bg); color: var(--tr-danger); }
.tr-chip--dropped, .tr-chip--skipped { background: var(--tr-bg-3); color: var(--tr-muted); text-decoration: line-through; }
.tr-chip--bucket-review { background: var(--tr-review-bg); color: var(--tr-review); }
.tr-chip--bucket-auto { background: var(--tr-auto-bg); color: var(--tr-auto); }
.tr-chip--tag-question { background: var(--tr-accent-weak); color: var(--tr-accent); }
.tr-chip--tag-suggestion { background: var(--tr-bg-3); color: var(--tr-text); }

.tr-summary { border-bottom: 1px solid var(--tr-border); }
.tr-summary > summary { padding: 6px 16px; cursor: pointer; font-weight: 600; color: var(--tr-muted); font-size: 13px; }
.tr-summary-body { max-height: 38vh; overflow: auto; padding: 4px 16px 12px; display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 24px; }
.tr-summary-body h3 { font-size: 13px; margin-bottom: 4px; }
.tr-summary-body ul { margin: 0; padding-left: 20px; }
.tr-md > * { margin: 0 0 8px; }
.tr-md h2, .tr-md h3, .tr-md h4 { font-size: 13px; margin-top: 8px; }
.tr-md pre { padding: 8px 10px; background: var(--tr-bg-2); border: 1px solid var(--tr-border); border-radius: var(--tr-radius); overflow: auto; font-size: 12.5px; }
.tr-md li { margin: 2px 0; }

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
.tr-confirm {
  display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px;
  background: var(--tr-warn-bg); color: var(--tr-warn); border-radius: var(--tr-radius);
}

.tr-btn {
  display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: var(--tr-radius);
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
.tr-list-pane { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--tr-border); }
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
.tr-row--removed .tr-text { color: var(--tr-muted); }
.tr-row--header, .tr-row--meta { color: var(--tr-muted); font-style: italic; }
.tr-row--marked .tr-text { background: var(--tr-mark-line); }
.tr-row--anchor .tr-gutter { color: var(--tr-text); font-weight: 600; box-shadow: inset 3px 0 0 var(--tr-accent); }
.tr-code mark { background: var(--tr-mark); color: inherit; border-radius: 2px; }
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
.tr-changed { margin: 4px 0 0; padding-left: 20px; }
.tr-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tr-context { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.tr-inline-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tr-inline-form--column { flex-direction: column; align-items: stretch; }
.tr-input { flex: 1; min-width: 240px; height: 30px; padding: 0 10px; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg); }
.tr-textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg); resize: vertical; }
.tr-input:focus, .tr-textarea:focus { outline: none; border-color: var(--tr-accent); }
.tr-ask { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: var(--tr-warn-bg); border-radius: var(--tr-radius); }
.tr-ask-text { font-weight: 600; }
.tr-options { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.tr-option { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.tr-option input { margin: 3px 0 0; }

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
  .tr-summary-body { grid-template-columns: 1fr; }
  .tr-header { flex-wrap: wrap; }
}
`
