import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '@/i18n'
import ItemDetailDrawer from '@/components/results/ItemDetailDrawer.vue'
import type { StacItem } from '@/types/stac'
import itemFixture from '@/services/__fixtures__/item-bild.json'

const item = itemFixture as unknown as StacItem

function mountDrawer(props: Record<string, unknown> = {}) {
  return mount(ItemDetailDrawer, {
    props: { item, selected: false, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
})

describe('closed state', () => {
  it('renders nothing without an item', () => {
    const wrapper = mountDrawer({ item: null })
    expect(wrapper.find('.drawer').exists()).toBe(false)
  })
})

describe('contents', () => {
  it('translates the Swedish property names it knows', () => {
    // The data is Swedish; the UI is not. `flygar` means nothing in English.
    const wrapper = mountDrawer()
    const labels = wrapper.findAll('.props dt').map((dt) => dt.text())

    expect(labels).toContain('Flight year')
    expect(labels).toContain('Resolution (m/pixel)')
  })

  it('keeps the original name for properties it has no label for', () => {
    // Every property in the stac-bild fixture happens to be in the label map,
    // so the fallback needs a property from some other catalog to exercise —
    // and a made-up translation would be worse than the honest wire name.
    const wrapper = mountDrawer({
      item: {
        ...item,
        properties: { ...item.properties, 'sat:orbit_state': 'descending' },
      },
    })
    const labels = wrapper.findAll('.props dt').map((dt) => dt.text())

    expect(labels).toContain('sat:orbit_state')
  })

  it('keeps the wire name available for anyone who needs it', () => {
    const wrapper = mountDrawer()
    const flightYear = wrapper
      .findAll('.props dt')
      .find((dt) => dt.text() === 'Flight year')!

    expect(flightYear.attributes('title')).toBe('flygar')
  })

  it('lists every asset with its size', () => {
    const wrapper = mountDrawer()
    const assets = wrapper.findAll('.asset')

    expect(assets).toHaveLength(3)
    expect(wrapper.text()).toContain('692 MB')
  })

  it('says which assets need signing in, before download time', () => {
    const wrapper = mountDrawer()
    const locked = wrapper.findAll('.asset-lock')

    // Only the `data` asset is behind HTTP Basic; metadata and thumbnail
    // are public, and planning a bulk job needs to know which is which.
    expect(locked).toHaveLength(1)
  })

  it('shows the public preview at a size worth judging', () => {
    expect(mountDrawer().find('.preview').attributes('src')).toContain('http')
  })

  it('hides the raw JSON until asked', async () => {
    const wrapper = mountDrawer()
    expect(wrapper.find('.raw').exists()).toBe(false)

    await wrapper.find('.raw-toggle').trigger('click')

    expect(wrapper.find('.raw').text()).toContain('"stac_version"')
  })
})

describe('selection', () => {
  it('offers to add an unselected item', () => {
    expect(mountDrawer().find('.select').text()).toBe('Add to selection')
  })

  it('offers to remove a selected one', () => {
    const wrapper = mountDrawer({ selected: true })
    expect(wrapper.find('.select').text()).toBe('Remove from selection')
    expect(wrapper.find('.select').attributes('aria-pressed')).toBe('true')
  })

  it('emits toggle', async () => {
    const wrapper = mountDrawer()
    await wrapper.find('.select').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})

describe('dismissal', () => {
  it('closes on the close button', async () => {
    const wrapper = mountDrawer()
    await wrapper.find('.close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on Escape', async () => {
    const wrapper = mountDrawer()
    await wrapper.find('.drawer').trigger('keydown.esc')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes when the scrim behind it is clicked', async () => {
    const wrapper = mountDrawer()
    await wrapper.find('.scrim').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('stays open when the panel itself is clicked', async () => {
    const wrapper = mountDrawer()
    await wrapper.find('.drawer').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})

describe('accessibility', () => {
  it('is a modal dialog with a name', () => {
    const drawer = mountDrawer().find('.drawer')
    expect(drawer.attributes('role')).toBe('dialog')
    expect(drawer.attributes('aria-modal')).toBe('true')
    expect(drawer.attributes('aria-label')).toContain(item.id)
  })

  it('resets the raw view between items', async () => {
    // Otherwise the next item opens scrolled into a wall of JSON.
    const wrapper = mountDrawer()
    await wrapper.find('.raw-toggle').trigger('click')
    expect(wrapper.find('.raw').exists()).toBe(true)

    await wrapper.setProps({ item: { ...item, id: 'other' } })
    await flushPromises()

    expect(wrapper.find('.raw').exists()).toBe(false)
  })
})
