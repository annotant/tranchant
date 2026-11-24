// The dashboard's stylesheet, injected by main.tsx: the kit's ground, then its own rules.
import { KIT_CSS } from '../kit'

export const DASHBOARD_CSS = `${KIT_CSS}
.tr-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.db-app { display: flex; flex-direction: column; min-height: 100%; }
.db-top { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px; padding: 10px 20px; border-bottom: 1px solid var(--tr-border); background: var(--tr-bg-2); }
.db-brand { font-size: 16px; font-weight: 700; }
.db-top-end { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.db-note { padding: 24px 20px; }

.db-body { display: flex; flex-direction: column; gap: 20px; padding: 16px 20px 24px; }
.db-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.db-multi { position: relative; }
.db-multi-btn { font-weight: 500; color: var(--tr-text); }
.db-multi-btn strong { font-weight: 700; }
.db-multi-pop { position: absolute; top: calc(100% + 4px); left: 0; z-index: 5; display: flex; flex-direction: column; width: 280px; max-width: calc(100vw - 32px); max-height: 360px; overflow: auto; padding: 6px; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg); box-shadow: 0 8px 24px rgba(19, 41, 75, .14); }
.db-input { width: 100%; height: 32px; margin-bottom: 4px; padding: 0 10px; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); background: var(--tr-bg); }
.db-input:focus-visible { outline: 2px solid var(--tr-accent); outline-offset: 0; }
.db-multi-item { padding: 6px 8px; border-radius: 6px; }
.db-multi-item:hover { background: var(--tr-bg-2); }
.db-multi-item .kit-checkbox { width: 100%; }
.db-multi-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-multi-count { margin-left: auto; font-size: 12px; white-space: nowrap; }
.db-multi-none { padding: 6px 8px; font-size: 13px; }
.db-multi-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; padding: 6px 2px 2px; border-top: 1px solid var(--tr-border); }
.db-livestat { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 12.5px; color: var(--tr-muted); }
.db-live { width: 8px; height: 8px; border-radius: 50%; background: var(--tr-auto); }
.db-livestat--off .db-live { background: var(--tr-muted); }

.db-group { display: flex; flex-direction: column; gap: 6px; }
.db-group-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; }
.db-group-head .tr-muted { font-weight: 500; font-size: 12.5px; }
.db-group--needs .db-group-head { color: var(--tr-warn); }
.db-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--tr-bg-3); color: var(--tr-text); font-size: 12px; }
.db-rows { margin: 0; padding: 0; list-style: none; border: 1px solid var(--tr-border); border-radius: var(--tr-radius); overflow: hidden; }
.db-row { display: grid; grid-template-columns: 14px minmax(0, 2.3fr) minmax(0, 1.5fr) minmax(0, 1.2fr) 100px; gap: 6px 16px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--tr-border); background: var(--tr-bg); }
.db-row:first-child { border-top: 0; }
.db-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--tr-muted); }
.db-dot--needs { background: var(--tr-warn); }
.db-dot--running { background: var(--tr-accent); }
.db-dot--paused, .db-dot--ready { background: transparent; border: 2px solid var(--tr-accent); }
.db-dot--done { background: var(--tr-auto); }
.db-dot--stopped { background: transparent; border: 2px solid var(--tr-danger); }
.db-what { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.db-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.db-project { flex: none; font-size: 12px; font-weight: 700; color: var(--tr-muted); }
.db-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.db-ref { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--tr-muted); }
.db-link { flex: none; font-size: 12px; font-weight: 600; }
.db-progress { display: flex; flex-direction: column; gap: 5px; min-width: 0; font-size: 13px; }
.db-progress--needs { color: var(--tr-warn); font-weight: 600; }
.db-progress--stopped { color: var(--tr-danger); font-weight: 600; }
.db-bar { width: 100%; max-width: 220px; height: 6px; border-radius: 3px; background: var(--tr-bg-3); overflow: hidden; }
.db-bar > span { display: block; height: 100%; border-radius: 3px; background: var(--tr-accent); }
.db-runs { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 12px; color: var(--tr-muted); }
.db-runs-where { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--tr-mono); font-size: 11.5px; color: var(--tr-text); }
.db-row-actions { display: flex; justify-content: flex-end; }
.db-more { padding: 6px 14px; border-top: 1px solid var(--tr-border); background: var(--tr-bg-2); }
.db-rows > .db-more:first-child { border-top: 0; }

.db-empty { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 640px; margin: 40px auto; padding: 0 16px; }
.db-empty h2 { font-size: 22px; font-weight: 700; }

@media (max-width: 820px) {
  .db-body { padding: 16px; }
  .db-row { grid-template-columns: 14px minmax(0, 1fr); }
  .db-row > .db-progress, .db-row > .db-runs, .db-row > .db-row-actions { grid-column: 2; justify-content: flex-start; }
  .db-livestat { margin-left: 0; }
}
`
