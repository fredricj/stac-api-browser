<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LngLat, MapMouseEvent } from 'maplibre-gl'
import { LngLatBounds } from 'maplibre-gl'
import type { StacItem } from '@/types/stac'
import { useMapLibre } from '@/composables/useMapLibre'
import {
  FOOTPRINT_FILL_LAYER,
  useFootprintLayer,
  type FootprintProperties,
} from '@/composables/useFootprintLayer'
import { defaultBasemapId, type BasemapId } from '@/config/basemaps'
import BasemapSwitcher from '@/components/map/BasemapSwitcher.vue'
import FootprintPopup from '@/components/map/FootprintPopup.vue'

const props = withDefaults(
  defineProps<{
    items: StacItem[]
    selectedKeys: Set<string>
    /** Key hovered elsewhere (the results list), mirrored onto the map. */
    hoveredKey?: string | null
    fitOnChange?: boolean
  }>(),
  { hoveredKey: null, fitOnChange: true },
)

const emit = defineEmits<{
  toggle: [key: string]
  hover: [key: string | null]
}>()

const { t } = useI18n()

const container = useTemplateRef<HTMLElement>('container')
const items = computed(() => props.items)
const selectedKeys = computed(() => props.selectedKeys)

const { map, isReady, styleEpoch, basemapId, setBasemap } = useMapLibre({
  container,
  initialBasemap: defaultBasemapId(),
})

const { setHover } = useFootprintLayer({
  map,
  isReady,
  styleEpoch,
  items,
  selectedKeys,
})

/* ---------------- Disambiguation popup ---------------- */

const popupHits = shallowRef<FootprintProperties[]>([])
const popupLngLat = shallowRef<LngLat | null>(null)
const popupPoint = ref({ x: 0, y: 0 })

function closePopup() {
  popupHits.value = []
  popupLngLat.value = null
}

function repositionPopup() {
  const instance = map.value
  const lngLat = popupLngLat.value
  if (!instance || !lngLat) return
  const point = instance.project(lngLat)
  popupPoint.value = { x: point.x, y: point.y }
}

/**
 * Footprints overlap heavily — the same ground is reflown every few years, so
 * one click can land on a dozen items. Collapse the duplicates a single
 * polygon produces across tile boundaries, then let the user pick rather than
 * silently taking the topmost.
 */
function hitsAt(event: MapMouseEvent): FootprintProperties[] {
  const instance = map.value
  if (!instance) return []

  const rendered = instance.queryRenderedFeatures(event.point, {
    layers: [FOOTPRINT_FILL_LAYER],
  })

  const byKey = new Map<string, FootprintProperties>()
  for (const feature of rendered) {
    const properties = feature.properties as FootprintProperties | null
    if (properties?.key && !byKey.has(properties.key)) {
      byKey.set(properties.key, properties)
    }
  }
  return Array.from(byKey.values())
}

/* ---------------- Map event wiring ---------------- */

watch([map, isReady], ([instance, ready]) => {
  if (!instance || !ready) return

  // Guard against re-binding after every style reload.
  if (instance.getLayer(FOOTPRINT_FILL_LAYER)) {
    instance.off('mousemove', FOOTPRINT_FILL_LAYER, onLayerMouseMove)
    instance.off('mouseleave', FOOTPRINT_FILL_LAYER, onLayerMouseLeave)
    instance.off('click', FOOTPRINT_FILL_LAYER, onLayerClick)

    instance.on('mousemove', FOOTPRINT_FILL_LAYER, onLayerMouseMove)
    instance.on('mouseleave', FOOTPRINT_FILL_LAYER, onLayerMouseLeave)
    instance.on('click', FOOTPRINT_FILL_LAYER, onLayerClick)
  }

  instance.off('click', onBackgroundClick)
  instance.on('click', onBackgroundClick)
  instance.off('move', repositionPopup)
  instance.on('move', repositionPopup)
})

function onLayerMouseMove(event: MapMouseEvent) {
  const instance = map.value
  if (!instance) return
  instance.getCanvas().style.cursor = 'pointer'

  const key = hitsAt(event)[0]?.key ?? null
  setHover(key)
  emit('hover', key)
}

function onLayerMouseLeave() {
  const instance = map.value
  if (instance) instance.getCanvas().style.cursor = ''
  setHover(null)
  emit('hover', null)
}

function onLayerClick(event: MapMouseEvent) {
  const hits = hitsAt(event)
  if (hits.length === 0) return

  // Never let a click on a footprint also read as a click on the background.
  event.preventDefault()

  if (hits.length === 1) {
    emit('toggle', hits[0].key)
    closePopup()
    return
  }

  popupHits.value = hits
  popupLngLat.value = event.lngLat
  repositionPopup()
}

function onBackgroundClick(event: MapMouseEvent) {
  if (event.defaultPrevented) return
  closePopup()
}

/* ---------------- Hover coming from outside ---------------- */

watch(
  () => props.hoveredKey,
  (key) => setHover(key ?? null),
)

/* ---------------- Fit to results ---------------- */

function fitToItems() {
  const instance = map.value
  if (!instance || !props.fitOnChange || props.items.length === 0) return

  const bounds = new LngLatBounds()
  let any = false
  for (const item of props.items) {
    if (!item.bbox) continue
    const [west, south, east, north] = item.bbox
    bounds.extend([west, south])
    bounds.extend([east, north])
    any = true
  }
  if (!any) return

  instance.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 14 })
}

watch(
  [items, isReady],
  ([, ready]) => {
    if (ready) fitToItems()
  },
  { immediate: true },
)
</script>

<template>
  <div class="map-root">
    <div
      ref="container"
      class="map-canvas"
      role="application"
      :aria-label="t('map.ariaLabel', { count: items.length })"
    />

    <div class="map-overlay map-overlay--top-left">
      <BasemapSwitcher
        :current="basemapId"
        @change="setBasemap($event as BasemapId)"
      />
    </div>

    <FootprintPopup
      v-if="popupHits.length"
      :hits="popupHits"
      :selected-keys="selectedKeys"
      :x="popupPoint.x"
      :y="popupPoint.y"
      @toggle="emit('toggle', $event)"
      @hover="
        (key) => {
          setHover(key)
          emit('hover', key)
        }
      "
      @close="closePopup"
    />
  </div>
</template>

<style scoped>
.map-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 20rem;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--c-surface-2);
}

.map-canvas {
  position: absolute;
  inset: 0;
}

.map-overlay {
  position: absolute;
  z-index: 2;
}

.map-overlay--top-left {
  top: var(--sp-2);
  left: var(--sp-2);
}
</style>
