import { describe, expect, it } from 'vitest'
import {
  collectionRegion,
  collectionYear,
  filterGroups,
  groupCollectionsByYear,
  toRows,
} from '@/utils/collectionGroups'
import type { StacCollection } from '@/types/stac'
import collectionsFixture from '@/services/__fixtures__/collections-bild.json'

const liveCollections = (
  collectionsFixture as unknown as { collections: StacCollection[] }
).collections

/** A collection with only the fields these helpers read. */
function collection(
  id: string,
  options: { title?: string; start?: string | null } = {},
): StacCollection {
  return {
    type: 'Collection',
    stac_version: '1.0.0',
    id,
    title: options.title,
    description: '',
    license: 'CC-BY-4.0',
    links: [],
    extent: {
      spatial: { bbox: [[11, 55, 24, 69]] },
      temporal: {
        interval: [[options.start ?? null, null]],
      },
    },
  }
}

describe('collectionYear', () => {
  it('prefers the temporal extent, which is authoritative', () => {
    // The id says 2010 but the extent says 2011; the extent wins.
    const entry = collection('orto-h-2010', { start: '2011-06-01T00:00:00Z' })
    expect(collectionYear(entry)).toBe(2011)
  })

  it('falls back to the year in the id when the extent is open-ended', () => {
    expect(collectionYear(collection('orto-arvidsjaur-2024'))).toBe(2024)
  })

  it('takes the earliest year from a range in the id', () => {
    expect(collectionYear(collection('orto-historiska-1940-1959'))).toBe(1940)
  })

  it('is null when neither source gives a year', () => {
    expect(collectionYear(collection('vektor-byggnad'))).toBeNull()
  })
})

describe('collectionRegion', () => {
  it.each([
    ['orto-arvidsjaur-2024', 'arvidsjaur'],
    ['orto-o2-2025', 'o2'],
    ['orto-historiska-1940-1959', 'historiska'],
  ])('reads %s as %s', (id, expected) => {
    expect(collectionRegion(id)).toBe(expected)
  })

  it('is null for an id that does not carry one', () => {
    expect(collectionRegion('byggnadsverk')).toBeNull()
  })
})

describe('groupCollectionsByYear', () => {
  it('orders years newest first', () => {
    const groups = groupCollectionsByYear([
      collection('orto-a-2010', { start: '2010-01-01T00:00:00Z' }),
      collection('orto-b-2024', { start: '2024-01-01T00:00:00Z' }),
      collection('orto-c-2018', { start: '2018-01-01T00:00:00Z' }),
    ])
    expect(groups.map((group) => group.key)).toEqual(['2024', '2018', '2010'])
  })

  it('puts undated collections last', () => {
    const groups = groupCollectionsByYear([
      collection('vektor-byggnad'),
      collection('orto-b-2024', { start: '2024-01-01T00:00:00Z' }),
    ])
    expect(groups.at(-1)?.key).toBe('unknown')
  })

  it('sorts within a year by title', () => {
    const groups = groupCollectionsByYear([
      collection('orto-z-2024', {
        title: 'Örebro',
        start: '2024-01-01T00:00:00Z',
      }),
      collection('orto-a-2024', {
        title: 'Arvidsjaur',
        start: '2024-01-01T00:00:00Z',
      }),
    ])
    expect(groups[0].options.map((option) => option.title)).toEqual([
      'Arvidsjaur',
      'Örebro',
    ])
  })

  it('handles the real 731-collection payload', () => {
    const groups = groupCollectionsByYear(liveCollections)
    const total = groups.reduce((sum, group) => sum + group.options.length, 0)

    expect(total).toBe(liveCollections.length)
    // Grouped into years rather than left as one flat list of 731.
    expect(groups.length).toBeGreaterThan(10)
    expect(groups.length).toBeLessThan(liveCollections.length)
  })
})

describe('filterGroups', () => {
  const groups = groupCollectionsByYear(liveCollections)

  it('returns everything for an empty query', () => {
    expect(filterGroups(groups, '   ')).toBe(groups)
  })

  it('matches on the place name parsed out of the id', () => {
    const result = filterGroups(groups, 'arvidsjaur')
    const ids = result.flatMap((group) =>
      group.options.map((option) => option.id),
    )
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => id.includes('arvidsjaur'))).toBe(true)
  })

  it('requires every term to match', () => {
    const result = filterGroups(groups, 'arvidsjaur 2024')
    expect(result.map((group) => group.key)).toEqual(['2024'])
  })

  it('drops groups left empty rather than showing bare headings', () => {
    const result = filterGroups(groups, 'zzzznothing')
    expect(result).toEqual([])
  })
})

describe('toRows', () => {
  it('interleaves headings with their options', () => {
    const rows = toRows(
      groupCollectionsByYear([
        collection('orto-a-2024', { start: '2024-01-01T00:00:00Z' }),
        collection('orto-b-2024', { start: '2024-01-01T00:00:00Z' }),
      ]),
    )
    expect(rows.map((row) => row.type)).toEqual(['header', 'option', 'option'])
  })

  it('gives every row a unique key for the virtualiser', () => {
    const rows = toRows(groupCollectionsByYear(liveCollections))
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })
})
