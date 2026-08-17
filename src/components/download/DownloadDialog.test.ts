import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import DownloadDialog from '@/components/download/DownloadDialog.vue'
import { useSelectionStore } from '@/stores/selectionStore'
import { useAuthStore } from '@/stores/authStore'
import type { StacApiEntry } from '@/types/registry'
import type { StacItem } from '@/types/stac'

const STORAGE_KEY = 'stac-browser:download-tier'

function item(id: string, size: number): StacItem {
  return {
    type: 'Feature',
    stac_version: '1.0.0',
    id,
    collection: 'coll',
    geometry: null,
    properties: { datetime: '2025-01-01T00:00:00Z' },
    links: [],
    assets: {
      data: {
        href: `https://dl1.example/${id}.tif`,
        roles: ['data'],
        'file:size': size,
      },
    },
  }
}

/**
 * Chromium has the picker; jsdom does not, so it is stubbed per test.
 *
 * The single property, not the whole `window` — replacing the window object
 * leaves test-utils unable to construct DOM events.
 */
function withDirectoryPicker(supported: boolean) {
  if (supported) vi.stubGlobal('showDirectoryPicker', () => {})
}

async function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = mount(DownloadDialog, {
    props: { entry: null, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  ;(wrapper.vm as unknown as { open: () => void }).open()
  // `open()` may change the selected tier; Vue reflects that on the next tick.
  await flushPromises()
  return wrapper
}

/** Flips the checked radio to `value`, the way a click would. */
async function chooseTier(
  wrapper: Awaited<ReturnType<typeof mountDialog>>,
  value: string,
) {
  await wrapper
    .findAll('input[type="radio"]')
    .find((radio) => radio.attributes('value') === value)!
    .setValue(true)
}

function selected(
  wrapper: Awaited<ReturnType<typeof mountDialog>>,
): string | undefined {
  return wrapper
    .findAll('input[type="radio"]')
    .find((radio) => (radio.element as HTMLInputElement).checked)
    ?.attributes('value')
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('remembering the download method', () => {
  it('opens on the remembered choice', async () => {
    withDirectoryPicker(true)
    localStorage.setItem(STORAGE_KEY, 'sequential')

    expect(selected(await mountDialog())).toBe('sequential')
  })

  it('records a choice the user makes', async () => {
    withDirectoryPicker(true)
    const wrapper = await mountDialog()

    const manifest = wrapper
      .findAll('input[type="radio"]')
      .find((radio) => radio.attributes('value') === 'manifest')!
    await manifest.setValue(true)

    expect(localStorage.getItem(STORAGE_KEY)).toBe('manifest')
  })

  it('carries the choice to the next time the dialog opens', async () => {
    withDirectoryPicker(true)
    const first = await mountDialog()
    await first
      .findAll('input[type="radio"]')
      .find((radio) => radio.attributes('value') === 'sequential')!
      .setValue(true)
    first.unmount()

    expect(selected(await mountDialog())).toBe('sequential')
  })

  it('does not treat its own default as a remembered choice', async () => {
    // Otherwise the first open would silently pin the default and disable the
    // size-based steering from then on.
    withDirectoryPicker(true)
    await mountDialog()

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('defaults when nothing is remembered', () => {
  it('starts on the folder route where the browser supports it', async () => {
    withDirectoryPicker(true)
    expect(selected(await mountDialog())).toBe('folder')
  })

  it('falls back where there is no directory handle', async () => {
    // jsdom, like Firefox and Safari, has no picker.
    expect(selected(await mountDialog())).toBe('manifest')
  })

  it('steers a very large selection to a download manager', async () => {
    withDirectoryPicker(true)
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('huge', 60e9)])

    expect(selected(await mountDialog())).toBe('manifest')
  })

  it('still warns about size even when the user prefers the folder route', async () => {
    // The remembered choice wins, but the advice is not withdrawn.
    withDirectoryPicker(true)
    localStorage.setItem(STORAGE_KEY, 'folder')
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('huge', 60e9)])

    const wrapper = await mountDialog()

    expect(selected(wrapper)).toBe('folder')
    expect(wrapper.find('.recommend').exists()).toBe(true)
  })
})

describe('sign-in', () => {
  const entry: StacApiEntry = {
    id: 'lantmateriet-bild',
    title: 'Ortofoto',
    url: 'https://api.lantmateriet.se/stac-bild/v1/',
    assetHost: 'dl1.lantmateriet.se',
    auth: 'basic',
    docsUrl: 'https://geotorget.lantmateriet.se/product',
  }

  it('stays out of the way for a catalog that needs no sign-in', async () => {
    withDirectoryPicker(true)
    const wrapper = await mountDialog({ entry: { ...entry, auth: 'none' } })

    expect(wrapper.find('.auth').exists()).toBe(false)
  })

  it('offers a sign-in on the folder tier, for a catalog whose assets are protected', async () => {
    withDirectoryPicker(true)
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('a', 1e6)])

    const wrapper = await mountDialog({ entry })

    expect(selected(wrapper)).toBe('folder')
    expect(wrapper.find('.auth').text()).toContain('dl1.example')
    expect(wrapper.text()).toContain('Sign in')
  })

  it('scopes to the host of a real selected asset, not the catalog host', async () => {
    // Assets live on a different origin than the catalog on every built-in
    // entry, so the credentials must be filed under the host that asks.
    withDirectoryPicker(true)
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([
      {
        ...item('a', 1),
        assets: {
          data: { href: 'https://elsewhere.example/a.tif', roles: ['data'] },
        },
      },
    ])

    const wrapper = await mountDialog({ entry })

    expect(wrapper.find('.auth').text()).toContain('elsewhere.example')
  })

  it('shows who is signed in and how long it lasts', async () => {
    withDirectoryPicker(true)
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('a', 1e6)])
    useAuthStore().set('dl1.example', { username: 'anna', password: 'x' })

    const wrapper = await mountDialog({ entry })

    expect(wrapper.find('.auth-ok').text()).toContain('anna')
    expect(wrapper.find('.auth-scope').text()).toContain('this page load only')
  })

  it('signs out without touching the basket', async () => {
    withDirectoryPicker(true)
    const auth = useAuthStore()
    auth.set('dl1.example', { username: 'anna', password: 'x' })
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('a', 1e6)])

    const wrapper = await mountDialog({ entry })
    const signOut = wrapper
      .findAll('.auth .link')
      .find((button) => button.text() === 'Sign out')!
    await signOut.trigger('click')

    expect(auth.has('dl1.example')).toBe(false)
    expect(selection.count).toBe(1)
  })

  it('is not asked for on the manifest tier — a download manager reads its own environment', async () => {
    withDirectoryPicker(true)
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('a', 1e6)])

    const wrapper = await mountDialog({ entry })
    await chooseTier(wrapper, 'manifest')

    expect(wrapper.find('.auth').exists()).toBe(false)
  })

  it('is not asked for when "save one at a time" opens the files as links', async () => {
    withDirectoryPicker(true)
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('a', 1e6)])

    const wrapper = await mountDialog({ entry })
    await chooseTier(wrapper, 'sequential')
    await chooseTier(wrapper, 'links')

    expect(wrapper.find('.auth').exists()).toBe(false)
  })

  it('is asked for when "save one at a time" downloads automatically', async () => {
    withDirectoryPicker(true)
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('a', 1e6)])

    const wrapper = await mountDialog({ entry })
    await chooseTier(wrapper, 'sequential')

    expect(wrapper.find('.auth').exists()).toBe(true)
  })
})

describe('"save one at a time" — opening the files as links', () => {
  it('lists every downloadable item as a plain link, nothing to fetch', async () => {
    withDirectoryPicker(true)
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('a', 1e6), item('b', 2e6)])

    const wrapper = await mountDialog()
    await chooseTier(wrapper, 'sequential')
    await chooseTier(wrapper, 'links')

    const links = wrapper.findAll('.link-list a')
    expect(links.map((a) => a.attributes('href'))).toEqual([
      'https://dl1.example/a.tif',
      'https://dl1.example/b.tif',
    ])
    // Opened directly by the browser, not fetched by the app.
    expect(links[0].attributes('target')).toBe('_blank')
    // Nothing to "start" — the user clicks a link instead of a button.
    expect(wrapper.find('.actions .btn--primary').exists()).toBe(false)
  })

  it('goes back to the automatic warning when the mode is switched back', async () => {
    withDirectoryPicker(true)
    const selection = useSelectionStore()
    selection.configure('cat')
    selection.add([item('a', 1e6)])

    const wrapper = await mountDialog()
    await chooseTier(wrapper, 'sequential')
    await chooseTier(wrapper, 'links')
    expect(wrapper.find('.warn').exists()).toBe(false)

    await wrapper
      .findAll('input[type="radio"]')
      .find((radio) => radio.attributes('value') === 'auto')!
      .setValue(true)

    expect(wrapper.find('.warn').exists()).toBe(true)
    expect(wrapper.find('.link-list').exists()).toBe(false)
  })
})
