import { useCallback, useEffect, useRef, useState } from 'react'
import type { DecisionInput, DecisionsResult, ReviewPayload, Step } from './domain'

const REVIEW = '/api/review'
const EVENTS = '/api/events'
const DECISIONS = '/api/decisions'
const ANSWER = '/api/answer'
const STOP = '/api/stop'
const RUNS = '/api/runs/'
const DIFF = '/api/diff'

/** How often the page asks again once the server stopped answering. */
export const RETRY_MS = 5000
// The server pushes its changes: this reload only catches what a dropped stream missed.
const POLL_MS = 30_000

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) throw new Error(await failure(response))
  // The server is ours: its JSON has the shape the caller asks for.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

/** The server's own words for a refusal when it gave some, else the status. */
async function failure(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined)
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    typeof body.error === 'string'
  ) {
    return body.error
  }
  return `Request failed (${response.status})`
}

const fetchReview = () => request<ReviewPayload>(REVIEW)

/** One file of the change, as `/api/diff` counts it. */
interface DiffStat {
  path: string
  oldPath?: string
  additions: number
  deletions: number
  binary: boolean
}

/** What `GET /api/diff` answers: the change's unified diff and its files. */
export interface DiffPayload {
  base: string
  head: string
  files: DiffStat[]
  diff: string
}

const fetchDiff = () => request<DiffPayload>(DIFF)

export const postDecisions = (decisions: DecisionInput[]) =>
  request<DecisionsResult>(DECISIONS, {
    method: 'POST',
    body: JSON.stringify({ decisions }),
  })

export const postAnswer = (id: string, text: string, choices?: string[]) =>
  request<unknown>(ANSWER, {
    method: 'POST',
    body: JSON.stringify(choices?.length ? { id, text, choices } : { id, text }),
  })

export const postStop = (id: string) =>
  request<unknown>(STOP, { method: 'POST', body: JSON.stringify({ id }) })

const isStep = (value: unknown): value is Step =>
  !!value &&
  typeof value === 'object' &&
  'kind' in value &&
  'label' in value &&
  'state' in value

/**
 * The run in progress then the history, whether the server sends one array
 * or `{ steps, history }`.
 */
function stepsOf(body: unknown): Step[] {
  if (Array.isArray(body)) return body.filter(isStep)
  if (body && typeof body === 'object') {
    return Object.values(body).flatMap((part: unknown) =>
      Array.isArray(part) ? part.filter(isStep) : [],
    )
  }
  return []
}

export const fetchRuns = async (id: string) =>
  stepsOf(await request<unknown>(`${RUNS}${encodeURIComponent(id)}`))

/**
 * The review at `/api/review`, reloaded on each `changed` event of the
 * server's stream. `reachable` turns false when a request fails or the stream
 * closes; the page then asks again every RETRY_MS until the server answers.
 */
export function useReview() {
  const [payload, setPayload] = useState<ReviewPayload>()
  const [reachable, setReachable] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const reachableRef = useRef(true)

  const load = useCallback(async () => {
    try {
      const next = await fetchReview()
      setPayload((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      )
      reachableRef.current = true
      setReachable(true)
    } catch {
      reachableRef.current = false
      setReachable(false)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let source: EventSource | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    // load() never rejects: it records failures as `reachable: false`.
    const reload = () => void load()

    function connect() {
      if (disposed || typeof EventSource === 'undefined') return
      const stream = new EventSource(EVENTS)
      source = stream
      stream.addEventListener('changed', reload)
      stream.addEventListener('open', reload)
      stream.addEventListener('error', () => {
        reload()
        // The browser retries a dropped stream itself; a closed one is ours to reopen.
        if (stream.readyState !== EventSource.CLOSED) return
        stream.close()
        if (source === stream) source = undefined
        clearTimeout(retry)
        retry = setTimeout(connect, RETRY_MS)
      })
    }

    reload()
    connect()
    const poll = setInterval(reload, POLL_MS)
    const probe = setInterval(() => {
      if (reachableRef.current) return
      reload()
      if (!source && !retry) connect()
    }, RETRY_MS)
    return () => {
      disposed = true
      clearInterval(poll)
      clearInterval(probe)
      clearTimeout(retry)
      source?.close()
    }
  }, [load])

  return { payload, reachable, loaded, reload: load }
}

export type DiffState =
  | { status: 'loading' }
  | { status: 'ready'; payload: DiffPayload }
  | { status: 'unavailable'; reason: string }

/**
 * The change's diff at `/api/diff`, read once per head the review shows:
 * `unavailable` with the server's reason (no repository, a commit not
 * fetched) when it answers 409, or when it does not answer, in which case
 * the page asks again once it is reachable.
 */
export function useDiff(head: string | undefined, reachable: boolean): DiffState {
  const [state, setState] = useState<DiffState>({ status: 'loading' })
  const asked = useRef<string>(undefined)

  useEffect(() => {
    if (!head || !reachable || asked.current === head) return undefined
    asked.current = head
    let disposed = false
    let settled = false
    async function load() {
      try {
        const payload = await fetchDiff()
        settled = true
        if (!disposed) setState({ status: 'ready', payload })
      } catch (error) {
        settled = true
        if (disposed) return
        asked.current = undefined
        setState({
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'the diff could not be read',
        })
      }
    }
    void load()
    return () => {
      disposed = true
      // A request cut short answers nothing: ask again next time.
      if (!settled) asked.current = undefined
    }
  }, [head, reachable])

  return state
}
