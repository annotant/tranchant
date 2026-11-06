import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DecisionInput,
  DecisionsResult,
  ReviewPayload,
  Step,
  Tracker,
} from './domain'

const REVIEW = '/api/review'
const EVENTS = '/api/events'
const DECISIONS = '/api/decisions'
const ANSWER = '/api/answer'
const STOP = '/api/stop'
const DISCUSS = '/api/discuss'
const RUNS = '/api/runs/'
const DIFF = '/api/diff'
const CHANGES = '/api/changes/'
const ACCOUNT = '/api/account'
const TRACKER = '/api/tracker'

/** How often the page asks again once the server stopped answering. */
export const RETRY_MS = 5000
// The server pushes its changes: this reload only catches what a dropped stream missed.
const POLL_MS = 30_000

/** A request the server answered with an error status, in its own words. */
class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) throw new HttpError(await failure(response), response.status)
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
export interface DiffStat {
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

export const postDiscuss = (id: string, text: string) =>
  request<unknown>(DISCUSS, { method: 'POST', body: JSON.stringify({ id, text }) })

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

/** A file a fix wrote; `since`, the other findings whose runs, ended or running, wrote it after this fix last did. */
interface ChangedFile {
  path: string
  since: string[]
}

/** What `GET /api/changes/<id>` answers: the files a fix wrote, and their diff against HEAD. */
export interface ChangesPayload {
  files: ChangedFile[]
  diff: string
}

export const fetchChanges = (id: string) =>
  request<ChangesPayload>(`${CHANGES}${encodeURIComponent(id)}`)

/** What `GET /api/account` answers: null when glab cannot say. */
export interface AccountPayload {
  username: string | null
}

/** The username glab posts as, asked once while `wanted`; undefined until known or when glab cannot say. */
export function useAccount(wanted: boolean) {
  const [username, setUsername] = useState<string>()
  useEffect(() => {
    if (!wanted) return undefined
    let disposed = false
    async function load() {
      try {
        const answer = await request<AccountPayload>(ACCOUNT)
        if (!disposed && answer.username) setUsername(answer.username)
      } catch {
        // A server older than /api/account: the confirmation says "your glab account".
      }
    }
    void load()
    return () => {
      disposed = true
    }
  }, [wanted])
  return username
}

/** Where the project's issues go, asked once; undefined until known, or when the request fails. */
export function useTracker() {
  const [tracker, setTracker] = useState<Tracker>()
  useEffect(() => {
    let disposed = false
    async function load() {
      try {
        const answer = await request<Tracker>(TRACKER)
        if (!disposed) setTracker(answer)
      } catch {
        // The issue still opens, its anchor in plain text; issue.mjs reads the tracker itself.
      }
    }
    void load()
    return () => {
      disposed = true
    }
  }, [])
  return tracker
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
  /** `retrying`: the server did not answer, or failed; else it refused (409) and says why. */
  | { status: 'unavailable'; reason: string; retrying: boolean }

/**
 * The change's diff at `/api/diff`, read once per head the review shows. A
 * refusal (409: no repository, a commit not fetched) is final until `retry`;
 * any other failure is asked again every RETRY_MS while the server answers,
 * and once it answers again.
 */
export function useDiff(head: string | undefined, reachable: boolean) {
  const [state, setState] = useState<DiffState>({ status: 'loading' })
  // The head the state holds the final word on: its diff, or its refusal.
  const [settled, setSettled] = useState<string>()

  useEffect(() => {
    if (!head || !reachable || settled === head) return undefined
    let disposed = false
    let again: ReturnType<typeof setTimeout> | undefined
    async function load() {
      try {
        const payload = await fetchDiff()
        if (disposed) return
        setState({ status: 'ready', payload })
        setSettled(head)
      } catch (error) {
        if (disposed) return
        const refused = error instanceof HttpError && error.status === 409
        setState({
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'the diff could not be read',
          retrying: !refused,
        })
        if (refused) setSettled(head)
        else again = setTimeout(() => void load(), RETRY_MS)
      }
    }
    void load()
    return () => {
      disposed = true
      clearTimeout(again)
    }
  }, [head, reachable, settled])

  const retry = useCallback(() => setSettled(undefined), [])

  return { diff: state, retry }
}
