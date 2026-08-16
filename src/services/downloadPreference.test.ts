import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadPreferredTier,
  resolveInitialTier,
  savePreferredTier,
} from '@/services/downloadPreference'

const STORAGE_KEY = 'stac-browser:download-tier'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('persistence', () => {
  it('round-trips a choice', () => {
    savePreferredTier('sequential')
    expect(loadPreferredTier()).toBe('sequential')
  })

  it('is null before anything has been chosen', () => {
    expect(loadPreferredTier()).toBeNull()
  })

  it('ignores a value that is not a tier', () => {
    // A hand-edited or stale key must not select a route that does not exist.
    localStorage.setItem(STORAGE_KEY, 'ftp')
    expect(loadPreferredTier()).toBeNull()
  })

  it('survives storage being unavailable', () => {
    // Private mode, or storage disabled by policy.
    // Spied on the instance, not `Storage.prototype`: under Node the test
    // setup installs a plain-object shim that is not a `Storage` at all.
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(() => savePreferredTier('manifest')).not.toThrow()
    expect(loadPreferredTier()).toBeNull()
  })

  it('remembers across sessions, unlike the basket or the credentials', () => {
    // This is a preference, so localStorage is right here where it would be
    // wrong for either of those.
    savePreferredTier('manifest')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('manifest')
  })
})

describe('resolveInitialTier', () => {
  it('opens on the remembered choice', () => {
    expect(
      resolveInitialTier({
        remembered: 'sequential',
        canStreamToFolder: true,
        oversized: false,
      }),
    ).toBe('sequential')
  })

  it('keeps the remembered choice even for an oversized selection', () => {
    // The recommendation banner still shows; silently moving the radio under
    // someone who deliberately picked otherwise would be worse than advising.
    expect(
      resolveInitialTier({
        remembered: 'folder',
        canStreamToFolder: true,
        oversized: true,
      }),
    ).toBe('folder')
  })

  it('drops a remembered choice this browser cannot honour', () => {
    // Firefox and Safari have no directory handle, so opening on a disabled
    // radio would just look broken.
    expect(
      resolveInitialTier({
        remembered: 'folder',
        canStreamToFolder: false,
        oversized: false,
      }),
    ).toBe('manifest')
  })

  it.each(['sequential', 'manifest'] as const)(
    'keeps a remembered %s even without a directory handle',
    (remembered) => {
      expect(
        resolveInitialTier({
          remembered,
          canStreamToFolder: false,
          oversized: false,
        }),
      ).toBe(remembered)
    },
  )
})

describe('defaults, before anything is remembered', () => {
  it('starts on the folder route where it is available', () => {
    expect(
      resolveInitialTier({
        remembered: null,
        canStreamToFolder: true,
        oversized: false,
      }),
    ).toBe('folder')
  })

  it('steers a huge selection to a download manager', () => {
    expect(
      resolveInitialTier({
        remembered: null,
        canStreamToFolder: true,
        oversized: true,
      }),
    ).toBe('manifest')
  })

  it('falls back where there is no directory handle', () => {
    expect(
      resolveInitialTier({
        remembered: null,
        canStreamToFolder: false,
        oversized: false,
      }),
    ).toBe('manifest')
  })
})
