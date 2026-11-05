// The producer's SVG is injected into the page: only drawing may survive.

const SVG_NS = 'http://www.w3.org/2000/svg'
const DROPPED_ELEMENTS = new Set(['script', 'foreignobject', 'image'])
const REFERENCE_ATTRIBUTES = ['href', 'xlink:href']

const isLocal = (reference: string) => reference.trim().startsWith('#')

// A `url(#…)` points into the SVG (Mermaid's gradients); any other loads, and an escape could spell one.
const unsafeCss = (css: string) =>
  /@import|expression\(|\\/i.test(css) || /url\(\s*(?!['"]?#)/i.test(css)

const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos'])

/** HTML's named entities (`&nbsp;`…), which XML does not define, as numeric ones. */
export function numericEntities(markup: string): string {
  const decoder = document.createElement('textarea')
  return markup.replace(/&([a-z][a-z0-9]*);/gi, (entity: string, name: string) => {
    if (XML_ENTITIES.has(name)) return entity
    decoder.innerHTML = entity
    const text = decoder.value
    if (text === entity) return `&amp;${name};`
    return text.replace(/[\s\S]/gu, (char) => `&#${char.codePointAt(0)};`)
  })
}

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
    if (element.localName === 'style' && unsafeCss(element.textContent ?? '')) {
      element.remove()
      continue
    }
    // A copy: the map is live, and removing an attribute shifts the rest.
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (
        name.startsWith('on') ||
        (REFERENCE_ATTRIBUTES.includes(name) && !isLocal(attribute.value)) ||
        (name === 'style' && unsafeCss(attribute.value))
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  // Some serializers write U+00A0 back as `&nbsp;`: the page parses this as XML again.
  return numericEntities(new XMLSerializer().serializeToString(root))
}
