/**
 * Everything one catalog's browse page searches with, and everything it got
 * back.
 *
 * Three properties of these APIs shape this store:
 *
 * 1. **There is no result total.** `numberMatched` is null, so the store
 *    counts what it has loaded and tracks whether a `next` link remains. It
 *    never exposes a page count, because none exists.
 * 2. **Searches are cancellable and frequently superseded.** Every request
 *    runs under an `AbortController` that the next one replaces, so a slow
 *    first search can never overwrite a fast second one's results.
 * 3. **Results accumulate.** *Load more* appends; a new search replaces. The
 *    two paths are separate so a failed *Load more* does not discard the
 *    pages already on screen.
 */

import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { BBox2D, StacCollection, StacItem, StacLink } from '@/types/stac'
import type { Cql2Filter, SearchParams } from '@/types/search'
import type { StacApiEntry } from '@/types/registry'
import {
  StacClient,
  StacHttpError,
  StacNetworkError,
  StacParseError,
  createStacClient,
  isAbortError,
} from '@/services/stacClient'
import {
  buildCql2Filter,
  fetchQueryables,
  parseQueryables,
  type QueryableField,
  type QueryableValues,
} from '@/services/queryables'
import { itemKey } from '@/types/stac'
import { LARGE_AREA_KM2, bboxAreaKm2, isValidBBox } from '@/utils/bbox'

/** Items per page. Large enough to fill the map, small enough to feel quick. */
export const PAGE_LIMIT = 250

/**
 * Ceiling on *Load more*.
 *
 * A generous bbox over Sweden matches hundreds of thousands of items across
 * seventy years of reflights. Without a stop, an eager user holding *Load
 * more* would pull the whole catalog into a single tab's memory.
 */
export const MAX_PAGES = 20

/* ------------------------------------------------------------------ *
 * Errors, in the shape the UI renders
 * ------------------------------------------------------------------ */

export type SearchErrorKind = 'network' | 'http' | 'parse' | 'unknown'

export interface SearchError {
  kind: SearchErrorKind
  message: string
  status?: number
  /** A blocked cross-origin request is indistinguishable from being offline. */
  likelyCors?: boolean
}

export function toSearchError(error: unknown): SearchError {
  if (error instanceof StacHttpError) {
    return {
      kind: 'http',
      status: error.status,
      message: `${error.status} ${error.statusText}`.trim(),
    }
  }
  if (error instanceof StacNetworkError) {
    return { kind: 'network', message: error.message, likelyCors: true }
  }
  if (error instanceof StacParseError) {
    return { kind: 'parse', message: error.message }
  }
  return {
    kind: 'unknown',
    message: (error as Error)?.message ?? 'Unknown error',
  }
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export const useSearchStore = defineStore('search', () => {
  /* ---- The catalog under the page ---- */

  const entry = shallowRef<StacApiEntry | null>(null)
  // Non-reactive on purpose: the client holds a fetch implementation and an
  // options bag, none of which benefit from being proxied.
  let client: StacClient | null = null

  /* ---- Search inputs ---- */

  const bbox = ref<BBox2D | null>(null)
  const collections = ref<string[]>([])
  /** RFC 3339 interval, e.g. `2020-01-01T00:00:00Z/..`. */
  const datetime = ref<string | null>(null)
  const queryableValues = ref<QueryableValues>({})

  /* ---- Catalog metadata ---- */

  const allCollections = shallowRef<StacCollection[]>([])
  const collectionsLoading = ref(false)
  const collectionsError = ref<SearchError | null>(null)

  const queryableFields = shallowRef<QueryableField[]>([])
  const queryablesLoading = ref(false)
  const queryablesError = ref<SearchError | null>(null)

  /* ---- Results ---- */

  const items = shallowRef<StacItem[]>([])
  const pages = ref(0)
  const nextLink = shallowRef<StacLink | null>(null)
  /** Body of the last POST page, needed to follow a `merge: true` next link. */
  let lastRequestBody: Record<string, unknown> | undefined

  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<SearchError | null>(null)
  /** False until the first search completes, to tell "empty" from "not yet". */
  const hasSearched = ref(false)

  let controller: AbortController | null = null

  /* ---- Derived ---- */

  const filter = computed<Cql2Filter | undefined>(() =>
    buildCql2Filter(queryableFields.value, queryableValues.value),
  )

  const areaKm2 = computed(() =>
    bbox.value && isValidBBox(bbox.value) ? bboxAreaKm2(bbox.value) : 0,
  )

  /** Above this the UI asks for confirmation rather than searching outright. */
  const isLargeArea = computed(() => areaKm2.value > LARGE_AREA_KM2)

  // Keyed off `entry`, not `client`: the client is a plain variable and would
  // not re-trigger the computed.
  const canSearch = computed(() => entry.value !== null && !loading.value)

  /** No `next` link left, so what is loaded is genuinely everything. */
  const isComplete = computed(
    () => hasSearched.value && nextLink.value === null,
  )

  const hasMore = computed(
    () => nextLink.value !== null && pages.value < MAX_PAGES,
  )

  /** More pages exist, but only an explicit new search will reach them. */
  const hitPageCap = computed(
    () => nextLink.value !== null && pages.value >= MAX_PAGES,
  )

  const hasActiveFilters = computed(
    () =>
      bbox.value !== null ||
      collections.value.length > 0 ||
      datetime.value !== null ||
      filter.value !== undefined,
  )

  /* ---- Actions ---- */

  /**
   * Point the store at a catalog. Idempotent for the same entry so a
   * re-render, or a return to the same route, keeps the results on screen.
   *
   * @param clientOverride  a pre-built client, so tests can inject a fetch
   *                        without reaching through the store.
   */
  function configure(
    next: StacApiEntry | null,
    clientOverride?: StacClient,
  ): void {
    if (entry.value?.id === next?.id && client !== null && !clientOverride) {
      return
    }

    cancel()
    entry.value = next
    client = next ? (clientOverride ?? createStacClient(next.url)) : null

    bbox.value = null
    collections.value = []
    datetime.value = null
    queryableValues.value = {}
    allCollections.value = []
    collectionsError.value = null
    queryableFields.value = []
    queryablesError.value = null
    resetResults()
  }

  function resetResults(): void {
    items.value = []
    pages.value = 0
    nextLink.value = null
    lastRequestBody = undefined
    error.value = null
    hasSearched.value = false
  }

  /** Abort whatever is in flight. Safe to call when nothing is. */
  function cancel(): void {
    controller?.abort()
    controller = null
    loading.value = false
    loadingMore.value = false
  }

  function currentParams(): SearchParams {
    return {
      bbox: bbox.value ?? undefined,
      collections: collections.value.length
        ? [...collections.value]
        : undefined,
      datetime: datetime.value ?? undefined,
      filter: filter.value,
      limit: PAGE_LIMIT,
    }
  }

  /**
   * Run a fresh search, replacing any results on screen.
   *
   * Never throws: every failure lands in `error` for the panel to render.
   */
  async function search(): Promise<void> {
    if (!client) return

    cancel()
    const signal = newSignal()

    loading.value = true
    error.value = null

    try {
      const page = await client.search(currentParams(), signal)
      if (signal.aborted) return

      items.value = dedupe(page.items)
      pages.value = 1
      nextLink.value = page.next
      lastRequestBody = page.requestBody
      hasSearched.value = true
    } catch (caught) {
      if (isAbortError(caught)) return
      error.value = toSearchError(caught)
      items.value = []
      pages.value = 0
      nextLink.value = null
      hasSearched.value = true
    } finally {
      if (controller?.signal === signal) loading.value = false
    }
  }

  /**
   * Append the next page.
   *
   * Failure leaves the existing results and the `next` link alone, so the
   * user can simply try again.
   */
  async function loadMore(): Promise<void> {
    const link = nextLink.value
    if (!client || !link || loading.value || loadingMore.value) return
    if (pages.value >= MAX_PAGES) return

    const signal = newSignal()
    loadingMore.value = true
    error.value = null

    try {
      const page = await client.searchNext(link, signal, lastRequestBody)
      if (signal.aborted) return

      items.value = dedupe([...items.value, ...page.items])
      pages.value += 1
      nextLink.value = page.next
      lastRequestBody = page.requestBody ?? lastRequestBody
    } catch (caught) {
      if (isAbortError(caught)) return
      error.value = toSearchError(caught)
    } finally {
      if (controller?.signal === signal) loadingMore.value = false
    }
  }

  /**
   * The catalog's collections, for the collection filter.
   *
   * Fetched once per catalog — 731 of them is a single ~880 KB response, big
   * enough to be worth not repeating and small enough to hold in memory.
   */
  async function loadCollections(): Promise<void> {
    if (
      !client ||
      allCollections.value.length > 0 ||
      collectionsLoading.value
    ) {
      return
    }

    collectionsLoading.value = true
    collectionsError.value = null
    try {
      allCollections.value = await client.getCollections()
    } catch (caught) {
      if (!isAbortError(caught)) collectionsError.value = toSearchError(caught)
    } finally {
      collectionsLoading.value = false
    }
  }

  /**
   * The catalog's queryables, for the generated filter controls.
   *
   * Never throws: `fetchQueryables` already turns "not supported" (404) into
   * an empty list, so anything that still reaches here is a real failure —
   * offline, CORS, a 5xx — and belongs in `queryablesError` for the panel to
   * show, the same way `search` and `loadCollections` handle theirs.
   */
  async function loadQueryables(): Promise<void> {
    if (
      !client ||
      queryableFields.value.length > 0 ||
      queryablesLoading.value
    ) {
      return
    }

    queryablesLoading.value = true
    queryablesError.value = null
    try {
      queryableFields.value = parseQueryables(await fetchQueryables(client))
    } catch (caught) {
      if (!isAbortError(caught)) queryablesError.value = toSearchError(caught)
    } finally {
      queryablesLoading.value = false
    }
  }

  /* ---- Input setters ---- */

  function setBbox(next: BBox2D | null): void {
    bbox.value = next
  }

  function setCollections(next: string[]): void {
    collections.value = next
  }

  function setDatetime(next: string | null): void {
    datetime.value = next
  }

  function setQueryableValues(next: QueryableValues): void {
    queryableValues.value = next
  }

  /** Clear every input. Results stay until the next search replaces them. */
  function clearFilters(): void {
    bbox.value = null
    collections.value = []
    datetime.value = null
    queryableValues.value = {}
  }

  function newSignal(): AbortSignal {
    controller = new AbortController()
    return controller.signal
  }

  return {
    // catalog
    entry,
    configure,
    // inputs
    bbox,
    collections,
    datetime,
    queryableValues,
    setBbox,
    setCollections,
    setDatetime,
    setQueryableValues,
    clearFilters,
    // metadata
    allCollections,
    collectionsLoading,
    collectionsError,
    queryableFields,
    queryablesLoading,
    queryablesError,
    loadCollections,
    loadQueryables,
    // results
    items,
    pages,
    nextLink,
    loading,
    loadingMore,
    error,
    hasSearched,
    // derived
    filter,
    areaKm2,
    isLargeArea,
    canSearch,
    isComplete,
    hasMore,
    hitPageCap,
    hasActiveFilters,
    // actions
    search,
    loadMore,
    cancel,
    resetResults,
  }
})

/**
 * Collapse repeats by `collection/id`.
 *
 * Token paging can re-emit an item across a page boundary, and a duplicate
 * would produce two map features sharing one `feature-state` id — selecting
 * one would visibly highlight the other.
 */
function dedupe(list: StacItem[]): StacItem[] {
  const seen = new Set<string>()
  const unique: StacItem[] = []
  for (const item of list) {
    const key = itemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}
