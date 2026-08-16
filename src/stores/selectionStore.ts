/**
 * The download basket.
 *
 * Two decisions shape this store:
 *
 * 1. **The basket outlives the search.** Assembling a download across several
 *    years means searching repeatedly, and losing the basket on every new
 *    search would make that impossible. So selection is never derived from
 *    the current results — it is its own state, and the UI says plainly when
 *    it holds items the current results no longer show.
 * 2. **It stores a projection, not the items.** A basket of a few thousand
 *    STAC items is megabytes of JSON, and `sessionStorage` is a few megabytes
 *    total. Keeping only what the basket, the size estimate and (in Phase 7)
 *    the manifest export actually need keeps a large basket well inside that,
 *    and keeps the persisted shape stable as item payloads change.
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { BBox2D, StacItem } from '@/types/stac'
import { dataAsset, itemKey, itemDatetime, thumbnailAsset } from '@/types/stac'
import { bboxIntersects, toBBox2D } from '@/utils/bbox'

const STORAGE_PREFIX = 'stac-browser:selection:'

/** What the basket keeps for each selected item. */
export interface BasketItem {
  /** `collection/id` — item ids are only unique within a collection. */
  key: string
  id: string
  collection: string
  datetime: string | null
  /** Bytes, from the asset's `file:size`, or null when the catalog omits it. */
  size: number | null
  /** The downloadable asset, needed for Phase 7's downloads and manifests. */
  href: string | null
  /** Public thumbnail, so the basket can show a preview with no credentials. */
  thumbnail: string | null
  bbox: BBox2D | null
}

/** Reduce a full STAC item to what the basket needs. */
export function toBasketItem(item: StacItem): BasketItem {
  const data = dataAsset(item)
  const size = data?.['file:size']

  return {
    key: itemKey(item),
    id: item.id,
    collection: item.collection ?? '',
    datetime: itemDatetime(item),
    size: typeof size === 'number' && Number.isFinite(size) ? size : null,
    href: data?.href ?? null,
    thumbnail: thumbnailAsset(item)?.href ?? null,
    bbox: item.bbox ? toBBox2D(item.bbox) : null,
  }
}

/** A total that says whether any of it was guessed. */
export interface SizeEstimate {
  /** Total bytes, known plus estimated. */
  bytes: number
  /** True when any item's size had to be inferred. */
  estimated: boolean
  /** How many items had no reported size. */
  unknownCount: number
}

/* ------------------------------------------------------------------ *
 * Persistence — a corrupt payload must never break the page
 * ------------------------------------------------------------------ */

function storageKey(apiId: string): string {
  return `${STORAGE_PREFIX}${apiId}`
}

export function loadPersisted(apiId: string): Map<string, BasketItem> {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(storageKey(apiId))
  } catch {
    return new Map() // Private mode, or storage disabled.
  }
  if (!raw) return new Map()

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    return new Map(
      parsed.filter(isValidBasketItem).map((entry) => [entry.key, entry]),
    )
  } catch {
    return new Map()
  }
}

function isValidBasketItem(value: unknown): value is BasketItem {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<BasketItem>
  return typeof entry.key === 'string' && typeof entry.id === 'string'
}

function persist(apiId: string, entries: Map<string, BasketItem>): void {
  try {
    sessionStorage.setItem(
      storageKey(apiId),
      JSON.stringify([...entries.values()]),
    )
  } catch {
    // Out of quota, or storage disabled. The basket still works this session;
    // only surviving a refresh is lost, which is not worth an error to the
    // user mid-selection.
  }
}

/* ------------------------------------------------------------------ *
 * Size estimation
 * ------------------------------------------------------------------ */

/**
 * Total the basket's bytes, filling gaps with a per-collection average.
 *
 * Tiles within one collection are near-identical in size — same grid, same
 * resolution — so a collection's own known items predict its unknown ones far
 * better than a global average does. Falls back to the global average, and
 * then to nothing at all rather than inventing a number.
 */
export function estimateSize(items: BasketItem[]): SizeEstimate {
  let known = 0
  let knownCount = 0
  const byCollection = new Map<string, { total: number; count: number }>()

  for (const item of items) {
    if (item.size == null) continue
    known += item.size
    knownCount++

    const bucket = byCollection.get(item.collection) ?? { total: 0, count: 0 }
    bucket.total += item.size
    bucket.count++
    byCollection.set(item.collection, bucket)
  }

  const globalAverage = knownCount > 0 ? known / knownCount : 0
  let estimated = 0
  let unknownCount = 0

  for (const item of items) {
    if (item.size != null) continue
    unknownCount++

    const bucket = byCollection.get(item.collection)
    estimated +=
      bucket && bucket.count > 0 ? bucket.total / bucket.count : globalAverage
  }

  return {
    bytes: known + estimated,
    // Only estimated when a guess actually contributed something.
    estimated: unknownCount > 0 && globalAverage > 0,
    unknownCount,
  }
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export const useSelectionStore = defineStore('selection', () => {
  /** Which catalog's basket this is; baskets never mix across catalogs. */
  const apiId = ref<string | null>(null)
  const entries = ref<Map<string, BasketItem>>(new Map())

  const items = computed(() => [...entries.value.values()])
  const count = computed(() => entries.value.size)
  const isEmpty = computed(() => entries.value.size === 0)

  /** Keys as a Set, for MapLibre `feature-state` and row checkboxes. */
  const keys = computed(() => new Set(entries.value.keys()))

  const size = computed(() => estimateSize(items.value))

  /**
   * Point the basket at a catalog, restoring anything a refresh left behind.
   * Idempotent, so re-entering the same route keeps the basket.
   */
  function configure(nextApiId: string | null): void {
    if (apiId.value === nextApiId) return
    apiId.value = nextApiId
    entries.value = nextApiId ? loadPersisted(nextApiId) : new Map()
  }

  function save(): void {
    if (apiId.value) persist(apiId.value, entries.value)
  }

  function has(key: string): boolean {
    return entries.value.has(key)
  }

  function add(list: StacItem[]): void {
    if (list.length === 0) return
    const next = new Map(entries.value)
    for (const item of list) next.set(itemKey(item), toBasketItem(item))
    entries.value = next
    save()
  }

  function remove(keysToRemove: string[]): void {
    if (keysToRemove.length === 0) return
    const next = new Map(entries.value)
    for (const key of keysToRemove) next.delete(key)
    entries.value = next
    save()
  }

  function toggle(item: StacItem): void {
    const key = itemKey(item)
    if (entries.value.has(key)) remove([key])
    else add([item])
  }

  /** Toggle by key, for the map, where only the key is to hand. */
  function toggleKey(key: string, pool: StacItem[]): void {
    if (entries.value.has(key)) {
      remove([key])
      return
    }
    const item = pool.find((candidate) => itemKey(candidate) === key)
    if (item) add([item])
  }

  function clear(): void {
    entries.value = new Map()
    save()
  }

  /* ---- Bulk operations (§3.4) ---- */

  function selectAll(list: StacItem[]): void {
    add(list)
  }

  /** Everything whose footprint overlaps the box — the map's own selection. */
  function selectInBbox(list: StacItem[], bbox: BBox2D): void {
    add(
      list.filter((item) => {
        if (!item.bbox) return false
        return bboxIntersects(toBBox2D(item.bbox), bbox)
      }),
    )
  }

  function selectByCollection(list: StacItem[], collection: string): void {
    add(list.filter((item) => item.collection === collection))
  }

  /**
   * Flip the selection across the loaded results.
   *
   * Only the loaded set is touched: items in the basket from an earlier search
   * are left alone, because inverting cannot sensibly mean "discard things you
   * can no longer see".
   */
  function invert(list: StacItem[]): void {
    const next = new Map(entries.value)
    for (const item of list) {
      const key = itemKey(item)
      if (next.has(key)) next.delete(key)
      else next.set(key, toBasketItem(item))
    }
    entries.value = next
    save()
  }

  /**
   * Basket entries not present in the current results.
   *
   * Surfaced in the UI so "12 selected" never silently disagrees with the
   * three rows the user can see.
   */
  function outOfResults(currentKeys: Set<string>): BasketItem[] {
    return items.value.filter((item) => !currentKeys.has(item.key))
  }

  return {
    apiId,
    entries,
    items,
    keys,
    count,
    isEmpty,
    size,
    configure,
    has,
    add,
    remove,
    toggle,
    toggleKey,
    clear,
    selectAll,
    selectInBbox,
    selectByCollection,
    invert,
    outOfResults,
  }
})
