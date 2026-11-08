import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Diagram } from '../src/Diagram'
import { applyTheme } from '../src/theme'
import { ThemeToggle } from '../src/ThemeToggle'

const renderMermaid = vi.fn(async () => ({
  svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
}))
vi.mock('../src/mermaid', () => ({ renderMermaid, currentPalette: () => ({}) }))

afterEach(() => document.documentElement.removeAttribute('data-theme'))

test('a diagram is drawn again in the theme the header switches to', async () => {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  Object.defineProperty(query, 'matches', { get: () => false })
  vi.spyOn(window, 'matchMedia').mockReturnValue(query)
  render(
    <>
      <ThemeToggle onPick={applyTheme} />
      <Diagram diagram={{ kind: 'mermaid', source: 'sequenceDiagram\n  A->>B: hi' }} />
    </>,
  )
  await waitFor(() =>
    expect(renderMermaid).toHaveBeenLastCalledWith(expect.any(String), {}, false),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
  await waitFor(() =>
    expect(renderMermaid).toHaveBeenLastCalledWith(expect.any(String), {}, true),
  )
})
