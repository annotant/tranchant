// The dashboard: every review of every project, by group, filtered by
// project, following the state folder with no reload.
import { useEffect, useState } from 'react'
import { IconButton, applyTheme, useTheme } from '../kit'
import { saveTheme, useListing } from './api'
import { filtered, projectsOf } from './domain'
import { ProjectFilter } from './ProjectFilter'
import { ReviewList } from './ReviewList'

/** The time the rows' `12 min ago` count from, a minute apart. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function ThemeToggle() {
  const other = useTheme() === 'dark' ? 'light' : 'dark'
  return (
    <IconButton
      icon={other === 'light' ? 'sun' : 'moon'}
      label={`Switch to ${other} theme`}
      onClick={() => {
        applyTheme(other)
        // Shown at once; a settings file it cannot write keeps it for this page alone.
        void saveTheme(other).catch(() => undefined)
      }}
    />
  )
}

export default function App() {
  const feed = useListing()
  const now = useNow()
  const [checked, setChecked] = useState<Set<string>>(() => new Set())

  let body
  if (feed.kind === 'loading')
    body = <p className="db-note tr-muted">Loading the reviews…</p>
  else if (feed.kind === 'failed')
    body = <p className="db-note tr-error">The reviews could not be read: {feed.error}</p>
  else if (!feed.listing.reviews.length)
    body = (
      <div className="db-empty">
        <h2>No review yet</h2>
        <p className="tr-muted">Reviews from all your projects show here.</p>
        <p>
          Start one with <code>/tranchant review</code> in a Claude Code session.
        </p>
      </div>
    )
  else {
    const { reviews, state, home } = feed.listing
    const projects = projectsOf(reviews)
    // A project gone from the list leaves the filter with it.
    const kept = new Set(
      [...checked].filter((key) => projects.some((one) => one.key === key)),
    )
    const shown = filtered(reviews, kept)
    body = (
      <div className="db-body">
        <div className="db-toolbar">
          <ProjectFilter projects={projects} checked={kept} onChange={setChecked} />
          <span
            className={`db-livestat${feed.live ? '' : ' db-livestat--off'}`}
            title="The list follows the state folder and the running servers: no reload needed"
          >
            <span className="db-live" aria-hidden="true" />
            {feed.live ? 'Live' : 'Reconnecting'} · from <code>{state}</code>
          </span>
        </div>
        {shown.length ? (
          <ReviewList reviews={shown} home={home} now={now} />
        ) : (
          <p className="db-note tr-muted">No review in these projects.</p>
        )}
      </div>
    )
  }

  return (
    <div className="db-app">
      <header className="db-top">
        <span className="db-brand">Tranchant</span>
        <div className="db-top-end">
          <ThemeToggle />
        </div>
      </header>
      <main>{body}</main>
    </div>
  )
}
