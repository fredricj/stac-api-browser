/**
 * A fake `maplibre-gl` for jsdom.
 *
 * MapLibre needs WebGL, which jsdom has none of, so any component test that
 * mounts the map has to substitute the module. The fake records what the app
 * asked the map to do — sources, layers, feature-state, handlers — so tests
 * can assert on real behaviour instead of just "it did not throw", and can
 * fire map events by hand.
 */

export interface FakePoint {
  x: number
  y: number
}

type Handler = (...args: unknown[]) => void

export class FakeMap {
  static instances: FakeMap[] = []

  sources = new Map<string, { spec: unknown; data: unknown }>()
  layers = new Map<string, unknown>()
  featureState = new Map<string, Record<string, unknown>>()
  controls: unknown[] = []
  style: unknown
  removed = false
  resizeCount = 0
  fitBoundsCalls: unknown[] = []
  /** Features `queryRenderedFeatures` should return; set by the test. */
  queryResult: Array<{ properties: Record<string, unknown> }> = []

  private handlers = new Map<string, Set<Handler>>()
  private canvas = { style: { cursor: '' } } as HTMLCanvasElement

  constructor(options: { style?: unknown } = {}) {
    this.style = options.style
    FakeMap.instances.push(this)
  }

  /** Key events by `type` or `type:layer`, mirroring MapLibre's overloads. */
  private key(type: string, layer?: string) {
    return layer ? `${type}:${layer}` : type
  }

  on(type: string, layerOrHandler: string | Handler, maybeHandler?: Handler) {
    const layer =
      typeof layerOrHandler === 'string' ? layerOrHandler : undefined
    const handler =
      typeof layerOrHandler === 'string' ? maybeHandler : layerOrHandler
    if (!handler) return this
    const key = this.key(type, layer)
    if (!this.handlers.has(key)) this.handlers.set(key, new Set())
    this.handlers.get(key)!.add(handler)
    return this
  }

  off(type: string, layerOrHandler: string | Handler, maybeHandler?: Handler) {
    const layer =
      typeof layerOrHandler === 'string' ? layerOrHandler : undefined
    const handler =
      typeof layerOrHandler === 'string' ? maybeHandler : layerOrHandler
    if (!handler) return this
    this.handlers.get(this.key(type, layer))?.delete(handler)
    return this
  }

  /** Test helper: fire a registered handler. */
  emit(type: string, arg?: unknown, layer?: string) {
    for (const handler of this.handlers.get(this.key(type, layer)) ?? []) {
      handler(arg)
    }
  }

  hasHandler(type: string, layer?: string) {
    return (this.handlers.get(this.key(type, layer))?.size ?? 0) > 0
  }

  addControl(control: unknown) {
    this.controls.push(control)
    return this
  }

  addSource(id: string, spec: { data?: unknown }) {
    this.sources.set(id, { spec, data: spec.data })
    return this
  }

  /** Counts `setData` calls, so a re-render loop is visible to tests. */
  setDataCalls = 0

  getSource(id: string) {
    const entry = this.sources.get(id)
    if (!entry) return undefined
    return {
      setData: (data: unknown) => {
        entry.data = data
        this.setDataCalls++
      },
    }
  }

  addLayer(layer: { id: string }) {
    this.layers.set(layer.id, layer)
    return this
  }

  getLayer(id: string) {
    return this.layers.get(id)
  }

  setFeatureState(
    target: { source: string; id: string },
    state: Record<string, unknown>,
  ) {
    const key = `${target.source}/${target.id}`
    this.featureState.set(key, { ...this.featureState.get(key), ...state })
  }

  getFeatureState(target: { source: string; id: string }) {
    return this.featureState.get(`${target.source}/${target.id}`) ?? {}
  }

  queryRenderedFeatures() {
    return this.queryResult
  }

  getCanvas() {
    return this.canvas
  }

  project() {
    return { x: 100, y: 200 } as FakePoint
  }

  isStyleLoaded() {
    return true
  }

  setStyle(style: unknown) {
    this.style = style
    // Real MapLibre discards app-added sources and layers on a style swap.
    this.sources.clear()
    this.layers.clear()
    this.featureState.clear()
    return this
  }

  fitBounds(bounds: unknown, options?: unknown) {
    this.fitBoundsCalls.push({ bounds, options })
    return this
  }

  resize() {
    this.resizeCount++
    return this
  }

  remove() {
    this.removed = true
  }
}

export class FakeLngLatBounds {
  extended: Array<[number, number]> = []
  extend(coord: [number, number]) {
    this.extended.push(coord)
    return this
  }
}

/** Module shape for `vi.mock('maplibre-gl', …)`. */
export function createMaplibreMock() {
  return {
    Map: FakeMap,
    NavigationControl: class NavigationControl {},
    ScaleControl: class ScaleControl {},
    LngLatBounds: FakeLngLatBounds,
    Popup: class Popup {},
    default: { Map: FakeMap },
  }
}

export function resetMaplibreMock() {
  FakeMap.instances = []
}

/** The most recently constructed map, which is the one under test. */
export function lastMap(): FakeMap {
  const instance = FakeMap.instances.at(-1)
  if (!instance) throw new Error('no FakeMap was constructed')
  return instance
}
