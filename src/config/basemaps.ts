import type { StyleSpecification } from 'maplibre-gl'

/**
 * Basemaps.
 *
 * All keyless and verified CORS-enabled, which keeps the app deployable as a
 * static site with no account or token to manage.
 */
export interface Basemap {
  id: BasemapId
  labelKey: string
  style: string | StyleSpecification
  /** Preferred when the OS colour scheme is dark. */
  isDark?: boolean
}

export type BasemapId = 'light' | 'dark' | 'aerial'

/**
 * Esri World Imagery as a plain raster style.
 *
 * Declared inline rather than fetched: there is no public style.json for it,
 * and the tile endpoint answers with `access-control-allow-origin: *`.
 * Note the `{z}/{y}/{x}` ordering — Esri puts row before column.
 */
const aerialStyle: StyleSpecification = {
  version: 8,
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    {
      id: 'esri-world-imagery',
      type: 'raster',
      source: 'esri-world-imagery',
    },
  ],
}

export const BASEMAPS: Basemap[] = [
  {
    id: 'light',
    labelKey: 'map.basemap.light',
    style: 'https://tiles.openfreemap.org/styles/bright',
  },
  {
    id: 'aerial',
    labelKey: 'map.basemap.aerial',
    style: aerialStyle,
  },
]

export function findBasemap(id: BasemapId): Basemap {
  return BASEMAPS.find((basemap) => basemap.id === id) ?? BASEMAPS[0]
}

/** Roughly Sweden, which is what every built-in catalog covers. */
export const DEFAULT_CENTER: [number, number] = [15.2, 62.5]
export const DEFAULT_ZOOM = 4
