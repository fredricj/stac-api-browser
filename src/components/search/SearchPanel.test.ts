import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import SearchPanel from '@/components/search/SearchPanel.vue'
import { useSearchStore } from '@/stores/searchStore'
import { BUILTIN_APIS } from '@/config/registry'
import {
  DEFAULT_PAGE_LIMIT,
  PAGE_LIMIT_OPTIONS,
} from '@/services/pageLimitPreference'

function mountPanel() {
  return mount(SearchPanel, {
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
})

describe('the search button stays reachable', () => {
  it('sits outside the scrolling region', () => {
    // The filters are taller than any viewport once 731 collections and the
    // generated property filters are in. A Search button inside that scroller
    // is a button the user has to go hunting for.
    const wrapper = mountPanel()

    const scroller = wrapper.find('.panel-scroll').element
    const button = wrapper.find('.btn--primary').element

    expect(button).toBeTruthy()
    expect(scroller.contains(button)).toBe(false)
  })

  it('keeps the filters in the scrolling region', () => {
    const wrapper = mountPanel()
    const scroller = wrapper.find('.panel-scroll').element

    for (const selector of ['.collections', '.dates', '.bbox']) {
      expect(scroller.contains(wrapper.find(selector).element)).toBe(true)
    }
  })

  it('pins the result summary alongside the button', () => {
    // It reports what the button just did, so it belongs with it.
    const wrapper = mountPanel()
    const foot = wrapper.find('.panel-foot').element

    expect(foot.contains(wrapper.find('.summary').element)).toBe(true)
  })

  it('keeps the cancel button pinned while a search runs', () => {
    const store = useSearchStore()
    store.configure(BUILTIN_APIS[0])
    store.loading = true

    const wrapper = mountPanel()
    const foot = wrapper.find('.panel-foot').element
    const cancel = wrapper
      .findAll('.panel-foot .btn')
      .find((button) => button.text() === 'Cancel')

    expect(cancel).toBeDefined()
    expect(foot.contains(cancel!.element)).toBe(true)
  })
})

describe('page size', () => {
  it('offers every configured option, defaulting to DEFAULT_PAGE_LIMIT', () => {
    const wrapper = mountPanel()
    const select = wrapper.find('select.page-limit-select')

    const values = select
      .findAll('option')
      .map((option) => Number(option.attributes('value')))
    expect(values).toEqual([...PAGE_LIMIT_OPTIONS])
    expect((select.element as HTMLSelectElement).value).toBe(
      String(DEFAULT_PAGE_LIMIT),
    )
  })

  it('updates the store when a different size is chosen', async () => {
    const store = useSearchStore()
    const wrapper = mountPanel()

    await wrapper.find('select.page-limit-select').setValue('1000')

    expect(store.pageLimit).toBe(1000)
  })

  it('sits outside the scrolling region, next to the search button', () => {
    // Changing it should not require scrolling past every filter first.
    const wrapper = mountPanel()
    const scroller = wrapper.find('.panel-scroll').element
    const select = wrapper.find('.page-limit').element

    expect(scroller.contains(select)).toBe(false)
  })
})
