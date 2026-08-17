import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '@/stores/toastStore'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('push', () => {
  it('adds a toast with the given message and variant', () => {
    const toast = useToastStore()
    toast.push('Added catalog', 'success')

    expect(toast.toasts).toHaveLength(1)
    expect(toast.toasts[0]).toMatchObject({
      message: 'Added catalog',
      variant: 'success',
    })
  })

  it('defaults to the info variant', () => {
    const toast = useToastStore()
    toast.push('Just so you know')

    expect(toast.toasts[0].variant).toBe('info')
  })

  it('gives each toast a distinct id, even for identical messages', () => {
    const toast = useToastStore()
    toast.push('Same message')
    toast.push('Same message')

    const [first, second] = toast.toasts
    expect(first.id).not.toBe(second.id)
  })

  it('dismisses itself after the default duration', () => {
    const toast = useToastStore()
    toast.push('Gone soon')
    expect(toast.toasts).toHaveLength(1)

    vi.advanceTimersByTime(5000)

    expect(toast.toasts).toHaveLength(0)
  })

  it('never expires when given a duration of zero', () => {
    const toast = useToastStore()
    toast.push('Stays until dismissed', 'info', 0)

    vi.advanceTimersByTime(60_000)

    expect(toast.toasts).toHaveLength(1)
  })
})

describe('dismiss', () => {
  it('removes only the named toast', () => {
    const toast = useToastStore()
    const first = toast.push('First')
    toast.push('Second')

    toast.dismiss(first)

    expect(toast.toasts).toHaveLength(1)
    expect(toast.toasts[0].message).toBe('Second')
  })

  it('is a no-op for an id that is not present', () => {
    const toast = useToastStore()
    toast.push('Still here')

    toast.dismiss(9999)

    expect(toast.toasts).toHaveLength(1)
  })
})
