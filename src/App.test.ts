import { describe, expect, it, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from '@/App.vue'
import i18n from '@/i18n'
import { router as appRouter } from '@/router'

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

    const hrefs = wrapper.findAll('a.api-card').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/api/lantmateriet-bild')
  })

  it('renders the browser route and passes apiId through', async () => {
    const { wrapper, router } = mountApp()
    await router.push('/api/lantmateriet-hojd')
    await router.isReady()
    await flushPromises()

    expect(wrapper.text()).toContain('lantmateriet-hojd')
    expect(wrapper.find('.map-slot').exists()).toBe(true)
  })
})
