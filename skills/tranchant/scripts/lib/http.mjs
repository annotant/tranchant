// What the review's server and the dashboard's answer alike: JSON, the
// errors a client made, its body read with a cap, the pages' CSP, and the
// check that a request comes from the server's own page.

/**
 * Answers `body` as JSON, never cached, never sniffed.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} [body]
 * @param {import('node:http').OutgoingHttpHeaders} [headers]
 */
export function send(res, status, body, headers = {}) {
  const json = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    ...headers,
    ...(json && { 'content-type': 'application/json' }),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  res.end(json)
}

/** What a server answers to a request the client got wrong, by status. */
export const CLIENT_ERRORS = /** @type {const} */ ({
  400: 'invalid JSON',
  403: 'origin not allowed',
  413: 'body too large',
})

/**
 * A request the client got wrong. The response takes its text from
 * CLIENT_ERRORS, never from the exception: no exception text reaches a client.
 */
export class ClientError extends Error {
  /** @param {keyof typeof CLIENT_ERRORS} status */
  constructor(status) {
    super(CLIENT_ERRORS[status])
    this.status = status
  }
}

const MAX_BODY = 500_000

/**
 * A request's JSON body, `{}` when it has none.
 * @param {import('node:http').IncomingMessage} req
 */
export async function readJson(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw new ClientError(413)
  // Decoded as a whole: a character split between two chunks stays one.
  req.setEncoding('utf8')
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY) throw new ClientError(413)
  }
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    throw new ClientError(400)
  }
}

/** @param {string} value */
export const escapeHtml = (value) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// The review page draws inline SVG the producer wrote: a script in it, missed
// by the page's sanitizer, would still not run.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

/**
 * Refuses a request that is not the server's own page's. A page of another
 * site may send a request it cannot read the answer of; a same-origin GET
 * carries no Origin, and a rebound DNS name would read the answers.
 * @param {import('node:http').IncomingMessage} req
 * @param {Set<string>} origins The server's own: `http://127.0.0.1:<port>` and `http://localhost:<port>`.
 */
export function checkOrigin(req, origins) {
  const { origin } = req.headers
  if (origin && !origins.has(origin)) throw new ClientError(403)
  if (!origins.has(`http://${req.headers.host}`)) throw new ClientError(403)
}
