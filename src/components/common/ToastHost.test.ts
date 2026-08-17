import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import ToastHost from '@/components/common/ToastHost.vue'
import { useToastStore } from '@/stores/toastStore'

function mountHost() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(ToastHost, {
    global: { plugins: [pinia, i18n] },
    attachTo: document.body,
  })
  return { wrapper, toast: useToastStore() }
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
})

describe('rendering', () => {
  it('renders nothing with no toasts', () => {
    const { wrapper } = mountHost()
    expect(wrapper.findAll('.toast')).toHaveLength(0)
  })

  it('is announced through a single polite live region', () => {
    const { wrapper } = mountHost()
    expect(wrapper.find('.host').attributes('aria-live')).toBe('polite')
  })

  it('renders a pushed toast', async () => {
    const { wrapper, toast } = mountHost()
    toast.push('Added a catalog', 'success')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.toast').text()).toContain('Added a catalog')
    expect(wrapper.find('.toast').classes()).toContain('toast--success')
  })

  it('renders every toast currently in the store', async () => {
    const { wrapper, toast } = mountHost()
    toast.push('First')
    toast.push('Second')
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.toast')).toHaveLength(2)
  })
})

describe('dismissal', () => {
  it('removes the toast from the store when its close button is clicked', async () => {
    const { wrapper, toast } = mountHost()
    toast.push('Dismiss me')
    await wrapper.vm.$nextTick()

    await wrapper.find('.dismiss').trigger('click')

    expect(toast.toasts).toHaveLength(0)
  })
})
