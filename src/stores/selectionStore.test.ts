import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  estimateSize,
  loadPersisted,
  toBasketItem,
  useSelectionStore,
  type BasketItem,
} from '@/stores/selectionStore'
import type { StacItem } from '@/types/stac'
import itemFixture from '@/services/__fixtures__/item-bild.json'
import page1 from '@/services/__fixtures__/search-get-page1.json'

const liveItem = itemFixture as unknown as StacItem
const liveItems = (page1 as unknown as { features: StacItem[] }).features

/** A minimal item, for cases the fixtures do not cover. */
function makeItem(
  id: string,
  options: {
    collection?: string
    size?: number | null
    bbox?: [number, number, number, number]
  } = {},
): StacItem {
  const { collection = 'coll', size = null, bbox } = options
  return {
    type: 'Feature',
    stac_version: '1.0.0',
    id,
    collection,
    geometry: null,
    bbox,
    properties: { datetime: '2025-01-01T00:00:00Z' },
    links: [],
    assets: {
      data: {
        href: `https://example.org/${id}.tif`,
        roles: ['data'],
        ...(size == null ? {} : { 'file:size': size }),
      },
    },
  }
}

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
})

describe('toBasketItem', () => {
  it('keeps what a download needs from a real item', () => {
    const basketItem = toBasketItem(liveItem)

    expect(basketItem).toMatchObject({
      key: 'orto-o2-2025/o65700_6825_25_mr25',
      id: 'o65700_6825_25_mr25',
      collection: 'orto-o2-2025',
      size: 692_361_773,
    })
    expect(basketItem.href).toContain('.tif')
    // Public, so the basket can show a preview without credentials.
    expect(basketItem.thumbnail).toBeTruthy()
  })

  it('records a missing size as null rather than zero', () => {
    // Zero would silently understate a bulk download by hundreds of gigabytes.
    expect(toBasketItem(makeItem('a')).size).toBeNull()
  })
})

describe('estimateSize', () => {
  const known = (size: number, collection = 'coll'): BasketItem => ({
    key: `${collection}/${size}`,
    id: String(size),
    collection,
    datetime: null,
    size,
    href: null,
    thumbnail: null,
    bbox: null,
  })

  const unknown = (id: string, collection = 'coll'): BasketItem => ({
    ...known(0, collection),
    key: `${collection}/${id}`,
    id,
    size: null,
  })

  it('is exact when every size is reported', () => {
    const result = estimateSize([known(100), known(300)])
    expect(result).toEqual({ bytes: 400, estimated: false, unknownCount: 0 })
  })

  it('fills a gap from the same collection, not the whole basket', () => {
    // Tiles within a collection share a grid and resolution, so its own
    // average predicts far better than one taken across collections.
    const result = estimateSize([
      known(100, 'small'),
      known(300, 'small'),
      known(9_000, 'large'),
      unknown('gap', 'small'),
    ])

    expect(result.bytes).toBe(100 + 300 + 9_000 + 200)
    expect(result.estimated).toBe(true)
    expect(result.unknownCount).toBe(1)
  })

  it('falls back to the overall average for an unseen collection', () => {
    const result = estimateSize([known(100), known(300), unknown('x', 'other')])
    expect(result.bytes).toBe(600)
  })

  it('claims nothing when no size is known at all', () => {
    const result = estimateSize([unknown('a'), unknown('b')])
    expect(result).toEqual({ bytes: 0, estimated: false, unknownCount: 2 })
  })

  it('is empty for an empty basket', () => {
    expect(estimateSize([])).toEqual({
      bytes: 0,
      estimated: false,
      unknownCount: 0,
    })
  })
})

describe('selecting', () => {
  it('toggles an item in and out', () => {
    const store = useSelectionStore()
    store.configure('cat')

    store.toggle(liveItem)
    expect(store.count).toBe(1)
    expect(store.has('orto-o2-2025/o65700_6825_25_mr25')).toBe(true)

    store.toggle(liveItem)
    expect(store.count).toBe(0)
  })

  it('keys by collection and id, since ids repeat across collections', () => {
    const store = useSelectionStore()
    store.configure('cat')

    store.add([
      makeItem('same-id', { collection: 'a' }),
      makeItem('same-id', { collection: 'b' }),
    ])

    expect(store.count).toBe(2)
    expect([...store.keys]).toEqual(['a/same-id', 'b/same-id'])
  })

  it('adding the same item twice does not duplicate it', () => {
    const store = useSelectionStore()
    store.configure('cat')

    store.add([liveItem])
    store.add([liveItem])

    expect(store.count).toBe(1)
  })

  it('toggles by key when only the key is to hand, as on the map', () => {
    const store = useSelectionStore()
    store.configure('cat')
    const key = `${liveItems[0].collection}/${liveItems[0].id}`

    store.toggleKey(key, liveItems)
    expect(store.has(key)).toBe(true)

    store.toggleKey(key, liveItems)
    expect(store.has(key)).toBe(false)
  })

  it('ignores a key that is in no known result', () => {
    const store = useSelectionStore()
    store.configure('cat')

    store.toggleKey('ghost/none', liveItems)

    expect(store.count).toBe(0)
  })
})

describe('bulk operations', () => {
  it('selects every loaded result', () => {
    const store = useSelectionStore()
    store.configure('cat')

    store.selectAll(liveItems)

    expect(store.count).toBe(liveItems.length)
  })

  it('selects only footprints overlapping the box', () => {
    const store = useSelectionStore()
    store.configure('cat')
    const inside = makeItem('in', { bbox: [17.95, 59.25, 18.05, 59.35] })
    const outside = makeItem('out', { bbox: [10, 55, 11, 56] })
    const straddling = makeItem('edge', { bbox: [18.1, 59.3, 18.5, 59.6] })

    store.selectInBbox([inside, outside, straddling], [17.9, 59.2, 18.2, 59.4])

    // A tile straddling the edge is still one the user asked for.
    expect([...store.keys].sort()).toEqual(['coll/edge', 'coll/in'])
  })

  it('selects a single collection out of mixed results', () => {
    const store = useSelectionStore()
    store.configure('cat')

    store.selectByCollection(
      [makeItem('a', { collection: 'x' }), makeItem('b', { collection: 'y' })],
      'x',
    )

    expect([...store.keys]).toEqual(['x/a'])
  })

  it('inverts across the loaded results', () => {
    const store = useSelectionStore()
    store.configure('cat')
    const [first, second] = liveItems
    store.add([first])

    store.invert([first, second])

    expect(store.has(`${first.collection}/${first.id}`)).toBe(false)
    expect(store.has(`${second.collection}/${second.id}`)).toBe(true)
  })

  it('leaves items from an earlier search alone when inverting', () => {
    // Inverting cannot sensibly mean "discard what you can no longer see".
    const store = useSelectionStore()
    store.configure('cat')
    const earlier = makeItem('earlier', { collection: 'old' })
    store.add([earlier])

    store.invert(liveItems)

    expect(store.has('old/earlier')).toBe(true)
  })

  it('clears everything', () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.selectAll(liveItems)

    store.clear()

    expect(store.isEmpty).toBe(true)
  })
})

describe('out-of-results indicator', () => {
  it('reports basket entries the current results no longer show', () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add([liveItems[0], makeItem('stale', { collection: 'old' })])

    const missing = store.outOfResults(
      new Set([`${liveItems[0].collection}/${liveItems[0].id}`]),
    )

    expect(missing.map((item) => item.key)).toEqual(['old/stale'])
  })
})

describe('persistence', () => {
  it('survives a refresh', () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add([liveItem])

    // A refresh: a brand new store instance reading the same session.
    setActivePinia(createPinia())
    const revived = useSelectionStore()
    revived.configure('cat')

    expect(revived.count).toBe(1)
    expect(revived.items[0].size).toBe(692_361_773)
  })

  it('keeps each catalog to its own basket', () => {
    const store = useSelectionStore()
    store.configure('cat-a')
    store.add([liveItem])

    store.configure('cat-b')

    expect(store.count).toBe(0)
  })

  it('restores the previous catalog when switching back', () => {
    const store = useSelectionStore()
    store.configure('cat-a')
    store.add([liveItem])
    store.configure('cat-b')

    store.configure('cat-a')

    expect(store.count).toBe(1)
  })

  it('keeps the basket when re-configured with the same catalog', () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add([liveItem])

    store.configure('cat')

    expect(store.count).toBe(1)
  })

  it('ignores a corrupt payload rather than breaking the page', () => {
    sessionStorage.setItem('stac-browser:selection:cat', '{not json')
    expect(loadPersisted('cat')).toEqual(new Map())
  })

  it('drops entries that are not basket items', () => {
    sessionStorage.setItem(
      'stac-browser:selection:cat',
      JSON.stringify([{ nope: true }, { key: 'a/b', id: 'b' }]),
    )
    expect([...loadPersisted('cat').keys()]).toEqual(['a/b'])
  })
})
