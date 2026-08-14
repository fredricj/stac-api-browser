import { describe, expect, it } from 'vitest'
import { itemsToFeatureCollection } from '@/composables/useFootprintLayer'
import type { StacItem } from '@/types/stac'
import { itemKey } from '@/types/stac'
import searchFixture from '@/services/__fixtures__/search-get-page1.json'

const items = (searchFixture as unknown as { features: StacItem[] }).features

function stub(id: string, collection: string, geometry: unknown = null) {
  return {
    type: 'Feature',
    id,
    collection,
    geometry,
    properties: { datetime: '2025-01-01T00:00:00Z' },
    assets: {},
    links: [],
    stac_version: '1.0.0',
  } as unknown as StacItem
}

const square = {
  type: 'Polygon',
  coordinates: [
    [
      [17, 59],
      [18, 59],
      [18, 60],
      [17, 60],
      [17, 59],
    ],
  ],
}

describe('itemsToFeatureCollection', () => {
  it('converts real search results into one FeatureCollection', () => {
    const collection = itemsToFeatureCollection(items)

    expect(collection.type).toBe('FeatureCollection')
    expect(collection.features).toHaveLength(items.length)
    expect(collection.features[0].geometry.type).toBe('Polygon')
  })

  it('keys every feature by collection and id', () => {
    const collection = itemsToFeatureCollection(items)
    const expected = itemKey(items[0])

    expect(collection.features[0].properties.key).toBe(expected)
    // The feature id must match too, so promoteId and setFeatureState agree.
    expect(collection.features[0].id).toBe(expected)
    expect(expected).toContain('/')
  })

  it('drops items with no geometry rather than emitting a broken feature', () => {
    const collection = itemsToFeatureCollection([
      stub('a', 'c1', square),
      stub('b', 'c1', null),
    ])
    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].properties.id).toBe('a')
  })

  it('collapses duplicate keys so feature-state ids stay unique', () => {
    // Overlapping result pages would otherwise yield two features sharing an id.
    const collection = itemsToFeatureCollection([
      stub('a', 'c1', square),
      stub('a', 'c1', square),
    ])
    expect(collection.features).toHaveLength(1)
  })

  it('keeps the same id in different collections apart', () => {
    // The same 2.5 km tile is reflown every few years under one id.
    const collection = itemsToFeatureCollection([
      stub('tile-1', 'orto-2019', square),
      stub('tile-1', 'orto-2024', square),
    ])

    expect(collection.features).toHaveLength(2)
    expect(collection.features.map((f) => f.properties.key)).toEqual([
      'orto-2019/tile-1',
      'orto-2024/tile-1',
    ])
  })

  it('carries only what the popup needs', () => {
    const properties = itemsToFeatureCollection(items)['features'][0]
      .properties as Record<string, unknown>

    expect(Object.keys(properties).sort()).toEqual([
      'collection',
      'datetime',
      'id',
      'key',
    ])
  })

  it('handles an empty result set', () => {
    expect(itemsToFeatureCollection([]).features).toEqual([])
  })
})
