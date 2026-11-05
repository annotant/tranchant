import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Diagram } from '../src/Diagram'
import { numericEntities, sanitizeSvg } from '../src/svg'
import { SVG_WITH_SCRIPT } from './fixture'

function parse(svg: string) {
  const host = document.createElement('div')
  host.innerHTML = svg
  return host
}

test('the sanitizer drops scripts, handlers, foreignObject, images and external references', () => {
  const clean = sanitizeSvg(SVG_WITH_SCRIPT)
  expect(clean).toBeDefined()
  const host = parse(clean ?? '')
  expect(host.querySelector('script')).toBeNull()
  expect(host.querySelector('foreignObject')).toBeNull()
  expect(host.querySelector('image')).toBeNull()
  expect(host.querySelector('rect')?.hasAttribute('onclick')).toBe(false)
  expect(host.querySelector('rect')?.getAttribute('fill')).toBe('#ccc')
  const anchors = host.querySelectorAll('a')
  expect(anchors).toHaveLength(2)
  expect(anchors[0]?.hasAttribute('href')).toBe(false)
  expect(anchors[0]?.textContent).toBe('drawer')
  expect(anchors[1]?.getAttribute('xlink:href')).toBe('#box')
  const uses = host.querySelectorAll('use')
  expect(uses).toHaveLength(1)
  expect(uses[0]?.getAttribute('href')).toBe('#box')
})

test('a style with an external url is dropped; a plain one stays', () => {
  const clean = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://x/y.css)</style><style>rect { fill: red }</style><rect style="fill: url(https://x)"/></svg>',
  )
  // As a string: happy-dom loses a <style> and what follows when an SVG is re-parsed as HTML.
  expect(clean).toContain('<style>rect { fill: red }</style>')
  expect(clean).not.toContain('@import')
  expect(clean).toContain('<rect/>')
})

test('what is not SVG is refused', () => {
  expect(sanitizeSvg('<div>hi</div>')).toBeUndefined()
  expect(sanitizeSvg('<svg><rect')).toBeUndefined()
})

test('an SVG diagram is injected clean, with its caption', () => {
  const { container } = render(
    <Diagram diagram={{ kind: 'svg', source: SVG_WITH_SCRIPT, caption: 'The flow' }} />,
  )
  expect(container.querySelector('svg')).not.toBeNull()
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('figcaption')?.textContent).toBe('The flow')
})

test('a text diagram is preformatted', () => {
  const { container } = render(
    <Diagram diagram={{ kind: 'text', source: 'a → b\n  → c' }} />,
  )
  expect(container.querySelector('pre')?.textContent).toBe('a → b\n  → c')
  expect(container.querySelector('figcaption')).toBeNull()
})

test('an SVG diagram is drawn as the sanitizer read it, past a self-closing element', () => {
  const { container } = render(
    <Diagram
      diagram={{
        kind: 'svg',
        source:
          '<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="9" y2="0"/><text>after</text></svg>',
      }}
    />,
  )
  const svg = container.querySelector('.tr-diagram-svg svg')
  expect(svg?.namespaceURI).toBe('http://www.w3.org/2000/svg')
  expect(svg?.querySelector('line')?.childNodes).toHaveLength(0)
  expect(svg?.querySelector('text')?.textContent).toBe('after')
})

test('HTML entities become numeric ones XML reads; XML’s own and unknown ones stay text', () => {
  expect(numericEntities('a&nbsp;b &amp; &lt;x&gt; &copy; &nosuch;')).toBe(
    'a&#160;b &amp; &lt;x&gt; &#169; &amp;nosuch;',
  )
})
