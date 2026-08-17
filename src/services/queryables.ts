/**
 * `/queryables` — turning an API's JSON Schema into a filter UI.
 *
 * Hardcoding filters per catalog does not scale: `stac-bild` filters on
 * `flygar`, `flyghojd`, `upplosning` and `spektraltyp`, `stac-hojd` on
 * `skanningsomrade`, `stac-vektor` on `lanskod`, and any catalog a user adds
 * on something else entirely. The spec already publishes the answer, bounds
 * included, so the filter panel is generated rather than written.
 *
 * The generated filters emit CQL2-JSON, which all three built-in catalogs
 * advertise (`basic-cql2` + `cql2-json`).
 */

import type { Cql2Filter, Queryables, QueryableProperty } from '@/types/search'
import { StacHttpError, type StacClient } from '@/services/stacClient'

/**
 * Properties with their own dedicated control, or with no useful control at
 * all. `datetime` has the date-range picker, `geometry` and `bbox` the map,
 * and `id`/`collection` are handled by search parameters proper.
 */
const HANDLED_ELSEWHERE = new Set([
  'id',
  'collection',
  'collections',
  'geometry',
  'bbox',
  'datetime',
  'start_datetime',
  'end_datetime',
])

export type QueryableKind =
  'number' | 'string' | 'enum' | 'boolean' | 'datetime'

/** One filter control's worth of information, extracted from the schema. */
export interface QueryableField {
  name: string
  kind: QueryableKind
  /** Schema `title`, falling back to the property name. */
  label: string
  description?: string
  /** Present for `number`; drives the input's min/max and placeholder. */
  minimum?: number
  maximum?: number
  /** Whole numbers only — years are integers, resolutions are not. */
  integer?: boolean
  /** Present for `enum`. */
  options?: string[]
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

function classify(schema: QueryableProperty): QueryableKind | null {
  // A `$ref` points at an external schema (GeoJSON geometry, the STAC item
  // id definition) that we cannot render a control for.
  if (schema.$ref) return null

  if (Array.isArray(schema.enum) && schema.enum.length > 0) return 'enum'

  switch (schema.type) {
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'string':
      return schema.format === 'date-time' || schema.format === 'date'
        ? 'datetime'
        : 'string'
    default:
      return null
  }
}

/**
 * Schema to field descriptors.
 *
 * Anything unrecognised is dropped rather than rendered as a broken control:
 * a filter the user cannot trust is worse than no filter.
 */
export function parseQueryables(
  queryables: Queryables | null | undefined,
): QueryableField[] {
  const properties = queryables?.properties
  if (!properties) return []

  const fields: QueryableField[] = []

  for (const [name, schema] of Object.entries(properties)) {
    if (HANDLED_ELSEWHERE.has(name)) continue
    if (!schema || typeof schema !== 'object') continue

    const kind = classify(schema)
    if (!kind) continue

    // Date-time properties beyond `datetime` itself (`created`, `updated`,
    // `andringsdatum`) are real, but a second date picker per property earns
    // less than it costs in panel space. Left out deliberately.
    if (kind === 'datetime') continue

    fields.push({
      name,
      kind,
      label: schema.title?.trim() || name,
      description: schema.description,
      minimum: typeof schema.minimum === 'number' ? schema.minimum : undefined,
      maximum: typeof schema.maximum === 'number' ? schema.maximum : undefined,
      integer: schema.type === 'integer' || undefined,
      options:
        kind === 'enum'
          ? (schema.enum as unknown[]).map((value) => String(value))
          : undefined,
    })
  }

  // Stable, readable order — the schema's key order is whatever the server's
  // JSON serialiser happened to produce.
  return fields.sort((a, b) => a.label.localeCompare(b.label))
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

/**
 * `/queryables`, or a collection's own when `collectionId` is given.
 *
 * Returns null rather than throwing when the endpoint is missing: it is
 * optional in the spec, and a catalog without it should still be searchable
 * by bbox and date. A 404 is the only case that means "not supported" —
 * anything else (offline, CORS, a 5xx) is a real failure and propagates, so
 * the caller can tell "this catalog has no properties to filter on" from
 * "the properties could not be read" and say so.
 */
export async function fetchQueryables(
  client: StacClient,
  options: { collectionId?: string; signal?: AbortSignal } = {},
): Promise<Queryables | null> {
  const path = options.collectionId
    ? `collections/${encodeURIComponent(options.collectionId)}/queryables`
    : 'queryables'

  try {
    return await client.getJson<Queryables>(path, options.signal)
  } catch (error) {
    if (error instanceof StacHttpError && error.status === 404) return null
    throw error
  }
}

/* ------------------------------------------------------------------ *
 * CQL2
 * ------------------------------------------------------------------ */

/** What the UI holds for one field while the user edits it. */
export type QueryableValue =
  | { kind: 'number'; min?: number | null; max?: number | null }
  | { kind: 'enum'; selected: string[] }
  | { kind: 'string'; text: string }
  | { kind: 'boolean'; value: boolean | null }

export type QueryableValues = Record<string, QueryableValue>

type Cql2Expression = Record<string, unknown>

function property(name: string) {
  return { property: name }
}

/** The comparison clauses one field's value produces, if any. */
function fieldClauses(
  field: QueryableField,
  value: QueryableValue | undefined,
): Cql2Expression[] {
  if (!value) return []

  switch (value.kind) {
    case 'number': {
      const clauses: Cql2Expression[] = []
      // Only emit a bound the user actually narrowed. Echoing the schema's own
      // minimum back at the server filters nothing and just bloats the query.
      if (value.min != null && value.min !== field.minimum) {
        clauses.push({ op: '>=', args: [property(field.name), value.min] })
      }
      if (value.max != null && value.max !== field.maximum) {
        clauses.push({ op: '<=', args: [property(field.name), value.max] })
      }
      return clauses
    }

    case 'enum': {
      if (value.selected.length === 0) return []
      if (value.selected.length === 1) {
        return [{ op: '=', args: [property(field.name), value.selected[0]] }]
      }
      return [{ op: 'in', args: [property(field.name), value.selected] }]
    }

    case 'string': {
      const text = value.text.trim()
      if (!text) return []
      // A trailing or leading `*` reads as a wildcard, which is what people
      // expect from a text filter; anything else is an exact match.
      if (text.includes('*')) {
        return [
          {
            op: 'like',
            args: [property(field.name), text.replace(/\*/g, '%')],
          },
        ]
      }
      return [{ op: '=', args: [property(field.name), text] }]
    }

    case 'boolean':
      if (value.value == null) return []
      return [{ op: '=', args: [property(field.name), value.value] }]
  }
}

/**
 * Combine every active field into one CQL2-JSON filter.
 *
 * Returns undefined when nothing is active, so callers can pass it straight
 * into `SearchParams.filter` without an empty `and` forcing a POST search.
 */
export function buildCql2Filter(
  fields: QueryableField[],
  values: QueryableValues,
): Cql2Filter | undefined {
  const clauses = fields.flatMap((field) =>
    fieldClauses(field, values[field.name]),
  )

  if (clauses.length === 0) return undefined
  if (clauses.length === 1) return clauses[0] as Cql2Filter
  return { op: 'and', args: clauses } as Cql2Filter
}

/** True when a value would contribute a clause — drives the filter chips. */
export function isActiveValue(
  field: QueryableField,
  value: QueryableValue | undefined,
): boolean {
  return fieldClauses(field, value).length > 0
}

/** The blank value for a field, so every control starts from a known shape. */
export function emptyValue(field: QueryableField): QueryableValue {
  switch (field.kind) {
    case 'number':
      return { kind: 'number', min: null, max: null }
    case 'enum':
      return { kind: 'enum', selected: [] }
    case 'boolean':
      return { kind: 'boolean', value: null }
    default:
      return { kind: 'string', text: '' }
  }
}
