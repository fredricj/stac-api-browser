import { describe, expect, it } from 'vitest'
import {
  BASEMAPS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  findBasemap,
} from '@/config/basemaps'

describe('basemap config', () => {
  it('offers a light, dark and aerial option', () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual(['light', 'dark', 'aerial'])
  })

  it('gives every basemap a unique id and a label key', () => {
    const ids = BASEMAPS.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const basemap of BASEMAPS) {
      expect(basemap.labelKey).toMatch(/^map\.basemap\./)
    }
  })

  it('uses only keyless https sources', () => {
    // The app deploys as a static site, so a basemap needing an API key or
    // an account would break the whole premise.
    for (const basemap of BASEMAPS) {
      const urls =
        typeof basemap.style === 'string'
          ? [basemap.style]
          : Object.values(basemap.style.sources).flatMap((source) =>
              'tiles' in source ? (source.tiles ?? []) : [],
            )

      for (const url of urls) {
        expect(url.startsWith('https://')).toBe(true)
        expect(url).not.toMatch(/api[_-]?key|access[_-]?token|\?key=/i)
      }
    }
  })

  it('attributes the aerial imagery', () => {
    const aerial = findBasemap('aerial')
    const source = Object.values(
      (aerial.style as { sources: Record<string, { attribution?: string }> })
        .sources,
    )[0]
    expect(source.attribution).toContain('Esri')
  })

  it('falls back to the first basemap for an unknown id', () => {
    expect(findBasemap('nope' as 'light').id).toBe('light')
  })

  it('starts over Sweden, which every built-in catalog covers', () => {
    const [lng, lat] = DEFAULT_CENTER
    expect(lng).toBeGreaterThan(10)
    expect(lng).toBeLessThan(25)
    expect(lat).toBeGreaterThan(55)
    expect(lat).toBeLessThan(70)
    expect(DEFAULT_ZOOM).toBeGreaterThan(0)
  })
})
