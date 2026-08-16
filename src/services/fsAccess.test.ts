import { describe, expect, it, vi } from 'vitest'
import {
  hasCompleteFile,
  isDirectoryPickerSupported,
  safeFilename,
} from '@/services/fsAccess'

describe('capability detection', () => {
  it('is false where the picker does not exist', () => {
    // jsdom, Firefox and Safari all land here, which is what drives the
    // fallback to tier 2 and tier 3.
    expect(isDirectoryPickerSupported()).toBe(false)
  })

  it('is true once the picker is present', () => {
    // The single property: replacing `window` wholesale breaks other DOM APIs.
    vi.stubGlobal('showDirectoryPicker', () => {})
    expect(isDirectoryPickerSupported()).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe('safeFilename', () => {
  it('takes the basename from a real asset URL', () => {
    expect(
      safeFilename(
        'https://dl1.lantmateriet.se/bild/data/orto/se0_16m/o65700_6825_25_mr25.tif',
      ),
    ).toBe('o65700_6825_25_mr25.tif')
  })

  it('decodes percent-encoding', () => {
    expect(safeFilename('https://x.example/a/my%20file.tif')).toBe(
      'my file.tif',
    )
  })

  it.each([
    ['https://x.example/a/../../../etc/passwd', 'passwd'],
    ['https://x.example/a/%2e%2e%2f%2e%2e%2fautorun.inf', 'autorun.inf'],
    ['https://x.example/a/....//evil.tif', 'evil.tif'],
  ])('refuses to escape the chosen folder: %s', (url, expected) => {
    // The href is catalog-controlled data. Handing a traversal straight to
    // getFileHandle would try to write outside the folder the user picked.
    const name = safeFilename(url)

    expect(name).toBe(expected)
    expect(name).not.toContain('/')
    expect(name).not.toContain('\\')
    expect(name.startsWith('.')).toBe(false)
  })

  it('strips characters that are illegal in a filename', () => {
    // Percent-encoded, because `?` and `*` in a raw URL are query and path
    // syntax rather than part of the filename.
    expect(
      safeFilename('https://x.example/a/a%3Cb%3Ec%3Ad%22e%7Cf%3Fg%2Ah.tif'),
    ).toBe('a_b_c_d_e_f_g_h.tif')
  })

  it('removes control characters', () => {
    const name = safeFilename('https://x.example/a/na%00me%1fx.tif')
    expect(name).toBe('namex.tif')
  })

  it('escapes Windows reserved device names', () => {
    // `CON.tif` is unusable as a filename on Windows whatever the extension.
    expect(safeFilename('https://x.example/a/CON.tif')).toBe('_CON.tif')
    expect(safeFilename('https://x.example/a/lpt1')).toBe('_lpt1')
  })

  it('falls back rather than producing an empty name', () => {
    expect(safeFilename('https://x.example/')).toBe('download')
    expect(safeFilename('not a url')).toBe('download')
    expect(safeFilename('https://x.example/a/...')).toBe('download')
  })

  it('leaves room for the .part suffix', () => {
    const long = `https://x.example/${'a'.repeat(500)}.tif`
    expect(safeFilename(long).length).toBeLessThanOrEqual(240)
  })
})

describe('hasCompleteFile', () => {
  function directoryWith(size: number | null) {
    return {
      getFileHandle: vi.fn(async () => {
        if (size === null) throw new DOMException('nope', 'NotFoundError')
        return { getFile: async () => ({ size }) }
      }),
    } as unknown as FileSystemDirectoryHandle
  }

  it('skips a file that is already there at the right size', async () => {
    expect(await hasCompleteFile(directoryWith(1000), 'a.tif', 1000)).toBe(true)
  })

  it('re-downloads a truncated file from an interrupted run', async () => {
    // The whole point of comparing size rather than mere existence: treating
    // a half-written 692 MB tile as complete is silent corruption that only
    // surfaces when someone opens it.
    expect(await hasCompleteFile(directoryWith(512), 'a.tif', 1000)).toBe(false)
  })

  it('does not skip when the file is absent', async () => {
    expect(await hasCompleteFile(directoryWith(null), 'a.tif', 1000)).toBe(
      false,
    )
  })

  it('declines to skip when the expected size is unknown', async () => {
    // With no size to compare against there is no way to tell complete from
    // truncated, so re-downloading is the only safe answer.
    expect(await hasCompleteFile(directoryWith(1000), 'a.tif', null)).toBe(
      false,
    )
  })
})
