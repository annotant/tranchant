import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DecisionInput,
  DecisionsResult,
  ReviewPayload,
  Step,
  Tracker,
} from './domain'
import type { Unfolded } from './diff'
import type { SettingsPayload, StoredSettings } from './settings'

const REVIEW = '/api/review'
const EVENTS = '/api/events'
const DECISIONS = '/api/decisions'
const ANSWER = '/api/answer'
const STOP = '/api/stop'
const DISCUSS = '/api/discuss'
const RUNS = '/api/runs/'
const DIFF = '/api/diff'
const LINES = '/api/lines'
const CHANGES = '/api/changes/'
const ACCOUNT = '/api/account'
const TRACKER = '/api/tracker'
const SETTINGS = '/api/settings'

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

/** What `GET /api/lines` answers: lines `from` to `to` of a file at the diff's head. */
interface LinesPayload {
  from: number
  to: number
  total: number
  lines: string[]
}

const fetchLines = (path: string, from: number, to: number) =>
  request<LinesPayload>(
    `${LINES}?${new URLSearchParams({ path, from: String(from), to: String(to) }).toString()}`,
  )

/** What the reader unfolded in one file, and whether more can be. */
export interface FileUnfold extends Unfolded {
  pending: boolean
  /** Why the server refused to read the file (404, 409): its rows stay disabled. */
  error?: string
}

const NO_UNFOLDS: ReadonlyMap<string, FileUnfold> = new Map()

/**
 * The lines the reader unfolded around the diff's hunks, by path; forgotten
 * when the head changes. `unfold(path, from, to)` reads lines `from` to `to`
 * at the head; past the file's end, it learns where the file ends.
 */
export function useUnfold(head: string | undefined) {
  const [state, setState] = useState<{
    head: string | undefined
    files: ReadonlyMap<string, FileUnfold>
  }>({ head, files: NO_UNFOLDS })
  const files = state.head === head ? state.files : NO_UNFOLDS
  // The head a late answer must still be on to land.
  const current = useRef(head)
  useEffect(() => {
    current.current = head
  }, [head])

  const unfold = useCallback(
    async (path: string, from: number, to: number) => {
      const update = (change: (one: FileUnfold) => FileUnfold) =>
        setState((previous) => {
          const base = previous.head === head ? previous.files : NO_UNFOLDS
          const one = base.get(path) ?? { lines: new Map(), pending: false }
          return { head, files: new Map(base).set(path, change(one)) }
        })
      update((one) => ({ ...one, pending: true }))
      try {
        const answer = await fetchLines(path, from, to)
        if (current.current !== head) return
        update((one) => {
          const lines = new Map(one.lines)
          answer.lines.forEach((text, at) => lines.set(answer.from + at, text))
          return { lines, total: answer.total, pending: false }
        })
      } catch (error) {
        if (current.current !== head) return
        // Past the end: the file ends before `from`, and nothing is wrong.
        const past = error instanceof HttpError && error.status === 416
        // A 404 or 409 is final; a dropped request or a 5xx may pass, and leaves the buttons.
        const refused =
          error instanceof HttpError && (error.status === 404 || error.status === 409)
        update((one) => ({
          lines: one.lines,
          ...(past
            ? { total: from - 1 }
            : one.total !== undefined && { total: one.total }),
          pending: false,
          ...(refused && { error: error.message }),
        }))
      }
    },
    [head],
  )

  return { unfolds: files, unfold }
}

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

/** What `GET /api/account` answers: the username null when the tool cannot say; `tool` absent from older servers. */
export interface AccountPayload {
  username: string | null
  tool?: 'glab' | 'gh'
}

/**
 * The account the server posts as, asked once while `wanted`: `tool`'s
 * (`glab`, the batch bar's: MR comments go through glab), else the issue
 * tool's. Undefined until known, or when the server cannot say.
 */
export function useAccount(wanted: boolean, tool?: 'glab' | 'gh') {
  const [account, setAccount] = useState<AccountPayload>()
  useEffect(() => {
    if (!wanted) return undefined
    let disposed = false
    async function load() {
      try {
        const answer = await request<AccountPayload>(
          tool ? `${ACCOUNT}?tool=${tool}` : ACCOUNT,
        )
        if (!disposed) setAccount(answer)
      } catch {
        // A server older than /api/account: the confirmation says "your glab account".
      }
    }
    void load()
    return () => {
      disposed = true
    }
  }, [wanted, tool])
  return account
}

const fetchSettings = () => request<SettingsPayload>(SETTINGS)

const putSettings = (settings: StoredSettings) =>
  request<SettingsPayload>(SETTINGS, { method: 'PUT', body: JSON.stringify(settings) })

/** A change to the settings: the file as it will be, from the file as it stands. */
export type SettingsChange = (stored: StoredSettings) => StoredSettings

/**
 * The settings at `/api/settings`, read at start and on each `reload` (the
 * review's stream calls it on the server's `settings` event, and when it
 * opens again). `save` applies a change to the file as last read, one save
 * after the other, writes it whole and keeps the server's refusal in `error`.
 * `unavailable`: the server did not answer them (older, or down).
 */
export function useSettings() {
  const [payload, setPayload] = useState<SettingsPayload>()
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string>()
  // What the next save builds on: the last answer, not the render that asked.
  const latest = useRef<SettingsPayload>(undefined)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const reload = useCallback(async () => {
    try {
      const next = await fetchSettings()
      latest.current = next
      setPayload(next)
      setUnavailable(false)
    } catch {
      // A server older than /api/settings, or down: the defaults show, read-only.
      setUnavailable(true)
    } finally {
      setLoaded(true)
    }
  }, [])
  useEffect(() => {
    // Not awaited: the state is set once the server answers, never during the effect.
    void Promise.resolve().then(reload)
  }, [reload])
  const save = useCallback((change: SettingsChange) => {
    const before = saving.current
    async function turn() {
      await before
      const stored = latest.current?.settings
      if (!stored) {
        setError('The settings could not be read from the server: nothing was changed.')
        return
      }
      try {
        const next = await putSettings(change(stored))
        latest.current = next
        setPayload(next)
        setError(undefined)
      } catch (refusal) {
        setError(
          refusal instanceof Error ? refusal.message : 'The settings were not saved.',
        )
      }
    }
    saving.current = turn()
    return saving.current
  }, [])
  const dismiss = useCallback(() => setError(undefined), [])
  return { payload, loaded, unavailable, error, save, dismiss, reload }
}

/**
 * Where the project's issues go, asked at start and on each `reload` (the
 * settings' `postWith` changes it); undefined until known, or when the
 * request fails.
 */
export function useTracker() {
  const [tracker, setTracker] = useState<Tracker>()
  const reload = useCallback(async () => {
    try {
      setTracker(await request<Tracker>(TRACKER))
    } catch {
      // The issue still opens, its anchor in plain text; issue.mjs reads the tracker itself.
    }
  }, [])
  useEffect(() => {
    void Promise.resolve().then(reload)
  }, [reload])
  return { tracker, reload }
}

export const fetchRuns = async (id: string) =>
  stepsOf(await request<unknown>(`${RUNS}${encodeURIComponent(id)}`))

/**
 * The review at `/api/review`, reloaded on each `changed` event of the
 * server's stream. `reachable` turns false when a request fails or the stream
 * closes; the page then asks again every RETRY_MS until the server answers.
 * `onSettings` runs on the stream's `settings` event, and each time it opens:
 * the settings may have changed while no stream listened.
 */
export function useReview(onSettings: () => Promise<void> | void = () => undefined) {
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
      stream.addEventListener('settings', () => void onSettings())
      stream.addEventListener('open', () => {
        reload()
        void onSettings()
      })
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
  }, [load, onSettings])

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
