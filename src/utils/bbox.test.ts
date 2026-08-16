import { describe, expect, it } from 'vitest'
import {
  bboxAreaKm2,
  bboxEquals,
  bboxSpanKm,
  bboxToPolygon,
  bufferPointToBBox,
  clampBBox,
  formatBBox,
  isValidBBox,
  normaliseBBox,
  parseBBox,
  polygonToBBox,
  toBBox2D,
} from '@/utils/bbox'
import type { BBox2D } from '@/types/stac'

describe('toBBox2D', () => {
  it('drops the elevation pair from a 3D bbox', () => {
    expect(toBBox2D([11, 55, 0, 24, 69, 2000])).toEqual([11, 55, 24, 69])
  })

  it('copies rather than aliasing a 2D bbox', () => {
    const source: BBox2D = [11, 55, 24, 69]
    expect(toBBox2D(source)).not.toBe(source)
  })
})

describe('normaliseBBox', () => {
  it('orders corners drawn bottom-right to top-left', () => {
    expect(normaliseBBox([18.2, 59.4, 17.9, 59.2])).toEqual([
      17.9, 59.2, 18.2, 59.4,
    ])
  })

  it('leaves an antimeridian-crossing box alone', () => {
    // west > east is legal here and means "the short way across 180°".
    expect(normaliseBBox([170, -10, -170, 10])).toEqual([170, -10, -170, 10])
  })
})

describe('isValidBBox', () => {
  it('accepts a normal box', () => {
    expect(isValidBBox([17.9, 59.2, 18.2, 59.4])).toBe(true)
  })

  it.each([
    ['null', null],
    ['a degenerate box', [18, 59, 18, 59.4] as BBox2D],
    ['an out-of-range latitude', [17, 59, 18, 91] as BBox2D],
    ['an inverted latitude pair', [17, 60, 18, 59] as BBox2D],
    ['a non-finite value', [17, 59, Number.NaN, 60] as BBox2D],
  ])('rejects %s', (_label, value) => {
    expect(isValidBBox(value as BBox2D | null)).toBe(false)
  })
})

describe('clampBBox', () => {
  it('pulls values back inside the WGS84 range', () => {
    expect(clampBBox([-200, -95, 200, 95])).toEqual([-180, -90, 180, 90])
  })
})

describe('bboxToPolygon / polygonToBBox', () => {
  it('round-trips', () => {
    const bbox: BBox2D = [17.9, 59.2, 18.2, 59.4]
    expect(polygonToBBox(bboxToPolygon(bbox))).toEqual(bbox)
  })

  it('produces a closed ring', () => {
    const ring = bboxToPolygon([17.9, 59.2, 18.2, 59.4]).coordinates[0]
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
  })

  it('returns null for a ring with a non-finite coordinate', () => {
    expect(
      polygonToBBox({
        type: 'Polygon',
        coordinates: [
          [
            [Number.NaN, 59],
            [18, 59],
            [18, 60],
            [Number.NaN, 59],
          ],
        ],
      }),
    ).toBeNull()
  })
})

describe('bboxAreaKm2', () => {
  it('matches the known area of a one-degree square at the equator', () => {
    // 111.32 km per degree at the equator, so ~12 390 km².
    expect(bboxAreaKm2([0, 0, 1, 1])).toBeCloseTo(12_364, -2)
  })

  it('shrinks the same span towards the pole', () => {
    // The whole point of using a spherical formula: a degree of longitude is
    // roughly half as wide in northern Sweden as at the equator.
    const equator = bboxAreaKm2([0, 0, 1, 1])
    const sweden = bboxAreaKm2([17, 59, 18, 60])
    expect(sweden).toBeLessThan(equator * 0.55)
  })
})

describe('bboxSpanKm', () => {
  it('reports width and height in kilometres', () => {
    const { width, height } = bboxSpanKm([17.9, 59.2, 18.2, 59.4])
    expect(height).toBeCloseTo(22.2, 0)
    // ~17 km at 59°N, not the ~33 km a flat approximation would give.
    expect(width).toBeCloseTo(17.0, 0)
  })
})

describe('bufferPointToBBox', () => {
  it('grows a point into a box centred on it', () => {
    const [west, south, east, north] = bufferPointToBBox(18.07, 59.33, 1_000)
    expect((west + east) / 2).toBeCloseTo(18.07, 6)
    expect((south + north) / 2).toBeCloseTo(59.33, 6)
  })

  it('widens the longitude span to keep the box square on the ground', () => {
    const [west, south, east, north] = bufferPointToBBox(18.07, 59.33, 1_000)
    expect(east - west).toBeGreaterThan(north - south)
  })
})

describe('parseBBox', () => {
  it.each([
    ['comma separated', '17.9,59.2,18.2,59.4'],
    ['spaced', '17.9 59.2 18.2 59.4'],
    ['a JSON array', '[17.9, 59.2, 18.2, 59.4]'],
  ])('parses %s bbox', (_label, text) => {
    expect(parseBBox(text)).toEqual([17.9, 59.2, 18.2, 59.4])
  })

  it('rejects the wrong number of values', () => {
    expect(parseBBox('17.9,59.2,18.2')).toBeNull()
  })

  it('rejects a degenerate box', () => {
    expect(parseBBox('18,59,18,59')).toBeNull()
  })
})

describe('formatBBox', () => {
  it('formats at a fixed precision', () => {
    expect(formatBBox([17.9, 59.2, 18.2, 59.4], 2)).toBe(
      '17.90,59.20,18.20,59.40',
    )
  })
})

describe('bboxEquals', () => {
  it('tolerates rounding', () => {
    expect(
      bboxEquals([17.9, 59.2, 18.2, 59.4], [17.9, 59.2, 18.2, 59.4000001]),
    ).toBe(true)
  })

  it('separates genuinely different boxes', () => {
    expect(bboxEquals([17.9, 59.2, 18.2, 59.4], [17.9, 59.2, 18.2, 59.5])).toBe(
      false,
    )
  })

  it('treats null as equal only to null', () => {
    expect(bboxEquals(null, null)).toBe(true)
    expect(bboxEquals(null, [17.9, 59.2, 18.2, 59.4])).toBe(false)
  })
})
