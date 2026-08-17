import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import QueryableFilters from '@/components/search/QueryableFilters.vue'
import type { QueryableField } from '@/services/queryables'

const FIELDS: QueryableField[] = [
  {
    name: 'flygar',
    kind: 'number',
    label: 'flygår',
    minimum: 1950,
    maximum: 2050,
    integer: true,
  },
]

function mountFilters(props: Record<string, unknown> = {}) {
  return mount(QueryableFilters, {
    props: { fields: FIELDS, values: {}, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
})

describe('empty states', () => {
  it('renders nothing for a catalog with no queryables and no error', () => {
    const wrapper = mountFilters({ fields: [] })
    expect(wrapper.find('.queryables').exists()).toBe(false)
  })
})

describe('a failed fetch', () => {
  const error = { kind: 'http' as const, status: 500, message: '500' }

  it('shows an error rather than disappearing entirely', () => {
    // Without an error prop the panel simply omits itself when `fields` is
    // empty — the same emptiness a catalog with no queryables produces. A
    // failed fetch needs to say so instead of looking identical to that.
    const wrapper = mountFilters({ fields: [], error })
    expect(wrapper.find('.queryables').exists()).toBe(true)
    expect(wrapper.find('.error').exists()).toBe(true)
  })

  it('hints at CORS when the failure looks like one', () => {
    const wrapper = mountFilters({
      fields: [],
      error: { ...error, likelyCors: true },
    })
    expect(wrapper.find('.error-hint').exists()).toBe(true)
  })

  it('asks to retry, and lets the parent decide what that means', async () => {
    const wrapper = mountFilters({ fields: [], error })
    await wrapper.find('.retry').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('prefers the loading state once a retry is in flight', () => {
    const wrapper = mountFilters({ fields: [], error, loading: true })
    expect(wrapper.find('.error').exists()).toBe(false)
    expect(wrapper.find('.status').text()).toContain('Reading')
  })
})

describe('a numeric field', () => {
  it('renders min and max inputs bounded by the schema', () => {
    const wrapper = mountFilters()
    const inputs = wrapper.findAll('.range-input')

    expect(inputs).toHaveLength(2)
    expect(inputs[0].attributes('min')).toBe('1950')
    expect(inputs[1].attributes('max')).toBe('2050')
  })

  it('emits an updated value when the min changes', async () => {
    const wrapper = mountFilters()
    await wrapper.find('.range-input').setValue('2000')

    const emitted = wrapper.emitted('update:values')?.[0]?.[0] as Record<
      string,
      unknown
    >
    expect(emitted.flygar).toMatchObject({ kind: 'number', min: 2000 })
  })
})
