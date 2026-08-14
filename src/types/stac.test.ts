import { describe, expect, it } from 'vitest'
import {
  assetsWithRole,
  dataAsset,
  findLink,
  findLinks,
  itemDatetime,
  itemKey,
  thumbnailAsset,
} from '@/types/stac'
import type { StacItem } from '@/types/stac'
import itemFixture from '@/services/__fixtures__/item-bild.json'

// A real ortofoto item captured from api.lantmateriet.se — it carries all
// three asset roles the app cares about.
const item = itemFixture as unknown as StacItem

describe('item helpers', () => {
  it('keys items by collection and id', () => {
    // Item IDs repeat across collections (the same 2.5 km tile is reflown
    // every few years), so the collection has to be part of the key.
    expect(itemKey(item)).toBe('orto-o2-2025/o65700_6825_25_mr25')
    expect(itemKey({ id: 'x', collection: undefined })).toBe('/x')
  })

  it('finds the downloadable asset by role', () => {
    const asset = dataAsset(item)
    expect(asset?.href).toMatch(/^https:\/\/dl1\.lantmateriet\.se\/.+\.tif$/)
    expect(asset?.type).toContain('profile=cloud-optimized')
  })

  it('finds the thumbnail, which carries two roles', () => {
    expect(assetsWithRole(item, 'thumbnail')).toHaveLength(1)
    expect(assetsWithRole(item, 'overview')).toHaveLength(1)
    expect(thumbnailAsset(item)?.type).toBe('image/jpeg')
  })

  it('returns null rather than throwing when a role is absent', () => {
    const bare = { ...item, assets: {} } as StacItem
    expect(dataAsset(bare)).toBeNull()
    expect(thumbnailAsset(bare)).toBeNull()
    expect(assetsWithRole(bare, 'data')).toEqual([])
  })

  it('reads the acquisition datetime', () => {
    expect(itemDatetime(item)).toBe('2025-05-31T09:21:07Z')
  })

  it('falls back to start_datetime when datetime is null', () => {
    const ranged = {
      ...item,
      properties: {
        ...item.properties,
        datetime: null,
        start_datetime: '2025-05-31T08:52:30Z',
      },
    } as StacItem
    expect(itemDatetime(ranged)).toBe('2025-05-31T08:52:30Z')
  })

  it('preserves Lantmäteriet extension properties', () => {
    expect(item.properties.upplosning).toBe(0.16)
    expect(item.properties.flygar).toBe(2025)
    expect(item.properties['proj:code']).toBe('EPSG:3006')
  })
})

describe('link helpers', () => {
  it('finds a link by rel', () => {
    expect(findLink(item.links, 'self')?.rel).toBe('self')
    expect(findLink(item.links, 'nope')).toBeNull()
    expect(findLink(undefined, 'self')).toBeNull()
  })

  it('finds every link with a rel', () => {
    expect(findLinks(item.links, 'nope')).toEqual([])
    expect(findLinks(undefined, 'self')).toEqual([])
    expect(findLinks(item.links, 'self').length).toBeGreaterThan(0)
  })
})
