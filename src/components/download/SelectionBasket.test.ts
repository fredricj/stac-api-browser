import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import SelectionBasket from '@/components/download/SelectionBasket.vue'
import { useSelectionStore } from '@/stores/selectionStore'
import { useAuthStore } from '@/stores/authStore'
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

  it('confirms before discarding a basket', async () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add(items)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mountBasket()

    await wrapper.find('.link--danger').trigger('click')

    expect(confirm).toHaveBeenCalled()
    // Declining keeps the basket — it is real work assembled over time.
    expect(store.count).toBe(items.length)
  })

  it('clears when the confirmation is accepted', async () => {
    const store = useSelectionStore()
    store.configure('cat')
    store.add(items)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountBasket()

    await wrapper.find('.link--danger').trigger('click')

    expect(store.isEmpty).toBe(true)
  })
})

describe('sign-in', () => {
  const entry = {
    id: 'lantmateriet-bild',
    title: 'Ortofoto',
    url: 'https://api.lantmateriet.se/stac-bild/v1/',
    assetHost: 'dl1.lantmateriet.se',
    auth: 'basic' as const,
    docsUrl: 'https://geotorget.lantmateriet.se/product',
  }

  it('stays out of the way for a catalog that needs no sign-in', () => {
    const wrapper = mountBasket({ entry: { ...entry, auth: 'none' as const } })
    expect(wrapper.find('.auth').exists()).toBe(false)
  })

  it('offers a sign-in for a catalog whose assets are protected', () => {
    const wrapper = mountBasket({ entry })

    expect(wrapper.find('.auth').text()).toContain('dl1.lantmateriet.se')
    expect(wrapper.text()).toContain('Sign in')
  })

  it('scopes to the host of a real selected asset, not the catalog host', () => {
    // Assets live on a different origin than the catalog on every built-in
    // entry, so the credentials must be filed under the host that asks.
    const store = useSelectionStore()
    store.configure('cat')
    store.add([
      {
        ...sized('a', 1),
        assets: {
          data: { href: 'https://elsewhere.example/a.tif', roles: ['data'] },
        },
      },
    ])

    const wrapper = mountBasket({ entry })

    expect(wrapper.find('.auth').text()).toContain('elsewhere.example')
  })

  it('shows who is signed in and how long it lasts', () => {
    const auth = useAuthStore()
    auth.set('dl1.lantmateriet.se', { username: 'anna', password: 'x' })

    const wrapper = mountBasket({ entry })

    expect(wrapper.find('.auth-ok').text()).toContain('anna')
    expect(wrapper.find('.auth-scope').text()).toContain('this page load only')
  })

  it('says when credentials will outlive a refresh', () => {
    const auth = useAuthStore()
    auth.set(
      'dl1.lantmateriet.se',
      { username: 'anna', password: 'x' },
      'session',
    )

    expect(mountBasket({ entry }).find('.auth-scope').text()).toContain(
      'remembered for this tab',
    )
  })

  it('signs out without touching the basket', async () => {
    const auth = useAuthStore()
    auth.set('dl1.lantmateriet.se', { username: 'anna', password: 'x' })
    const selectionStore = useSelectionStore()
    selectionStore.configure('cat')
    selectionStore.add(items)

    const wrapper = mountBasket({ entry })
    const signOut = wrapper
      .findAll('.auth .link')
      .find((button) => button.text() === 'Sign out')!
    await signOut.trigger('click')

    expect(auth.has('dl1.lantmateriet.se')).toBe(false)
    expect(selectionStore.count).toBe(items.length)
  })
})
