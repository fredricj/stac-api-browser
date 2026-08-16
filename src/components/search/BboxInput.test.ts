import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import BboxInput from '@/components/search/BboxInput.vue'
import type { BBox2D } from '@/types/stac'

function mountInput(modelValue: BBox2D | null = null) {
  return mount(BboxInput, {
    props: { modelValue },
    global: { plugins: [i18n] },
  })
}

function fields(wrapper: ReturnType<typeof mountInput>) {
  return wrapper.findAll('input[type="number"]')
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
})

describe('editing', () => {
  it('emits once every corner is filled in', async () => {
    const wrapper = mountInput()
    const [west, south, east, north] = fields(wrapper)

    await west.setValue('17.9')
    await south.setValue('59.2')
    await east.setValue('18.2')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await north.setValue('59.4')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([
      17.9, 59.2, 18.2, 59.4,
    ])
  })

  it('emits nothing while a field is being cleared and retyped', async () => {
    // Publishing a partial box mid-edit would fire a search against nonsense.
    const wrapper = mountInput([17.9, 59.2, 18.2, 59.4])
    await fields(wrapper)[2].setValue('')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('orders corners entered the wrong way round', async () => {
    const wrapper = mountInput()
    const [west, south, east, north] = fields(wrapper)

    await west.setValue('18.2')
    await south.setValue('59.4')
    await east.setValue('17.9')
    await north.setValue('59.2')

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([
      17.9, 59.2, 18.2, 59.4,
    ])
  })

  it('rejects a degenerate box', async () => {
    const wrapper = mountInput()
    const [west, south, east, north] = fields(wrapper)

    await west.setValue('18')
    await south.setValue('59')
    await east.setValue('18')
    await north.setValue('59.4')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('display', () => {
  it('fills the fields from an incoming box', () => {
    const wrapper = mountInput([17.9, 59.2, 18.2, 59.4])
    const values = fields(wrapper).map(
      (field) => (field.element as HTMLInputElement).value,
    )
    expect(values).toEqual(['17.9', '59.2', '18.2', '59.4'])
  })

  it('reports the size on the ground', () => {
    const wrapper = mountInput([17.9, 59.2, 18.2, 59.4])
    // ~17 × 22 km at this latitude, not the ~33 km a flat approximation gives.
    expect(wrapper.find('.readout').text()).toContain('17')
    expect(wrapper.find('.readout').text()).toContain('22.2')
  })

  it('warns before a large area is searched, not after', () => {
    // There is no result total to warn with afterwards, so the warning has to
    // be attached to the box itself.
    const wrapper = mountInput([11, 55, 19, 60])
    expect(wrapper.find('.warning').exists()).toBe(true)
  })

  it('leaves a city-sized box unwarned', () => {
    const wrapper = mountInput([17.9, 59.2, 18.2, 59.4])
    expect(wrapper.find('.warning').exists()).toBe(false)
  })

  it('clears back to null', async () => {
    const wrapper = mountInput([17.9, 59.2, 18.2, 59.4])
    await wrapper.find('.clear').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBeNull()
  })
})
