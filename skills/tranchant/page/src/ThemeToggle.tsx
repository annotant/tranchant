import { setTheme, useTheme } from './theme'

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

/** Shows the theme a click switches to: a sun in the dark theme, a moon in the light one. */
export function ThemeToggle() {
  const other = useTheme() === 'dark' ? 'light' : 'dark'
  const label = `Switch to ${other} theme`
  return (
    <button
      type="button"
      className="tr-theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(other)}
    >
      {other === 'light' ? SUN : MOON}
    </button>
  )
}
