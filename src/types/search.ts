/**
 * Item-search request and response shapes.
 *
 * @see https://github.com/radiantearth/stac-api-spec/tree/main/item-search
 */

import type { Geometry } from 'geojson'
import type { BBox, StacItem, StacLink } from './stac'

/** CQL2-JSON. Left opaque — Phase 4 builds these from `/queryables`. */
export type Cql2Filter = Record<string, unknown>

export interface SortBy {
  field: string
  direction: 'asc' | 'desc'
}

/** The `fields` extension: trim the payload to what the UI actually renders. */
export interface FieldsSelector {
  include?: string[]
  exclude?: string[]
}

export interface SearchParams {
  collections?: string[]
  ids?: string[]
  /** Mutually exclusive with `intersects` per the spec. */
  bbox?: BBox
  intersects?: Geometry
  /**
   * RFC 3339 instant or interval: `2024-01-01T00:00:00Z`,
   * `2024-01-01T00:00:00Z/2024-12-31T23:59:59Z`, or open-ended with `..`.
   */
  datetime?: string
  limit?: number
  sortby?: SortBy[]
  fields?: FieldsSelector
  /** Legacy `query` extension. Prefer `filter`. */
  query?: Record<string, unknown>
  filter?: Cql2Filter
  filterLang?: 'cql2-json' | 'cql2-text'
}

/** A single page of search results, normalised across GET and POST paging. */
export interface SearchPage {
  items: StacItem[]
  links: StacLink[]
  /**
   * Total matching items, or null when the API does not report one.
   *
   * Lantmäteriet always returns null here, so the UI must show "N loaded"
   * with a *Load more* affordance rather than "page X of Y".
   */
  matched: number | null
  /** Items in this page. */
  returned: number
  /** The `rel=next` link, or null when the result set is exhausted. */
  next: StacLink | null
  /**
   * Body sent for this page, when it was a POST. Needed to follow a `next`
   * link that sets `merge: true`, where `body` is a partial.
   */
  requestBody?: Record<string, unknown>
}

/* ------------------------------------------------------------------ *
 * Queryables — JSON Schema describing what an API can filter on.
 * Consumed in Phase 4 to generate the filter UI instead of hardcoding it.
 * ------------------------------------------------------------------ */

export interface QueryableProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  title?: string
  description?: string
  format?: string
  pattern?: string
  minimum?: number
  maximum?: number
  enum?: unknown[]
  $ref?: string
  [key: string]: unknown
}

export interface Queryables {
  $schema?: string
  $id?: string
  type: 'object'
  title?: string
  description?: string
  properties: Record<string, QueryableProperty>
  additionalProperties?: boolean
}
