// From Annotant's UI kit: its IconButton, on Tranchant's palette.
import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** Its accessible name and its tooltip. */
  label: string
}

/** A button showing only its icon, its label in the tooltip. */
export function IconButton({ icon, label, className = '', ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`kit-icon-btn ${className}`}
      {...props}
    >
      <Icon name={icon} />
    </button>
  )
}

export const ICON_BUTTON_CSS = `
.kit-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0; border: 1px solid transparent; border-radius: var(--tr-radius);
  background: transparent; color: var(--tr-muted); cursor: pointer;
}
.kit-icon-btn:hover { color: var(--tr-text); border-color: var(--tr-border); background: var(--tr-bg-3); }
.kit-icon-btn:focus-visible { outline: 2px solid var(--tr-accent); outline-offset: 1px; }
.kit-icon-btn svg { width: 16px; height: 16px; }
`
