/**
 * Bounding-box arithmetic.
 *
 * A bbox here is always WGS84 `[west, south, east, north]` in degrees — the
 * only form STAC accepts on the wire, and the form the map speaks. Anything
 * in a projected CRS is converted in `utils/projections.ts` before it gets
 * here.
 */

import type { Polygon } from 'geojson'
import type { BBox, BBox2D } from '@/types/stac'

/** Mean Earth radius (IUGG), in metres. */
const EARTH_RADIUS_M = 6_371_008.8

/**
 * Above this, a search is likely to return more items than anyone wants to
 * page through: at 2.5 km tiles, 50×50 km is already 400 tiles per year of
 * coverage, and Sweden has been reflown many times. Not a hard limit — just
 * the point where the UI asks whether the user meant it.
 */
export const LARGE_AREA_KM2 = 2_500

/** Drop the elevation pair from a 3D bbox. */
export function toBBox2D(bbox: BBox): BBox2D {
  if (bbox.length === 6) {
    const [west, south, , east, north] = bbox
    return [west, south, east, north]
  }
  return [...bbox]
}

/**
 * Put the corners in the order the spec wants, so a box dragged right-to-left
 * or bottom-to-top still reads as `[west, south, east, north]`.
 *
 * Antimeridian-crossing boxes, where STAC deliberately allows `west > east`,
 * are left alone — swapping those would silently invert the query.
 */
export function normaliseBBox(bbox: BBox2D): BBox2D {
  const [west, south, east, north] = bbox
  const crossesAntimeridian = west > east && west - east > 180
  return [
    crossesAntimeridian ? west : Math.min(west, east),
    Math.min(south, north),
    crossesAntimeridian ? east : Math.max(west, east),
    Math.max(south, north),
  ]
}

/** Every value finite, latitudes in range, and the box not degenerate. */
export function isValidBBox(bbox: BBox2D | null | undefined): bbox is BBox2D {
  if (!bbox || bbox.length !== 4) return false
  if (!bbox.every((value) => Number.isFinite(value))) return false

  const [west, south, east, north] = bbox
  if (south < -90 || north > 90 || south > north) return false
  if (west < -180 || east > 180) return false
  return west !== east && south !== north
}

/** Pull a box back inside the valid WGS84 range. */
export function clampBBox(bbox: BBox2D): BBox2D {
  const [west, south, east, north] = bbox
  return [
    Math.max(-180, Math.min(180, west)),
    Math.max(-90, Math.min(90, south)),
    Math.max(-180, Math.min(180, east)),
    Math.max(-90, Math.min(90, north)),
  ]
}

/** Closed ring, counter-clockwise, starting south-west. */
export function bboxToPolygon(bbox: BBox2D): Polygon {
  const [west, south, east, north] = bbox
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  }
}

/**
 * The bbox of any polygon ring, used to read a drawn rectangle back out of
 * Terra Draw.
 */
export function polygonToBBox(polygon: Polygon): BBox2D | null {
  const ring = polygon.coordinates?.[0]
  if (!ring?.length) return null

  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const [lon, lat] of ring) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
    west = Math.min(west, lon)
    south = Math.min(south, lat)
    east = Math.max(east, lon)
    north = Math.max(north, lat)
  }

  return [west, south, east, north]
}

/**
 * Area in km².
 *
 * Exact on a sphere rather than a flat approximation: a degree of longitude is
 * 111 km at the equator and 50 km in northern Sweden, so treating the box as a
 * rectangle would overstate every Swedish search by a factor of two.
 */
export function bboxAreaKm2(bbox: BBox2D): number {
  const [west, south, east, north] = normaliseBBox(bbox)
  const lonSpan = ((east - west + 540) % 360) - 180
  const radians = Math.PI / 180

  const area =
    EARTH_RADIUS_M ** 2 *
    Math.abs(lonSpan * radians) *
    Math.abs(Math.sin(north * radians) - Math.sin(south * radians))

  return area / 1e6
}

/** Rough width and height in km, for showing the user what they drew. */
export function bboxSpanKm(bbox: BBox2D): { width: number; height: number } {
  const [west, south, east, north] = normaliseBBox(bbox)
  const radians = Math.PI / 180
  const midLat = ((south + north) / 2) * radians
  const lonSpan = ((east - west + 540) % 360) - 180

  return {
    width:
      (Math.abs(lonSpan * radians) * EARTH_RADIUS_M * Math.cos(midLat)) / 1000,
    height: (Math.abs((north - south) * radians) * EARTH_RADIUS_M) / 1000,
  }
}

/**
 * Grow a point into a small box.
 *
 * A point search almost never lands meaningfully — the user means "around
 * here", and an `intersects` on a bare point would only match the single tile
 * containing it, missing the neighbours they can see on screen.
 */
export function bufferPointToBBox(
  lon: number,
  lat: number,
  radiusM = 1_000,
): BBox2D {
  const degrees = 180 / Math.PI
  const latDelta = (radiusM / EARTH_RADIUS_M) * degrees
  // Longitude degrees shrink towards the poles; guard the division at ±90.
  const cosLat = Math.max(Math.cos(lat * (Math.PI / 180)), 1e-6)
  const lonDelta = (radiusM / (EARTH_RADIUS_M * cosLat)) * degrees

  return clampBBox([
    lon - lonDelta,
    lat - latDelta,
    lon + lonDelta,
    lat + latDelta,
  ])
}

/**
 * Parse `west,south,east,north`.
 *
 * Separators are loose on purpose — people paste bboxes out of URLs, JSON
 * arrays and spreadsheets, and all three should work.
 */
export function parseBBox(text: string): BBox2D | null {
  const numbers = text
    .replace(/[[\]()]/g, ' ')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)

  if (
    numbers.length !== 4 ||
    numbers.some((value) => !Number.isFinite(value))
  ) {
    return null
  }

  const bbox = normaliseBBox(numbers as BBox2D)
  return isValidBBox(bbox) ? bbox : null
}

/** `west,south,east,north` at a fixed precision, for URLs and inputs. */
export function formatBBox(bbox: BBox2D, precision = 5): string {
  return bbox.map((value) => value.toFixed(precision)).join(',')
}

/** True when two boxes are the same to within a rounding step. */
export function bboxEquals(
  a: BBox2D | null,
  b: BBox2D | null,
  epsilon = 1e-6,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.every((value, index) => Math.abs(value - b[index]) < epsilon)
}
