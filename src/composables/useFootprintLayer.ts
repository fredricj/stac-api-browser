import {
  computed,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection, Feature, Geometry } from 'geojson'
import type { StacItem } from '@/types/stac'
import { itemDatetime, itemKey } from '@/types/stac'

export const FOOTPRINT_SOURCE = 'stac-footprints'
export const FOOTPRINT_FILL_LAYER = 'stac-footprints-fill'
export const FOOTPRINT_LINE_LAYER = 'stac-footprints-line'

/** Properties carried on each footprint feature. Kept small — the map only
 *  needs enough to identify a feature and label it in the popup. */
export interface FootprintProperties {
  key: string
  id: string
  collection: string
  datetime: string | null
  [name: string]: unknown
}

/**
 * Turn STAC items into one FeatureCollection.
 *
 * Items without geometry are dropped (the spec allows null), and duplicates
 * are collapsed by key — overlapping pages would otherwise produce two
 * features sharing a feature-state id.
 */
export function itemsToFeatureCollection(
  items: StacItem[],
): FeatureCollection<Geometry, FootprintProperties> {
  const seen = new Set<string>()
  const features: Feature<Geometry, FootprintProperties>[] = []

  for (const item of items) {
    if (!item.geometry) continue
    const key = itemKey(item)
    if (seen.has(key)) continue
    seen.add(key)

    features.push({
      type: 'Feature',
      id: key,
      geometry: item.geometry,
      properties: {
        key,
        id: item.id,
        collection: item.collection ?? '',
        datetime: itemDatetime(item),
      },
    })
  }

  return { type: 'FeatureCollection', features }
}

/** Read a colour token, falling back when the stylesheet is not available. */
function token(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return value || fallback
}

export interface UseFootprintLayerOptions {
  map: ShallowRef<MapLibreMap | null>
  isReady: Ref<boolean>
  styleEpoch: Ref<number>
  items: Ref<StacItem[]> | ComputedRef<StacItem[]>
  selectedKeys: Ref<Set<string>> | ComputedRef<Set<string>>
}

export function useFootprintLayer(options: UseFootprintLayerOptions) {
  const { map, isReady, styleEpoch, items, selectedKeys } = options

  const featureCollection = computed(() =>
    itemsToFeatureCollection(items.value),
  )

  /** Keys currently carrying a `selected` feature-state, so we can clear them. */
  let appliedSelection = new Set<string>()
  let hoveredKey: string | null = null

  function addSourceAndLayers(instance: MapLibreMap) {
    if (!instance.getSource(FOOTPRINT_SOURCE)) {
      instance.addSource(FOOTPRINT_SOURCE, {
        type: 'geojson',
        data: featureCollection.value,
        // Makes `properties.key` the feature id, so feature-state survives
        // data updates and matches the selection basket's keys exactly.
        promoteId: 'key',
      })
    }

    // Colours come from the same tokens as the rest of the UI, so the map
    // stays part of one visual system in both themes.
    const fill = token('--c-footprint-fill', 'rgba(27, 110, 243, 0.16)')
    const fillHover = token(
      '--c-footprint-hover-fill',
      'rgba(27, 110, 243, 0.32)',
    )
    const fillSelected = token('--c-selected-fill', 'rgba(21, 128, 61, 0.35)')
    const line = token('--c-footprint-line', 'rgba(27, 110, 243, 0.75)')
    const lineSelected = token('--c-selected-line', '#15803d')

    if (!instance.getLayer(FOOTPRINT_FILL_LAYER)) {
      instance.addLayer({
        id: FOOTPRINT_FILL_LAYER,
        type: 'fill',
        source: FOOTPRINT_SOURCE,
        paint: {
          // Selected wins over hover so a selected tile never looks unselected
          // just because the pointer is over it.
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            fillSelected,
            ['boolean', ['feature-state', 'hover'], false],
            fillHover,
            fill,
          ],
        },
      })
    }

    if (!instance.getLayer(FOOTPRINT_LINE_LAYER)) {
      instance.addLayer({
        id: FOOTPRINT_LINE_LAYER,
        type: 'line',
        source: FOOTPRINT_SOURCE,
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            lineSelected,
            line,
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            2.5,
            ['boolean', ['feature-state', 'hover'], false],
            2,
            1,
          ],
        },
      })
    }
  }

  function setData(instance: MapLibreMap) {
    // `getSource` returns a union across every source type; we know ours.
    const source = instance.getSource(FOOTPRINT_SOURCE) as
      GeoJSONSource | undefined
    source?.setData(featureCollection.value)
  }

  function applySelection(instance: MapLibreMap) {
    if (!instance.getSource(FOOTPRINT_SOURCE)) return
    const next = selectedKeys.value

    for (const key of appliedSelection) {
      if (!next.has(key)) {
        instance.setFeatureState(
          { source: FOOTPRINT_SOURCE, id: key },
          { selected: false },
        )
      }
    }
    for (const key of next) {
      instance.setFeatureState(
        { source: FOOTPRINT_SOURCE, id: key },
        { selected: true },
      )
    }

    appliedSelection = new Set(next)
  }

  /** Move the hover highlight, clearing whatever held it before. */
  function setHover(key: string | null) {
    const instance = map.value
    if (!instance || !instance.getSource(FOOTPRINT_SOURCE)) return
    if (key === hoveredKey) return

    if (hoveredKey) {
      instance.setFeatureState(
        { source: FOOTPRINT_SOURCE, id: hoveredKey },
        { hover: false },
      )
    }
    if (key) {
      instance.setFeatureState(
        { source: FOOTPRINT_SOURCE, id: key },
        { hover: true },
      )
    }
    hoveredKey = key
  }

  // A style swap discards every source, layer and feature-state the app added,
  // so rebuild all three whenever a style finishes loading.
  watch(
    [isReady, styleEpoch],
    () => {
      const instance = map.value
      if (!instance || !isReady.value) return
      addSourceAndLayers(instance)
      setData(instance)
      appliedSelection = new Set()
      hoveredKey = null
      applySelection(instance)
    },
    { immediate: true },
  )

  watch(featureCollection, () => {
    const instance = map.value
    if (!instance || !isReady.value) return
    setData(instance)
    // setData clears feature-state for replaced features; re-assert it.
    appliedSelection = new Set()
    applySelection(instance)
  })

  watch(
    selectedKeys,
    () => {
      const instance = map.value
      if (!instance || !isReady.value) return
      applySelection(instance)
    },
    { deep: true },
  )

  return { featureCollection, setHover }
}
