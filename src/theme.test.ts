import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEMES, loadTheme, setTheme, theme } from '@/theme'

const STORAGE_KEY = 'stac-browser:theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  vi.restoreAllMocks()
})

afterEach(() => {
  // The module holds one reactive singleton; leaving it on "system" keeps
  // every test's starting point the same regardless of run order.
  setTheme('system')
})

describe('persistence', () => {
  it('round-trips a choice', () => {
    setTheme('dark')
    expect(loadTheme()).toBe('dark')
  })

  it('defaults to "system" before anything has been chosen', () => {
    expect(loadTheme()).toBe('system')
  })

  it('ignores a value that is not a theme', () => {
    // A hand-edited or stale key must not select a palette that does not exist.
    localStorage.setItem(STORAGE_KEY, 'solarized')
    expect(loadTheme()).toBe('system')
  })

  it('survives storage being unavailable', () => {
    // Private mode, or storage disabled by policy.
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(() => setTheme('dark')).not.toThrow()
    expect(loadTheme()).toBe('system')
  })

  it('remembers across sessions, like the locale and download-tier choices', () => {
    setTheme('light')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
  })
})

describe('applying the choice', () => {
  it('stamps data-theme for an explicit choice', () => {
    setTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    setTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('clears data-theme for "system", leaving prefers-color-scheme in charge', () => {
    setTheme('dark')
    setTheme('system')

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('updates the reactive ref components read', () => {
    setTheme('dark')
    expect(theme.value).toBe('dark')
  })
})

describe('THEMES', () => {
  it('lists all three, "system" included', () => {
    expect(THEMES).toEqual(['light', 'dark', 'system'])
  })
})
