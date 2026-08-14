import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from '@/App.vue'
import i18n from '@/i18n'
import { router as appRouter } from '@/router'

// The browse route mounts MapLibre, which needs WebGL that jsdom lacks.
vi.mock('maplibre-gl', async () => {
  const { createMaplibreMock } = await import('@/test/maplibreMock')
  return createMaplibreMock()
})

/**
 * Phase 0 milestone: the shell boots and both routes render.
 * Uses memory history so the test does not depend on jsdom's location.
 */
function mountApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: appRouter.getRoutes().map((r) => ({
      path: r.path,
      name: r.name,
      component: r.components?.default,
      redirect: r.redirect,
      props: r.props?.default,
    })) as never,
  })

  const wrapper = mount(App, {
    global: { plugins: [createPinia(), router, i18n] },
  })

  return { wrapper, router }
}

describe('App shell', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    localStorage.clear()
    // Neither route fetches anything on mount. Fail loudly if that changes.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('the app shell must not fetch on mount')
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the header on the catalog list route', async () => {
    const { wrapper, router } = mountApp()
    await router.push('/')
    await router.isReady()
    await flushPromises()

    expect(wrapper.find('header.app-header').exists()).toBe(true)
    expect(wrapper.text()).toContain('STAC catalogs')
  })

  it('links each catalog to its browser route', async () => {
    const { wrapper, router } = mountApp()
    await router.push('/')
    await router.isReady()
    await flushPromises()

    const hrefs = wrapper
      .findAll('a.card-main')
      .map((a) => a.attributes('href'))
    expect(hrefs).toContain('/api/lantmateriet-bild')
  })

  it('renders the browser route and resolves the catalog title', async () => {
    const { wrapper, router } = mountApp()
    await router.push('/api/lantmateriet-hojd')
    await router.isReady()
    await flushPromises()

    expect(wrapper.text()).toContain('Höjddata')
    expect(wrapper.find('.map-root').exists()).toBe(true)
  })

  it('explains an unknown catalog id instead of rendering an empty page', async () => {
    const { wrapper, router } = mountApp()
    await router.push('/api/no-such-catalog')
    await router.isReady()
    await flushPromises()

    expect(wrapper.find('.not-found').exists()).toBe(true)
    expect(wrapper.text()).toContain('no-such-catalog')
    expect(wrapper.find('.map-root').exists()).toBe(false)
  })
})
