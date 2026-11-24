// From Annotant's UI kit: its Chip, toned by what it says rather than by a comment's state.
import type { ReactNode } from 'react'

export type ChipTone = 'accent' | 'warn' | 'danger' | 'ok' | 'muted'

/** A pill in the colour of its tone. */
export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`kit-chip kit-chip--${tone}`}>{children}</span>
}

export const CHIP_CSS = `
.kit-chip { display: inline-flex; align-items: center; flex: none; height: 20px; padding: 0 8px; border-radius: 10px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
.kit-chip--accent { background: var(--tr-accent-weak); color: var(--tr-accent); }
.kit-chip--warn { background: var(--tr-warn-bg); color: var(--tr-warn); }
.kit-chip--danger { background: var(--tr-danger-bg); color: var(--tr-danger); }
.kit-chip--ok { background: var(--tr-auto-bg); color: var(--tr-auto); }
.kit-chip--muted { background: var(--tr-bg-3); color: var(--tr-muted); }
`
