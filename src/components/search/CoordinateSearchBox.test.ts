import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import i18n from '@/i18n'
import CoordinateSearchBox from '@/components/search/CoordinateSearchBox.vue'
import { SWEREF99TM } from '@/utils/projections'

/** The box debounces its parse; advance past it and settle the DOM. */
async function settle() {
  await vi.advanceTimersByTimeAsync(250)
  await flushPromises()
}

async function typeCoordinate(
  text: string,
  props: Record<string, unknown> = {},
) {
  const wrapper = mount(CoordinateSearchBox, {
    props,
    global: { plugins: [i18n] },
  })
  await wrapper.find('input[type="text"]').setValue(text)
  await settle()
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers()
  i18n.global.locale.value = 'en'
})

describe('read-back', () => {
  it('shows the parsed point before anything is searched', async () => {
    // Silent auto-detection is the danger here: a coordinate read the wrong
    // way round lands hundreds of kilometres away and still looks plausible.
    const wrapper = await typeCoordinate('59.33, 18.07')

    expect(wrapper.find('.readback').text()).toContain('59.33000, 18.07000')
    expect(wrapper.find('.badge').text()).toBe('Degrees')
  })

  it('labels SWEREF99 TM input as metres', async () => {
    const wrapper = await typeCoordinate('6580499, 673775')

    expect(wrapper.find('.badge').text()).toContain('Metres')
    expect(wrapper.find('.badge').text()).toContain('EPSG:3006')
    expect(wrapper.find('.readback').text()).toContain('59.32744')
  })

  it("echoes the point in the catalog's own CRS as well", async () => {
    const wrapper = await typeCoordinate('59.32744, 18.05442', {
      defaultCrs: SWEREF99TM,
    })

    // A Swedish user checks the answer against the grid they came from.
    expect(wrapper.find('.readback-line--muted').text()).toContain('673775 E')
    expect(wrapper.find('.readback-line--muted').text()).toContain('6580499 N')
  })

  it('says so plainly when the input is not a coordinate', async () => {
    const wrapper = await typeCoordinate('somewhere near Stockholm')

    expect(wrapper.find('.unparsed').exists()).toBe(true)
    expect(
      wrapper.find('button[type="submit"]').attributes('disabled'),
    ).toBeDefined()
  })
})

describe('axis order', () => {
  it('offers a swap when both values could be either axis', async () => {
    const wrapper = await typeCoordinate('59.33, 18.07')
    expect(wrapper.find('.ambiguous').exists()).toBe(true)
  })

  it('does not offer a swap when the order is deducible', async () => {
    // -122.4 cannot be a latitude, so there is nothing to ask about.
    const wrapper = await typeCoordinate('-122.4, 37.8')
    expect(wrapper.find('.ambiguous').exists()).toBe(false)
  })

  it('re-reads the input the other way round when swapped', async () => {
    const wrapper = await typeCoordinate('59.33, 18.07')
    await wrapper.find('.ambiguous .link').trigger('click')
    await settle()

    expect(wrapper.find('.value').text()).toContain('18.07000, 59.33000')
  })
})

describe('locate', () => {
  it('emits a buffered box rather than a bare point', async () => {
    const wrapper = await typeCoordinate('59.33, 18.07')
    await wrapper.find('form').trigger('submit')

    const bbox = wrapper.emitted('locate')?.[0]?.[0] as number[]
    expect(bbox).toHaveLength(4)
    // A point search would only match the single tile containing it.
    expect(bbox[0]).toBeLessThan(18.07)
    expect(bbox[2]).toBeGreaterThan(18.07)
  })

  it('emits a pasted bbox unchanged', async () => {
    const wrapper = await typeCoordinate('17.9,59.2,18.2,59.4')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('locate')?.[0]?.[0]).toEqual([
      17.9, 59.2, 18.2, 59.4,
    ])
  })

  it('emits nothing when the input is not understood', async () => {
    const wrapper = await typeCoordinate('nonsense')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('locate')).toBeUndefined()
  })
})

describe('forced CRS', () => {
  it('honours an explicit choice over the magnitude check', async () => {
    const wrapper = mount(CoordinateSearchBox, {
      global: { plugins: [i18n] },
    })
    await wrapper.find('select').setValue('EPSG:3006')
    await wrapper.find('input[type="text"]').setValue('674000, 6580000')
    await settle()

    expect(wrapper.find('.badge').text()).toContain('Metres')
  })
})
