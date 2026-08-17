import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import SearchPanel from '@/components/search/SearchPanel.vue'
import { useSearchStore } from '@/stores/searchStore'
import { BUILTIN_APIS } from '@/config/registry'

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

  it('pins the large-area guard, which replaces the button', () => {
    // The guard takes the button's place, so it has to inherit its position.
    const store = useSearchStore()
    store.configure(BUILTIN_APIS[0])
    store.setBbox([11, 55, 19, 60])

    const wrapper = mountPanel()
    const foot = wrapper.find('.panel-foot').element
    const guard = wrapper.find('.guard')

    expect(guard.exists()).toBe(true)
    expect(foot.contains(guard.element)).toBe(true)
    expect(wrapper.find('.panel-scroll').element.contains(guard.element)).toBe(
      false,
    )
  })
})
