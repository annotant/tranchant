import { useSyncExternalStore } from 'react'
import type { Theme as Pick } from './settings'

/** A theme in force: the settings' pick, or the system's when they say `system`. */
export type Theme = 'light' | 'dark'

const DARK = '(prefers-color-scheme: dark)'

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/** The theme the settings picked, on `<html data-theme>`; none follows the system. */
const chosen = (): Theme | undefined => {
  const value = document.documentElement.getAttribute('data-theme')
  return value === 'light' || value === 'dark' ? value : undefined
}

const systemTheme = (): Theme => (window.matchMedia?.(DARK).matches ? 'dark' : 'light')

/** The theme in force: the pick, else the system's. */
const currentTheme = (): Theme => chosen() ?? systemTheme()

/**
 * Puts the settings' pick on `<html>`: the server put it there before the
 * page loaded, so nothing flashes; this follows a change.
 */
export function applyTheme(theme: Pick) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const query = window.matchMedia?.(DARK)
  query?.addEventListener('change', listener)
  return () => {
    listeners.delete(listener)
    query?.removeEventListener('change', listener)
  }
}

/** The theme in force, re-rendering when the settings or the system change it. */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, currentTheme)
