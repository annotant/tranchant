// From Annotant's UI kit: its Button, on Tranchant's palette.
import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Filled in the accent, framed on the surface, or text alone. */
  variant?: 'primary' | 'secondary' | 'tertiary'
  /** 28px high instead of 36px. */
  small?: boolean
  /** After the label. */
  icon?: IconName
}

/** A button with a label: `type="button"` unless told otherwise. */
export function Button({
  variant = 'primary',
  small,
  icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`kit-btn kit-btn--${variant}${small ? ' kit-btn--sm' : ''} ${className}`}
      {...props}
    >
      {children}
      {icon && <Icon name={icon} />}
    </button>
  )
}

export const BUTTON_CSS = `
.kit-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 14px; border-radius: var(--tr-radius);
  border: 1px solid transparent; cursor: pointer; font-weight: 600;
  background: var(--tr-accent); color: var(--tr-on-accent); white-space: nowrap;
  text-decoration: none; transition: background .15s, border-color .15s, color .15s;
}
.kit-btn:hover { filter: brightness(0.95); }
.kit-btn:focus-visible { outline: 2px solid var(--tr-accent); outline-offset: 2px; }
.kit-btn:disabled { cursor: default; background: var(--tr-accent-weak); color: var(--tr-muted); }
.kit-btn--secondary { background: var(--tr-bg); color: var(--tr-accent); border-color: var(--tr-border); }
.kit-btn--secondary:hover { filter: none; background: var(--tr-bg-2); border-color: var(--tr-accent); }
.kit-btn--tertiary { background: transparent; color: var(--tr-accent); }
.kit-btn--tertiary:hover { filter: none; background: var(--tr-bg-2); }
.kit-btn--sm { height: 28px; padding: 0 10px; font-size: 13px; }
.kit-btn svg { width: 14px; height: 14px; }
`
