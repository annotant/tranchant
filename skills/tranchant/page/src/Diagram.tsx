import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Diagram as DiagramSource } from './domain'
import type { Rendered } from './mermaid'
import { sanitizeSvg } from './svg'

export function Diagram({ diagram }: { diagram: DiagramSource }) {
  return (
    <figure className="tr-diagram">
      {diagram.kind === 'text' ? (
        <pre className="tr-diagram-text">{diagram.source}</pre>
      ) : diagram.kind === 'mermaid' ? (
        <MermaidDiagram source={diagram.source} />
      ) : (
        <SvgDiagram source={diagram.source} />
      )}
      {diagram.caption && <figcaption>{diagram.caption}</figcaption>}
    </figure>
  )
}

function SvgDiagram({ source }: { source: string }) {
  const svg = useMemo(() => sanitizeSvg(source), [source])
  return svg === undefined ? (
    <p className="tr-muted">The diagram is not valid SVG and was not shown.</p>
  ) : (
    <CleanSvg svg={svg} />
  )
}

// Parsed as XML, like the sanitizer did: innerHTML's HTML parser would read another SVG.
function CleanSvg({ svg }: { svg: string }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    // Never the parser's error page in place of the diagram.
    if (doc.querySelector('parsererror')) host.current?.replaceChildren()
    else host.current?.replaceChildren(document.importNode(doc.documentElement, true))
  }, [svg])
  return <div className="tr-diagram-svg" ref={host} />
}

const DARK = '(prefers-color-scheme: dark)'

/** The colour scheme in force, which the page's palette follows. */
function useColorScheme(): 'light' | 'dark' {
  const query = useMemo(() => window.matchMedia?.(DARK), [])
  const [dark, setDark] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return undefined
    const changed = (event: MediaQueryListEvent) => setDark(event.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [query])
  return dark ? 'dark' : 'light'
}

function MermaidDiagram({ source }: { source: string }) {
  const scheme = useColorScheme()
  const [rendered, setRendered] = useState<Rendered | undefined>()
  useEffect(() => {
    let current = true
    async function draw(): Promise<Rendered> {
      try {
        const { renderMermaid, currentPalette } = await import('./mermaid')
        return await renderMermaid(source, currentPalette(), scheme === 'dark')
      } catch (error) {
        return {
          error: `the renderer did not load (${error instanceof Error ? error.message : String(error)})`,
        }
      }
    }
    void draw().then((result) => {
      if (current) setRendered(result)
      return undefined
    })
    return () => {
      current = false
    }
  }, [source, scheme])
  if (rendered === undefined) return <p className="tr-muted">Drawing the diagram…</p>
  if ('svg' in rendered) return <CleanSvg svg={rendered.svg} />
  return (
    <div className="tr-diagram-failed">
      <p className="tr-error">The diagram could not be drawn: {rendered.error}</p>
      <pre className="tr-diagram-text">{source}</pre>
    </div>
  )
}
