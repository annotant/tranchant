// The producer's SVG is injected into the page: only drawing may survive.

const SVG_NS = 'http://www.w3.org/2000/svg'
const DROPPED_ELEMENTS = new Set(['script', 'foreignobject', 'image'])
const REFERENCE_ATTRIBUTES = ['href', 'xlink:href']

const isLocal = (reference: string) => reference.trim().startsWith('#')

/**
 * The SVG with every script, event handler, `foreignObject`, `image` and
 * external reference removed; undefined when it does not parse as one.
 */
export function sanitizeSvg(source: string): string | undefined {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = doc.documentElement
  if (
    root.localName !== 'svg' ||
    root.namespaceURI !== SVG_NS ||
    doc.querySelector('parsererror')
  ) {
    return undefined
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (DROPPED_ELEMENTS.has(element.localName.toLowerCase())) {
      element.remove()
      continue
    }
    if (
      element.localName === 'use' &&
      REFERENCE_ATTRIBUTES.some((name) => {
        const value = element.getAttribute(name)
        return value !== null && !isLocal(value)
      })
    ) {
      element.remove()
      continue
    }
    // An animation of `href` would point a <use> elsewhere after the check above.
    if (
      /^(animate|set|animatemotion|animatetransform)$/i.test(element.localName) &&
      REFERENCE_ATTRIBUTES.includes(element.getAttribute('attributeName') ?? '')
    ) {
      element.remove()
      continue
    }
    if (
      element.localName === 'style' &&
      /url\(|@import/i.test(element.textContent ?? '')
    ) {
      element.remove()
      continue
    }
    // A copy: the map is live, and removing an attribute shifts the rest.
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (
        name.startsWith('on') ||
        (REFERENCE_ATTRIBUTES.includes(name) && !isLocal(attribute.value)) ||
        (name === 'style' && /url\(|expression\(/i.test(attribute.value))
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return new XMLSerializer().serializeToString(root)
}
