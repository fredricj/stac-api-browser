import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import SelectionBasket from '@/components/download/SelectionBasket.vue'
import DownloadDialog from '@/components/download/DownloadDialog.vue'
import { useSelectionStore } from '@/stores/selectionStore'
import type { StacItem } from '@/types/stac'
import page1 from '@/services/__fixtures__/search-get-page1.json'

const items = (page1 as unknown as { features: StacItem[] }).features

function sized(id: string, size: number | null, collection = 'coll'): StacItem {
  return {
    type: 'Feature',
    stac_version: '1.0.0',
    id,
    collection,
    geometry: null,
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

function mountBasket(props: Record<string, unknown> = {}) {
  return mount(SelectionBasket, {
    props: { items, bbox: null, entry: null, ...props },
    global: { plugins: [i18n] },
  })
}

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('empty state', () => {
  it('explains both ways of selecting', () => {
    const wrapper = mountBasket()
    const text = wrapper.find('.empty').text()

    expect(text).toContain('list')
    expect(text).toContain('map')
  })
})

describe('size estimate', () => {
  it('totals the reported sizes', () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add([sized('a', 2e9), sized('b', 3e9)])

    expect(mountBasket().find('.size-value').text()).toBe('5 GB')
  })

  it('is not labelled estimated when every size is known', () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add([sized('a', 2e9)])

    expect(mountBasket().find('.estimated').exists()).toBe(false)
  })

  it('says plainly when part of the total was inferred', () => {
    // The number must never read as a promise when it is partly a guess.
    const store = useSelectionStore()
    store.configure('cat')
    store.add([sized('a', 2e9), sized('b', null)])

    const wrapper = mountBasket()
    expect(wrapper.find('.estimated').text()).toContain('estimated')
    expect(wrapper.find('.size-value').text()).toBe('4 GB')
  })

  it('recommends a download manager once the selection is huge', () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add([sized('a', 60e9)])

    expect(mountBasket().find('.advice').exists()).toBe(true)
  })
})

describe('out-of-results indicator', () => {
  it('explains a count that exceeds what is on screen', () => {
    // The basket deliberately survives new searches, so this is correct
    // behaviour that would otherwise look like a bug.
    const store = useSelectionStore()
    store.configure('cat')
    store.add([items[0], sized('stale', 1, 'old')])

    expect(mountBasket().find('.elsewhere').text()).toContain('1 of 2')
  })

  it('stays hidden when everything selected is visible', () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add([items[0]])

    expect(mountBasket().find('.elsewhere').exists()).toBe(false)
  })
})

describe('bulk actions', () => {
  it('selects every loaded result', async () => {
    const store = useSelectionStore()
    store.configure('cat')
    const wrapper = mountBasket()

    await wrapper.findAll('.link')[0].trigger('click')

    expect(store.count).toBe(items.length)
  })

  it('offers select-in-box only when a box is set', () => {
    const store = useSelectionStore()
    store.configure('cat')

    const without = mountBasket({ bbox: null })
    expect(without.text()).not.toContain('Select all in the box')

    const withBox = mountBasket({ bbox: [17.9, 59.2, 18.2, 59.4] })
    expect(withBox.text()).toContain('Select all in the box')
  })

  it('inverts the loaded results', async () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add([items[0]])
    const wrapper = mountBasket()

    const invert = wrapper
      .findAll('.link')
      .find((button) => button.text() === 'Invert')!
    await invert.trigger('click')

    expect(store.count).toBe(items.length - 1)
  })

  it('clears when the confirmation is accepted', async () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add(items)
    const wrapper = mountBasket()

    await wrapper.find('.link--danger').trigger('click')

    expect(store.isEmpty).toBe(true)
  })
})

describe('download dialog', () => {
  // Sign-in now lives inside the download dialog itself, scoped to whichever
  // tier is actually chosen there — see DownloadDialog.test.ts. The basket's
  // only job is to hand the dialog the catalog it needs to know that.
  it('passes the catalog through to the download dialog', () => {
    const entry = {
      id: 'lantmateriet-bild',
      title: 'Ortofoto',
      url: 'https://api.lantmateriet.se/stac-bild/v1/',
      assetHost: 'dl1.lantmateriet.se',
      auth: 'basic' as const,
      docsUrl: 'https://geotorget.lantmateriet.se/product',
    }

    const wrapper = mountBasket({ entry })

    expect(wrapper.findComponent(DownloadDialog).props('entry')).toEqual(entry)
  })
})
