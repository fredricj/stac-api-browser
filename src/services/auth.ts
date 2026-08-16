/**
 * HTTP Basic credentials for protected assets.
 *
 * These are real Geotorget credentials, so this module is deliberately narrow:
 * it builds one header and performs one check, and nothing it returns or
 * throws ever carries the username or password. Errors here are surfaced to
 * the user and may end up in a bug report, so a result object that quoted the
 * request would leak the password into a screenshot.
 *
 * Note this is HTTP Basic against the *asset host*, not the OAuth2
 * client-credentials flow Lantmäteriet's other Geotorget APIs use.
 */

export interface BasicCredentials {
  username: string
  password: string
}

/**
 * Base64 of `user:password`, encoded as UTF-8.
 *
 * `btoa` alone throws on anything outside Latin-1, which a Swedish password
 * containing å, ä or ö reaches immediately. RFC 7617 leaves the charset to
 * the server, but UTF-8 is what modern servers and browsers agree on, so the
 * string is encoded to bytes first and base64'd from those.
 */
export function basicAuthHeader(credentials: BasicCredentials): string {
  const raw = `${credentials.username}:${credentials.password}`
  const bytes = new TextEncoder().encode(raw)

  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return `Basic ${btoa(binary)}`
}

/**
 * What a credential check concluded.
 *
 * `invalid` and `forbidden` are the two that matter and are routinely
 * conflated. On Geotorget, access is granted *per product*: a perfectly good
 * account that has not subscribed to orthophotos gets 403, and telling that
 * user their password is wrong sends them to reset a password that was never
 * the problem.
 */
export type AuthCheckStatus =
  /** The asset is readable with these credentials. */
  | 'ok'
  /** 401 — the username or password is wrong. */
  | 'invalid'
  /** 403 — the credentials are good, but lack access to this product. */
  | 'forbidden'
  /** 404 — the asset is gone. Says nothing about the credentials. */
  | 'missing'
  /** No response at all: offline, DNS, TLS, or a CORS refusal. */
  | 'unreachable'
  /** A response we have no specific advice for. */
  | 'unexpected'

export interface AuthCheckResult {
  status: AuthCheckStatus
  /** Present when a response arrived, for diagnostics. Never a header value. */
  httpStatus?: number
}

export interface CheckOptions {
  fetchImpl?: typeof globalThis.fetch
  signal?: AbortSignal
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Verify credentials against one real asset, with a `HEAD`.
 *
 * `HEAD` because the point is the status code, and the assets behind it run
 * to hundreds of megabytes — a `GET` to learn one number would be rude to a
 * public service and slow for the user.
 *
 * Never throws for an HTTP or network outcome; every case is a status the UI
 * can explain. Only an abort propagates, because that is the caller's own
 * decision.
 */
export async function checkCredentials(
  assetUrl: string,
  credentials: BasicCredentials,
  options: CheckOptions = {},
): Promise<AuthCheckResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let response: Response
  try {
    response = await fetchImpl(assetUrl, {
      method: 'HEAD',
      headers: { Authorization: basicAuthHeader(credentials) },
      /*
       * `omit`, not `include`.
       *
       * We send our own Authorization header, so the browser has no reason to
       * attach cookies. More importantly, `include` lets the browser handle
       * the 401 itself and pop its *native* Basic-auth prompt on top of our
       * dialog — two password boxes, one of which we cannot read.
       */
      credentials: 'omit',
      signal: withTimeout(options.signal, timeoutMs),
    })
  } catch (error) {
    if (isAbort(error, options.signal)) throw error
    // A blocked cross-origin request is indistinguishable from being offline.
    return { status: 'unreachable' }
  }

  if (response.ok) return { status: 'ok', httpStatus: response.status }

  switch (response.status) {
    case 401:
      return { status: 'invalid', httpStatus: 401 }
    case 403:
      return { status: 'forbidden', httpStatus: 403 }
    case 404:
      return { status: 'missing', httpStatus: 404 }
    default:
      return { status: 'unexpected', httpStatus: response.status }
  }
}

/** Combine the caller's signal with a timeout, allocating only when needed. */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal | undefined {
  if (timeoutMs <= 0) return signal
  if (typeof AbortSignal.timeout !== 'function') return signal

  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  if (typeof AbortSignal.any !== 'function') return signal
  return AbortSignal.any([signal, timeout])
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * The host credentials are scoped to.
 *
 * Per §3.5 this is the *asset* host, which differs from the catalog host on
 * every built-in entry (`dl1.lantmateriet.se` against `api.lantmateriet.se`),
 * so keying credentials by the API's own origin would file them under a host
 * that never asks for them.
 */
export function assetHostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
