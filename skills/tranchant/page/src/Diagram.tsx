import { useMemo } from 'react'
import type { Diagram as DiagramSource } from './domain'
import { sanitizeSvg } from './svg'

export function Diagram({ diagram }: { diagram: DiagramSource }) {
  const svg = useMemo(
    () => (diagram.kind === 'svg' ? sanitizeSvg(diagram.source) : undefined),
    [diagram],
  )
  return (
    <figure className="tr-diagram">
      {diagram.kind === 'text' ? (
        <pre className="tr-diagram-text">{diagram.source}</pre>
      ) : svg === undefined ? (
        <p className="tr-muted">The diagram is not valid SVG and was not shown.</p>
      ) : (
        // Sanitized just above: no script, handler, foreignObject or external reference is left.
        <div className="tr-diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
      {diagram.caption && <figcaption>{diagram.caption}</figcaption>}
    </figure>
  )
}
