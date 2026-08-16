/**
 * The query string as the search's state container.
 *
 * A search someone found useful should survive a reload and be sendable to a
 * colleague, and that costs nothing but keeping the URL honest. The selection
 * basket is deliberately *not* here — it grows without bound and would blow
 * past every URL length limit the moment anyone selected a real download.
 *
 * Map movement and typing both write with `replace`, so the back button steps
 * between pages rather than through every pan and keystroke.
 */

import { ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import type {
  QueryableField,
  QueryableValues,
  QueryableValue,
} from '@/services/queryables'
import { emptyValue } from '@/services/queryables'
import { formatBBox, isValidBBox, parseBBox } from '@/utils/bbox'
import { useDebounceFn } from '@/composables/useDebounce'
import type { useSearchStore } from '@/stores/searchStore'

export interface MapView {
  lon: number
  lat: number
  zoom: number
}

/* ------------------------------------------------------------------ *
 * Encoding — pure, and exported for testing
 * ------------------------------------------------------------------ */

/**
 * Queryable values as one compact parameter.
 *
 * `flygar:2020..2024;spektraltyp:rgb|rgbi;note:orto*`
 *
 * Each name and value is percent-encoded before joining, so a value that
 * itself contains a separator survives the round trip. JSON would also work
 * and be shorter to write, but this stays readable in a shared link, which is
 * the whole point of putting it in the URL.
 */
export function encodeQueryableValues(values: QueryableValues): string {
  const parts: string[] = []

  for (const [name, value] of Object.entries(values)) {
    const encoded = encodeOne(value)
    if (encoded === null) continue
    parts.push(`${encodeURIComponent(name)}:${encodeURIComponent(encoded)}`)
  }

  return parts.join(';')
}

function encodeOne(value: QueryableValue): string | null {
  switch (value.kind) {
    case 'number': {
      if (value.min == null && value.max == null) return null
      return `${value.min ?? ''}..${value.max ?? ''}`
    }
    case 'enum':
      return value.selected.length ? value.selected.join('|') : null
    case 'string':
      return value.text.trim() || null
    case 'boolean':
      return value.value == null ? null : String(value.value)
  }
}

/**
 * Decode against the field descriptors, which is the only way to know whether
 * `2020..2024` is a range or a piece of text. Fields the catalog no longer
 * publishes are dropped rather than guessed at.
 */
export function decodeQueryableValues(
  encoded: string,
  fields: QueryableField[],
): QueryableValues {
  const byName = new Map(fields.map((field) => [field.name, field]))
  const values: QueryableValues = {}

  for (const part of encoded.split(';')) {
    if (!part) continue
    const separator = part.indexOf(':')
    if (separator < 0) continue

    const name = safeDecode(part.slice(0, separator))
    const raw = safeDecode(part.slice(separator + 1))
    const field = byName.get(name)
    if (!field) continue

    switch (field.kind) {
      case 'number': {
        const [min, max] = raw.split('..')
        const value = emptyValue(field) as Extract<
          QueryableValue,
          { kind: 'number' }
        >
        value.min = min === '' || min === undefined ? null : Number(min)
        value.max = max === '' || max === undefined ? null : Number(max)
        if (Number.isNaN(value.min)) value.min = null
        if (Number.isNaN(value.max)) value.max = null
        if (value.min !== null || value.max !== null) values[name] = value
        break
      }
      case 'enum': {
        // Only offer values the catalog still advertises.
        const selected = raw
          .split('|')
          .filter((option) => field.options?.includes(option))
        if (selected.length) values[name] = { kind: 'enum', selected }
        break
      }
      case 'boolean':
        if (raw === 'true' || raw === 'false') {
          values[name] = { kind: 'boolean', value: raw === 'true' }
        }
        break
      default:
        if (raw) values[name] = { kind: 'string', text: raw }
    }
  }

  return values
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // A hand-edited URL can carry a stray `%`; take it literally.
    return value
  }
}

export function encodeMapView(view: MapView): string {
  return `${view.lon.toFixed(4)},${view.lat.toFixed(4)},${view.zoom.toFixed(2)}`
}

export function decodeMapView(value: string | undefined): MapView | null {
  if (!value) return null
  const [lon, lat, zoom] = value.split(',').map(Number)
  if (![lon, lat, zoom].every((n) => Number.isFinite(n))) return null
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90 || zoom < 0 || zoom > 24) {
    return null
  }
  return { lon, lat, zoom }
}

/** First value of a possibly-repeated query parameter. */
function single(value: LocationQuery[string]): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return first ?? undefined
}

/* ------------------------------------------------------------------ *
 * Composable
 * ------------------------------------------------------------------ */

export interface UseUrlStateOptions {
  store: ReturnType<typeof useSearchStore>
  /** Current map camera, written by the view on `moveend`. */
  view: { value: MapView | null }
}

export interface UseUrlStateReturn {
  /**
   * Camera the URL arrived with, or null. Read synchronously during setup:
   * child components mount before their parent, so anything the map needs at
   * construction time cannot wait for `onMounted`.
   */
  initialView: MapView | null
  /** True when the URL carried a search worth running on entry. */
  hasSearchParams: boolean
  applyFromRoute: () => boolean
}

export function useUrlState(options: UseUrlStateOptions): UseUrlStateReturn {
  const { store, view } = options
  const route = useRoute()
  const router = useRouter()

  /** Suppresses writes while we are the ones applying a URL. */
  let hydrating = false
  /** The query string we last wrote, so our own writes do not re-hydrate. */
  let lastWritten = ''

  /**
   * Held until `/queryables` resolves: the encoded values cannot be decoded
   * without the field descriptors, and they arrive one network round trip
   * after the URL does.
   */
  const pendingProps = ref('')

  function applyFromRoute(): boolean {
    hydrating = true
    try {
      const query = route.query

      const bboxParam = single(query.bbox)
      const bbox = bboxParam ? parseBBox(bboxParam) : null
      store.setBbox(bbox && isValidBBox(bbox) ? bbox : null)

      const collectionsParam = single(query.collections)
      store.setCollections(
        collectionsParam ? collectionsParam.split(',').filter(Boolean) : [],
      )

      store.setDatetime(single(query.datetime) ?? null)

      pendingProps.value = single(query.props) ?? ''
      if (pendingProps.value && store.queryableFields.length) {
        store.setQueryableValues(
          decodeQueryableValues(pendingProps.value, store.queryableFields),
        )
        pendingProps.value = ''
      } else if (!pendingProps.value) {
        store.setQueryableValues({})
      }

      return Boolean(bboxParam || collectionsParam || query.datetime)
    } finally {
      hydrating = false
    }
  }

  function buildQuery(): LocationQuery {
    const query: LocationQuery = {}

    if (store.bbox) query.bbox = formatBBox(store.bbox)
    if (store.collections.length)
      query.collections = store.collections.join(',')
    if (store.datetime) query.datetime = store.datetime

    const props = encodeQueryableValues(store.queryableValues)
    if (props) query.props = props

    if (view.value) query.map = encodeMapView(view.value)

    return query
  }

  const writeUrl = useDebounceFn(() => {
    if (hydrating) return

    const query = buildQuery()
    const serialised = new URLSearchParams(
      Object.entries(query) as [string, string][],
    ).toString()
    if (serialised === lastWritten) return

    lastWritten = serialised
    // `replace`, not `push`: a search is a refinement of the same page, and
    // pushing would bury the catalog list under dozens of history entries.
    void router.replace({ query }).catch(() => {
      // A navigation cancelled by a route change is not an error worth
      // surfacing; the next write will pick up the current state.
    })
  }, 300)

  // Synchronously, during setup — see `initialView` above.
  const initialView = decodeMapView(single(route.query.map))
  if (initialView) view.value = initialView
  const hasSearchParams = applyFromRoute()
  lastWritten = new URLSearchParams(
    Object.entries(buildQuery()) as [string, string][],
  ).toString()

  // The queryable descriptors land after the URL; decode what was held back.
  watch(
    () => store.queryableFields,
    (fields) => {
      if (!pendingProps.value || fields.length === 0) return
      hydrating = true
      try {
        store.setQueryableValues(
          decodeQueryableValues(pendingProps.value, fields),
        )
        pendingProps.value = ''
      } finally {
        hydrating = false
      }
    },
  )

  watch(
    () => [
      store.bbox,
      store.collections,
      store.datetime,
      store.queryableValues,
      view.value,
    ],
    () => writeUrl(),
    { deep: true },
  )

  return { initialView, hasSearchParams, applyFromRoute }
}
