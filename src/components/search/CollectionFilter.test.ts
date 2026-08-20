import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '@/i18n'
import CollectionFilter from '@/components/search/CollectionFilter.vue'
import type { StacCollection } from '@/types/stac'
import collectionsFixture from '@/services/__fixtures__/collections-bild.json'
import hojdCollectionsFixture from '@/services/__fixtures__/collections-hojd.json'

const liveCollections = (
  collectionsFixture as unknown as { collections: StacCollection[] }
).collections

const liveHojdCollections = (
  hojdCollectionsFixture as unknown as { collections: StacCollection[] }
).collections

function mountFilter(props: Record<string, unknown> = {}) {
  return mount(CollectionFilter, {
    props: { collections: liveCollections, selected: [], ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

/** The search box debounces; advance past it and let the DOM settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(200)
  await flushPromises()
}

/**
 * jsdom lays nothing out, so every element measures 0×0 and the virtualiser
 * concludes there is no viewport to fill. Give it a scroll port with real
 * dimensions; without this it renders no rows at all and the tests below
 * would pass vacuously.
 */
const SCROLLER_HEIGHT = 224

beforeEach(() => {
  vi.useFakeTimers()
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 320,
    bottom: SCROLLER_HEIGHT,
    width: 320,
    height: SCROLLER_HEIGHT,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('virtualisation', () => {
  it('renders a handful of rows, not all 731', async () => {
    // The whole reason this list is virtualised: 731 collections is several
    // thousand DOM nodes, and every keystroke would re-render them.
    const wrapper = mountFilter()
    await flushPromises()

    const rendered = wrapper.findAll('.row').length
    expect(liveCollections).toHaveLength(731)
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(100)
  })

  it('reports the total it is filtering over', async () => {
    const wrapper = mountFilter()
    await flushPromises()
    expect(wrapper.find('.status').text()).toContain('731')
  })
})

describe('loading', () => {
  it('fills the empty list with placeholder rows rather than a blank box', async () => {
    const wrapper = mountFilter({ collections: [], loading: true })
    await flushPromises()

    expect(wrapper.find('.skeleton-rows').exists()).toBe(true)
    expect(wrapper.findAll('.skeleton-row').length).toBeGreaterThan(0)
    // The virtualised list and its "no matches" state are for once there is
    // something — or definitively nothing — to report; loading is neither.
    expect(wrapper.find('.spacer').exists()).toBe(false)
    expect(wrapper.find('.empty').exists()).toBe(false)
  })
})

describe('searching', () => {
  it('narrows to matching collections', async () => {
    const wrapper = mountFilter()
    await wrapper.find('input[type="search"]').setValue('arvidsjaur')
    await settle()

    const status = wrapper.find('.status').text()
    expect(status).toContain('of 731')
    // Far fewer than the whole catalog, but not none.
    expect(status).not.toContain('731 of 731')
  })

  it('shows an empty state rather than a blank box', async () => {
    const wrapper = mountFilter()
    await wrapper.find('input[type="search"]').setValue('zzzznothing')
    await settle()

    expect(wrapper.find('.empty').exists()).toBe(true)
  })
})

describe('selection', () => {
  it('emits the id when a collection is checked', async () => {
    const wrapper = mountFilter()
    await flushPromises()

    await wrapper.find('.option input[type="checkbox"]').setValue(true)

    const emitted = wrapper.emitted('update:selected')?.[0]?.[0] as string[]
    expect(emitted).toHaveLength(1)
  })

  it('bulk-selects everything the query matches', async () => {
    const wrapper = mountFilter()
    await wrapper.find('input[type="search"]').setValue('arvidsjaur')
    await settle()

    await wrapper.findAll('.bulk .link')[0].trigger('click')

    const emitted = wrapper.emitted('update:selected')?.at(-1)?.[0] as string[]
    expect(emitted.length).toBeGreaterThan(0)
    // Matches now come from keywords as well as the id, so not every id need
    // literally contain the term — but some still should.
    expect(emitted.some((id) => id.includes('arvidsjaur'))).toBe(true)
  })

  it('bulk-selects only what is visible, not the whole catalog', async () => {
    const wrapper = mountFilter()
    await wrapper.find('input[type="search"]').setValue('arvidsjaur')
    await settle()

    await wrapper.findAll('.bulk .link')[0].trigger('click')

    const emitted = wrapper.emitted('update:selected')?.at(-1)?.[0] as string[]
    expect(emitted.length).toBeLessThan(liveCollections.length)
  })

  it('clears the selection', async () => {
    const wrapper = mountFilter({ selected: ['orto-o2-2025'] })
    await flushPromises()

    await wrapper.findAll('.bulk .link')[1].trigger('click')

    expect(wrapper.emitted('update:selected')?.at(-1)?.[0]).toEqual([])
  })
})

describe('product grouping', () => {
  it('stays out of the way for the default, year-grouped catalog', async () => {
    const wrapper = mountFilter()
    await flushPromises()

    expect(wrapper.find('.products').exists()).toBe(false)
  })

  it('offers "All" plus one chip per product, with counts', async () => {
    const wrapper = mountFilter({
      collections: liveHojdCollections,
      grouping: 'product',
    })
    await flushPromises()

    const chips = wrapper.findAll('.product-chip')
    // Alphabetical after "All" — there is no "newest" to lead with here.
    expect(chips.map((chip) => chip.text())).toEqual([
      'All',
      'Laserdata Skog (1)',
      'Markhöjdmodell (77)',
    ])
    // "All" is where it starts.
    expect(chips[0].classes('is-on')).toBe(true)
  })

  it('narrows the list to the chosen product', async () => {
    const wrapper = mountFilter({
      collections: liveHojdCollections,
      grouping: 'product',
    })
    await flushPromises()

    const laserdata = wrapper
      .findAll('.product-chip')
      .find((chip) => chip.text().startsWith('Laserdata'))!
    await laserdata.trigger('click')
    await flushPromises()

    expect(laserdata.classes('is-on')).toBe(true)
    expect(wrapper.find('.status').text()).toContain('1 of 78')
  })

  it('goes back to everything when "All" is clicked again', async () => {
    const wrapper = mountFilter({
      collections: liveHojdCollections,
      grouping: 'product',
    })
    await flushPromises()
    await wrapper.findAll('.product-chip')[1].trigger('click')
    await flushPromises()

    await wrapper.findAll('.product-chip')[0].trigger('click')
    await flushPromises()

    expect(wrapper.find('.status').text()).toContain('78 of 78')
  })

  it('combines with the search box — both narrow at once', async () => {
    const wrapper = mountFilter({
      collections: liveHojdCollections,
      grouping: 'product',
    })
    await flushPromises()
    const markhojdmodell = wrapper
      .findAll('.product-chip')
      .find((chip) => chip.text().startsWith('Markhöjdmodell'))!
    await markhojdmodell.trigger('click')

    await wrapper.find('input[type="search"]').setValue('dtm')
    await settle()

    expect(wrapper.find('.status').text()).toContain('1 of 78')
  })

  it("does not carry a selection over when the catalog's collections change", async () => {
    // Otherwise a leftover product key from one catalog would filter a
    // different catalog's whole list down to nothing.
    const wrapper = mountFilter({
      collections: liveHojdCollections,
      grouping: 'product',
    })
    await flushPromises()
    await wrapper.findAll('.product-chip')[1].trigger('click')
    await flushPromises()

    await wrapper.setProps({ collections: [...liveHojdCollections] })
    await flushPromises()

    expect(wrapper.find('.status').text()).toContain('78 of 78')
  })

  it('hides the picker rather than showing a single, pointless chip', async () => {
    const wrapper = mountFilter({
      collections: [liveHojdCollections.find((c) => c.id === 'dtm-cog')!],
      grouping: 'product',
    })
    await flushPromises()

    expect(wrapper.find('.products').exists()).toBe(false)
  })
})

describe('a failed fetch', () => {
  const error = { kind: 'http' as const, status: 500, message: '500' }

  it('shows an error rather than an empty list', async () => {
    const wrapper = mountFilter({ collections: [], error })
    await flushPromises()

    expect(wrapper.find('.error').exists()).toBe(true)
    expect(wrapper.find('.search').exists()).toBe(false)
    expect(wrapper.find('.empty').exists()).toBe(false)
  })

  it('hints at CORS when the failure looks like one', async () => {
    const wrapper = mountFilter({
      collections: [],
      error: { ...error, likelyCors: true },
    })
    await flushPromises()

    expect(wrapper.find('.error-hint').exists()).toBe(true)
  })

  it('asks to retry, and lets the parent decide what that means', async () => {
    const wrapper = mountFilter({ collections: [], error })
    await flushPromises()

    await wrapper.find('.retry').trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('prefers the loading state once a retry is in flight', async () => {
    const wrapper = mountFilter({ collections: [], error, loading: true })
    await flushPromises()

    expect(wrapper.find('.error').exists()).toBe(false)
    expect(wrapper.find('.status').text()).toContain('Loading')
  })
})
