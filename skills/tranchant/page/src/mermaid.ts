// Its own chunk: Diagram.tsx imports it only when a finding has a Mermaid diagram.
import mermaid from 'mermaid'
import { numericEntities, sanitizeSvg } from './svg'

export type Rendered = { svg: string } | { error: string }

/** The page's colours and font Mermaid draws with, read from its `--tr-*` variables. */
export interface Palette {
  text: string
  muted: string
  bg: string
  bg2: string
  bg3: string
  border: string
  accent: string
  accentWeak: string
  danger: string
  font: string
}

/** The palette in force now, the light one's colours where a variable is unset. */
export function currentPalette(): Palette {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) =>
    style.getPropertyValue(`--tr-${name}`).trim() || fallback
  return {
    text: read('text', '#1c2129'),
    muted: read('muted', '#5f6b7a'),
    bg: read('bg', '#ffffff'),
    bg2: read('bg-2', '#f6f7f9'),
    bg3: read('bg-3', '#eceef2'),
    border: read('border', '#d9dde3'),
    accent: read('accent', '#2b6cb0'),
    accentWeak: read('accent-weak', '#e7f0fb'),
    danger: read('danger', '#b3423f'),
    font: read('font', 'system-ui, sans-serif'),
  }
}

// What a directive in the source (%%{init}%%, front matter) may not change, at any depth.
const SECURE = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'maxEdges',
  'suppressErrorRendering',
  // An HTML label draws in a foreignObject, which the sanitizer drops with its text.
  'htmlLabels',
  // Mermaid 11 bundles no elk layout: dagre draws every graph.
  'layout',
  // The page's palette, and CSS that would reach the whole page.
  'theme',
  'themeVariables',
  'themeCSS',
  'darkMode',
  'fontFamily',
]

function configure(palette: Palette, dark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: 64 * 1024,
    secure: SECURE,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    layout: 'dagre',
    theme: 'base',
    fontFamily: palette.font,
    themeVariables: {
      darkMode: dark,
      fontFamily: palette.font,
      background: palette.bg2,
      primaryColor: palette.accentWeak,
      primaryTextColor: palette.text,
      primaryBorderColor: palette.accent,
      secondaryColor: palette.bg3,
      tertiaryColor: palette.bg,
      lineColor: palette.text,
      textColor: palette.text,
      mainBkg: palette.accentWeak,
      nodeBorder: palette.accent,
      clusterBkg: palette.bg3,
      clusterBorder: palette.border,
      edgeLabelBackground: palette.bg2,
      actorBkg: palette.accentWeak,
      actorBorder: palette.accent,
      actorTextColor: palette.text,
      actorLineColor: palette.muted,
      signalColor: palette.text,
      signalTextColor: palette.text,
      labelBoxBkgColor: palette.bg3,
      labelBoxBorderColor: palette.border,
      labelTextColor: palette.text,
      loopTextColor: palette.text,
      noteBkgColor: palette.bg3,
      noteBorderColor: palette.border,
      noteTextColor: palette.text,
      activationBkgColor: palette.bg3,
      activationBorderColor: palette.muted,
      sequenceNumberColor: palette.bg,
      errorBkgColor: palette.danger,
      errorTextColor: palette.bg,
    },
  })
}

let renders = 0

// Mermaid serializes a `click … href` as `xlink:href` with no xmlns:xlink, which XML refuses.
const withXlink = (svg: string) =>
  /^<svg\b[^>]*\sxmlns:xlink=/.test(svg)
    ? svg
    : svg.replace(/^<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"')

/**
 * The diagram drawn as sanitized SVG, or why it could not be: a source
 * Mermaid does not parse, or an SVG the sanitizer refuses.
 */
export async function renderMermaid(
  source: string,
  palette: Palette,
  dark: boolean,
): Promise<Rendered> {
  configure(palette, dark)
  const id = `tr-mermaid-${++renders}`
  try {
    await mermaid.parse(source)
    const { svg } = await mermaid.render(id, source)
    const clean = sanitizeSvg(withXlink(numericEntities(svg)))
    return clean === undefined
      ? { error: 'Mermaid drew an SVG that does not parse.' }
      : { svg: clean }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  } finally {
    // A failed render leaves its scratch element in the body.
    document.getElementById(`d${id}`)?.remove()
  }
}
