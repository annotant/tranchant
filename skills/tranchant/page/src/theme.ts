import { useSyncExternalStore } from 'react'
import { readStored, writeStored } from './storage'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'tranchant:theme'
const DARK = '(prefers-color-scheme: dark)'

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/** The theme the viewer picked, on `<html data-theme>`; none follows the system. */
const chosen = (): Theme | undefined => {
  const value = document.documentElement.getAttribute('data-theme')
  return value === 'light' || value === 'dark' ? value : undefined
}

const systemTheme = (): Theme => (window.matchMedia?.(DARK).matches ? 'dark' : 'light')

/** The theme in force: the viewer's pick, else the system's. */
const currentTheme = (): Theme => chosen() ?? systemTheme()

/** Puts the remembered pick on `<html>`; called before React renders, so nothing flashes. */
export function applyStoredTheme() {
  const stored = readStored(THEME_KEY)
  if (stored === 'light' || stored === 'dark')
    document.documentElement.setAttribute('data-theme', stored)
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  writeStored(THEME_KEY, theme)
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

/** The theme in force, re-rendering when the viewer or the system changes it. */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, currentTheme)
