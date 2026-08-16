/**
 * Coordinate parsing and reprojection.
 *
 * Swedish users hold coordinates in SWEREF99 TM, not degrees — a property
 * boundary, a map sheet corner or a GPS reading all arrive as
 * `6580822, 674032`. Requiring them to convert to WGS84 before searching
 * would make the coordinate box useless to the people most likely to use it,
 * so the box accepts every form they actually have and shows back its
 * interpretation before anything is searched.
 */

import proj4 from 'proj4'
import type { BBox2D } from '@/types/stac'
import { bufferPointToBBox, normaliseBBox } from '@/utils/bbox'

export const WGS84 = 'EPSG:4326'
/** SWEREF99 TM — the national grid all three Lantmäteriet catalogs cut on. */
export const SWEREF99TM = 'EPSG:3006'
/** SWEREF99 TM + RH2000 heights. Horizontally identical to EPSG:3006. */
export const SWEREF99TM_RH2000 = 'EPSG:5845'

proj4.defs(
  SWEREF99TM,
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
// A compound CRS: proj4 only handles the horizontal half, which is all we
// need, so it is registered as a plain alias of EPSG:3006.
proj4.defs(SWEREF99TM_RH2000, proj4.defs(SWEREF99TM))

/** CRS the coordinate box can read, in the order it offers them. */
export const SUPPORTED_CRS = [WGS84, SWEREF99TM] as const
export type SupportedCrs = (typeof SUPPORTED_CRS)[number]

export function isSupportedCrs(value: string): value is SupportedCrs {
  return (SUPPORTED_CRS as readonly string[]).includes(value)
}

/**
 * Map a registry entry's `defaultCrs` onto something the box can offer.
 * EPSG:5845 differs from EPSG:3006 only in the vertical datum.
 */
export function resolveCrs(value: string | undefined): SupportedCrs {
  if (!value) return WGS84
  if (value === SWEREF99TM_RH2000) return SWEREF99TM
  return isSupportedCrs(value) ? value : WGS84
}

/* ------------------------------------------------------------------ *
 * Reprojection
 * ------------------------------------------------------------------ */

/** Projected easting/northing (or degrees, for WGS84) to WGS84 lon/lat. */
export function toWgs84(
  x: number,
  y: number,
  crs: string,
): { lon: number; lat: number } {
  if (crs === WGS84) return { lon: x, lat: y }
  const [lon, lat] = proj4(crs, WGS84, [x, y])
  return { lon, lat }
}

/** WGS84 lon/lat to the given CRS, for showing coordinates back. */
export function fromWgs84(
  lon: number,
  lat: number,
  crs: string,
): { x: number; y: number } {
  if (crs === WGS84) return { x: lon, y: lat }
  const [x, y] = proj4(WGS84, crs, [lon, lat])
  return { x, y }
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

export type CoordinateFormat = 'decimal' | 'dms' | 'projected' | 'bbox'

/** Which axis the first number in the input turned out to be. */
export type AxisOrder = 'lat-lon' | 'lon-lat' | 'north-east' | 'east-north'

export interface ParsedCoordinate {
  format: CoordinateFormat
  /** CRS the input was read in. */
  crs: SupportedCrs
  order: AxisOrder
  /**
   * True when the axis order was a convention rather than a deduction — two
   * values both inside ±90 could be either way round. The UI offers a swap.
   */
  ambiguous: boolean
  /** WGS84 point, for every format except a pasted bbox. */
  point?: { lon: number; lat: number }
  /** WGS84 search extent. Point formats are buffered into a small box. */
  bbox: BBox2D
}

export interface ParseCoordinateOptions {
  /** Force a CRS instead of detecting it by magnitude. */
  crs?: SupportedCrs | 'auto'
  /** Read the two numbers the other way round. */
  swapAxes?: boolean
  /** Half-size of the box a point is buffered into, in metres. */
  pointBufferM?: number
}

/**
 * Below this, a pair of numbers cannot be metres in a projected CRS: SWEREF99
 * TM eastings start around 200 000 and northings around 6 100 000, while
 * degrees never exceed 180. Nothing in between is a real coordinate, so the
 * magnitude test is exact rather than heuristic.
 */
const PROJECTED_THRESHOLD = 1_000

/** Numbers, tolerating the separators people actually paste. */
function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+(?:\.\d+)?/g)
  return matches ? matches.map(Number) : []
}

/**
 * `59°19'48"N 18°04'12"E`, and the looser forms people type: missing seconds,
 * a plain space for the degree sign, hemisphere letters before or after.
 */
function parseDms(text: string): { lat: number; lon: number } | null {
  const pattern =
    /([NSEWnsew])?\s*(\d+(?:\.\d+)?)\s*[°d:\s]\s*(?:(\d+(?:\.\d+)?)\s*['′m:]?\s*)?(?:(\d+(?:\.\d+)?)\s*["″s]?\s*)?([NSEWnsew])?/g

  const found: Array<{ value: number; hemisphere: string | null }> = []
  for (const match of text.matchAll(pattern)) {
    const [, before, degrees, minutes, seconds, after] = match
    if (degrees === undefined) continue

    const decimal =
      Number(degrees) + Number(minutes ?? 0) / 60 + Number(seconds ?? 0) / 3600
    const hemisphere = (after ?? before ?? null)?.toUpperCase() ?? null
    const signed = hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal

    found.push({ value: signed, hemisphere })
    if (found.length === 2) break
  }

  if (found.length !== 2) return null

  // Hemisphere letters settle the order outright; without them, fall back to
  // the usual latitude-first convention.
  const latIndex = found.findIndex(
    (entry) => entry.hemisphere === 'N' || entry.hemisphere === 'S',
  )
  const lonIndex = found.findIndex(
    (entry) => entry.hemisphere === 'E' || entry.hemisphere === 'W',
  )

  if (latIndex >= 0 && lonIndex >= 0 && latIndex !== lonIndex) {
    return { lat: found[latIndex].value, lon: found[lonIndex].value }
  }
  return { lat: found[0].value, lon: found[1].value }
}

function hasDmsMarkers(text: string): boolean {
  return /[°′″'"]/.test(text) || /\d\s*[NSEW]\b/i.test(text)
}

/**
 * Read whatever the user pasted into a WGS84 search extent.
 *
 * Returns null when the text is not a coordinate at all — the caller shows
 * that as "not understood", never as an empty search.
 */
export function parseCoordinateInput(
  text: string,
  options: ParseCoordinateOptions = {},
): ParsedCoordinate | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const { swapAxes = false, pointBufferM = 1_000 } = options
  const requestedCrs = options.crs ?? 'auto'

  /* ---- DMS ---- */
  if (hasDmsMarkers(trimmed)) {
    const dms = parseDms(trimmed)
    if (dms && isPlausibleLonLat(dms.lon, dms.lat)) {
      const point = swapAxes ? { lon: dms.lat, lat: dms.lon } : dms
      if (!isPlausibleLonLat(point.lon, point.lat)) return null
      return {
        format: 'dms',
        crs: WGS84,
        order: swapAxes ? 'lon-lat' : 'lat-lon',
        ambiguous: false,
        point,
        bbox: bufferPointToBBox(point.lon, point.lat, pointBufferM),
      }
    }
    return null
  }

  const numbers = extractNumbers(trimmed)

  /* ---- Pasted bbox ---- */
  if (numbers.length === 4) {
    const crs = detectCrs(numbers, requestedCrs)
    const corners =
      crs === WGS84
        ? (numbers as BBox2D)
        : projectBBox(numbers as BBox2D, crs, swapAxes)
    if (!corners) return null

    const bbox = normaliseBBox(corners)
    if (!isPlausibleLonLat(bbox[0], bbox[1])) return null
    if (!isPlausibleLonLat(bbox[2], bbox[3])) return null

    return {
      format: 'bbox',
      crs,
      order: crs === WGS84 ? 'lon-lat' : 'east-north',
      ambiguous: false,
      bbox,
    }
  }

  /* ---- Point ---- */
  if (numbers.length !== 2) return null

  const [first, second] = numbers
  const crs = detectCrs(numbers, requestedCrs)

  if (crs !== WGS84) {
    // Northings are millions, eastings hundreds of thousands: the larger value
    // is always the northing, so projected input never needs a guess.
    const northingFirst = Math.abs(first) > Math.abs(second)
    const [northing, easting] = northingFirst
      ? [first, second]
      : [second, first]
    const swapped = swapAxes
      ? { x: northing, y: easting }
      : { x: easting, y: northing }

    const point = toWgs84(swapped.x, swapped.y, crs)
    if (!isPlausibleLonLat(point.lon, point.lat)) return null

    return {
      format: 'projected',
      crs,
      order: northingFirst ? 'north-east' : 'east-north',
      ambiguous: false,
      point,
      bbox: bufferPointToBBox(point.lon, point.lat, pointBufferM),
    }
  }

  // Degrees. A value beyond ±90 cannot be a latitude, which settles the order;
  // otherwise assume the latitude-first convention and flag it as a guess.
  const firstMustBeLon = Math.abs(first) > 90
  const secondMustBeLon = Math.abs(second) > 90
  if (firstMustBeLon && secondMustBeLon) return null

  let latLonOrder = !firstMustBeLon
  if (swapAxes) latLonOrder = !latLonOrder

  const point = latLonOrder
    ? { lat: first, lon: second }
    : { lat: second, lon: first }
  if (!isPlausibleLonLat(point.lon, point.lat)) return null

  return {
    format: 'decimal',
    crs: WGS84,
    order: latLonOrder ? 'lat-lon' : 'lon-lat',
    ambiguous: !firstMustBeLon && !secondMustBeLon,
    point,
    bbox: bufferPointToBBox(point.lon, point.lat, pointBufferM),
  }
}

function detectCrs(
  numbers: number[],
  requested: SupportedCrs | 'auto',
): SupportedCrs {
  if (requested !== 'auto') return requested
  const projected = numbers.some(
    (value) => Math.abs(value) >= PROJECTED_THRESHOLD,
  )
  return projected ? SWEREF99TM : WGS84
}

/** Reproject a projected `[minX, minY, maxX, maxY]` box into WGS84. */
function projectBBox(
  bbox: BBox2D,
  crs: SupportedCrs,
  swapAxes: boolean,
): BBox2D | null {
  const [a, b, c, d] = bbox
  const [minX, minY, maxX, maxY] = swapAxes ? [b, a, d, c] : [a, b, c, d]

  try {
    const lowerLeft = toWgs84(minX, minY, crs)
    const upperRight = toWgs84(maxX, maxY, crs)
    return normaliseBBox([
      lowerLeft.lon,
      lowerLeft.lat,
      upperRight.lon,
      upperRight.lat,
    ])
  } catch {
    return null
  }
}

function isPlausibleLonLat(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lon) <= 180 &&
    Math.abs(lat) <= 90
  )
}

/** `59.32938, 18.06871` — the read-back the coordinate box shows. */
export function formatLonLat(lon: number, lat: number, precision = 5): string {
  return `${lat.toFixed(precision)}, ${lon.toFixed(precision)}`
}

/** `674032 E, 6580822 N` — the same point in a projected CRS. */
export function formatProjected(x: number, y: number): string {
  return `${Math.round(x)} E, ${Math.round(y)} N`
}
