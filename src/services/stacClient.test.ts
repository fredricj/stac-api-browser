import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RETRY,
  StacClient,
  StacHttpError,
  StacNetworkError,
  StacParseError,
  backoffDelay,
  createStacClient,
  isAbortError,
  parseRetryAfter,
  searchParamsToBody,
  searchParamsToQuery,
} from '@/services/stacClient'
import type { StacLink } from '@/types/stac'

// Payloads recorded from https://api.lantmateriet.se/stac-bild/v1 — the tests
// below assert against what the API really returns, not an idealised shape.
import rootFixture from './__fixtures__/root-bild.json'
import collectionsFixture from './__fixtures__/collections-bild.json'
import collectionFixture from './__fixtures__/collection-bild.json'
import searchGetPage1 from './__fixtures__/search-get-page1.json'
import searchGetPage2 from './__fixtures__/search-get-page2.json'
import searchPostPage1 from './__fixtures__/search-post-page1.json'

const BASE = 'https://api.lantmateriet.se/stac-bild/v1'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

/**
 * Responds with each entry in turn, so retry sequences are explicit.
 *
 * Declares the real fetch signature so `mock.calls[n]` stays typed — without
 * the parameters, the mock infers an empty argument tuple.
 */
function fetchSequence(...responses: Array<Response | Error>) {
  const queue = [...responses]
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const next = queue.shift()
    if (!next) throw new Error('fetch called more times than expected')
    if (next instanceof Error) throw next
    return next
  })
}

function clientWith(fetchImpl: typeof globalThis.fetch, retries = 3) {
  return new StacClient({
    baseUrl: BASE,
    fetchImpl,
    retry: { retries, baseDelayMs: 1, maxDelayMs: 2 },
    sleep: async () => {},
  })
}

describe('URL construction', () => {
  it('joins paths whether or not the base has a trailing slash', async () => {
    for (const base of [BASE, `${BASE}/`]) {
      const fetchImpl = fetchSequence(jsonResponse(collectionFixture))
      const client = new StacClient({ baseUrl: base, fetchImpl })
      await client.getCollection('orto-o2-2025')
      expect(fetchImpl.mock.calls[0][0]).toBe(
        `${BASE}/collections/orto-o2-2025`,
      )
    }
  })

  it('requests the landing page at the base itself', async () => {
    const fetchImpl = fetchSequence(jsonResponse(rootFixture))
    await clientWith(fetchImpl).getRoot()
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/`)
  })

  it('percent-encodes collection ids', async () => {
    const fetchImpl = fetchSequence(jsonResponse(collectionFixture))
    await clientWith(fetchImpl).getCollection('a b/c')
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/collections/a%20b%2Fc`)
  })
})

describe('getRoot', () => {
  it('parses the real landing page', async () => {
    const client = clientWith(fetchSequence(jsonResponse(rootFixture)))
    const root = await client.getRoot()

    expect(root.id).toBe('lantmateriet-stac-bild')
    expect(root.type).toBe('Catalog')
    expect(root.conformsTo).toContain(
      'https://api.stacspec.org/v1.0.0/item-search',
    )
  })
})

describe('getCollections', () => {
  it('parses the real 731-collection payload', async () => {
    const fetchImpl = fetchSequence(jsonResponse(collectionsFixture))
    const collections = await clientWith(fetchImpl).getCollections()

    expect(collections).toHaveLength(731)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(collections[0].license).toBe('CC-BY-4.0')
    // Every entry must carry the extent the map needs to zoom to it.
    expect(
      collections.every((c) => c.extent?.spatial?.bbox?.[0]?.length >= 4),
    ).toBe(true)
  })

  it('follows rel=next when an API does paginate collections', async () => {
    // Lantmäteriet returns all 731 at once, but the spec allows paging, so
    // the client must handle a server that does.
    const page1 = {
      collections: [{ id: 'a' }],
      links: [{ rel: 'next', href: `${BASE}/collections?page=2` }],
    }
    const page2 = { collections: [{ id: 'b' }], links: [] }
    const fetchImpl = fetchSequence(jsonResponse(page1), jsonResponse(page2))

    const collections = await clientWith(fetchImpl).getCollections()
    expect(collections.map((c) => c.id)).toEqual(['a', 'b'])
    expect(fetchImpl.mock.calls[1][0]).toBe(`${BASE}/collections?page=2`)
  })

  it('stops at maxPages so a always-next server cannot spin forever', async () => {
    const looping = () =>
      jsonResponse({
        collections: [{ id: 'x' }],
        links: [{ rel: 'next', href: `${BASE}/collections?page=n` }],
      })
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => looping(),
    )

    const collections = await clientWith(fetchImpl).getCollections(undefined, 3)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(collections).toHaveLength(3)
  })
})

describe('search — GET path', () => {
  it('uses GET and encodes the simple params', async () => {
    const fetchImpl = fetchSequence(jsonResponse(searchGetPage1))
    await clientWith(fetchImpl).search({
      bbox: [17.9, 59.2, 18.2, 59.4],
      collections: ['orto-o2-2025'],
      datetime: '2025-01-01T00:00:00Z/..',
      limit: 5,
    })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(init?.method).toBeUndefined()
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe('/stac-bild/v1/search')
    expect(parsed.searchParams.get('bbox')).toBe('17.9,59.2,18.2,59.4')
    expect(parsed.searchParams.get('collections')).toBe('orto-o2-2025')
    expect(parsed.searchParams.get('limit')).toBe('5')
  })

  it('omits the query string entirely when there are no params', async () => {
    const fetchImpl = fetchSequence(jsonResponse(searchGetPage1))
    await clientWith(fetchImpl).search()
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/search`)
  })

  it('reports matched as null when the API does not count', async () => {
    // This is the real Lantmäteriet behaviour and it drives the whole
    // "N loaded / Load more" UX — a regression here would silently break it.
    const client = clientWith(fetchSequence(jsonResponse(searchGetPage1)))
    const page = await client.search({ limit: 5 })

    expect(page.matched).toBeNull()
    expect(page.returned).toBe(5)
    expect(page.items).toHaveLength(5)
    expect(page.next).not.toBeNull()
  })

  it('surfaces matched when an API does report it', async () => {
    const client = clientWith(
      fetchSequence(jsonResponse({ ...searchGetPage1, numberMatched: 4211 })),
    )
    expect((await client.search()).matched).toBe(4211)
  })

  it('never turns a zero result set into a null matched', async () => {
    const client = clientWith(
      fetchSequence(
        jsonResponse({
          type: 'FeatureCollection',
          features: [],
          links: [],
          numberMatched: 0,
          numberReturned: 0,
        }),
      ),
    )
    const page = await client.search()
    expect(page.matched).toBe(0)
    expect(page.next).toBeNull()
  })
})

describe('search — POST path', () => {
  it('switches to POST when a geometry is supplied', async () => {
    const fetchImpl = fetchSequence(jsonResponse(searchPostPage1))
    const intersects = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [17.9, 59.2],
          [18.1, 59.2],
          [18.1, 59.4],
          [17.9, 59.4],
          [17.9, 59.2],
        ],
      ],
    }
    await clientWith(fetchImpl).search({ intersects, limit: 3 })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${BASE}/search`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ intersects, limit: 3 })
  })

  it('switches to POST for a CQL2 filter and tags the language', async () => {
    const fetchImpl = fetchSequence(jsonResponse(searchPostPage1))
    await clientWith(fetchImpl).search({
      filter: { op: '>=', args: [{ property: 'upplosning' }, 0.16] },
      limit: 3,
    })

    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)
    expect(body['filter-lang']).toBe('cql2-json')
    expect(body.filter.op).toBe('>=')
  })

  it('keeps the request body on the page for merge-style paging', async () => {
    const client = clientWith(fetchSequence(jsonResponse(searchPostPage1)))
    const page = await client.search({
      sortby: [{ field: 'datetime', direction: 'desc' }],
    })
    expect(page.requestBody).toEqual({
      sortby: [{ field: 'datetime', direction: 'desc' }],
    })
  })
})

describe('searchNext', () => {
  it('follows a GET next link and returns the following page', async () => {
    const client = clientWith(
      fetchSequence(jsonResponse(searchGetPage1), jsonResponse(searchGetPage2)),
    )

    const page1 = await client.search({
      bbox: [17.9, 59.2, 18.2, 59.4],
      limit: 5,
    })
    const page2 = await client.searchNext(page1.next!)

    // Real consecutive pages: the token must actually advance the cursor.
    const ids1 = page1.items.map((i) => i.id)
    const ids2 = page2.items.map((i) => i.id)
    expect(ids2).toHaveLength(5)
    expect(ids1.some((id) => ids2.includes(id))).toBe(false)
  })

  it('POSTs the link body when the next link is a POST', async () => {
    const fetchImpl = fetchSequence(
      jsonResponse(searchPostPage1),
      jsonResponse(searchGetPage2),
    )
    const client = clientWith(fetchImpl)

    const page1 = await client.search({
      intersects: { type: 'Point', coordinates: [18, 59] },
      limit: 3,
    })
    await client.searchNext(page1.next!)

    const [url, init] = fetchImpl.mock.calls[1]
    expect(url).toBe(`${BASE}/search`)
    expect(init?.method).toBe('POST')
    // Lantmäteriet sends the complete next body, token included.
    expect(JSON.parse(init?.body as string).token).toMatch(/^next:/)
  })

  it('merges into the previous body when the link sets merge', async () => {
    const fetchImpl = fetchSequence(jsonResponse(searchGetPage2))
    const link: StacLink = {
      rel: 'next',
      href: `${BASE}/search`,
      method: 'POST',
      merge: true,
      body: { token: 'next:abc' },
    }

    await clientWith(fetchImpl).searchNext(link, undefined, {
      intersects: { type: 'Point', coordinates: [18, 59] },
      limit: 3,
    })

    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toEqual({
      intersects: { type: 'Point', coordinates: [18, 59] },
      limit: 3,
      token: 'next:abc',
    })
  })

  it('replaces rather than merges when merge is absent', async () => {
    const fetchImpl = fetchSequence(jsonResponse(searchGetPage2))
    const link: StacLink = {
      rel: 'next',
      href: `${BASE}/search`,
      method: 'POST',
      body: { token: 'next:abc', limit: 3 },
    }

    await clientWith(fetchImpl).searchNext(link, undefined, { limit: 999 })

    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string)).toEqual({
      token: 'next:abc',
      limit: 3,
    })
  })

  it('returns a null next on the final page', async () => {
    const client = clientWith(
      fetchSequence(jsonResponse({ ...searchGetPage2, links: [] })),
    )
    expect((await client.search()).next).toBeNull()
  })
})

describe('errors', () => {
  it('throws StacHttpError for a 4xx and does not retry it', async () => {
    const fetchImpl = fetchSequence(
      jsonResponse(
        { message: 'nope' },
        { status: 404, statusText: 'Not Found' },
      ),
    )
    const client = clientWith(fetchImpl)

    await expect(client.getRoot()).rejects.toBeInstanceOf(StacHttpError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('marks 401 and 403 as auth errors', () => {
    expect(new StacHttpError(401, 'Unauthorized', BASE).isAuthError).toBe(true)
    expect(new StacHttpError(403, 'Forbidden', BASE).isAuthError).toBe(true)
    expect(new StacHttpError(404, 'Not Found', BASE).isAuthError).toBe(false)
  })

  it('captures a body snippet for diagnostics', async () => {
    const fetchImpl = fetchSequence(
      new Response('upstream exploded', { status: 500 }),
      new Response('upstream exploded', { status: 500 }),
    )
    const client = clientWith(fetchImpl, 1)

    await expect(client.getRoot()).rejects.toMatchObject({
      status: 500,
      bodySnippet: 'upstream exploded',
    })
  })

  it('throws StacNetworkError when the request never lands', async () => {
    const fetchImpl = fetchSequence(
      new TypeError('Failed to fetch'),
      new TypeError('Failed to fetch'),
    )
    await expect(clientWith(fetchImpl, 1).getRoot()).rejects.toBeInstanceOf(
      StacNetworkError,
    )
  })

  it('throws StacParseError when a 200 is not JSON', async () => {
    const fetchImpl = fetchSequence(new Response('<html>oops</html>'))
    await expect(clientWith(fetchImpl).getRoot()).rejects.toBeInstanceOf(
      StacParseError,
    )
  })
})

describe('retry', () => {
  it('retries a 503 and succeeds', async () => {
    const fetchImpl = fetchSequence(
      jsonResponse({}, { status: 503 }),
      jsonResponse(rootFixture),
    )
    const root = await clientWith(fetchImpl).getRoot()

    expect(root.id).toBe('lantmateriet-stac-bild')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries a network failure and succeeds', async () => {
    const fetchImpl = fetchSequence(
      new TypeError('Failed to fetch'),
      jsonResponse(rootFixture),
    )
    await expect(clientWith(fetchImpl).getRoot()).resolves.toMatchObject({
      id: 'lantmateriet-stac-bild',
    })
  })

  it('gives up after the configured number of retries', async () => {
    const fetchImpl = fetchSequence(
      jsonResponse({}, { status: 500 }),
      jsonResponse({}, { status: 500 }),
      jsonResponse({}, { status: 500 }),
    )
    await expect(clientWith(fetchImpl, 2).getRoot()).rejects.toBeInstanceOf(
      StacHttpError,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('honours Retry-After ahead of its own backoff', async () => {
    const sleep = vi.fn(async () => {})
    const fetchImpl = fetchSequence(
      jsonResponse({}, { status: 429, headers: { 'Retry-After': '2' } }),
      jsonResponse(rootFixture),
    )
    const client = new StacClient({
      baseUrl: BASE,
      fetchImpl,
      retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 2 },
      sleep,
    })

    await client.getRoot()
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('can be disabled', async () => {
    const fetchImpl = fetchSequence(jsonResponse({}, { status: 500 }))
    await expect(clientWith(fetchImpl, 0).getRoot()).rejects.toBeInstanceOf(
      StacHttpError,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('cancellation', () => {
  it('does not call fetch at all when the signal is already aborted', async () => {
    const fetchImpl = fetchSequence(jsonResponse(rootFixture))
    const controller = new AbortController()
    controller.abort()

    await expect(
      clientWith(fetchImpl).getRoot(controller.signal),
    ).rejects.toSatisfy(isAbortError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not retry an aborted request', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => {
      controller.abort()
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    await expect(
      clientWith(fetchImpl).search({}, controller.signal),
    ).rejects.toSatisfy(isAbortError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('parameter serialisation', () => {
  it('leaves absent params out of the query string', () => {
    expect(searchParamsToQuery({}).toString()).toBe('')
    expect(searchParamsToQuery({ collections: [] }).toString()).toBe('')
  })

  it('keeps limit 0 rather than treating it as absent', () => {
    expect(searchParamsToQuery({ limit: 0 }).get('limit')).toBe('0')
    expect(searchParamsToBody({ limit: 0 }).limit).toBe(0)
  })

  it('defaults filter-lang but lets the caller override it', () => {
    expect(searchParamsToBody({ filter: { op: 'and' } })['filter-lang']).toBe(
      'cql2-json',
    )
    expect(
      searchParamsToBody({ filter: { op: 'and' }, filterLang: 'cql2-text' })[
        'filter-lang'
      ],
    ).toBe('cql2-text')
  })
})

describe('backoff helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses Retry-After as seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000)
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('parses Retry-After as an HTTP date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000)
  })

  it('never returns a negative delay for a date in the past', () => {
    const now = Date.parse('2026-01-01T00:01:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now)).toBe(0)
  })

  it('returns null for absent or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter('soon')).toBeNull()
  })

  it('grows exponentially but stays under the ceiling', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const options = { retries: 5, baseDelayMs: 100, maxDelayMs: 1000 }

    expect(backoffDelay(0, options)).toBe(100)
    expect(backoffDelay(1, options)).toBe(200)
    expect(backoffDelay(4, options)).toBe(1000)
    expect(backoffDelay(9, options)).toBe(1000)
  })

  it('applies jitter rather than a fixed delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(backoffDelay(3, DEFAULT_RETRY)).toBe(0)
  })
})

describe('createStacClient', () => {
  it('builds a client bound to a base url', () => {
    expect(createStacClient(BASE).baseUrl).toBe(BASE)
  })
})
