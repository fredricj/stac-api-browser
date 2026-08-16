import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import i18n from '@/i18n'
import { useSearchStore } from '@/stores/searchStore'
import { BUILTIN_APIS } from '@/config/registry'

vi.mock('maplibre-gl', async () => {
  const { createMaplibreMock } = await import('@/test/maplibreMock')
  return createMaplibreMock()
})

const { resetMaplibreMock } = await import('@/test/maplibreMock')
const ApiBrowserView = (await import('@/views/ApiBrowserView.vue')).default

const CATALOG = BUILTIN_APIS[0]

function emptyItemCollection() {
  return new Response(
    JSON.stringify({ type: 'FeatureCollection', features: [], links: [] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** Mounts the view at a URL, with every network call stubbed out. */
async function mountAt(query: string) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/api/:apiId',
        name: 'api-browser',
        component: ApiBrowserView,
        props: true,
      },
      { path: '/', name: 'home', component: { template: '<div />' } },
    ],
  })

  await router.push(`/api/${CATALOG.id}${query}`)
  await router.isReady()

  const wrapper = mount(ApiBrowserView, {
    props: { apiId: CATALOG.id },
    global: { plugins: [i18n, router] },
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  resetMaplibreMock()
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => emptyItemCollection()),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('opening a shared link', () => {
  it('keeps the bbox from the query string', async () => {
    // The regression: `store.configure()` clears every search input, and it
    // ran after the URL was read — so a shared link opened with no search at
    // all and the query string was rewritten empty.
    await mountAt('?bbox=17.9,59.2,18.2,59.4')

    expect(useSearchStore().bbox).toEqual([17.9, 59.2, 18.2, 59.4])
  })

  it('keeps collections and the date interval too', async () => {
    await mountAt(
      '?bbox=17.9,59.2,18.2,59.4&collections=orto-o2-2025&datetime=2024-01-01T00:00:00Z/..',
    )

    const store = useSearchStore()
    expect(store.collections).toEqual(['orto-o2-2025'])
    expect(store.datetime).toBe('2024-01-01T00:00:00Z/..')
  })

  it('does not rewrite the URL empty', async () => {
    const { router } = await mountAt('?bbox=17.9,59.2,18.2,59.4')
    await flushPromises()

    expect(router.currentRoute.value.query.bbox).toBe('17.9,59.2,18.2,59.4')
  })

  it('runs the search it was sent, rather than waiting for a button press', async () => {
    await mountAt('?bbox=17.9,59.2,18.2,59.4')
    await flushPromises()

    const requested = (
      fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.map((call) => String(call[0]))
    expect(requested.some((url) => url.includes('/search?'))).toBe(true)
    expect(useSearchStore().hasSearched).toBe(true)
  })

  it('leaves the search alone when the URL carries none', async () => {
    await mountAt('')

    const store = useSearchStore()
    expect(store.bbox).toBeNull()
    expect(store.hasSearched).toBe(false)
  })
})
