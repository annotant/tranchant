import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { PAGE_CSS } from '../src/styles'
import { applyTheme } from '../src/theme'
import { ThemeToggle } from '../src/ThemeToggle'

const html = document.documentElement

/** A system whose colour scheme is `dark` or not, with a way to change it. */
function systemScheme(dark: boolean) {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  Object.defineProperty(query, 'matches', { get: () => dark })
  vi.spyOn(window, 'matchMedia').mockReturnValue(query)
  return (next: boolean) => {
    dark = next
    query.dispatchEvent(new Event('change'))
  }
}

afterEach(() => {
  html.removeAttribute('data-theme')
  vi.restoreAllMocks()
})

test('by default, the button follows the system and offers the other theme', () => {
  const change = systemScheme(false)
  render(<ThemeToggle onPick={applyTheme} />)
  expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toHaveProperty(
    'title',
    'Switch to dark theme',
  )
  expect(html.hasAttribute('data-theme')).toBe(false)
  act(() => change(true))
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy()
})

test('a click hands the other theme to its owner, who puts it on <html>', () => {
  systemScheme(true)
  const onPick = vi.fn(applyTheme)
  render(<ThemeToggle onPick={onPick} />)
  fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
  expect(onPick).toHaveBeenLastCalledWith('light')
  expect(html.getAttribute('data-theme')).toBe('light')
  fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
  expect(onPick).toHaveBeenLastCalledWith('dark')
  expect(html.getAttribute('data-theme')).toBe('dark')
})

test('a pick holds when the system changes its scheme', () => {
  const change = systemScheme(false)
  render(<ThemeToggle onPick={applyTheme} />)
  fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
  act(() => change(false))
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy()
})

test('the system theme takes the pick off <html>, and the button follows the system again', () => {
  systemScheme(false)
  render(<ThemeToggle onPick={applyTheme} />)
  act(() => applyTheme('dark'))
  expect(html.getAttribute('data-theme')).toBe('dark')
  expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy()
  act(() => applyTheme('system'))
  expect(html.hasAttribute('data-theme')).toBe(false)
  expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy()
})

/** The declarations of the first rule whose selector ends with `selector`. */
const rule = (selector: string) => {
  const at = PAGE_CSS.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no ${selector} rule`)
  const open = PAGE_CSS.indexOf('{', at)
  return PAGE_CSS.slice(open + 1, PAGE_CSS.indexOf('}', open)).trim()
}

test('the system dark scheme and a dark pick apply the same palette, with its native controls', () => {
  const system = rule(':root:not([data-theme="light"])')
  expect(system).toBe(rule(':root[data-theme="dark"]'))
  expect(system).toMatch(/color-scheme: dark;/)
  expect(system).toMatch(/--tr-bg: #15181d;/)
  expect(PAGE_CSS.indexOf(':root:not([data-theme="light"])')).toBeGreaterThan(
    PAGE_CSS.indexOf('@media (prefers-color-scheme: dark)'),
  )
  expect(rule(':root[data-theme="light"]')).toBe('color-scheme: light;')
})
