import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import CredentialsDialog from '@/components/download/CredentialsDialog.vue'
import { useAuthStore } from '@/stores/authStore'

const HOST = 'dl1.lantmateriet.se'
const ASSET = `https://${HOST}/bild/data/orto/x.tif`
const DOCS = 'https://geotorget.lantmateriet.se/product'

function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = mount(CredentialsDialog, {
    props: { host: HOST, sampleAssetUrl: ASSET, docsUrl: DOCS, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  ;(wrapper.vm as unknown as { open: () => void }).open()
  return wrapper
}

async function fillIn(
  wrapper: ReturnType<typeof mountDialog>,
  username = 'anna',
  password = 'hemligt',
) {
  await wrapper.find('input[type="text"]').setValue(username)
  await wrapper.find('input[type="password"]').setValue(password)
}

function respondWith(status: number) {
  return vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status }),
  )
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('disclosure', () => {
  it('says where the password goes, before asking for it', () => {
    const wrapper = mountDialog()
    const text = wrapper.find('.disclosure').text()

    expect(text).toContain(HOST)
    expect(text).toContain('straight to')
  })

  it('states plainly that there is no server in the middle', () => {
    // The app is a static site; saying so is the only honest way to ask
    // someone for real credentials.
    expect(mountDialog().text()).toContain('no server of its own')
  })

  it('explains what remembering actually does', () => {
    const hint = mountDialog().find('.remember-hint').text()

    expect(hint).toContain('close the tab')
    expect(hint).toContain('Never saved to disk')
  })
})

describe('verification', () => {
  it('checks against the selected asset with a HEAD', async () => {
    const fetchImpl = respondWith(200)
    vi.stubGlobal('fetch', fetchImpl)
    const wrapper = mountDialog()
    await fillIn(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const [url, init] = fetchImpl.mock.calls[0]
    expect(init).toBeDefined()
    expect(url).toBe(ASSET)
    expect(init!.method).toBe('HEAD')
    expect(wrapper.find('.msg--ok').exists()).toBe(true)
  })

  it('reports a wrong password as a wrong password', async () => {
    vi.stubGlobal('fetch', respondWith(401))
    const wrapper = mountDialog()
    await fillIn(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.msg--error').text()).toContain('not accepted')
  })

  it('reports a missing subscription as exactly that, with a way forward', async () => {
    // The distinction the whole dialog exists for: 403 means the account is
    // fine and the product is not licensed, so "wrong password" would send
    // the user to reset something that was never broken.
    vi.stubGlobal('fetch', respondWith(403))
    const wrapper = mountDialog()
    await fillIn(wrapper)

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const text = wrapper.find('.msg--warn').text()
    expect(text).toContain('sign-in worked')
    expect(text).toContain('per product')
    expect(wrapper.find('.msg-link a').attributes('href')).toBe(DOCS)
  })

  it('does not offer a check when nothing is selected to check against', () => {
    const wrapper = mountDialog({ sampleAssetUrl: null })

    expect(wrapper.find('.msg--warn').text()).toContain('Select an item first')
    expect(
      wrapper
        .findAll('button')
        .find((b) => b.text() === 'Check')
        ?.attributes().disabled,
    ).toBeDefined()
  })

  it('discards a verdict once the credentials are edited', async () => {
    vi.stubGlobal('fetch', respondWith(200))
    const wrapper = mountDialog()
    await fillIn(wrapper)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.msg--ok').exists()).toBe(true)

    await wrapper.find('input[type="password"]').setValue('different')

    expect(wrapper.find('.msg--ok').exists()).toBe(false)
  })
})

describe('saving', () => {
  it('holds credentials in memory by default', async () => {
    const wrapper = mountDialog()
    await fillIn(wrapper)

    await wrapper.find('.btn--primary').trigger('click')

    const auth = useAuthStore()
    expect(auth.usernameFor(HOST)).toBe('anna')
    expect(auth.scopeFor(HOST)).toBe('memory')
    expect(sessionStorage.getItem('stac-browser:credentials')).toBeNull()
  })

  it('remembers for the tab only when the box is ticked', async () => {
    const wrapper = mountDialog()
    await fillIn(wrapper)
    await wrapper.find('input[type="checkbox"]').setValue(true)

    await wrapper.find('.btn--primary').trigger('click')

    expect(useAuthStore().scopeFor(HOST)).toBe('session')
  })

  it('never writes to localStorage', async () => {
    const wrapper = mountDialog()
    await fillIn(wrapper)
    await wrapper.find('input[type="checkbox"]').setValue(true)

    await wrapper.find('.btn--primary').trigger('click')

    expect(localStorage.length).toBe(0)
  })

  it('will not save an empty password', async () => {
    const wrapper = mountDialog()
    await wrapper.find('input[type="text"]').setValue('anna')

    expect(wrapper.find('.btn--primary').attributes('disabled')).toBeDefined()
  })

  it('emits saved so the caller can refresh its state', async () => {
    const wrapper = mountDialog()
    await fillIn(wrapper)

    await wrapper.find('.btn--primary').trigger('click')

    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
})

describe('reopening', () => {
  it('prefills the username but never the password', async () => {
    const auth = useAuthStore()
    auth.set(HOST, { username: 'anna', password: 'hemligt' }, 'session')

    const wrapper = mountDialog()
    await flushPromises()

    expect(
      (wrapper.find('input[type="text"]').element as HTMLInputElement).value,
    ).toBe('anna')
    // Re-entering the password is a deliberate cost: it keeps the secret out
    // of the DOM, where an extension or a screenshot could reach it.
    expect(
      (wrapper.find('input[type="password"]').element as HTMLInputElement)
        .value,
    ).toBe('')
  })

  it('remembers that the user chose to remember', async () => {
    useAuthStore().set(HOST, { username: 'anna', password: 'x' }, 'session')

    const wrapper = mountDialog()
    await flushPromises()

    expect(
      (wrapper.find('input[type="checkbox"]').element as HTMLInputElement)
        .checked,
    ).toBe(true)
  })
})

describe('discretion', () => {
  it('logs nothing while checking or saving', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    )
    vi.stubGlobal('fetch', respondWith(401))

    const wrapper = mountDialog()
    await fillIn(wrapper)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    await wrapper.find('.btn--primary').trigger('click')

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('keeps the password out of the rendered markup', async () => {
    const wrapper = mountDialog()
    await fillIn(wrapper, 'anna', 'hemligt')

    // The input holds it as a live value; it must not be written into an
    // attribute that ends up in the serialised DOM.
    expect(wrapper.html()).not.toContain('hemligt')
  })
})
