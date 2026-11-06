import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { Diagram } from '../src/Diagram'

// happy-dom's nodes fail DOMPurify, which drops even a bare <svg>: the page's own defences are what is checked.
vi.mock('dompurify', async (importOriginal) => {
  const { default: purify } = await importOriginal<{ default: object }>()
  return { default: { ...purify, sanitize: (dirty: string) => dirty } }
})

// happy-dom lays nothing out: each label Mermaid measures gets a box from its text's length.
const width = (element: Element) => (element.textContent?.length ?? 0) * 7
const measures: Record<string, (this: Element) => unknown> = {
  getBBox() {
    return { x: 0, y: 0, width: width(this), height: 16 }
  },
  getComputedTextLength() {
    return width(this)
  },
}
/** The prototype that defines `name`, where the stub must go to be found first. */
function owner(name: string): object {
  let proto: object | null = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'text',
  )
  while (proto && !Object.hasOwn(proto, name)) proto = Object.getPrototypeOf(proto)
  return proto ?? SVGElement.prototype
}
const originals = Object.keys(measures).map((name) => {
  const target = owner(name)
  return [target, name, Object.getOwnPropertyDescriptor(target, name)] as const
})
beforeAll(() => {
  for (const [target, name] of originals) {
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: measures[name],
    })
  }
})
afterAll(() => {
  for (const [target, name, original] of originals) {
    if (original) Object.defineProperty(target, name, original)
    else Reflect.deleteProperty(target, name)
  }
})

const SEQUENCE = [
  'sequenceDiagram',
  '  participant D as PersonDrawer',
  '  participant H as usePeople',
  '  D->>H: mount, tenantId undefined',
  '  H-->>D: TypeError',
].join('\n')

/** The drawn SVG, once the lazy renderer has answered. */
async function drawn(container: HTMLElement) {
  await waitFor(() => expect(screen.queryByText('Drawing the diagram…')).toBeNull(), {
    timeout: 10_000,
  })
  const svg = container.querySelector('.tr-diagram-svg svg')
  if (!svg) throw new Error(`no SVG drawn: ${container.textContent}`)
  return svg
}

test('a Mermaid sequence diagram renders as SVG, its messages with arrowheads', async () => {
  const { container } = render(
    <Diagram
      diagram={{
        kind: 'mermaid',
        source: SEQUENCE,
        caption: 'The drawer reads too early',
      }}
    />,
  )
  const svg = await drawn(container)
  expect(svg.textContent).toContain('PersonDrawer')
  expect(svg.textContent).toContain('mount, tenantId undefined')
  expect(svg.querySelector('marker[id$="arrowhead"]')).not.toBeNull()
  const messages = [...svg.querySelectorAll('.messageLine0, .messageLine1')]
  expect(messages).toHaveLength(2)
  for (const line of messages)
    expect(line.getAttribute('marker-end')).toMatch(/^url\(#.*arrowhead\)$/)
  expect(screen.getByText('The drawer reads too early')).toBeTruthy()
  // Drawn in the page's palette: a lost <style> would draw it in black.
  expect(svg.querySelector('style')?.textContent).toContain('#1c2129')
})

test('a label with a non-breaking space is drawn, not refused as XML', async () => {
  const source = 'sequenceDiagram\n  A->>B: wait#nbsp;here\n  B-->>A: done\u00a0!'
  const { container } = render(<Diagram diagram={{ kind: 'mermaid', source }} />)
  const svg = await drawn(container)
  expect(svg.textContent).toContain('wait\u00a0here')
  expect(svg.textContent).toContain('done\u00a0!')
})

test('a source Mermaid cannot parse shows the source and the parser’s message', async () => {
  const source = 'sequenceDiagram\n  D->>: nobody'
  const { container } = render(<Diagram diagram={{ kind: 'mermaid', source }} />)
  expect(
    await screen.findByText(
      /The diagram could not be drawn: .*(Parse error|Expecting)/s,
      undefined,
      {
        timeout: 10_000,
      },
    ),
  ).toBeTruthy()
  expect(container.querySelector('pre.tr-diagram-text')?.textContent).toBe(source)
  expect(container.querySelector('svg')).toBeNull()
})

test('a click or an HTML label in the source does nothing, whatever its directive asks', async () => {
  const alert = vi.fn()
  vi.stubGlobal('alert', alert)
  const source = [
    '%%{init: {"securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}, "themeCSS": ".tr-detail { display: none }"}}%%',
    'flowchart LR',
    '  A["<img src=x onerror=alert(1)>label"] --> B',
    '  click A call alert(1)',
    '  click B alert',
  ].join('\n')
  const { container } = render(<Diagram diagram={{ kind: 'mermaid', source }} />)
  const svg = await drawn(container)
  expect(svg.querySelector('img, foreignObject, script, a')).toBeNull()
  expect(svg.textContent).toContain('<img src=x')
  expect(svg.querySelector('style')?.textContent).not.toContain('.tr-detail')
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of element.attributes) {
      expect(attribute.name.toLowerCase().startsWith('on'), attribute.name).toBe(false)
    }
  }
  for (const node of svg.querySelectorAll('.node')) fireEvent.click(node)
  expect(alert).not.toHaveBeenCalled()
})
