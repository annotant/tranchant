import { expect, test } from 'vitest'
import { PAGE_CSS } from '../src/styles'

type Rgb = readonly [number, number, number]

/** A `#rrggbb` or `rgba(r, g, b, a)` colour, with its alpha. */
const rgb = (color: string): [Rgb, number] => {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
  if (hex)
    return [[parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)], 1]
  const parts = /^rgba?\(([^)]+)\)$/.exec(color)?.[1]?.split(',').map(Number) ?? []
  return [[parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], parts[3] ?? 1]
}

const channel = (value: number) => {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const contrast = (a: Rgb, b: Rgb) => {
  const high = Math.max(luminance(a), luminance(b))
  const low = Math.min(luminance(a), luminance(b))
  return (high + 0.05) / (low + 0.05)
}
/** `top`, translucent, over `under`. */
const over = (top: string, under: Rgb): Rgb => {
  const [color, alpha] = rgb(top)
  const blend = (at: 0 | 1 | 2) => alpha * color[at] + (1 - alpha) * under[at]
  return [blend(0), blend(1), blend(2)]
}

/** The `--tr-*` variables of a palette, light or dark, from the stylesheet. */
const palette = (scheme: 'light' | 'dark') => {
  const dark = PAGE_CSS.indexOf('@media (prefers-color-scheme: dark)')
  const block = scheme === 'light' ? PAGE_CSS.slice(0, dark) : PAGE_CSS.slice(dark)
  const variables = new Map<string, string>()
  for (const [, name, value] of block.matchAll(/--tr-([\w-]+):\s*([^;]+);/g))
    if (!variables.has(name!)) variables.set(name!, value!.trim())
  return (name: string) => {
    const value = variables.get(name)
    if (!value) throw new Error(`no --tr-${name} in the ${scheme} palette`)
    return value
  }
}

/** The kinds `tokens` gives, each with a `.tr-tok--<kind>` rule. */
const KINDS = ['keyword', 'string', 'number', 'comment', 'tag', 'attr', 'key']

/** By token kind, the `--tr-code-*` variable its rule colours it with. */
const ruleVariables = () => {
  const byKind = new Map<string, string>()
  for (const [, kinds, variable] of PAGE_CSS.matchAll(
    /((?:\.tr-tok--\w+(?:,\s*)?)+)\s*\{[^}]*color:\s*var\(--tr-([\w-]+)\)/g,
  ))
    for (const [, kind] of kinds!.matchAll(/\.tr-tok--(\w+)/g))
      byKind.set(kind!, variable!)
  return byKind
}

test('every token kind has a rule, and the rules name the palette variables', () => {
  const rules = ruleVariables()
  expect([...rules.keys()].toSorted()).toEqual(KINDS.toSorted())
  for (const scheme of ['light', 'dark'] as const)
    for (const variable of rules.values()) expect(palette(scheme)(variable)).toBeTruthy()
})

for (const scheme of ['light', 'dark'] as const)
  test(`the ${scheme} token colours read at 4.5:1 on every code surface, under a mark too`, () => {
    const get = palette(scheme)
    const surfaces = ['bg', 'bg-2', 'added', 'removed'].map((name) => rgb(get(name))[0])
    // A column mark over a line marked whole stacks both: not a case the test holds the
    // dark palette to, where it would push every colour to white.
    const backgrounds = surfaces.flatMap((surface) => [
      surface,
      over(get('mark'), surface),
      over(get('mark-line'), surface),
    ])
    const colours = [...new Set(ruleVariables().values())].map(
      (variable) => [variable, rgb(get(variable))[0]] as const,
    )
    const failing = [...colours, ['text', rgb(get('text'))[0]] as const].flatMap(
      ([name, colour]) =>
        backgrounds
          .filter((background) => contrast(colour, background) < 4.5)
          .map((background) => `${name} on ${background.map(Math.round).join(',')}`),
    )
    expect(failing).toEqual([])
  })
