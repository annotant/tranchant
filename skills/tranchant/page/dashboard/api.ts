// The dashboard's server: the list once, then each new one it pushes.
import { useEffect, useState } from 'react'
import type { ThemePick } from '../kit/theme'
import type { Listing } from './domain'

/** Whether `value` is a list as the server answers it: what the page reads of it, checked. */
const isListing = (value: unknown): value is Listing =>
  !!value &&
  typeof value === 'object' &&
  'reviews' in value &&
  Array.isArray(value.reviews) &&
  'state' in value &&
  typeof value.state === 'string' &&
  'home' in value &&
  typeof value.home === 'string'

export type Feed =
  | { kind: 'loading' }
  | { kind: 'failed'; error: string }
  | { kind: 'ready'; listing: Listing; live: boolean }

/** The list, kept up to date: the server pushes `reviews` whenever it changes. */
export function useListing(): Feed {
  const [feed, setFeed] = useState<Feed>({ kind: 'loading' })
  useEffect(() => {
    let closed = false
    const events = new EventSource('/api/events')
    const take = (body: unknown) => {
      if (!isListing(body)) throw new Error('the server answered no list')
      if (!closed) setFeed({ kind: 'ready', listing: body, live: true })
    }
    events.addEventListener('reviews', (event) => {
      if (event instanceof MessageEvent && typeof event.data === 'string')
        take(JSON.parse(event.data))
    })
    // The connection is back: read the list it may have missed meanwhile.
    events.addEventListener('open', () => {
      fetch('/api/reviews')
        .then(async (response) => {
          if (!response.ok) throw new Error(`the server answered ${response.status}`)
          return take(await response.json())
        })
        .catch((error: unknown) => {
          if (closed) return
          setFeed((now) =>
            now.kind === 'ready'
              ? { ...now, live: false }
              : {
                  kind: 'failed',
                  error: error instanceof Error ? error.message : String(error),
                },
          )
        })
    })
    // EventSource tries again on its own: the list stands, said not live until then.
    events.addEventListener('error', () => {
      if (!closed)
        setFeed((now) => (now.kind === 'ready' ? { ...now, live: false } : now))
    })
    return () => {
      closed = true
      events.close()
    }
  }, [])
  return feed
}

/** Saves the theme in the user's settings, which the review pages read too. */
export async function saveTheme(theme: ThemePick) {
  const response = await fetch('/api/theme', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ theme }),
  })
  if (!response.ok) throw new Error(`the server answered ${response.status}`)
}
