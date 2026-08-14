/**
 * STAC 1.0.0 core object model.
 *
 * Typed from the spec, but deliberately permissive where the spec is:
 * `properties`, `assets` and `summaries` all carry extension fields
 * (`proj:*`, `file:*`, and Lantmäteriet's Swedish keys such as `flygar` and
 * `upplosning`), so those objects keep an index signature rather than
 * pretending the shape is closed.
 *
 * @see https://github.com/radiantearth/stac-spec
 */

import type { Geometry } from 'geojson'

/** `[west, south, east, north]`, or the 3D form with min/max elevation. */
export type BBox2D = [number, number, number, number]
export type BBox3D = [number, number, number, number, number, number]
export type BBox = BBox2D | BBox3D

/**
 * A STAC link. `method`, `body` and `merge` only appear on paging links from
 * an item-search POST, but they are part of the same object.
 */
export interface StacLink {
  rel: string
  href: string
  type?: string
  title?: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** Request body for a POST paging link. */
  body?: Record<string, unknown>
  /**
   * When true, `body` is a partial to merge into the original request body
   * rather than a complete replacement. Defaults to false.
   */
  merge?: boolean
  [key: string]: unknown
}

export interface StacAsset {
  href: string
  title?: string
  description?: string
  /** Media type, e.g. `image/tiff; application=geotiff; profile=cloud-optimized`. */
  type?: string
  /** e.g. `['data']`, `['thumbnail', 'overview']`, `['metadata']`. */
  roles?: string[]
  /** Extension fields: `file:size`, `proj:shape`, `raster:bands`, … */
  [key: string]: unknown
}

export interface StacProvider {
  name: string
  description?: string
  roles?: Array<'licensor' | 'producer' | 'processor' | 'host'>
  url?: string
}

/**
 * Item properties. `datetime` is required by the spec but nullable — when it
 * is null, `start_datetime` and `end_datetime` must both be present.
 */
export interface StacItemProperties {
  datetime: string | null
  start_datetime?: string
  end_datetime?: string
  title?: string
  description?: string
  created?: string
  updated?: string
  license?: string
  platform?: string
  constellation?: string
  instruments?: string[]
  gsd?: number
  [key: string]: unknown
}

export interface StacItem {
  type: 'Feature'
  stac_version: string
  stac_extensions?: string[]
  id: string
  geometry: Geometry | null
  /** Required by the spec whenever `geometry` is non-null. */
  bbox?: BBox
  properties: StacItemProperties
  links: StacLink[]
  assets: Record<string, StacAsset>
  collection?: string
}

export interface StacSpatialExtent {
  /** First entry is the overall extent; any others are sub-regions. */
  bbox: BBox[]
}

export interface StacTemporalExtent {
  /** `[start, end]` pairs; either side may be null meaning open-ended. */
  interval: Array<[string | null, string | null]>
}

export interface StacExtent {
  spatial: StacSpatialExtent
  temporal: StacTemporalExtent
}

export interface StacCatalog {
  type: 'Catalog'
  stac_version: string
  stac_extensions?: string[]
  id: string
  title?: string
  description: string
  links: StacLink[]
  /**
   * Only present on a STAC *API* landing page, not a static catalog. This is
   * how we tell whether an entry supports item-search at all.
   */
  conformsTo?: string[]
}

export interface StacCollection {
  type: 'Collection'
  stac_version: string
  stac_extensions?: string[]
  id: string
  title?: string
  description: string
  license: string
  extent: StacExtent
  links: StacLink[]
  keywords?: string[]
  providers?: StacProvider[]
  summaries?: Record<string, unknown>
  assets?: Record<string, StacAsset>
}

/** Response body of `GET /collections`. */
export interface StacCollectionList {
  collections: StacCollection[]
  links: StacLink[]
  numberMatched?: number | null
  numberReturned?: number
}

/** Response body of `/search` and `/collections/{id}/items`. */
export interface StacItemCollection {
  type: 'FeatureCollection'
  features: StacItem[]
  links: StacLink[]
  /**
   * Total matching the query. Frequently absent or null — Lantmäteriet never
   * reports it — so never render it without a null check.
   */
  numberMatched?: number | null
  numberReturned?: number
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** First link with the given `rel`, or null. */
export function findLink(
  links: StacLink[] | undefined,
  rel: string,
): StacLink | null {
  return links?.find((link) => link.rel === rel) ?? null
}

export function findLinks(
  links: StacLink[] | undefined,
  rel: string,
): StacLink[] {
  return links?.filter((link) => link.rel === rel) ?? []
}

/**
 * Stable key for an item.
 *
 * Item IDs are only unique *within* a collection, so anything that keys items
 * globally — the selection basket, MapLibre `feature-state`, dedupe across
 * pages — must use this, never `item.id`.
 */
export function itemKey(item: Pick<StacItem, 'id' | 'collection'>): string {
  return `${item.collection ?? ''}/${item.id}`
}

/** Assets carrying the given role, as `[key, asset]` pairs. */
export function assetsWithRole(
  item: StacItem,
  role: string,
): Array<[string, StacAsset]> {
  return Object.entries(item.assets ?? {}).filter(([, asset]) =>
    asset.roles?.includes(role),
  )
}

/**
 * The primary downloadable asset: the first with role `data`, falling back to
 * a conventional `data` key.
 */
export function dataAsset(item: StacItem): StacAsset | null {
  return assetsWithRole(item, 'data')[0]?.[1] ?? item.assets?.data ?? null
}

/** Preview image for list rows and hover, or null. Public on Lantmäteriet. */
export function thumbnailAsset(item: StacItem): StacAsset | null {
  return (
    assetsWithRole(item, 'thumbnail')[0]?.[1] ?? item.assets?.thumbnail ?? null
  )
}

/**
 * Best-effort acquisition instant. Falls back to the start of the range for
 * items that only carry `start_datetime`/`end_datetime`.
 */
export function itemDatetime(item: StacItem): string | null {
  return item.properties.datetime ?? item.properties.start_datetime ?? null
}
