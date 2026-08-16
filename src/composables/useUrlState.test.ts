import { describe, expect, it } from 'vitest'
import {
  decodeMapView,
  decodeQueryableValues,
  encodeMapView,
  encodeQueryableValues,
} from '@/composables/useUrlState'
import type { QueryableField, QueryableValues } from '@/services/queryables'

const FIELDS: QueryableField[] = [
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

describe('queryable values round trip', () => {
  it('survives an encode/decode cycle', () => {
    const values: QueryableValues = {
      flygar: { kind: 'number', min: 2020, max: 2024 },
      spektraltyp: { kind: 'enum', selected: ['rgb', 'cir'] },
      note: { kind: 'string', text: 'orto*' },
    }
    expect(
      decodeQueryableValues(encodeQueryableValues(values), FIELDS),
    ).toEqual(values)
  })

  it('keeps an open-ended range open', () => {
    const values: QueryableValues = {
      flygar: { kind: 'number', min: null, max: 2024 },
    }
    const encoded = encodeQueryableValues(values)
    // Readable in a shared link, which is the point of not using JSON here.
    expect(encoded).toBe('flygar:..2024')
    expect(decodeQueryableValues(encoded, FIELDS)).toEqual(values)
  })

  it('omits values that constrain nothing', () => {
    expect(
      encodeQueryableValues({
        flygar: { kind: 'number', min: null, max: null },
        spektraltyp: { kind: 'enum', selected: [] },
        note: { kind: 'string', text: '  ' },
      }),
    ).toBe('')
  })

  it('survives a value containing its own separators', () => {
    // A hand-typed filter can contain anything; percent-encoding each part is
    // what keeps `;` and `:` from splitting the parameter apart.
    const values: QueryableValues = {
      note: { kind: 'string', text: 'a;b:c|d' },
    }
    expect(
      decodeQueryableValues(encodeQueryableValues(values), FIELDS),
    ).toEqual(values)
  })
})

describe('decodeQueryableValues — hostile and stale input', () => {
  it('drops a field the catalog no longer publishes', () => {
    expect(decodeQueryableValues('gone:2020..2024', FIELDS)).toEqual({})
  })

  it('drops enum options the catalog no longer offers', () => {
    // A bookmarked URL outlives a schema change; offering a value the server
    // would reject is worse than quietly narrowing to what still exists.
    expect(decodeQueryableValues('spektraltyp:rgb|obsolete', FIELDS)).toEqual({
      spektraltyp: { kind: 'enum', selected: ['rgb'] },
    })
  })

  it('ignores a non-numeric range', () => {
    expect(decodeQueryableValues('flygar:abc..def', FIELDS)).toEqual({})
  })

  it('ignores malformed parts instead of throwing', () => {
    expect(decodeQueryableValues(';;no-colon;flygar:2020..', FIELDS)).toEqual({
      flygar: { kind: 'number', min: 2020, max: null },
    })
  })

  it('survives a stray percent sign from a hand-edited URL', () => {
    expect(() => decodeQueryableValues('note:100%', FIELDS)).not.toThrow()
    expect(decodeQueryableValues('note:100%', FIELDS)).toEqual({
      note: { kind: 'string', text: '100%' },
    })
  })
})

describe('map view', () => {
  it('round-trips a camera', () => {
    const view = { lon: 18.0712, lat: 59.3251, zoom: 11.5 }
    expect(decodeMapView(encodeMapView(view))).toEqual(view)
  })

  it('is null for a missing or malformed parameter', () => {
    expect(decodeMapView(undefined)).toBeNull()
    expect(decodeMapView('nonsense')).toBeNull()
    expect(decodeMapView('18,59')).toBeNull()
  })

  it('rejects out-of-range values rather than moving the map somewhere absurd', () => {
    expect(decodeMapView('999,59,11')).toBeNull()
    expect(decodeMapView('18,59,99')).toBeNull()
  })
})
