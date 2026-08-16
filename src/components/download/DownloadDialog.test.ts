import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import DownloadDialog from '@/components/download/DownloadDialog.vue'
import { useSelectionStore } from '@/stores/selectionStore'
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

async function mountDialog() {
  const wrapper = mount(DownloadDialog, {
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  ;(wrapper.vm as unknown as { open: () => void }).open()
  // `open()` may change the selected tier; Vue reflects that on the next tick.
  await flushPromises()
  return wrapper
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
