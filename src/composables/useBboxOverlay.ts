/**
 * The search extent, drawn on the map.
 *
 * Deliberately separate from `useBboxDraw`: a bbox arrives from four places —
 * *Search this area*, the typed bounds, the coordinate box, and a shared URL —
 * and only one of them involves drawing. Tying the rectangle's *display* to
 * the drawing tool meant that three of the four set a search extent the user
 * could not see, which is exactly the bug this fixes.
 *
 * So: this layer always shows the current extent and costs nothing, and Terra
 * Draw is loaded only when the user actually wants to edit it. While Terra
 * Draw is showing its own editable rectangle this layer hides, so the box is
 * never drawn twice.
 */

import { watch, type Ref, type ShallowRef } from 'vue'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection, Polygon } from 'geojson'
import type { BBox2D } from '@/types/stac'
import { bboxToPolygon, isValidBBox } from '@/utils/bbox'

export const BBOX_SOURCE = 'search-bbox'
export const BBOX_FILL_LAYER = 'search-bbox-fill'
export const BBOX_LINE_LAYER = 'search-bbox-line'

const EMPTY: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [],
}

function toFeatureCollection(bbox: BBox2D | null): FeatureCollection<Polygon> {
  if (!bbox || !isValidBBox(bbox)) return EMPTY
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: bboxToPolygon(bbox), properties: {} },
    ],
  }
}

/** Read a colour token, falling back when the stylesheet is unavailable. */
function token(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

export interface UseBboxOverlayOptions {
  map: ShallowRef<MapLibreMap | null>
  isReady: Ref<boolean>
  /** Bumped on every style load; a style swap discards these layers with it. */
  styleEpoch: Ref<number>
  bbox: Ref<BBox2D | null> | Readonly<Ref<BBox2D | null>>
  /** True while Terra Draw is rendering its own editable rectangle. */
  hidden: Ref<boolean>
}

export function useBboxOverlay(options: UseBboxOverlayOptions) {
  const { map, isReady, styleEpoch, bbox, hidden } = options

  function addLayers(instance: MapLibreMap) {
    if (!instance.getSource(BBOX_SOURCE)) {
      instance.addSource(BBOX_SOURCE, {
        type: 'geojson',
        data: toFeatureCollection(bbox.value),
      })
    }

    const fill = token('--c-bbox-fill', 'rgba(180, 83, 9, 0.12)')
    const line = token('--c-bbox-line', '#b45309')

    if (!instance.getLayer(BBOX_FILL_LAYER)) {
      instance.addLayer({
        id: BBOX_FILL_LAYER,
        type: 'fill',
        source: BBOX_SOURCE,
        paint: { 'fill-color': fill },
      })
    }

    if (!instance.getLayer(BBOX_LINE_LAYER)) {
      instance.addLayer({
        id: BBOX_LINE_LAYER,
        type: 'line',
        source: BBOX_SOURCE,
        paint: {
          'line-color': line,
          'line-width': 2,
          // Dashed, so the search extent never reads as another footprint.
          'line-dasharray': [2, 1.5],
        },
      })
    }
  }

  function setData(instance: MapLibreMap) {
    const source = instance.getSource(BBOX_SOURCE) as GeoJSONSource | undefined
    source?.setData(toFeatureCollection(bbox.value))
  }

  function applyVisibility(instance: MapLibreMap) {
    const visibility = hidden.value ? 'none' : 'visible'
    for (const layer of [BBOX_FILL_LAYER, BBOX_LINE_LAYER]) {
      if (instance.getLayer(layer)) {
        instance.setLayoutProperty(layer, 'visibility', visibility)
      }
    }
  }

  function sync() {
    const instance = map.value
    if (!instance || !isReady.value) return
    addLayers(instance)
    setData(instance)
    applyVisibility(instance)
  }

  // A style swap discards every source and layer the app added, so rebuild on
  // each new style as well as on the first one.
  watch([isReady, styleEpoch], sync, { immediate: true })
  watch(bbox, sync)
  watch(hidden, () => {
    const instance = map.value
    if (instance && isReady.value) applyVisibility(instance)
  })

  return { sync }
}
