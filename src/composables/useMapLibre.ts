import {
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  type Ref,
  type ShallowRef,
} from 'vue'
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl'
// `?worker&url` makes Vite bundle the worker *and the shared chunk it imports*
// into one asset, and hands back its hashed URL. See `setWorkerUrl` below.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  findBasemap,
  type BasemapId,
} from '@/config/basemaps'

/**
 * Tell MapLibre where its worker lives.
 *
 * Load-bearing, and the cause of a genuinely baffling bug: MapLibre resolves
 * its own worker with a *computed* `new URL(`./${name}`, import.meta.url)`.
 * No bundler can trace that, so Vite emitted no worker asset and the app
 * requested `/assets/maplibre-gl-worker.mjs`, which does not exist. The dev
 * server and `vite preview` both answer a missing path with the SPA fallback
 * — `index.html`, status 200 — and MapLibre only checks `response.ok` before
 * handing the body to `new Worker()`. So the worker was silently constructed
 * from HTML and died parsing it, with no console error, because worker parse
 * failures never reach the page.
 *
 * Every source is tiled in that worker. Without it nothing renders at all:
 * no basemap, no footprints, no search box — an entirely blank map, which is
 * exactly how this presented.
 *
 * Runs at module scope so it is set before any `Map` is constructed.
 */
setWorkerUrl(maplibreWorkerUrl)

export interface UseMapLibreOptions {
  container: Ref<HTMLElement | null>
  initialBasemap?: BasemapId
  center?: [number, number]
  zoom?: number
}

export interface UseMapLibreReturn {
  map: ShallowRef<MapLibreMap | null>
  /** True once a style has finished loading and layers may be added. */
  isReady: Ref<boolean>
  /**
   * Increments every time a style finishes loading, including the first.
   *
   * Changing the style wipes every source and layer the app added, so anything
   * that owns map layers must watch this and re-add its own.
   */
  styleEpoch: Ref<number>
  basemapId: Ref<BasemapId>
  setBasemap: (id: BasemapId) => void
}

export function useMapLibre(options: UseMapLibreOptions): UseMapLibreReturn {
  // shallowRef, never ref/reactive: Vue's deep proxy would wrap MapLibre's
  // internals and break them in ways that surface as impossible bugs.
  const map = shallowRef<MapLibreMap | null>(null)
  const isReady = ref(false)
  const styleEpoch = ref(0)
  const basemapId = ref<BasemapId>(options.initialBasemap ?? 'light')

  let resizeObserver: ResizeObserver | null = null

  /**
   * True between calling `setStyle` and the replacement finishing.
   *
   * Load-bearing. `styledata` fires for *any* style mutation, including the
   * `setData` that pushes new footprints, so treating every `styledata` as a
   * new style would loop: setData -> styledata -> epoch++ -> setData -> …
   * That loop freezes the tab outright. Gate the epoch on an actual swap so
   * it advances exactly once per style: once on load, once per basemap change.
   */
  let awaitingStyleSwap = false

  function handleStyleLoad() {
    isReady.value = true
    styleEpoch.value++
  }

  onMounted(() => {
    const container = options.container.value
    if (!container) return

    const instance = new MapLibreMap({
      container,
      style: findBasemap(basemapId.value).style,
      center: options.center ?? DEFAULT_CENTER,
      zoom: options.zoom ?? DEFAULT_ZOOM,
      attributionControl: { compact: true },
    })

    instance.addControl(
      new NavigationControl({ showCompass: false }),
      'top-right',
    )
    instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

    // `load` covers the first style; `styledata` only counts while a swap is
    // outstanding (see `awaitingStyleSwap`).
    instance.on('load', handleStyleLoad)
    instance.on('styledata', () => {
      if (!awaitingStyleSwap || !instance.isStyleLoaded()) return
      awaitingStyleSwap = false
      handleStyleLoad()
    })

    // The map lives in a flex/grid panel that resizes without the window
    // doing so, and MapLibre only listens to window resize on its own.
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => instance.resize())
      resizeObserver.observe(container)
    }

    map.value = instance
  })

  onBeforeUnmount(() => {
    resizeObserver?.disconnect()
    resizeObserver = null
    map.value?.remove()
    map.value = null
    isReady.value = false
  })

  function setBasemap(id: BasemapId) {
    if (id === basemapId.value) return
    basemapId.value = id

    const instance = map.value
    if (!instance) return

    // setStyle keeps the camera; `diff: false` forces a clean swap between
    // unrelated styles (vector -> raster) instead of a partial diff.
    isReady.value = false
    awaitingStyleSwap = true
    instance.setStyle(findBasemap(id).style as string | StyleSpecification, {
      diff: false,
    })
  }

  return { map, isReady, styleEpoch, basemapId, setBasemap }
}
