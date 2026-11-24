// The dashboard's server: the list it pushes on every connection, then each new one.
import { useEffect, useState } from 'react'
import type { ThemePick } from '../kit/theme'
import { type ListedReview, type Listing, isGroupState } from './domain'

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Whether a row holds what the page reads of it: a newer server's may not. */
const isRow = (value: unknown): value is ListedReview =>
  isObject(value) &&
  typeof value['dir'] === 'string' &&
  typeof value['title'] === 'string' &&
  isGroupState(value['state']) &&
  isObject(value['repo']) &&
  typeof value['repo']['key'] === 'string' &&
  isObject(value['findings'])

/** The list as the server answers it, its rows the page cannot read left out; undefined when it is none. */
function listingOf(value: unknown): Listing | undefined {
  if (!isObject(value) || !Array.isArray(value['reviews'])) return undefined
  if (typeof value['state'] !== 'string' || typeof value['home'] !== 'string')
    return undefined
  return {
    state: value['state'],
    home: value['home'],
    reviews: value['reviews'].filter(isRow),
  }
}

export type Feed =
  | { kind: 'loading' }
  | { kind: 'failed'; error: string }
  | { kind: 'ready'; listing: Listing; live: boolean }

const NO_ANSWER = "the dashboard's server does not answer"

/** The list, kept up to date: the server pushes `reviews` on connecting, then whenever it changes. */
export function useListing(): Feed {
  const [feed, setFeed] = useState<Feed>({ kind: 'loading' })
  useEffect(() => {
    let closed = false
    const events = new EventSource('/api/events')
    const offline = (error: string) => {
      if (!closed)
        setFeed((now) =>
          now.kind === 'ready' ? { ...now, live: false } : { kind: 'failed', error },
        )
    }
    events.addEventListener('reviews', (event) => {
      let listing
      try {
        listing =
          event instanceof MessageEvent
            ? listingOf(JSON.parse(String(event.data)))
            : undefined
      } catch {
        listing = undefined
      }
      if (!listing) return offline('the server answered no list')
      if (!closed) setFeed({ kind: 'ready', listing, live: true })
      return undefined
    })
    // The server could not read the list: the last one stands, no longer live.
    events.addEventListener('stale', () => offline('the server cannot read the reviews'))
    // EventSource tries again on its own, and the server's first event is the list again.
    events.addEventListener('error', () => offline(NO_ANSWER))
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
