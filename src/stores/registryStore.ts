import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { BUILTIN_APIS } from '@/config/registry'
import type { ApiProbe, StacApiEntry } from '@/types/registry'
import {
  StacClient,
  StacHttpError,
  StacNetworkError,
  isAbortError,
} from '@/services/stacClient'

const STORAGE_KEY = 'stac-browser:custom-apis'

/** Landing-page probes should fail fast — nobody waits 30 s on a card. */
const PROBE_TIMEOUT_MS = 10_000

/* ------------------------------------------------------------------ *
 * Pure helpers — exported for testing
 * ------------------------------------------------------------------ */

/**
 * Whether a landing page advertises item-search.
 *
 * Matched loosely on purpose: the conformance URI carries a spec version and
 * may have a fragment (`…/v1.0.0-rc.2/item-search#filter`), so pinning the
 * exact string would reject perfectly usable APIs.
 */
export function supportsItemSearch(conformsTo: string[] | undefined): boolean {
  return Boolean(conformsTo?.some((uri) => uri.includes('/item-search')))
}

/**
 * Normalise user input into a URL.
 *
 * Accepts a bare host (`example.com/stac`) by assuming https, and rejects
 * anything that is not http(s) — a `file:` or `javascript:` URL here would be
 * at best useless and at worst a footgun.
 */
export function normaliseApiUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url.toString()
}

/** A stable, URL-safe id derived from the API's host and path. */
export function deriveEntryId(url: string, taken: string[] = []): string {
  let base = 'stac-api'
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    base =
      `${host}${parsed.pathname}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'stac-api'
  } catch {
    // Fall through to the default.
  }

  if (!taken.includes(base)) return base
  let suffix = 2
  while (taken.includes(`${base}-${suffix}`)) suffix++
  return `${base}-${suffix}`
}

export interface ProbeOptions {
  signal?: AbortSignal
  fetchImpl?: typeof globalThis.fetch
}

/**
 * Fetch a landing page and report what we learn.
 *
 * Only ever called from the add-catalog dialog, in response to an explicit
 * "Check catalog" click — the catalog list itself is static and makes no
 * network requests.
 *
 * Never throws (except on abort): an unreachable catalog is a result the
 * dialog renders, not an error that should take the page down.
 */
export async function probeApi(
  url: string,
  options: ProbeOptions = {},
): Promise<ApiProbe> {
  const client = new StacClient({
    baseUrl: url,
    fetchImpl: options.fetchImpl,
    // One retry only; the card should settle quickly either way.
    retry: { retries: 1 },
    timeoutMs: PROBE_TIMEOUT_MS,
  })

  try {
    const root = await client.getRoot(options.signal)
    return {
      state: 'online',
      title: root.title ?? root.id,
      description: root.description,
      supportsItemSearch: supportsItemSearch(root.conformsTo),
      checkedAt: Date.now(),
    }
  } catch (error) {
    if (isAbortError(error)) throw error

    if (error instanceof StacHttpError) {
      return {
        state: 'unreachable',
        error: `HTTP ${error.status} ${error.statusText}`.trim(),
        likelyCors: false,
        checkedAt: Date.now(),
      }
    }

    // The browser reports a blocked cross-origin request as an opaque network
    // failure, indistinguishable from being offline. For a third-party STAC
    // API that is overwhelmingly CORS, so say so rather than shrugging.
    return {
      state: 'unreachable',
      error:
        error instanceof StacNetworkError
          ? error.message
          : ((error as Error)?.message ?? 'Unknown error'),
      likelyCors: error instanceof StacNetworkError,
      checkedAt: Date.now(),
    }
  }
}

/* ------------------------------------------------------------------ *
 * Persistence — never let a bad localStorage payload break boot
 * ------------------------------------------------------------------ */

export function loadCustomEntries(): StacApiEntry[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return [] // Private mode, or storage disabled.
  }
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidStoredEntry).map((entry) => ({
      ...entry,
      custom: true,
    }))
  } catch {
    return []
  }
}

function isValidStoredEntry(value: unknown): value is StacApiEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<StacApiEntry>
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.url === 'string' &&
    normaliseApiUrl(entry.url) !== null &&
    typeof entry.title === 'string'
  )
}

function persist(entries: StacApiEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Out of quota or storage disabled — the entry still works this session.
  }
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export const useRegistryStore = defineStore('registry', () => {
  const customEntries = ref<StacApiEntry[]>(loadCustomEntries())

  /** Built-ins first, then whatever the user added. */
  const entries = computed<StacApiEntry[]>(() => [
    ...BUILTIN_APIS,
    ...customEntries.value,
  ])

  const takenIds = computed(() => entries.value.map((entry) => entry.id))

  function byId(id: string): StacApiEntry | undefined {
    return entries.value.find((entry) => entry.id === id)
  }

  function addCustomEntry(entry: Omit<StacApiEntry, 'custom'>): StacApiEntry {
    const stored: StacApiEntry = {
      ...entry,
      custom: true,
      addedAt: new Date().toISOString(),
    }
    customEntries.value = [...customEntries.value, stored]
    persist(customEntries.value)
    return stored
  }

  function removeCustomEntry(id: string): void {
    customEntries.value = customEntries.value.filter((entry) => entry.id !== id)
    persist(customEntries.value)
  }

  function isCustom(id: string): boolean {
    return customEntries.value.some((entry) => entry.id === id)
  }

  /** An id not already in use, derived from the URL. */
  function nextIdFor(url: string): string {
    return deriveEntryId(url, takenIds.value)
  }

  return {
    customEntries,
    entries,
    byId,
    addCustomEntry,
    removeCustomEntry,
    isCustom,
    nextIdFor,
  }
})
