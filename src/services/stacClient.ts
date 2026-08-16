/**
 * A minimal STAC API client.
 *
 * Scope is deliberately narrow: the landing page, collections, and
 * item-search with paging. Everything the UI needs in later phases is built
 * on top of these five calls.
 *
 * Two behaviours are load-bearing and easy to get wrong:
 *
 * 1. **`numberMatched` is optional.** Lantmäteriet always returns null, so
 *    {@link SearchPage.matched} is `number | null` and callers must not
 *    compute page counts from it.
 * 2. **Paging links come in two shapes.** A GET search returns
 *    `{rel: 'next', href}` with the token in the query string; a POST search
 *    returns `{rel: 'next', method: 'POST', href, body}` where `body` is the
 *    complete next request (or a partial, when `merge` is true).
 */

import type {
  StacCatalog,
  StacCollection,
  StacCollectionList,
  StacItemCollection,
  StacLink,
} from '@/types/stac'
import { findLink } from '@/types/stac'
import type { SearchPage, SearchParams } from '@/types/search'

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** Base for every error this client throws, for a single catch-all. */
export class StacError extends Error {}

/** The server answered, but with a non-2xx status. */
export class StacHttpError extends StacError {
  status: number
  statusText: string
  url: string
  /** First few hundred characters of the response body, for diagnostics. */
  bodySnippet: string | undefined

  constructor(
    status: number,
    statusText: string,
    url: string,
    bodySnippet?: string,
  ) {
    super(`STAC request failed: ${status} ${statusText} (${url})`)
    this.name = 'StacHttpError'
    this.status = status
    this.statusText = statusText
    this.url = url
    this.bodySnippet = bodySnippet
  }

  /**
   * 401 means the credentials are wrong; 403 means they are valid but lack a
   * subscription to *this* product. Different user problems, different copy.
   */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }

  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500
  }
}

/** The request never produced a response — offline, DNS, TLS, or CORS. */
export class StacNetworkError extends StacError {
  url: string

  constructor(url: string, options?: { cause?: unknown }) {
    super(`Could not reach ${url}`, options)
    this.name = 'StacNetworkError'
    this.url = url
  }
}

/** A 2xx response whose body was not the JSON we expected. */
export class StacParseError extends StacError {
  url: string

  constructor(url: string, options?: { cause?: unknown }) {
    super(`Malformed JSON from ${url}`, options)
    this.name = 'StacParseError'
    this.url = url
  }
}

/**
 * True for the DOMException thrown when an AbortSignal fires.
 *
 * Duck-typed on purpose: `instanceof Error` is unreliable across realms —
 * jsdom's DOMException is not Node's Error, and an abort raised inside an
 * iframe is not the top window's Error either.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export interface RetryOptions {
  /** Additional attempts after the first. 0 disables retrying. */
  retries: number
  baseDelayMs: number
  maxDelayMs: number
}

export const DEFAULT_RETRY: RetryOptions = {
  retries: 3,
  baseDelayMs: 300,
  maxDelayMs: 8_000,
}

export interface StacClientOptions {
  /** API landing page, with or without a trailing slash. */
  baseUrl: string
  fetchImpl?: typeof globalThis.fetch
  retry?: Partial<RetryOptions>
  /** Per-attempt timeout. Set 0 to disable. */
  timeoutMs?: number
  /** Injectable so tests do not actually wait out the backoff. */
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 30_000

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(path, base).toString()
}

/**
 * `Retry-After` is either delta-seconds or an HTTP date. Returns ms, or null
 * when absent or unparseable.
 */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | null {
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const at = Date.parse(value)
  if (Number.isNaN(at)) return null
  return Math.max(0, at - now)
}

/**
 * Exponential backoff with full jitter — spreads retries out instead of
 * letting every client in the tab retry in lockstep.
 */
export function backoffDelay(attempt: number, options: RetryOptions): number {
  const ceiling = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** attempt,
  )
  return Math.random() * ceiling
}

/**
 * Combine the caller's signal with a per-attempt timeout. Returns undefined
 * when there is nothing to combine, so we never allocate needlessly.
 */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal | undefined {
  if (timeoutMs <= 0) return signal
  if (typeof AbortSignal.timeout !== 'function') return signal

  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  // `any` landed later than `timeout`; degrade to the caller's signal.
  if (typeof AbortSignal.any !== 'function') return signal
  return AbortSignal.any([signal, timeout])
}

function needsPost(params: SearchParams): boolean {
  return Boolean(
    params.intersects ||
    params.filter ||
    params.query ||
    params.fields ||
    params.sortby?.length,
  )
}

/** Search params as a GET query string. Only the simple subset gets here. */
export function searchParamsToQuery(params: SearchParams): URLSearchParams {
  const query = new URLSearchParams()
  if (params.collections?.length)
    query.set('collections', params.collections.join(','))
  if (params.ids?.length) query.set('ids', params.ids.join(','))
  if (params.bbox) query.set('bbox', params.bbox.join(','))
  if (params.datetime) query.set('datetime', params.datetime)
  if (params.limit != null) query.set('limit', String(params.limit))
  return query
}

/** Search params as a POST body, using the spec's wire names. */
export function searchParamsToBody(
  params: SearchParams,
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (params.collections?.length) body.collections = params.collections
  if (params.ids?.length) body.ids = params.ids
  if (params.bbox) body.bbox = params.bbox
  if (params.intersects) body.intersects = params.intersects
  if (params.datetime) body.datetime = params.datetime
  if (params.limit != null) body.limit = params.limit
  if (params.sortby?.length) body.sortby = params.sortby
  if (params.fields) body.fields = params.fields
  if (params.query) body.query = params.query
  if (params.filter) {
    body.filter = params.filter
    body['filter-lang'] = params.filterLang ?? 'cql2-json'
  }
  return body
}

function toSearchPage(
  payload: StacItemCollection,
  requestBody?: Record<string, unknown>,
): SearchPage {
  const items = payload.features ?? []
  return {
    items,
    links: payload.links ?? [],
    // Absent and null both mean "unknown", never zero.
    matched: payload.numberMatched ?? null,
    returned: payload.numberReturned ?? items.length,
    next: findLink(payload.links, 'next'),
    requestBody,
  }
}

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

export class StacClient {
  readonly baseUrl: string
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly retry: RetryOptions
  private readonly timeoutMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: StacClientOptions) {
    this.baseUrl = options.baseUrl
    // Bound: an unbound `globalThis.fetch` throws "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.retry = { ...DEFAULT_RETRY, ...options.retry }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.sleep = options.sleep ?? defaultSleep
  }

  /** The API landing page. `conformsTo` tells us what it supports. */
  getRoot(signal?: AbortSignal): Promise<StacCatalog> {
    return this.request<StacCatalog>(joinUrl(this.baseUrl, '.'), {}, signal)
  }

  /**
   * Every collection, following `rel=next` if the API paginates.
   *
   * Lantmäteriet returns all 731 in a single ~880 KB response, but the spec
   * permits paging, so we follow it — capped, so a server that always emits a
   * `next` link cannot spin us forever.
   */
  async getCollections(
    signal?: AbortSignal,
    maxPages = 50,
  ): Promise<StacCollection[]> {
    let url: string | null = joinUrl(this.baseUrl, 'collections')
    const collections: StacCollection[] = []

    for (let page = 0; url && page < maxPages; page++) {
      const payload: StacCollectionList =
        await this.request<StacCollectionList>(url, {}, signal)
      collections.push(...(payload.collections ?? []))
      url = findLink(payload.links, 'next')?.href ?? null
    }

    return collections
  }

  getCollection(id: string, signal?: AbortSignal): Promise<StacCollection> {
    const url = joinUrl(this.baseUrl, `collections/${encodeURIComponent(id)}`)
    return this.request<StacCollection>(url, {}, signal)
  }

  getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(joinUrl(this.baseUrl, path), {}, signal)
  }

  /**
   * Item search. Uses GET for the simple bbox/collections/datetime case so
   * requests stay cacheable and debuggable, and POST as soon as the query
   * needs a geometry, a CQL2 filter, sorting, or field selection.
   */
  async search(
    params: SearchParams = {},
    signal?: AbortSignal,
  ): Promise<SearchPage> {
    const searchUrl = joinUrl(this.baseUrl, 'search')

    if (needsPost(params)) {
      const body = searchParamsToBody(params)
      const payload = await this.postJson<StacItemCollection>(
        searchUrl,
        body,
        signal,
      )
      return toSearchPage(payload, body)
    }

    const query = searchParamsToQuery(params)
    const url = query.size ? `${searchUrl}?${query}` : searchUrl
    const payload = await this.request<StacItemCollection>(url, {}, signal)
    return toSearchPage(payload)
  }

  /**
   * Follow a `rel=next` link.
   *
   * @param link          the `next` link from the previous page
   * @param signal        cancellation
   * @param previousBody  body of the previous POST, required only when the
   *                      link sets `merge: true` (its `body` is then a partial)
   */
  async searchNext(
    link: StacLink,
    signal?: AbortSignal,
    previousBody?: Record<string, unknown>,
  ): Promise<SearchPage> {
    if (link.method === 'POST') {
      const body = link.merge
        ? { ...(previousBody ?? {}), ...(link.body ?? {}) }
        : (link.body ?? {})
      const payload = await this.postJson<StacItemCollection>(
        link.href,
        body,
        signal,
      )
      return toSearchPage(payload, body)
    }

    const payload = await this.request<StacItemCollection>(
      link.href,
      {},
      signal,
    )
    return toSearchPage(payload)
  }

  private postJson<T>(
    url: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.request<T>(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      signal,
    )
  }

  /**
   * One request, with retries. Retries network failures, 429 and 5xx; never
   * retries a 4xx (other than 429) or an aborted request.
   */
  private async request<T>(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt <= this.retry.retries; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError')
      }

      let response: Response
      try {
        response = await this.fetchImpl(url, {
          ...init,
          headers: { Accept: 'application/json', ...init.headers },
          signal: withTimeout(signal, this.timeoutMs),
        })
      } catch (error) {
        // A caller-driven abort is a decision, not a failure — never retry it.
        if (signal?.aborted || isAbortError(error)) throw error
        lastError = new StacNetworkError(url, { cause: error })
        if (attempt === this.retry.retries) throw lastError
        await this.sleep(backoffDelay(attempt, this.retry))
        continue
      }

      if (response.ok) {
        try {
          return (await response.json()) as T
        } catch (error) {
          throw new StacParseError(url, { cause: error })
        }
      }

      const httpError = new StacHttpError(
        response.status,
        response.statusText,
        url,
        await readSnippet(response),
      )

      if (!httpError.isRetryable || attempt === this.retry.retries) {
        throw httpError
      }

      lastError = httpError
      const retryAfter = parseRetryAfter(response.headers.get('Retry-After'))
      await this.sleep(retryAfter ?? backoffDelay(attempt, this.retry))
    }

    // Unreachable: the loop either returns or throws.
    throw lastError
  }
}

async function readSnippet(response: Response): Promise<string | undefined> {
  try {
    return (await response.text()).slice(0, 300)
  } catch {
    return undefined
  }
}

/** Convenience for the common case of one client per catalog. */
export function createStacClient(
  baseUrl: string,
  options: Omit<StacClientOptions, 'baseUrl'> = {},
): StacClient {
  return new StacClient({ baseUrl, ...options })
}
