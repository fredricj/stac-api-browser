import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '@/i18n'
import type { StacItem } from '@/types/stac'
import {
  FOOTPRINT_FILL_LAYER,
  FOOTPRINT_LINE_LAYER,
  FOOTPRINT_SOURCE,
} from '@/composables/useFootprintLayer'
import searchFixture from '@/services/__fixtures__/search-get-page1.json'

vi.mock('maplibre-gl', async () => {
  const { createMaplibreMock } = await import('@/test/maplibreMock')
  return createMaplibreMock()
})

const { lastMap, resetMaplibreMock } = await import('@/test/maplibreMock')
const StacMap = (await import('@/components/map/StacMap.vue')).default

const items = (searchFixture as unknown as { features: StacItem[] }).features

async function mountMap(props: Record<string, unknown> = {}) {
  const wrapper = mount(StacMap, {
    props: { items, selectedKeys: new Set<string>(), ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  await flushPromises()

  // The map reports ready once its style is parsed — not once the
  // basemap's tiles have arrived.
  lastMap().emit('style.load')
  await flushPromises()
  return wrapper
}

/** A MapLibre-shaped click/move event. */
function mapEvent() {
  return {
    point: { x: 10, y: 20 },
    lngLat: { lng: 18, lat: 59 },
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
}

function hit(key: string, id = key, collection = 'orto-o2-2025') {
  return { properties: { key, id, collection, datetime: null } }
}

beforeEach(() => {
  resetMaplibreMock()
  i18n.global.locale.value = 'en'
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('StacMap layers', () => {
  it('adds one source and both footprint layers', async () => {
    await mountMap()
    const map = lastMap()

    expect(map.sources.has(FOOTPRINT_SOURCE)).toBe(true)
    expect(map.getLayer(FOOTPRINT_FILL_LAYER)).toBeDefined()
    expect(map.getLayer(FOOTPRINT_LINE_LAYER)).toBeDefined()
    // One source carrying every footprint, not one source per item. The only
    // other source is the search-extent overlay.
    const footprintSources = [...map.sources.keys()].filter((id) =>
      id.startsWith('stac-footprints'),
    )
    expect(footprintSources).toEqual([FOOTPRINT_SOURCE])
  })

  it('promotes the composite key so feature-state matches basket keys', async () => {
    await mountMap()
    const source = lastMap().sources.get(FOOTPRINT_SOURCE)
    expect((source?.spec as { promoteId?: string }).promoteId).toBe('key')
  })

  it('loads every item with a geometry into the single source', async () => {
    await mountMap()
    const data = lastMap().sources.get(FOOTPRINT_SOURCE)?.data as {
      features: unknown[]
    }
    expect(data.features).toHaveLength(items.length)
  })

  it('adds navigation and scale controls', async () => {
    await mountMap()
    expect(lastMap().controls).toHaveLength(2)
  })

  it('removes the map when the component unmounts', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    wrapper.unmount()
    expect(map.removed).toBe(true)
  })
})

describe('StacMap selection', () => {
  it('reflects selected keys as feature-state', async () => {
    const key = `${items[0].collection}/${items[0].id}`
    await mountMap({ selectedKeys: new Set([key]) })

    expect(
      lastMap().getFeatureState({ source: FOOTPRINT_SOURCE, id: key }).selected,
    ).toBe(true)
  })

  it('clears feature-state for keys that leave the selection', async () => {
    const key = `${items[0].collection}/${items[0].id}`
    const wrapper = await mountMap({ selectedKeys: new Set([key]) })

    await wrapper.setProps({ selectedKeys: new Set<string>() })
    await flushPromises()

    expect(
      lastMap().getFeatureState({ source: FOOTPRINT_SOURCE, id: key }).selected,
    ).toBe(false)
  })

  it('emits toggle for a single-hit click', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.queryResult = [hit('coll/a')]

    map.emit('click', mapEvent(), FOOTPRINT_FILL_LAYER)
    await flushPromises()

    expect(wrapper.emitted('toggle')).toEqual([['coll/a']])
  })
})

describe('StacMap disambiguation popup', () => {
  it('does not open for a single hit', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.queryResult = [hit('coll/a')]

    map.emit('click', mapEvent(), FOOTPRINT_FILL_LAYER)
    await flushPromises()

    expect(wrapper.find('.popup').exists()).toBe(false)
  })

  it('lists every item under an overlapping click instead of picking one', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.queryResult = [hit('coll/a'), hit('coll/b'), hit('coll/c')]

    map.emit('click', mapEvent(), FOOTPRINT_FILL_LAYER)
    await flushPromises()

    expect(wrapper.find('.popup').exists()).toBe(true)
    expect(wrapper.findAll('.hit')).toHaveLength(3)
    expect(wrapper.text()).toContain('3 items here')
    // Nothing is selected merely by clicking an overlap.
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('collapses the duplicates a polygon produces across tile seams', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.queryResult = [hit('coll/a'), hit('coll/a'), hit('coll/b')]

    map.emit('click', mapEvent(), FOOTPRINT_FILL_LAYER)
    await flushPromises()

    expect(wrapper.findAll('.hit')).toHaveLength(2)
  })

  it('toggles the item chosen from the popup', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.queryResult = [hit('coll/a'), hit('coll/b')]

    map.emit('click', mapEvent(), FOOTPRINT_FILL_LAYER)
    await flushPromises()

    await wrapper.findAll('.hit')[1].trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([['coll/b']])
  })

  it('closes on a background click but survives a footprint click', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.queryResult = [hit('coll/a'), hit('coll/b')]

    const layerEvent = mapEvent()
    map.emit('click', layerEvent, FOOTPRINT_FILL_LAYER)
    // The layer handler marks the event handled; the background handler runs
    // for the same click and must ignore it.
    map.emit('click', layerEvent)
    await flushPromises()
    expect(wrapper.find('.popup').exists()).toBe(true)

    map.emit('click', mapEvent())
    await flushPromises()
    expect(wrapper.find('.popup').exists()).toBe(false)
  })
})

describe('StacMap hover', () => {
  it('sets hover feature-state and emits the key', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.queryResult = [hit('coll/a')]

    map.emit('mousemove', mapEvent(), FOOTPRINT_FILL_LAYER)
    await flushPromises()

    expect(
      map.getFeatureState({ source: FOOTPRINT_SOURCE, id: 'coll/a' }).hover,
    ).toBe(true)
    expect(wrapper.emitted('hover')).toEqual([['coll/a']])
    expect(map.getCanvas().style.cursor).toBe('pointer')
  })

  it('clears hover when the pointer leaves the layer', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.queryResult = [hit('coll/a')]

    map.emit('mousemove', mapEvent(), FOOTPRINT_FILL_LAYER)
    map.emit('mouseleave', undefined, FOOTPRINT_FILL_LAYER)
    await flushPromises()

    expect(
      map.getFeatureState({ source: FOOTPRINT_SOURCE, id: 'coll/a' }).hover,
    ).toBe(false)
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
    expect(map.getCanvas().style.cursor).toBe('')
  })

  it('mirrors hover driven from outside the map', async () => {
    const wrapper = await mountMap()
    await wrapper.setProps({ hoveredKey: 'coll/z' })
    await flushPromises()

    expect(
      lastMap().getFeatureState({ source: FOOTPRINT_SOURCE, id: 'coll/z' })
        .hover,
    ).toBe(true)
  })
})

describe('StacMap basemap switching', () => {
  it('offers the three basemaps and marks the active one', async () => {
    const wrapper = await mountMap()
    expect(wrapper.findAll('.basemap-switcher .option')).toHaveLength(3)
    expect(wrapper.findAll('.option.is-active')).toHaveLength(1)
  })

  it('ignores styledata entirely', async () => {
    // Regression: `styledata` fires for any style mutation, including the
    // `setData` that pushes footprints. Keying readiness to it looped
    // setData -> styledata -> setData and froze the browser tab.
    const wrapper = await mountMap()
    const map = lastMap()
    const before = map.setDataCalls

    for (let i = 0; i < 25; i++) map.emit('styledata')
    await flushPromises()

    expect(map.setDataCalls).toBe(before)
    expect(wrapper.find('.map-root').exists()).toBe(true)
  })

  it('becomes ready without waiting for the basemap tiles', async () => {
    // Regression: readiness hung off `load`, which waits for the first full
    // render. A slow or blocked basemap meant it never fired, and the app's
    // own layers — footprints and the search box — never appeared at all.
    const wrapper = mount(StacMap, {
      props: { items, selectedKeys: new Set<string>() },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    await flushPromises()

    const map = lastMap()
    // `style.load` only: no `load`, as when tiles never arrive.
    map.emit('style.load')
    await flushPromises()

    expect(map.sources.has(FOOTPRINT_SOURCE)).toBe(true)
    expect(map.getLayer(FOOTPRINT_FILL_LAYER)).toBeDefined()
    wrapper.unmount()
  })

  it('re-adds the footprint layers after a style swap wipes them', async () => {
    const wrapper = await mountMap({ selectedKeys: new Set(['coll/a']) })
    const map = lastMap()

    const aerial = wrapper
      .findAll('.basemap-switcher .option')
      .find((option) => option.text() === 'Aerial')!
    await aerial.trigger('click')

    // setStyle clears everything the app added...
    expect(map.sources.has(FOOTPRINT_SOURCE)).toBe(false)

    // ...and the new style loading must bring it all back, selection included.
    map.emit('style.load')
    await flushPromises()

    expect(map.sources.has(FOOTPRINT_SOURCE)).toBe(true)
    expect(map.getLayer(FOOTPRINT_FILL_LAYER)).toBeDefined()
    expect(
      map.getFeatureState({ source: FOOTPRINT_SOURCE, id: 'coll/a' }).selected,
    ).toBe(true)
  })
})

describe('StacMap search controls', () => {
  it('turns the current viewport into a bbox for "Search this area"', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.bounds = { west: 17.5, south: 58.8, east: 18.5, north: 59.4 }

    const button = wrapper
      .findAll('.toolbar .tool')
      .find((tool) => tool.text() === 'Search this area')!
    await button.trigger('click')

    expect(wrapper.emitted('searchArea')?.[0]?.[0]).toEqual([
      17.5, 58.8, 18.5, 59.4,
    ])
    // The drawn box follows the viewport, so the panel shows what was searched.
    expect(wrapper.emitted('update:bbox')?.at(-1)?.[0]).toEqual([
      17.5, 58.8, 18.5, 59.4,
    ])
  })

  it('reports the camera on moveend so the URL can carry it', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    map.camera = { lon: 18.07, lat: 59.33, zoom: 12 }

    map.emit('moveend')
    await flushPromises()

    expect(wrapper.emitted('viewChange')?.at(-1)?.[0]).toEqual({
      lon: 18.07,
      lat: 59.33,
      zoom: 12,
    })
  })

  it('fits to a bbox when a coordinate search asks it to', async () => {
    const wrapper = await mountMap()
    const map = lastMap()

    wrapper.vm.fitToBbox([17.9, 59.2, 18.2, 59.4])

    expect(map.fitBoundsCalls).not.toHaveLength(0)
  })

  it('stops refitting once the user has panned themselves', async () => {
    const wrapper = await mountMap()
    const map = lastMap()
    const before = map.fitBoundsCalls.length

    // Only user gestures carry an originalEvent; our own fitBounds does not.
    map.emit('movestart', { originalEvent: new Event('mousedown') })
    await wrapper.setProps({ items: items.slice(0, 2) })
    await flushPromises()

    expect(map.fitBoundsCalls).toHaveLength(before)
  })

  it('refits after an explicit search re-arms the auto-fit', async () => {
    const wrapper = await mountMap()
    const map = lastMap()

    map.emit('movestart', { originalEvent: new Event('mousedown') })
    wrapper.vm.resetAutoFit()
    const before = map.fitBoundsCalls.length

    await wrapper.setProps({ items: items.slice(0, 2) })
    await flushPromises()

    expect(map.fitBoundsCalls.length).toBeGreaterThan(before)
  })
})
