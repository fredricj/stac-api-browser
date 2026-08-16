<script setup lang="ts">
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LngLat, MapMouseEvent } from 'maplibre-gl'
import { LngLatBounds } from 'maplibre-gl'
import type { BBox2D, StacItem } from '@/types/stac'
import { useMapLibre } from '@/composables/useMapLibre'
import {
  FOOTPRINT_FILL_LAYER,
  useFootprintLayer,
  type FootprintProperties,
} from '@/composables/useFootprintLayer'
import { useBboxDraw } from '@/composables/useBboxDraw'
import { useBboxOverlay } from '@/composables/useBboxOverlay'
import { defaultBasemapId, type BasemapId } from '@/config/basemaps'
import { clampBBox, isValidBBox } from '@/utils/bbox'
import BasemapSwitcher from '@/components/map/BasemapSwitcher.vue'
import FootprintPopup from '@/components/map/FootprintPopup.vue'
import MapToolbar from '@/components/map/MapToolbar.vue'

const props = withDefaults(
  defineProps<{
    items: StacItem[]
    selectedKeys: Set<string>
    /** Key hovered elsewhere (the results list), mirrored onto the map. */
    hoveredKey?: string | null
    fitOnChange?: boolean
    /** The search extent, two-way bound to the drawn rectangle. */
    bbox?: BBox2D | null
    /** Disables the search controls while a request is in flight. */
    busy?: boolean
    /** Camera to restore, from a shared or bookmarked URL. */
    initialView?: { lon: number; lat: number; zoom: number } | null
  }>(),
  {
    hoveredKey: null,
    fitOnChange: true,
    bbox: null,
    busy: false,
    initialView: null,
  },
)

const emit = defineEmits<{
  toggle: [key: string]
  hover: [key: string | null]
  'update:bbox': [bbox: BBox2D | null]
  /** *Search this area*, carrying the current viewport as a bbox. */
  searchArea: [bbox: BBox2D]
  viewChange: [view: { lon: number; lat: number; zoom: number }]
}>()

const { t } = useI18n()

const container = useTemplateRef<HTMLElement>('container')
const items = computed(() => props.items)
const selectedKeys = computed(() => props.selectedKeys)

const { map, isReady, styleEpoch, basemapId, setBasemap } = useMapLibre({
  container,
  initialBasemap: defaultBasemapId(),
  center: props.initialView
    ? [props.initialView.lon, props.initialView.lat]
    : undefined,
  zoom: props.initialView?.zoom,
})

const { setHover } = useFootprintLayer({
  map,
  isReady,
  styleEpoch,
  items,
  selectedKeys,
})

/* ---------------- Bbox drawing ---------------- */

/**
 * A local mirror of the `bbox` prop, because Terra Draw needs a writable ref
 * and props are not. Writes propagate outward; incoming changes propagate in.
 */
const bboxRef = ref<BBox2D | null>(props.bbox)

watch(
  () => props.bbox,
  (next) => {
    bboxRef.value = next
  },
)

watch(bboxRef, (next) => {
  if (next !== props.bbox) emit('update:bbox', next)
})

const {
  drawing,
  failed: drawFailed,
  startDrawing,
  stopDrawing,
  clear: clearBbox,
} = useBboxDraw({ map, isReady, styleEpoch, bbox: bboxRef })

/**
 * The extent is drawn by a plain layer, not by the drawing tool.
 *
 * Three of the four ways to set a search extent — *Search this area*, the
 * typed bounds, the coordinate box — never touch Terra Draw, and a fourth
 * arrives from a shared URL. Tying the display to the editor left all of them
 * setting an extent the user could not see.
 *
 * It steps aside only for the moment a rubber band is being dragged, when
 * Terra Draw is showing the in-progress shape. Everything else — including a
 * finished, editable rectangle — is drawn by this layer, so whether the box
 * is visible never depends on Terra Draw having attached, kept its feature,
 * or survived a style swap. The two overlap exactly when both are up, which
 * costs nothing; being invisible cost a great deal.
 */
useBboxOverlay({ map, isReady, styleEpoch, bbox: bboxRef, hidden: drawing })

function toggleDraw() {
  if (drawing.value) stopDrawing()
  else void startDrawing()
}

/* ---------------- Search this area ---------------- */

/** The current viewport as a bbox, clamped to the valid WGS84 range. */
function viewportBbox(): BBox2D | null {
  const instance = map.value
  if (!instance?.getBounds) return null

  const bounds = instance.getBounds()
  const bbox = clampBBox([
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ])
  return isValidBBox(bbox) ? bbox : null
}

function searchThisArea() {
  const bbox = viewportBbox()
  if (!bbox) return
  bboxRef.value = bbox
  emit('searchArea', bbox)
}

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
  instance.off('movestart', onMoveStart)
  instance.on('movestart', onMoveStart)
  instance.off('moveend', onMoveEnd)
  instance.on('moveend', onMoveEnd)
})

function onLayerMouseMove(event: MapMouseEvent) {
  const instance = map.value
  if (!instance) return
  // While drawing, the pointer belongs to the rectangle, not the footprints.
  if (drawing.value) return
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
  if (drawing.value) return

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

/* ---------------- Fit to results ---------------- */

/**
 * True once the user has moved the map themselves.
 *
 * New results normally recentre the map, but not if the user has taken the
 * camera somewhere on purpose since the search was issued — yanking the view
 * out from under someone mid-pan is worse than an off-centre result set.
 */
const userMoved = ref(false)

function onMoveStart(event: unknown) {
  // Only user gestures carry an originalEvent; our own fitBounds does not.
  if ((event as { originalEvent?: unknown } | undefined)?.originalEvent) {
    userMoved.value = true
  }
}

function onMoveEnd() {
  const instance = map.value
  if (!instance?.getCenter) return
  const center = instance.getCenter()
  emit('viewChange', {
    lon: center.lng,
    lat: center.lat,
    zoom: instance.getZoom(),
  })
}

function fitToItems() {
  const instance = map.value
  if (!instance || props.items.length === 0) return

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

function fitToBbox(bbox: BBox2D) {
  const instance = map.value
  if (!instance) return
  const bounds = new LngLatBounds()
  bounds.extend([bbox[0], bbox[1]])
  bounds.extend([bbox[2], bbox[3]])
  instance.fitBounds(bounds, { padding: 48, duration: 0, maxZoom: 14 })
}

/** Called by the view when a search is issued, re-arming the auto-fit. */
function resetAutoFit() {
  userMoved.value = false
}

watch(
  [items, isReady],
  ([, ready]) => {
    if (ready && props.fitOnChange && !userMoved.value) fitToItems()
  },
  { immediate: true },
)

/* ---------------- Hover coming from outside ---------------- */

watch(
  () => props.hoveredKey,
  (key) => setHover(key ?? null),
)

defineExpose({ fitToBbox, fitToItems, resetAutoFit })
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
      <MapToolbar
        :drawing="drawing"
        :has-bbox="bbox !== null"
        :draw-failed="drawFailed"
        :busy="busy"
        @toggle-draw="toggleDraw"
        @clear-bbox="clearBbox"
        @search-area="searchThisArea"
      />
      <BasemapSwitcher
        :current="basemapId"
        @change="setBasemap($event as BasemapId)"
      />
    </div>

    <p v-if="drawing" class="draw-hint" role="status">
      {{ t('map.toolbar.drawHint') }}
    </p>

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
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-2);
}

.draw-hint {
  position: absolute;
  z-index: 2;
  bottom: var(--sp-4);
  left: 50%;
  transform: translateX(-50%);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-full);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  box-shadow: var(--shadow-md);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
}
</style>
