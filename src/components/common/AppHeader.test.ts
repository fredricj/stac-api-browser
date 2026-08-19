import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import AppHeader from '@/components/common/AppHeader.vue'
import i18n from '@/i18n'
import { setTheme, theme } from '@/theme'

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'home', component: { template: '<div />' } }],
  })
}

function mountHeader() {
  return mount(AppHeader, {
    global: { plugins: [router(), i18n] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  setTheme('system')
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
})

describe('theme switch', () => {
  it('offers all three options, marking the active one', () => {
    const wrapper = mountHeader()
    const buttons = wrapper.findAll('.theme-btn')

    expect(buttons).toHaveLength(3)
    const active = buttons.filter((button) => button.classes('is-active'))
    expect(active).toHaveLength(1)
    expect(active[0].attributes('aria-label')).toBe('Match system')
    expect(active[0].attributes('aria-current')).toBe('true')
  })

  it('switches the theme, and only that button, when clicked', async () => {
    const wrapper = mountHeader()
    const dark = wrapper
      .findAll('.theme-btn')
      .find((button) => button.attributes('aria-label') === 'Dark')!

    await dark.trigger('click')

    expect(theme.value).toBe('dark')
    expect(dark.classes('is-active')).toBe(true)
    expect(
      wrapper
        .findAll('.theme-btn')
        .filter((button) => button.classes('is-active')),
    ).toHaveLength(1)
  })

  it('reflects the choice on <html> so tokens.css can key off it', async () => {
    const wrapper = mountHeader()
    const light = wrapper
      .findAll('.theme-btn')
      .find((button) => button.attributes('aria-label') === 'Light')!

    await light.trigger('click')

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('reflects a choice already made elsewhere, on mount', () => {
    setTheme('dark')
    const wrapper = mountHeader()

    const active = wrapper
      .findAll('.theme-btn')
      .filter((button) => button.classes('is-active'))
    expect(active[0].attributes('aria-label')).toBe('Dark')
  })

  it('names the group for assistive tech', () => {
    const wrapper = mountHeader()
    expect(wrapper.find('nav.theme-switch').attributes('aria-label')).toBe(
      'Appearance',
    )
  })
})

describe('language switch', () => {
  it('marks the active locale', () => {
    const wrapper = mountHeader()
    const active = wrapper
      .findAll('.locale-btn')
      .find((button) => button.classes('is-active'))!

    expect(active.text()).toBe('EN')
  })

  it('switches locale when clicked', async () => {
    const wrapper = mountHeader()
    const sv = wrapper
      .findAll('.locale-btn')
      .find((button) => button.text() === 'SV')!

    await sv.trigger('click')

    expect(i18n.global.locale.value).toBe('sv')
  })
})
