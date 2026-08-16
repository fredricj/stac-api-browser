/**
 * Drawing a search box on the map.
 *
 * Two-way bound to a plain `BBox2D` ref: dragging a rectangle writes the box,
 * and typing numbers into `BboxInput` redraws it. Terra Draw owns the
 * interaction, but never the state — the bbox ref is the single source of
 * truth, so the numeric input and the drawn shape can never disagree.
 *
 * Terra Draw and its MapLibre adapter are imported dynamically. Most sessions
 * never draw a box, and the pair is not small enough to load for everyone.
 */

import {
  onScopeDispose,
  ref,
  shallowRef,
  watch,
  type Ref,
  type ShallowRef,
} from 'vue'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Feature, Polygon } from 'geojson'
import type { TerraDraw } from 'terra-draw'
import type { BBox2D } from '@/types/stac'
import {
  bboxEquals,
  bboxToPolygon,
  isValidBBox,
  polygonToBBox,
} from '@/utils/bbox'

const RECTANGLE_MODE = 'rectangle'
const SELECT_MODE = 'select'

export interface UseBboxDrawOptions {
  map: ShallowRef<MapLibreMap | null>
  isReady: Ref<boolean>
  /** Bumped on every style load; the adapter's layers are wiped with it. */
  styleEpoch: Ref<number>
  /** Two-way: drawing writes it, and external edits redraw the rectangle. */
  bbox: Ref<BBox2D | null>
}

export interface UseBboxDrawReturn {
  /** True while the next click or drag will draw a new rectangle. */
  drawing: Ref<boolean>
  /**
   * True once Terra Draw is attached to the map.
   *
   * Latches on the first successful attach and only clears on teardown, so it
   * says nothing about whether a rectangle is currently on screen.
   */
  active: Ref<boolean>
  /**
   * Set when the last attempt to start the tool failed.
   *
   * Reported to the user, never used to remove the control: a button that
   * silently vanishes is a worse failure than one that says why it did not
   * work. Cleared on the next attempt so a transient failure can be retried.
   */
  failed: Ref<boolean>
  startDrawing: () => Promise<void>
  stopDrawing: () => void
  clear: () => void
}

/** Read a Terra Draw snapshot back out as a bbox. */
function snapshotToBBox(
  features: Array<Feature | { geometry?: unknown }>,
): BBox2D | null {
  for (const feature of features) {
    const geometry = feature.geometry as Polygon | undefined
    if (geometry?.type !== 'Polygon') continue
    const bbox = polygonToBBox(geometry)
    if (bbox && isValidBBox(bbox)) return bbox
  }
  return null
}

/** Read a CSS colour token as a hex string; Terra Draw only takes hex. */
function hexToken(name: string, fallback: `#${string}`): `#${string}` {
  if (typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return /^#[0-9a-f]{3,8}$/i.test(value) ? (value as `#${string}`) : fallback
}

export function useBboxDraw(options: UseBboxDrawOptions): UseBboxDrawReturn {
  const { map, isReady, styleEpoch, bbox } = options

  const drawing = ref(false)
  const active = ref(false)
  const failed = ref(false)

  // Never reactive: Terra Draw holds a map instance and its own store.
  const draw = shallowRef<TerraDraw | null>(null)

  /**
   * Set while we are pushing the ref's value into Terra Draw.
   *
   * Without it, `addFeatures` fires `change`, which writes the bbox, which
   * re-runs the watcher — a loop that redraws the rectangle forever.
   */
  let applying = false

  /**
   * The last bbox Terra Draw itself produced.
   *
   * The watcher below uses this to tell our own echo apart from a genuine
   * outside edit. It replaced a comparison against `getSnapshot()`, which
   * raced badly: while the pointer is moving the snapshot changes under the
   * watcher, so the two disagreed and we re-rendered — clearing the feature
   * the user was still drawing, mid-draw.
   */
  let lastSynced: BBox2D | null = null

  async function ensureDraw(): Promise<TerraDraw | null> {
    if (draw.value) return draw.value

    const instance = map.value
    if (!instance || !isReady.value) return null

    // Each attempt starts clean, so a failure caused by a half-loaded style
    // or a transient chunk error does not disable the tool for the session.
    failed.value = false

    try {
      const [terraDraw, adapterModule] = await Promise.all([
        import('terra-draw'),
        import('terra-draw-maplibre-gl-adapter'),
      ])

      const outline = hexToken('--c-bbox-line', '#b45309')

      const created = new terraDraw.TerraDraw({
        adapter: new adapterModule.TerraDrawMapLibreGLAdapter({
          map: instance,
        }),
        modes: [
          new terraDraw.TerraDrawRectangleMode({
            // The mode defaults to click-move-click, which leaves a dragged
            // rectangle doing nothing at all — and dragging is what everyone
            // tries first on a map. Accept both.
            drawInteraction: 'click-move-or-drag',
            styles: {
              fillColor: outline,
              fillOpacity: 0.12,
              outlineColor: outline,
              outlineWidth: 2,
            },
          }),
          new terraDraw.TerraDrawSelectMode({
            flags: {
              [RECTANGLE_MODE]: {
                feature: {
                  draggable: true,
                  coordinates: {
                    draggable: true,
                    // Dragging a corner pins the opposite one, which is the
                    // only resize behaviour that keeps a rectangle rectangular.
                    resizable: 'opposite',
                    midpoints: false,
                    deletable: false,
                  },
                },
              },
            },
            styles: {
              selectedPolygonColor: outline,
              selectedPolygonFillOpacity: 0.12,
              selectedPolygonOutlineColor: outline,
              selectedPolygonOutlineWidth: 2,
            },
          }),
        ],
      })

      created.start()
      created.on('finish', onFinish)
      created.on('change', onChange)

      draw.value = created
      active.value = true
      return created
    } catch (error) {
      // A missing WebGL context, a blocked chunk, an adapter that cannot
      // attach — none of it should take the map down. The typed bbox input
      // and "search this area" both keep working without drawing.
      //
      // Reported, never swallowed: a silent failure here looks to the user
      // like a button that vanishes for no reason.
      console.error('[bbox-draw] could not start the drawing tool', error)
      failed.value = true
      return null
    }
  }

  function onFinish() {
    syncFromDraw()
    // One rectangle at a time: drop straight into select mode so the box the
    // user just drew can be nudged, instead of drawing a second one.
    drawing.value = false
    draw.value?.setMode(SELECT_MODE)
  }

  function onChange() {
    if (applying) return
    syncFromDraw()
  }

  function syncFromDraw() {
    const instance = draw.value
    if (!instance) return

    const next = snapshotToBBox(instance.getSnapshot())
    if (next && !bboxEquals(next, bbox.value)) {
      lastSynced = next
      bbox.value = next
    }
  }

  /** Push the ref's value into Terra Draw, replacing whatever is drawn. */
  function renderBbox(instance: TerraDraw, next: BBox2D | null) {
    applying = true
    try {
      instance.clear()
      lastSynced = next
      if (!next || !isValidBBox(next)) return

      instance.addFeatures([
        {
          id: instance.getFeatureId(),
          type: 'Feature',
          geometry: bboxToPolygon(next),
          // Terra Draw keys its styling and flags off this property.
          properties: { mode: RECTANGLE_MODE },
        },
      ])
    } finally {
      applying = false
    }
  }

  async function startDrawing() {
    const instance = await ensureDraw()
    if (!instance) return
    // Starting a new rectangle discards the old one — two search boxes would
    // have no meaning.
    renderBbox(instance, null)
    bbox.value = null
    instance.setMode(RECTANGLE_MODE)
    drawing.value = true
  }

  function stopDrawing() {
    drawing.value = false
    draw.value?.setMode(SELECT_MODE)
  }

  function clear() {
    drawing.value = false
    bbox.value = null
    const instance = draw.value
    if (instance) {
      renderBbox(instance, null)
      instance.setMode(SELECT_MODE)
    }
  }

  function teardown() {
    const instance = draw.value
    draw.value = null
    active.value = false
    drawing.value = false
    if (!instance) return
    try {
      instance.off('finish', onFinish)
      instance.off('change', onChange)
      instance.stop()
    } catch {
      // The map may already be gone; nothing left to release.
    }
  }

  // An external edit — typed bounds, a coordinate search, a shared URL —
  // redraws the rectangle.
  watch(bbox, (next) => {
    const instance = draw.value
    if (!instance || applying) return
    // Our own value coming back around the loop, not an outside edit.
    if (bboxEquals(next, lastSynced)) return
    // Mid-draw, Terra Draw owns the shape. Re-rendering here would delete the
    // half-finished rectangle out from under the pointer.
    if (drawing.value) return

    renderBbox(instance, next)
    instance.setMode(SELECT_MODE)
  })

  // A style swap wipes every layer the adapter added. Rebuild from scratch
  // and redraw the current box, rather than leaving an invisible rectangle.
  watch(styleEpoch, async () => {
    if (!active.value) return
    const wasDrawing = drawing.value
    teardown()

    const instance = await ensureDraw()
    if (!instance) return
    renderBbox(instance, bbox.value)
    if (wasDrawing) {
      instance.setMode(RECTANGLE_MODE)
      drawing.value = true
    } else {
      instance.setMode(SELECT_MODE)
    }
  })

  onScopeDispose(teardown)

  return { drawing, active, failed, startDrawing, stopDrawing, clear }
}

/** Exported for testing the snapshot conversion without a live map. */
export { snapshotToBBox }
