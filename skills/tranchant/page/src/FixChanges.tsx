// Hunks have no identity but their place in the file.
/* oxlint-disable react/no-array-index-key */
import { useState } from 'react'
import { type ChangesPayload, fetchChanges } from './api'
import { parseDiff } from './diff'
import { CodeBlock, digitsOf } from './Excerpt'
import { languageOfFile } from './syntax'

interface Props {
  id: string
  disabled: boolean
}

/** A fixed finding's files and their diff against HEAD, read on demand. */
export function FixChanges({ id, disabled }: Props) {
  const [changes, setChanges] = useState<ChangesPayload>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  async function load() {
    setLoading(true)
    setError(undefined)
    try {
      setChanges(await fetchChanges(id))
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The changes could not be read.',
      )
    } finally {
      setLoading(false)
    }
  }

  if (!changes) {
    return (
      <div className="tr-fix-changes">
        <button
          type="button"
          className="tr-btn tr-btn--small"
          disabled={disabled || loading}
          onClick={() => void load()}
        >
          {loading ? 'Loading…' : 'View changes'}
        </button>
        {error && <p className="tr-error">{error}</p>}
      </div>
    )
  }

  const files = parseDiff(changes.diff)
  return (
    <section className="tr-fix-changes" aria-label="Changes of the fix">
      <div className="tr-section-head">
        <h3>Changes</h3>
        <button
          type="button"
          className="tr-btn tr-btn--link"
          onClick={() => setChanges(undefined)}
        >
          Hide changes
        </button>
      </div>
      {changes.files.length === 0 ? (
        <p className="tr-muted">The fix wrote no file in the project.</p>
      ) : (
        <ul className="tr-changed">
          {changes.files.map((file) => (
            <li key={file.path}>
              <code>{file.path}</code>
              {file.since.length > 0 && (
                <span className="tr-warn" role="note">
                  {' '}
                  also changed since by {file.since.join(', ')}: the diff shows their
                  changes too
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {changes.files.length > 0 && !files.length && (
        <p className="tr-muted">No difference from HEAD left on the working tree.</p>
      )}
      {files.map((file) => {
        const digits = digitsOf(file.hunks.flatMap((hunk) => hunk.rows))
        const language = languageOfFile(file.path)
        return (
          <div key={file.path} className="tr-file" aria-label={`Diff of ${file.path}`}>
            <header className="tr-file-head">
              <code className="tr-file-path">{file.path}</code>
              {file.status === 'added' && <span className="tr-chip">new file</span>}
              {file.status === 'deleted' && <span className="tr-chip">deleted</span>}
              {file.binary && <span className="tr-chip">binary</span>}
            </header>
            {file.hunks.map((hunk, at) => (
              <CodeBlock
                key={at}
                rows={hunk.rows}
                signed
                digits={digits}
                language={language}
              />
            ))}
          </div>
        )
      })}
    </section>
  )
}
