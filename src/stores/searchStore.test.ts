import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MAX_PAGES, useSearchStore } from '@/stores/searchStore'
import { StacClient } from '@/services/stacClient'
import type { StacApiEntry } from '@/types/registry'
import type { StacItem } from '@/types/stac'
import page1 from '@/services/__fixtures__/search-get-page1.json'
import page2 from '@/services/__fixtures__/search-get-page2.json'
import queryablesFixture from '@/services/__fixtures__/queryables-bild.json'

const ENTRY: StacApiEntry = {
  id: 'test-catalog',
  title: 'Test catalog',
  url: 'https://api.example.org/stac/v1/',
  auth: 'none',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A client whose fetch is scripted per call, so paging is testable. */
function clientReturning(
  responses: Array<Response | Error | (() => Response | Promise<Response>)>,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let index = 0

  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      const next = responses[Math.min(index++, responses.length - 1)]
      if (next instanceof Error) throw next
      if (typeof next === 'function') return next()
      return next.clone()
    },
  )

  const client = new StacClient({
    baseUrl: ENTRY.url,
    fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    retry: { retries: 0 },
    timeoutMs: 0,
  })

  return { client, calls, fetchImpl }
}

function itemKeys(items: StacItem[]): string[] {
  return items.map((item) => `${item.collection}/${item.id}`)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('configure', () => {
  it('clears inputs and results when moving to another catalog', () => {
    const store = useSearchStore()
    const { client } = clientReturning([jsonResponse(page1)])

    store.configure(ENTRY, client)
    store.setBbox([17.9, 59.2, 18.2, 59.4])
    store.setCollections(['orto-o2-2025'])

    store.configure({ ...ENTRY, id: 'other' }, client)

    expect(store.bbox).toBeNull()
    expect(store.collections).toEqual([])
    expect(store.items).toEqual([])
  })

  it('keeps state when re-configured with the same catalog', () => {
    const store = useSearchStore()
    const { client } = clientReturning([jsonResponse(page1)])

    store.configure(ENTRY, client)
    store.setBbox([17.9, 59.2, 18.2, 59.4])
    store.configure(ENTRY)

    expect(store.bbox).toEqual([17.9, 59.2, 18.2, 59.4])
  })
})

describe('search', () => {
  it('loads the first page and keeps the next link', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([jsonResponse(page1)])
    store.configure(ENTRY, client)
    store.setBbox([17.9, 59.2, 18.2, 59.4])

    await store.search()

    expect(store.items).toHaveLength(5)
    expect(store.pages).toBe(1)
    expect(store.nextLink?.rel).toBe('next')
    expect(store.hasSearched).toBe(true)
    expect(store.loading).toBe(false)
  })

  it('sends bbox, collections and datetime as query parameters', async () => {
    const store = useSearchStore()
    const { client, calls } = clientReturning([jsonResponse(page1)])
    store.configure(ENTRY, client)
    store.setBbox([17.9, 59.2, 18.2, 59.4])
    store.setCollections(['orto-o2-2025', 'orto-o2-2024'])
    store.setDatetime('2024-01-01T00:00:00Z/..')

    await store.search()

    const url = new URL(calls[0].url)
    expect(url.searchParams.get('bbox')).toBe('17.9,59.2,18.2,59.4')
    expect(url.searchParams.get('collections')).toBe(
      'orto-o2-2025,orto-o2-2024',
    )
    expect(url.searchParams.get('datetime')).toBe('2024-01-01T00:00:00Z/..')
  })

  it('switches to POST once a CQL2 filter is active', async () => {
    const store = useSearchStore()
    const { client, calls } = clientReturning([jsonResponse(page1)])
    store.configure(ENTRY, client)
    store.queryableFields = [
      { name: 'flygar', kind: 'number', label: 'flygår', minimum: 1950 },
    ]
    store.setQueryableValues({
      flygar: { kind: 'number', min: 2024, max: null },
    })

    await store.search()

    expect(calls[0].init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.filter).toEqual({
      op: '>=',
      args: [{ property: 'flygar' }, 2024],
    })
    expect(body['filter-lang']).toBe('cql2-json')
  })

  it('records a failure without throwing, and clears stale results', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([
      jsonResponse(page1),
      jsonResponse({}, 500),
    ])
    store.configure(ENTRY, client)

    await store.search()
    expect(store.items).toHaveLength(5)

    await store.search()

    expect(store.error).toMatchObject({ kind: 'http', status: 500 })
    expect(store.items).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('labels an unreachable host as a likely CORS problem', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([new TypeError('Failed to fetch')])
    store.configure(ENTRY, client)

    await store.search()

    expect(store.error).toMatchObject({ kind: 'network', likelyCors: true })
  })

  it('lets a later search win over an earlier slow one', async () => {
    const store = useSearchStore()
    // A response the test holds open, so the first search is still in flight
    // when the second one starts.
    let release!: (response: Response) => void
    const held = new Promise<Response>((resolve) => {
      release = resolve
    })

    const { client } = clientReturning([() => held, jsonResponse(page2)])
    store.configure(ENTRY, client)

    const slow = store.search()
    const fast = store.search()
    await fast
    release(jsonResponse(page1))
    await slow

    // The stale first response must not overwrite the second's results.
    expect(itemKeys(store.items)[0]).toBe('orto-o2-2025/o65825_6800_25_mr25')
  })
})

describe('loadMore', () => {
  it('appends the next page and advances the page count', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([
      jsonResponse(page1),
      jsonResponse(page2),
    ])
    store.configure(ENTRY, client)

    await store.search()
    await store.loadMore()

    expect(store.items).toHaveLength(10)
    expect(store.pages).toBe(2)
  })

  it('follows the next link rather than re-running the search', async () => {
    const store = useSearchStore()
    const { client, calls } = clientReturning([
      jsonResponse(page1),
      jsonResponse(page2),
    ])
    store.configure(ENTRY, client)

    await store.search()
    await store.loadMore()

    expect(calls[1].url).toContain('token=')
  })

  it('collapses an item repeated across a page boundary', async () => {
    const store = useSearchStore()
    // A token-paged API can re-emit an item; two features sharing one
    // feature-state id would make selection visibly wrong on the map.
    const { client } = clientReturning([
      jsonResponse(page1),
      jsonResponse(page1),
    ])
    store.configure(ENTRY, client)

    await store.search()
    await store.loadMore()

    expect(store.items).toHaveLength(5)
    expect(new Set(itemKeys(store.items)).size).toBe(5)
  })

  it('keeps the loaded pages when a later page fails', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([
      jsonResponse(page1),
      jsonResponse({}, 503),
    ])
    store.configure(ENTRY, client)

    await store.search()
    await store.loadMore()

    expect(store.error).toMatchObject({ status: 503 })
    expect(store.items).toHaveLength(5)
    expect(store.nextLink).not.toBeNull()
  })

  it('stops at the page cap even while a next link remains', async () => {
    const store = useSearchStore()
    // Every page carries a next link, so only the cap ends the loop.
    const { client } = clientReturning([jsonResponse(page1)])
    store.configure(ENTRY, client)

    await store.search()
    for (let index = 0; index < MAX_PAGES + 5; index++) await store.loadMore()

    expect(store.pages).toBe(MAX_PAGES)
    expect(store.hasMore).toBe(false)
    expect(store.hitPageCap).toBe(true)
  })

  it('reports completion when the API stops sending a next link', async () => {
    const store = useSearchStore()
    const lastPage = { ...page2, links: [] }
    const { client } = clientReturning([
      jsonResponse(page1),
      jsonResponse(lastPage),
    ])
    store.configure(ENTRY, client)

    await store.search()
    expect(store.isComplete).toBe(false)

    await store.loadMore()

    expect(store.isComplete).toBe(true)
    expect(store.hasMore).toBe(false)
  })
})

describe('area guard', () => {
  it('flags a bbox large enough to run away', () => {
    const store = useSearchStore()
    store.configure(ENTRY)
    // Roughly the southern third of Sweden.
    store.setBbox([11, 55, 19, 60])

    expect(store.areaKm2).toBeGreaterThan(2_500)
    expect(store.isLargeArea).toBe(true)
  })

  it('leaves a city-sized bbox alone', () => {
    const store = useSearchStore()
    store.configure(ENTRY)
    store.setBbox([17.9, 59.2, 18.2, 59.4])

    expect(store.isLargeArea).toBe(false)
  })
})

describe('metadata loading', () => {
  it('fetches collections once per catalog', async () => {
    const store = useSearchStore()
    const { client, fetchImpl } = clientReturning([
      jsonResponse({ collections: [{ id: 'a' }], links: [] }),
    ])
    store.configure(ENTRY, client)

    await store.loadCollections()
    await store.loadCollections()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.allCollections).toHaveLength(1)
  })

  it('builds filter fields from the catalog queryables', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([jsonResponse(queryablesFixture)])
    store.configure(ENTRY, client)

    await store.loadQueryables()

    expect(store.queryableFields.map((field) => field.name).sort()).toEqual([
      'flygar',
      'flyghojd',
      'spektraltyp',
      'upplosning',
    ])
  })

  it('leaves the panel usable when a catalog has no queryables', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([jsonResponse({}, 404)])
    store.configure(ENTRY, client)

    await store.loadQueryables()

    expect(store.queryableFields).toEqual([])
    expect(store.queryablesLoading).toBe(false)
    // A 404 means "not supported", not "something went wrong" — no error to show.
    expect(store.queryablesError).toBeNull()
  })

  it('records a real queryables failure rather than swallowing it', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([jsonResponse({ message: 'boom' }, 500)])
    store.configure(ENTRY, client)

    await store.loadQueryables()

    expect(store.queryableFields).toEqual([])
    expect(store.queryablesError).toMatchObject({ kind: 'http', status: 500 })
  })

  it('records a collections failure for the panel to show', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([jsonResponse({ message: 'boom' }, 500)])
    store.configure(ENTRY, client)

    await store.loadCollections()

    expect(store.allCollections).toEqual([])
    expect(store.collectionsError).toMatchObject({ kind: 'http', status: 500 })
  })

  it('clears stale metadata errors when the catalog changes', async () => {
    const store = useSearchStore()
    const failing = clientReturning([jsonResponse({ message: 'boom' }, 500)])
    store.configure(ENTRY, failing.client)
    await store.loadCollections()
    await store.loadQueryables()
    expect(store.collectionsError).not.toBeNull()
    expect(store.queryablesError).not.toBeNull()

    const OTHER: StacApiEntry = { ...ENTRY, id: 'other-catalog' }
    const working = clientReturning([jsonResponse(queryablesFixture)])
    store.configure(OTHER, working.client)

    expect(store.collectionsError).toBeNull()
    expect(store.queryablesError).toBeNull()
  })
})

describe('clearFilters', () => {
  it('empties every input but keeps the results on screen', async () => {
    const store = useSearchStore()
    const { client } = clientReturning([jsonResponse(page1)])
    store.configure(ENTRY, client)
    store.setBbox([17.9, 59.2, 18.2, 59.4])
    store.setDatetime('2024-01-01T00:00:00Z/..')
    await store.search()

    store.clearFilters()

    expect(store.hasActiveFilters).toBe(false)
    expect(store.items).toHaveLength(5)
  })
})
