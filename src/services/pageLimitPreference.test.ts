import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PAGE_LIMIT,
  PAGE_LIMIT_OPTIONS,
  loadPageLimit,
  savePageLimit,
} from '@/services/pageLimitPreference'

const STORAGE_KEY = 'stac-browser:page-limit'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('persistence', () => {
  it('round-trips a choice', () => {
    savePageLimit(500)
    expect(loadPageLimit()).toBe(500)
  })

  it('is null before anything has been chosen', () => {
    expect(loadPageLimit()).toBeNull()
  })

  it('ignores a value that is not one of the offered options', () => {
    // A hand-edited or stale key must not feed an arbitrary number to the API.
    localStorage.setItem(STORAGE_KEY, '99999')
    expect(loadPageLimit()).toBeNull()
  })

  it('ignores a non-numeric value', () => {
    localStorage.setItem(STORAGE_KEY, 'lots')
    expect(loadPageLimit()).toBeNull()
  })

  it('survives storage being unavailable', () => {
    // Private mode, or storage disabled by policy.
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(() => savePageLimit(100)).not.toThrow()
    expect(loadPageLimit()).toBeNull()
  })

  it('remembers across sessions, like the download tier and unlike the basket', () => {
    savePageLimit(1000)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1000')
  })
})

describe('the offered options', () => {
  it('include the default', () => {
    expect(PAGE_LIMIT_OPTIONS).toContain(DEFAULT_PAGE_LIMIT)
  })
})
