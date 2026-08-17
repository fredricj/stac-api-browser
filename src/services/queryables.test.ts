import { describe, expect, it } from 'vitest'
import {
  buildCql2Filter,
  emptyValue,
  fetchQueryables,
  isActiveValue,
  parseQueryables,
  type QueryableField,
  type QueryableValues,
} from '@/services/queryables'
import { StacClient } from '@/services/stacClient'
import type { Queryables } from '@/types/search'
import queryablesFixture from '@/services/__fixtures__/queryables-bild.json'

const bildQueryables = queryablesFixture as unknown as Queryables

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A client that records the URLs it was asked for. */
function clientRecording() {
  const calls: string[] = []
  const client = new StacClient({
    baseUrl: 'https://api.example.org/stac/v1/',
    fetchImpl: async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return jsonResponse(bildQueryables)
    },
  })
  return { client, calls }
}

describe('parseQueryables — against the live stac-bild schema', () => {
  const fields = parseQueryables(bildQueryables)
  const byName = new Map(fields.map((field) => [field.name, field]))

  it('keeps the filterable Swedish properties', () => {
    expect([...byName.keys()].sort()).toEqual([
      'flygar',
      'flyghojd',
      'spektraltyp',
      'upplosning',
    ])
  })

  it('carries the schema bounds through to the control', () => {
    // These drive the numeric inputs' min/max, so a user cannot ask for a
    // resolution the catalog has never held.
    expect(byName.get('upplosning')).toMatchObject({
      kind: 'number',
      minimum: 0.16,
      maximum: 1,
    })
    expect(byName.get('flygar')).toMatchObject({ minimum: 1950, maximum: 2050 })
  })

  it('uses the schema title as the label', () => {
    expect(byName.get('flygar')?.label).toBe('flygår')
  })

  it('drops properties with a dedicated control', () => {
    // `datetime` has the date-range picker and `geometry` has the map.
    expect(byName.has('datetime')).toBe(false)
    expect(byName.has('geometry')).toBe(false)
    expect(byName.has('id')).toBe(false)
  })

  it('drops $ref properties it cannot render a control for', () => {
    expect(fields.every((field) => field.kind !== 'datetime')).toBe(true)
  })

  it('treats an untyped string property as free text', () => {
    expect(byName.get('spektraltyp')?.kind).toBe('string')
  })
})

describe('parseQueryables — general schemas', () => {
  it('reads an enum as a multi-select', () => {
    const [field] = parseQueryables({
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['landsat-8', 'landsat-9'] },
      },
    })
    expect(field).toMatchObject({
      kind: 'enum',
      options: ['landsat-8', 'landsat-9'],
    })
  })

  it('marks an integer property so the control steps by whole numbers', () => {
    const [field] = parseQueryables({
      type: 'object',
      properties: { orbit: { type: 'integer' } },
    })
    expect(field).toMatchObject({ kind: 'number', integer: true })
  })

  it('returns nothing for a missing or empty schema', () => {
    expect(parseQueryables(null)).toEqual([])
    expect(parseQueryables({ type: 'object', properties: {} })).toEqual([])
  })

  it('sorts by label so the panel order is stable', () => {
    const fields = parseQueryables({
      type: 'object',
      properties: {
        zulu: { type: 'number' },
        alpha: { type: 'number' },
      },
    })
    expect(fields.map((field) => field.name)).toEqual(['alpha', 'zulu'])
  })
})

describe('fetchQueryables', () => {
  it('requests the catalog-level endpoint', async () => {
    const { client, calls } = clientRecording()

    await fetchQueryables(client)

    expect(calls[0]).toBe('https://api.example.org/stac/v1/queryables')
  })

  it('requests a collection-level endpoint when asked', async () => {
    const { client, calls } = clientRecording()

    await fetchQueryables(client, { collectionId: 'orto-o2-2025' })

    expect(calls[0]).toBe(
      'https://api.example.org/stac/v1/collections/orto-o2-2025/queryables',
    )
  })

  it('returns null when the endpoint is missing rather than failing the page', async () => {
    // /queryables is optional in the spec; a catalog without it is still
    // searchable by bbox and date.
    const client = new StacClient({
      baseUrl: 'https://api.example.org/stac/v1/',
      fetchImpl: async () => jsonResponse({ message: 'not found' }, 404),
      retry: { retries: 0 },
    })

    await expect(fetchQueryables(client)).resolves.toBeNull()
  })

  it('propagates a failure that is not "not supported"', async () => {
    // A 500, unlike a 404, does not mean the catalog lacks queryables — it
    // means the request failed, and the caller needs to know that rather
    // than silently rendering an empty properties panel.
    const client = new StacClient({
      baseUrl: 'https://api.example.org/stac/v1/',
      fetchImpl: async () => jsonResponse({ message: 'boom' }, 500),
      retry: { retries: 0 },
    })

    await expect(fetchQueryables(client)).rejects.toMatchObject({
      status: 500,
    })
  })

  it('propagates an abort', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = new StacClient({
      baseUrl: 'https://api.example.org/stac/v1/',
      fetchImpl: async () => jsonResponse(bildQueryables),
    })

    await expect(
      fetchQueryables(client, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('buildCql2Filter', () => {
  const fields: QueryableField[] = [
    {
      name: 'upplosning',
      kind: 'number',
      label: 'upplösning',
      minimum: 0.16,
      maximum: 1,
    },
    {
      name: 'flygar',
      kind: 'number',
      label: 'flygår',
      minimum: 1950,
      maximum: 2050,
    },
    {
      name: 'spektraltyp',
      kind: 'enum',
      label: 'spektraltyp',
      options: ['rgb', 'rgbi', 'cir'],
    },
    { name: 'note', kind: 'string', label: 'note' },
  ]

  it('is undefined when nothing is active', () => {
    expect(buildCql2Filter(fields, {})).toBeUndefined()
  })

  it('emits a single clause without wrapping it in an `and`', () => {
    const values: QueryableValues = {
      flygar: { kind: 'number', min: 2020, max: null },
    }
    expect(buildCql2Filter(fields, values)).toEqual({
      op: '>=',
      args: [{ property: 'flygar' }, 2020],
    })
  })

  it('combines several clauses with `and`', () => {
    const values: QueryableValues = {
      flygar: { kind: 'number', min: 2020, max: 2024 },
      spektraltyp: { kind: 'enum', selected: ['rgb'] },
    }
    expect(buildCql2Filter(fields, values)).toEqual({
      op: 'and',
      args: [
        { op: '>=', args: [{ property: 'flygar' }, 2020] },
        { op: '<=', args: [{ property: 'flygar' }, 2024] },
        { op: '=', args: [{ property: 'spektraltyp' }, 'rgb'] },
      ],
    })
  })

  it('skips a bound left at the schema default', () => {
    // Echoing the catalog's own minimum back filters nothing; it would just
    // force a POST search and bloat the query.
    const values: QueryableValues = {
      upplosning: { kind: 'number', min: 0.16, max: 0.5 },
    }
    expect(buildCql2Filter(fields, values)).toEqual({
      op: '<=',
      args: [{ property: 'upplosning' }, 0.5],
    })
  })

  it('uses `in` for a multi-value enum selection', () => {
    const values: QueryableValues = {
      spektraltyp: { kind: 'enum', selected: ['rgb', 'rgbi'] },
    }
    expect(buildCql2Filter(fields, values)).toEqual({
      op: 'in',
      args: [{ property: 'spektraltyp' }, ['rgb', 'rgbi']],
    })
  })

  it('ignores an empty enum selection and blank text', () => {
    const values: QueryableValues = {
      spektraltyp: { kind: 'enum', selected: [] },
      note: { kind: 'string', text: '   ' },
    }
    expect(buildCql2Filter(fields, values)).toBeUndefined()
  })

  it('turns a `*` in text into a CQL2 `like`', () => {
    const values: QueryableValues = { note: { kind: 'string', text: 'orto*' } }
    expect(buildCql2Filter(fields, values)).toEqual({
      op: 'like',
      args: [{ property: 'note' }, 'orto%'],
    })
  })
})

describe('isActiveValue / emptyValue', () => {
  const field: QueryableField = {
    name: 'flygar',
    kind: 'number',
    label: 'flygår',
    minimum: 1950,
    maximum: 2050,
  }

  it('reports a blank value as inactive', () => {
    expect(isActiveValue(field, emptyValue(field))).toBe(false)
  })

  it('reports a narrowed value as active', () => {
    expect(isActiveValue(field, { kind: 'number', min: 2020, max: null })).toBe(
      true,
    )
  })
})
