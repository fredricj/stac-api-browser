import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import i18n from '@/i18n'
import { BUILTIN_APIS } from '@/config/registry'
import { useToastStore } from '@/stores/toastStore'
import rootFixture from '@/services/__fixtures__/root-bild.json'

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      {
        path: '/api/:apiId',
        name: 'api-browser',
        component: { template: '<div />' },
      },
    ],
  })
}

async function mountHome(pinia: Pinia = createPinia()) {
  const r = router()
  await r.push('/')
  await r.isReady()

  const wrapper = mount(HomeView, {
    global: { plugins: [pinia, r, i18n] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

/** Landing page for any URL. */
function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify(rootFixture)))
}

beforeEach(() => {
  localStorage.clear()
  i18n.global.locale.value = 'en'
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('HomeView', () => {
  it('renders the catalog list without touching the network', async () => {
    // The list is static by design: no probing, no collection counting, no
    // reachability checks. It must render identically offline.
    const fetchSpy = vi.fn(async () => {
      throw new Error('the catalog list must not fetch anything')
    })
    vi.stubGlobal('fetch', fetchSpy)

    const wrapper = await mountHome()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(wrapper.findAll('.card')).toHaveLength(BUILTIN_APIS.length)
    expect(wrapper.text()).toContain('Lantmäteriet — Ortofoto')
  })

  it('shows no status badge on a card', async () => {
    vi.stubGlobal('fetch', okFetch())
    const wrapper = await mountHome()

    expect(wrapper.find('.status').exists()).toBe(false)
    expect(wrapper.find('.note').exists()).toBe(false)
  })

  it('lists every built-in catalog', async () => {
    vi.stubGlobal('fetch', okFetch())
    const wrapper = await mountHome()

    const cards = wrapper.findAll('.card')
    expect(cards).toHaveLength(BUILTIN_APIS.length)
    expect(wrapper.text()).toContain('Lantmäteriet — Ortofoto')
    expect(wrapper.text()).toContain('Lantmäteriet — Höjddata')
    expect(wrapper.text()).toContain('Lantmäteriet — Vektordata')
  })

  it('shows the translated description and the static facts', async () => {
    vi.stubGlobal('fetch', okFetch())
    const wrapper = await mountHome()

    expect(wrapper.text()).toContain('Aerial orthophotos of Sweden')
    expect(wrapper.text()).toContain('Sign-in needed to download')
    expect(wrapper.text()).toContain('CC BY 4.0')
  })

  it('links each card to its browse route', async () => {
    vi.stubGlobal('fetch', okFetch())
    const wrapper = await mountHome()

    const hrefs = wrapper
      .findAll('a.card-main')
      .map((a) => a.attributes('href'))
    expect(hrefs).toContain('/api/lantmateriet-bild')
  })
})

describe('AddCustomApiDialog', () => {
  async function openDialog(pinia?: Pinia) {
    const wrapper = await mountHome(pinia)
    await wrapper.find('.head-actions .btn--primary').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('rejects a URL that is not http(s)', async () => {
    vi.stubGlobal('fetch', okFetch())
    const wrapper = await openDialog()

    await wrapper.find('dialog input').setValue('javascript:alert(1)')
    await wrapper.find('dialog form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('dialog .msg--error').text()).toContain(
      'valid http(s) URL',
    )
  })

  it('refuses to add a catalog that is already listed', async () => {
    vi.stubGlobal('fetch', okFetch())
    const wrapper = await openDialog()

    await wrapper
      .find('dialog input')
      .setValue('https://api.lantmateriet.se/stac-bild/v1/')
    await wrapper.find('dialog form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('dialog .msg--error').text()).toContain('already')
  })

  it('checks, adds and persists a new catalog', async () => {
    vi.stubGlobal('fetch', okFetch())
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = await openDialog(pinia)

    await wrapper.find('dialog input').setValue('https://example.org/stac/')
    await wrapper.find('dialog form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('dialog .msg--ok').exists()).toBe(true)

    await wrapper.find('dialog .btn--primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Added by you')
    expect(wrapper.findAll('.card')).toHaveLength(BUILTIN_APIS.length + 1)
    expect(localStorage.getItem('stac-browser:custom-apis')).toContain(
      'example.org',
    )

    // Confirmation that the catalog was added, not just a dialog that closed.
    const toast = useToastStore()
    expect(toast.toasts).toHaveLength(1)
    expect(toast.toasts[0].message).toContain('Added')
    expect(toast.toasts[0].variant).toBe('success')
  })

  it('explains a CORS failure and still offers to add it anyway', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const wrapper = await openDialog()

    await wrapper.find('dialog input').setValue('https://blocked.example/stac/')
    await wrapper.find('dialog form').trigger('submit')
    await flushPromises()

    await vi.waitFor(
      () => {
        expect(wrapper.find('dialog .msg--error').exists()).toBe(true)
      },
      { timeout: 3000 },
    )

    expect(wrapper.find('dialog .msg--error').text()).toContain('Could not')
    expect(wrapper.text()).toContain('CORS restriction')
    // Might just be down; the user is allowed to decide.
    const addButton = wrapper.find('dialog .btn--primary')
    expect(addButton.attributes('disabled')).toBeUndefined()
    expect(addButton.text()).toBe('Add anyway')
  })
})
