// Projects: All, a dropdown where several projects can be checked, sorted by
// name, each with its reviews not done; a search, and Show all projects.
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Checkbox, Icon } from '../kit'
import { type ProjectCount, summaryOf } from './domain'

export function ProjectFilter({
  projects,
  checked,
  onChange,
}: {
  projects: readonly ProjectCount[]
  checked: ReadonlySet<string>
  onChange: (checked: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const search = useId()

  // Closed by a click outside it, or Escape.
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !box.current?.contains(event.target))
        setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const wanted = query.trim().toLowerCase()
  const shown = projects.filter((one) => one.name.toLowerCase().includes(wanted))
  const toggle = (key: string, on: boolean) => {
    const next = new Set(checked)
    if (on) next.add(key)
    else next.delete(key)
    onChange(next)
  }

  return (
    <div className="db-multi" ref={box}>
      <Button
        variant="secondary"
        className="db-multi-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>
          Projects: <strong>{summaryOf(projects, checked)}</strong>
        </span>
        <Icon name="chevron-down" />
      </Button>
      {open && (
        <div className="db-multi-pop" role="group" aria-label="Projects to show">
          <label className="tr-sr-only" htmlFor={search}>
            Find a project
          </label>
          <input
            id={search}
            className="db-input"
            placeholder="Find a project"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {shown.map((one) => (
            <div className="db-multi-item" key={one.key} title={one.key}>
              <Checkbox
                checked={checked.has(one.key)}
                onChange={(on) => toggle(one.key, on)}
              >
                <span className="db-multi-name">{one.name}</span>
                <span className="tr-muted db-multi-count">
                  {one.open ? `${one.open} open` : ''}
                </span>
              </Checkbox>
            </div>
          ))}
          {!shown.length && <p className="tr-muted db-multi-none">No project matches.</p>}
          <div className="db-multi-foot">
            <Button variant="tertiary" small onClick={() => onChange(new Set())}>
              Show all projects
            </Button>
            <Button variant="secondary" small onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
