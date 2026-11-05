import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { Diagram } from '../src/Diagram'

// A page left open across a rebuild asks for a chunk the server no longer has.
vi.mock('../src/mermaid', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

test('a renderer that does not load shows the source and why', async () => {
  const source = 'sequenceDiagram\n  A->>B: hi'
  const { container } = render(<Diagram diagram={{ kind: 'mermaid', source }} />)
  expect(await screen.findByText(/the renderer did not load/)).toBeTruthy()
  expect(container.querySelector('pre.tr-diagram-text')?.textContent).toBe(source)
})
