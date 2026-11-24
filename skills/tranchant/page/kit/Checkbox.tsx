// From Annotant's UI kit: its Checkbox, on Tranchant's palette.
import type { ReactNode } from 'react'

/** A checkbox with its label, `children`, which toggles it too. */
export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="kit-checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {children}
    </label>
  )
}

export const CHECKBOX_CSS = `
.kit-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13.5px; }
.kit-checkbox input { width: 16px; height: 16px; margin: 0; flex: none; accent-color: var(--tr-accent); }
`
