import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  deriveEntryId,
  loadCustomEntries,
  normaliseApiUrl,
  probeApi,
  supportsItemSearch,
  useRegistryStore,
} from '@/stores/registryStore'
import { BUILTIN_APIS } from '@/config/registry'
import rootFixture from '@/services/__fixtures__/root-bild.json'

const STORAGE_KEY = 'stac-browser:custom-apis'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function fetchReturning(response: Response | Error) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    if (response instanceof Error) throw response
    return response.clone()
  })
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('supportsItemSearch', () => {
  it('accepts the versioned conformance URI', () => {
    expect(
      supportsItemSearch(['https://api.stacspec.org/v1.0.0/item-search']),
    ).toBe(true)
  })

  it('accepts release-candidate and fragment variants', () => {
    // The real Lantmäteriet landing page advertises exactly this form.
    expect(
      supportsItemSearch([
        'https://api.stacspec.org/v1.0.0-rc.2/item-search#filter',
      ]),
    ).toBe(true)
  })

  it('rejects a catalog that only does OGC features', () => {
    expect(
      supportsItemSearch([
        'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core',
      ]),
    ).toBe(false)
    expect(supportsItemSearch(undefined)).toBe(false)
    expect(supportsItemSearch([])).toBe(false)
  })

  it('accepts the real landing page fixture', () => {
    expect(supportsItemSearch(rootFixture.conformsTo)).toBe(true)
  })
})

describe('normaliseApiUrl', () => {
  it('keeps a well-formed https URL', () => {
    expect(normaliseApiUrl('https://example.org/stac/v1/')).toBe(
      'https://example.org/stac/v1/',
    )
  })

  it('assumes https for a bare host', () => {
    expect(normaliseApiUrl('example.org/stac')).toBe('https://example.org/stac')
  })

  it('trims surrounding whitespace from a paste', () => {
    expect(normaliseApiUrl('  https://example.org/  ')).toBe(
      'https://example.org/',
    )
  })

  it('rejects empty input and non-http schemes', () => {
    expect(normaliseApiUrl('')).toBeNull()
    expect(normaliseApiUrl('   ')).toBeNull()
    // Pasting one of these should never become a stored, clickable entry.
    expect(normaliseApiUrl('javascript:alert(1)')).toBeNull()
    expect(normaliseApiUrl('file:///etc/passwd')).toBeNull()
  })
})

describe('deriveEntryId', () => {
  it('slugifies host and path', () => {
    expect(deriveEntryId('https://api.lantmateriet.se/stac-bild/v1/')).toBe(
      'api-lantmateriet-se-stac-bild-v1',
    )
  })

  it('drops a www prefix', () => {
    expect(deriveEntryId('https://www.example.org/stac')).toBe(
      'example-org-stac',
    )
  })

  it('suffixes until the id is free', () => {
    const taken = ['example-org', 'example-org-2']
    expect(deriveEntryId('https://example.org/', taken)).toBe('example-org-3')
  })
})

describe('loadCustomEntries', () => {
  it('returns an empty list when nothing is stored', () => {
    expect(loadCustomEntries()).toEqual([])
  })

  it('survives malformed JSON rather than breaking boot', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadCustomEntries()).toEqual([])
  })

  it('survives a non-array payload', () => {
    localStorage.setItem(STORAGE_KEY, '{"a":1}')
    expect(loadCustomEntries()).toEqual([])
  })

  it('drops entries missing required fields or with unusable URLs', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'ok', url: 'https://example.org/', title: 'Fine' },
        { id: 'no-url', title: 'Missing url' },
        { id: 'bad-scheme', url: 'javascript:alert(1)', title: 'Nope' },
        'not an object',
      ]),
    )

    const loaded = loadCustomEntries()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('ok')
    expect(loaded[0].custom).toBe(true)
  })
})

describe('probeApi', () => {
  it('reports online and reads title and capabilities', async () => {
    const probe = await probeApi('https://api.example.org/stac/', {
      fetchImpl: fetchReturning(jsonResponse(rootFixture)),
    })

    expect(probe.state).toBe('online')
    expect(probe.title).toBe(
      'Lantmäteriets katalog för nedladdning av ortofoton',
    )
    expect(probe.supportsItemSearch).toBe(true)
    expect(probe.checkedAt).toBeTypeOf('number')
  })

  it('flags a catalog that does not advertise item search', async () => {
    const probe = await probeApi('https://api.example.org/stac/', {
      fetchImpl: fetchReturning(
        jsonResponse({ ...rootFixture, conformsTo: [] }),
      ),
    })

    expect(probe.state).toBe('online')
    expect(probe.supportsItemSearch).toBe(false)
  })

  it('falls back to the id when the landing page has no title', async () => {
    const { title: _title, ...untitled } = rootFixture
    const probe = await probeApi('https://api.example.org/stac/', {
      fetchImpl: fetchReturning(jsonResponse(untitled)),
    })
    expect(probe.title).toBe('lantmateriet-stac-bild')
  })

  it('reports an HTTP failure without blaming CORS', async () => {
    const probe = await probeApi('https://api.example.org/stac/', {
      fetchImpl: fetchReturning(
        jsonResponse({}, { status: 404, statusText: 'Not Found' }),
      ),
    })

    expect(probe.state).toBe('unreachable')
    expect(probe.error).toContain('404')
    expect(probe.likelyCors).toBe(false)
  })

  it('flags an opaque network failure as likely CORS', async () => {
    // This is what a blocked cross-origin request looks like from JS: a bare
    // TypeError, indistinguishable from being offline.
    const probe = await probeApi('https://api.example.org/stac/', {
      fetchImpl: fetchReturning(new TypeError('Failed to fetch')),
    })

    expect(probe.state).toBe('unreachable')
    expect(probe.likelyCors).toBe(true)
  })

  it('never rejects for an unreachable catalog', async () => {
    await expect(
      probeApi('https://api.example.org/stac/', {
        fetchImpl: fetchReturning(new TypeError('Failed to fetch')),
      }),
    ).resolves.toMatchObject({ state: 'unreachable' })
  })
})

describe('registryStore', () => {
  it('exposes the built-in catalogs', () => {
    const registry = useRegistryStore()
    expect(registry.entries).toHaveLength(BUILTIN_APIS.length)
    expect(registry.byId('lantmateriet-bild')?.auth).toBe('basic')
    expect(registry.byId('nope')).toBeUndefined()
  })

  it('adds, persists and reloads a custom entry', () => {
    const registry = useRegistryStore()
    registry.addCustomEntry({
      id: 'example-org',
      url: 'https://example.org/stac/',
      title: 'Example',
      auth: 'none',
    })

    expect(registry.entries).toHaveLength(BUILTIN_APIS.length + 1)
    expect(registry.isCustom('example-org')).toBe(true)

    // A fresh store in a new session must see the same entry.
    setActivePinia(createPinia())
    const reloaded = useRegistryStore()
    expect(reloaded.byId('example-org')?.title).toBe('Example')
    expect(reloaded.byId('example-org')?.custom).toBe(true)
  })

  it('never treats a built-in as removable', () => {
    const registry = useRegistryStore()
    expect(registry.isCustom('lantmateriet-bild')).toBe(false)
  })

  it('removes a custom entry and persists the removal', () => {
    const registry = useRegistryStore()
    registry.addCustomEntry({
      id: 'example-org',
      url: 'https://example.org/stac/',
      title: 'Example',
      auth: 'none',
    })

    registry.removeCustomEntry('example-org')
    expect(registry.byId('example-org')).toBeUndefined()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[]')
  })

  it('derives an unused id for a new URL', () => {
    const registry = useRegistryStore()
    const id = registry.nextIdFor('https://example.org/stac/')
    registry.addCustomEntry({
      id,
      url: 'https://example.org/stac/',
      title: 'Example',
      auth: 'none',
    })
    expect(registry.nextIdFor('https://example.org/stac/')).toBe(`${id}-2`)
  })

  it('never fetches anything of its own accord', async () => {
    // The catalog list is static; probing only happens when the user asks to
    // check a URL in the add dialog.
    const fetchSpy = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchSpy)

    const registry = useRegistryStore()
    void registry.entries
    registry.byId('lantmateriet-bild')
    registry.addCustomEntry({
      id: 'example-org',
      url: 'https://example.org/stac/',
      title: 'Example',
      auth: 'none',
    })
    registry.removeCustomEntry('example-org')

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('built-in registry config', () => {
  it('gives every entry a unique, route-safe id', () => {
    const ids = BUILTIN_APIS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('points every entry at a usable https URL', () => {
    for (const entry of BUILTIN_APIS) {
      expect(normaliseApiUrl(entry.url)).not.toBeNull()
      expect(entry.url.startsWith('https://')).toBe(true)
    }
  })

  it('scopes credentials to the asset host, not the API host', () => {
    // Lantmäteriet serves assets from a different origin than the catalog;
    // conflating the two would send credentials to the wrong place.
    for (const entry of BUILTIN_APIS) {
      expect(entry.auth).toBe('basic')
      expect(entry.assetHost).toBe('dl1.lantmateriet.se')
      expect(new URL(entry.url).host).not.toBe(entry.assetHost)
    }
  })
})
