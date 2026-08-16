import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '@/i18n'
import type { StacItem } from '@/types/stac'
import {
  BBOX_FILL_LAYER,
  BBOX_LINE_LAYER,
  BBOX_SOURCE,
} from '@/composables/useBboxOverlay'
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
  lastMap().emit('style.load')
  await flushPromises()
  return wrapper
}

/** The single polygon the overlay source holds, or null when empty. */
function overlayRing(): number[][] | null {
  const data = lastMap().sources.get(BBOX_SOURCE)?.data as {
    features: Array<{ geometry: { coordinates: number[][][] } }>
  }
  return data?.features?.[0]?.geometry.coordinates[0] ?? null
}

beforeEach(() => {
  resetMaplibreMock()
  i18n.global.locale.value = 'en'
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('bbox overlay', () => {
  it('adds its own source and layers, separate from the footprints', async () => {
    await mountMap()
    const map = lastMap()

    expect(map.sources.has(BBOX_SOURCE)).toBe(true)
    expect(map.getLayer(BBOX_FILL_LAYER)).toBeDefined()
    expect(map.getLayer(BBOX_LINE_LAYER)).toBeDefined()
  })

  it('renders a bbox that arrives without the drawing tool', async () => {
    // The regression: "Search this area", typed bounds, the coordinate box and
    // a shared URL all set an extent without ever touching Terra Draw, and the
    // map showed nothing at all for any of them.
    const wrapper = await mountMap()
    await wrapper.setProps({ bbox: [17.9, 59.2, 18.2, 59.4] })
    await flushPromises()

    const ring = overlayRing()
    expect(ring).not.toBeNull()
    expect(ring).toEqual([
      [17.9, 59.2],
      [18.2, 59.2],
      [18.2, 59.4],
      [17.9, 59.4],
      [17.9, 59.2],
    ])
  })

  it('shows the box straight away when the page opens on a shared URL', async () => {
    await mountMap({ bbox: [17.9, 59.2, 18.2, 59.4] })
    expect(overlayRing()).not.toBeNull()
  })

  it('empties the source when the box is cleared', async () => {
    const wrapper = await mountMap({ bbox: [17.9, 59.2, 18.2, 59.4] })
    await wrapper.setProps({ bbox: null })
    await flushPromises()

    expect(overlayRing()).toBeNull()
  })

  it('ignores a degenerate box rather than drawing a zero-area sliver', async () => {
    await mountMap({ bbox: [18, 59, 18, 59.4] })
    expect(overlayRing()).toBeNull()
  })

  it('survives a basemap change', async () => {
    // setStyle discards every source and layer the app added.
    const wrapper = await mountMap({ bbox: [17.9, 59.2, 18.2, 59.4] })
    const map = lastMap()

    const aerial = wrapper
      .findAll('.basemap-switcher .option')
      .find((option) => option.text() === 'Aerial')!
    await aerial.trigger('click')
    expect(map.sources.has(BBOX_SOURCE)).toBe(false)

    map.emit('style.load')
    await flushPromises()

    expect(map.sources.has(BBOX_SOURCE)).toBe(true)
    expect(overlayRing()).not.toBeNull()
  })

  it('stays visible after the draw tool is opened but draws nothing', async () => {
    // The regression: the overlay hid on "Terra Draw attached", which latches
    // true on the first click of "Draw a box" and never clears — so one click
    // handed the only means of showing the extent to a tool that was not
    // showing one, and the box disappeared for the rest of the session.
    const wrapper = await mountMap({ bbox: [17.9, 59.2, 18.2, 59.4] })
    const map = lastMap()

    const draw = wrapper
      .findAll('.toolbar .tool')
      .find((tool) => tool.text() === 'Draw a box')!
    await draw.trigger('click')
    await flushPromises()

    expect(map.getLayoutProperty(BBOX_FILL_LAYER, 'visibility')).toBe('visible')
    expect(overlayRing()).not.toBeNull()
  })

  it('becomes visible without waiting for the basemap tiles', async () => {
    // Readiness comes from `style.load`; `load` waits for a full render and
    // never arrives when the basemap is slow or blocked.
    const wrapper = mount(StacMap, {
      props: {
        items,
        selectedKeys: new Set<string>(),
        bbox: [17.9, 59.2, 18.2, 59.4],
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    await flushPromises()
    lastMap().emit('style.load')
    await flushPromises()

    expect(overlayRing()).not.toBeNull()
    wrapper.unmount()
  })

  it('is visible while the drawing tool is not attached', async () => {
    await mountMap({ bbox: [17.9, 59.2, 18.2, 59.4] })
    const map = lastMap()

    // Terra Draw is dynamically imported and never attaches in jsdom, so the
    // static overlay is the only thing drawing the box — as it is for every
    // user who has not clicked "Draw a box".
    expect(map.getLayoutProperty(BBOX_FILL_LAYER, 'visibility')).toBe('visible')
    expect(map.getLayoutProperty(BBOX_LINE_LAYER, 'visibility')).toBe('visible')
  })
})

describe('draw tool availability', () => {
  it('keeps the draw button on screen even when the tool cannot start', async () => {
    // The regression: the button was removed outright on failure, so it simply
    // vanished after the first click with no explanation.
    const wrapper = await mountMap()
    const labels = wrapper.findAll('.toolbar .tool').map((tool) => tool.text())

    expect(labels).toContain('Draw a box')
  })

  it('offers "Clear box" alongside the draw button once a box exists', async () => {
    const wrapper = await mountMap({ bbox: [17.9, 59.2, 18.2, 59.4] })
    const labels = wrapper.findAll('.toolbar .tool').map((tool) => tool.text())

    expect(labels).toEqual(['Search this area', 'Draw a box', 'Clear box'])
  })
})
