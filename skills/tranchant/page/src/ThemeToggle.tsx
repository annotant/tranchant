import { type Theme, useTheme } from './theme'

const SUN = (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </g>
  </svg>
)

const MOON = (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <path
      d="M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
)

const GEAR = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </g>
  </svg>
)

/** Shows the theme a click switches to: a sun in the dark theme, a moon in the light one. */
export function ThemeToggle({ onPick }: { onPick: (theme: Theme) => void }) {
  const other = useTheme() === 'dark' ? 'light' : 'dark'
  const label = `Switch to ${other} theme`
  return (
    <button
      type="button"
      className="tr-theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => onPick(other)}
    >
      {other === 'light' ? SUN : MOON}
    </button>
  )
}

/** The gear next to the theme toggle: opens the Settings; on them, back to the review. */
export function SettingsLink({ open }: { open: boolean }) {
  const label = open ? 'Settings: back to the review' : 'Settings'
  return (
    <a
      className="tr-theme-toggle"
      href={open ? '#' : '#settings'}
      aria-label={label}
      title={label}
      aria-current={open ? 'page' : undefined}
    >
      {GEAR}
    </a>
  )
}
