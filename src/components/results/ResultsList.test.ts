import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '@/i18n'
import ResultsList from '@/components/results/ResultsList.vue'
import type { StacItem } from '@/types/stac'
import { itemKey } from '@/types/stac'
import page1 from '@/services/__fixtures__/search-get-page1.json'

const items = (page1 as unknown as { features: StacItem[] }).features

/** Enough distinct items to make virtualisation observable. */
function manyItems(count: number): StacItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...items[index % items.length],
    id: `item-${index}`,
  }))
}

function mountList(props: Record<string, unknown> = {}) {
  return mount(ResultsList, {
    props: {
      items,
      selectedKeys: new Set<string>(),
      hoveredKey: null,
      hasSearched: true,
      ...props,
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

const SCROLLER_HEIGHT = 400

beforeEach(() => {
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
  // jsdom lays nothing out, so the virtualiser would see a zero-height
  // viewport and render no rows at all — making every assertion vacuous.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 360,
    bottom: SCROLLER_HEIGHT,
    width: 360,
    height: SCROLLER_HEIGHT,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rendering', () => {
  it('shows one row per loaded item', async () => {
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.findAll('.row')).toHaveLength(items.length)
  })

  it('shows the item id, collection and a public thumbnail', async () => {
    const wrapper = mountList()
    await flushPromises()

    const first = wrapper.find('.row')
    expect(first.text()).toContain(items[0].id)
    expect(first.text()).toContain(items[0].collection)
    // Thumbnails are public on these catalogs, so previews need no sign-in.
    expect(first.find('img').attributes('src')).toContain('http')
  })

  it('lazy-loads thumbnails rather than firing a request per row at once', async () => {
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.find('.row img').attributes('loading')).toBe('lazy')
  })

  it('virtualises a long result set', async () => {
    const wrapper = mountList({ items: manyItems(2_000) })
    await flushPromises()

    const rendered = wrapper.findAll('.row').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(60)
  })
})

describe('counts and terminal states', () => {
  it('never claims a total, only what is loaded', async () => {
    // `numberMatched` is null on these APIs, so "5 of 812" would be a lie.
    const wrapper = mountList({ complete: false, hasMore: true })
    await flushPromises()

    expect(wrapper.find('.count').text()).toBe('5 loaded')
  })

  it('says so plainly once everything is loaded', async () => {
    const wrapper = mountList({ complete: true })
    await flushPromises()

    expect(wrapper.find('.count').text()).toContain('all of them')
    expect(wrapper.find('.terminal').exists()).toBe(true)
    expect(wrapper.find('.more').exists()).toBe(false)
  })

  it('offers load more while a next link remains', async () => {
    const wrapper = mountList({ hasMore: true })
    await flushPromises()

    await wrapper.find('.more').trigger('click')

    expect(wrapper.emitted('loadMore')).toHaveLength(1)
  })

  it('explains the page cap instead of silently stopping', async () => {
    const wrapper = mountList({ hasMore: false, hitPageCap: true })
    await flushPromises()

    expect(wrapper.find('.capped').exists()).toBe(true)
  })

  it('prompts for a search before one has run', async () => {
    const wrapper = mountList({ hasSearched: false, items: [] })
    await flushPromises()

    expect(wrapper.find('.count').text()).toContain('then search')
  })

  it('offers a way forward when a search matches nothing', async () => {
    const wrapper = mountList({ items: [], hasSearched: true })
    await flushPromises()

    expect(wrapper.find('.state').text()).toContain('No items matched')
  })
})

describe('loading', () => {
  it('shows placeholder rows shaped like results, not bare text, before any arrive', async () => {
    const wrapper = mountList({ items: [], hasSearched: false, loading: true })
    await flushPromises()

    expect(wrapper.find('.skeleton-rows').exists()).toBe(true)
    expect(wrapper.findAll('.skeleton-row').length).toBeGreaterThan(0)
    // The visible page has no plain "Loading…" text; a screen reader still
    // hears it, through the hidden status text alongside the skeleton.
    expect(wrapper.find('.state').exists()).toBe(false)
    expect(wrapper.find('.sr-only').text()).toBe('Loading…')
  })

  it('keeps showing stale results, with a plain-text notice, while a new search runs', async () => {
    const wrapper = mountList({ loading: true })
    await flushPromises()

    expect(wrapper.find('.skeleton-rows').exists()).toBe(false)
    expect(wrapper.find('.state').text()).toBe('Loading…')
    expect(wrapper.findAll('.row').length).toBeGreaterThan(0)
  })
})

describe('selection and hover', () => {
  it('emits the composite key when a row is ticked', async () => {
    const wrapper = mountList()
    await flushPromises()

    await wrapper.find('.row input[type="checkbox"]').setValue(true)

    expect(wrapper.emitted('toggle')?.[0]).toEqual([itemKey(items[0])])
  })

  it('marks selected rows with more than colour', async () => {
    const wrapper = mountList({ selectedKeys: new Set([itemKey(items[0])]) })
    await flushPromises()

    const first = wrapper.find('.row')
    expect(first.classes()).toContain('is-selected')
    expect(
      (first.find('input[type="checkbox"]').element as HTMLInputElement)
        .checked,
    ).toBe(true)
  })

  it('reports hover outward so the map can highlight the footprint', async () => {
    const wrapper = mountList()
    await flushPromises()

    await wrapper.find('.row').trigger('mouseenter')
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([itemKey(items[0])])

    await wrapper.find('.row').trigger('mouseleave')
    expect(wrapper.emitted('hover')?.at(-1)).toEqual([null])
  })

  it('mirrors hover coming from the map', async () => {
    const wrapper = mountList({ hoveredKey: itemKey(items[1]) })
    await flushPromises()

    expect(wrapper.findAll('.row')[1].classes()).toContain('is-hovered')
  })

  it('reports hover from keyboard focus, not just the pointer', async () => {
    // The map is not the only way to work; the list has to drive the map too.
    const wrapper = mountList()
    await flushPromises()

    await wrapper.find('.row .body').trigger('focus')

    expect(wrapper.emitted('hover')?.at(-1)).toEqual([itemKey(items[0])])
  })

  it('opens the detail drawer for a row', async () => {
    const wrapper = mountList()
    await flushPromises()

    await wrapper.find('.row .body').trigger('click')

    expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({
      id: items[0].id,
    })
  })
})
