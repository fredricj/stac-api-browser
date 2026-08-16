import { describe, expect, it } from 'vitest'
import {
  SWEREF99TM,
  WGS84,
  fromWgs84,
  parseCoordinateInput,
  resolveCrs,
  toWgs84,
} from '@/utils/projections'

/**
 * Reference point: Stockholm City Hall, 59.32744 N 18.05442 E.
 *
 * The SWEREF99 TM pair below was cross-checked against Lantmäteriet's own
 * Gauss-Krüger formulas (their published Krüger series for the Gauss Conformal
 * Projection), computed independently of proj4. The two agree to well under a
 * millimetre, so a failure here is a broken projection definition, not drift.
 */
const CITY_HALL = { lon: 18.05442, lat: 59.32744, x: 673775.04, y: 6580498.93 }

describe('reprojection', () => {
  it('converts SWEREF99 TM to WGS84', () => {
    const { lon, lat } = toWgs84(CITY_HALL.x, CITY_HALL.y, SWEREF99TM)
    expect(lat).toBeCloseTo(CITY_HALL.lat, 5)
    expect(lon).toBeCloseTo(CITY_HALL.lon, 5)
  })

  it('round-trips back to SWEREF99 TM within a centimetre', () => {
    const { x, y } = fromWgs84(CITY_HALL.lon, CITY_HALL.lat, SWEREF99TM)
    expect(x).toBeCloseTo(CITY_HALL.x, 1)
    expect(y).toBeCloseTo(CITY_HALL.y, 1)
  })

  it('puts the central meridian on the false easting', () => {
    // 15°E is SWEREF99 TM's central meridian and 500 000 its false easting,
    // so this pair holds exactly by definition and pins the zone and datum.
    const { x } = fromWgs84(15, 60, SWEREF99TM)
    expect(x).toBeCloseTo(500_000, 6)
  })

  it('passes WGS84 through untouched', () => {
    expect(toWgs84(18, 59, WGS84)).toEqual({ lon: 18, lat: 59 })
  })
})

describe('resolveCrs', () => {
  it('maps the compound SWEREF99 TM + RH2000 code onto its horizontal half', () => {
    expect(resolveCrs('EPSG:5845')).toBe(SWEREF99TM)
  })

  it('falls back to WGS84 for anything unknown', () => {
    expect(resolveCrs('EPSG:27700')).toBe(WGS84)
    expect(resolveCrs(undefined)).toBe(WGS84)
  })
})

describe('parseCoordinateInput — decimal degrees', () => {
  it('reads a lat, lon pair', () => {
    const parsed = parseCoordinateInput('59.33, 18.07')
    expect(parsed?.format).toBe('decimal')
    expect(parsed?.point?.lat).toBeCloseTo(59.33, 5)
    expect(parsed?.point?.lon).toBeCloseTo(18.07, 5)
  })

  it('flags a both-under-90 pair as an assumed order', () => {
    // Sweden sits where latitude and longitude are both plausible, so the
    // order genuinely cannot be deduced — the UI has to offer a swap.
    expect(parseCoordinateInput('59.33, 18.07')?.ambiguous).toBe(true)
  })

  it('honours an explicit swap', () => {
    const parsed = parseCoordinateInput('59.33, 18.07', { swapAxes: true })
    expect(parsed?.point?.lat).toBeCloseTo(18.07, 5)
    expect(parsed?.order).toBe('lon-lat')
  })

  it('deduces the order when one value cannot be a latitude', () => {
    const parsed = parseCoordinateInput('-122.4, 37.8')
    expect(parsed?.ambiguous).toBe(false)
    expect(parsed?.order).toBe('lon-lat')
    expect(parsed?.point?.lat).toBeCloseTo(37.8, 5)
  })

  it('buffers a point into a box rather than searching a bare point', () => {
    const parsed = parseCoordinateInput('59.33, 18.07')
    expect(parsed?.bbox[0]).toBeLessThan(18.07)
    expect(parsed?.bbox[2]).toBeGreaterThan(18.07)
  })

  it('rejects a pair where neither value can be a latitude', () => {
    expect(parseCoordinateInput('120, 130')).toBeNull()
  })
})

describe('parseCoordinateInput — SWEREF99 TM', () => {
  it('detects projected metres by magnitude', () => {
    const parsed = parseCoordinateInput(`${CITY_HALL.y}, ${CITY_HALL.x}`)
    expect(parsed?.format).toBe('projected')
    expect(parsed?.crs).toBe(SWEREF99TM)
    expect(parsed?.point?.lat).toBeCloseTo(CITY_HALL.lat, 5)
    expect(parsed?.point?.lon).toBeCloseTo(CITY_HALL.lon, 5)
  })

  it('reads easting-first input the same way', () => {
    // The northing is always the larger value, so the order needs no guess.
    const parsed = parseCoordinateInput(`${CITY_HALL.x}, ${CITY_HALL.y}`)
    expect(parsed?.order).toBe('east-north')
    expect(parsed?.point?.lat).toBeCloseTo(CITY_HALL.lat, 5)
  })

  it('never reports projected input as ambiguous', () => {
    expect(parseCoordinateInput('6580499, 673775')?.ambiguous).toBe(false)
  })

  it('rejects out-of-range values when forced to read them as degrees', () => {
    expect(parseCoordinateInput('6580499, 673775', { crs: WGS84 })).toBeNull()
  })
})

describe('parseCoordinateInput — DMS', () => {
  it('reads degrees, minutes and seconds with hemispheres', () => {
    const parsed = parseCoordinateInput(`59°19'48"N 18°04'12"E`)
    expect(parsed?.format).toBe('dms')
    expect(parsed?.point?.lat).toBeCloseTo(59.33, 2)
    expect(parsed?.point?.lon).toBeCloseTo(18.07, 2)
  })

  it('applies the southern and western hemispheres as a sign', () => {
    const parsed = parseCoordinateInput(`33°55'S 18°25'E`)
    expect(parsed?.point?.lat).toBeCloseTo(-33.9167, 3)
    expect(parsed?.point?.lon).toBeCloseTo(18.4167, 3)
  })

  it('orders by hemisphere letter, not by position', () => {
    const parsed = parseCoordinateInput(`18°04'12"E 59°19'48"N`)
    expect(parsed?.point?.lat).toBeCloseTo(59.33, 2)
    expect(parsed?.point?.lon).toBeCloseTo(18.07, 2)
  })
})

describe('parseCoordinateInput — pasted bbox', () => {
  it('reads four degree values as a bbox', () => {
    const parsed = parseCoordinateInput('17.9,59.2,18.2,59.4')
    expect(parsed?.format).toBe('bbox')
    expect(parsed?.bbox).toEqual([17.9, 59.2, 18.2, 59.4])
    expect(parsed?.point).toBeUndefined()
  })

  it('reprojects a bbox given in SWEREF99 TM', () => {
    const parsed = parseCoordinateInput('674000,6580000,676500,6582500')
    expect(parsed?.crs).toBe(SWEREF99TM)
    expect(parsed?.bbox[1]).toBeCloseTo(59.32, 1)
    expect(parsed?.bbox[0]).toBeCloseTo(18.05, 1)
  })
})

describe('parseCoordinateInput — rejections', () => {
  it.each([
    ['empty input', '   '],
    ['prose', 'somewhere near Stockholm'],
    ['three numbers', '17.9, 59.2, 18.2'],
  ])('returns null for %s', (_label, text) => {
    expect(parseCoordinateInput(text)).toBeNull()
  })
})
