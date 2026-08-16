import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/authStore'

const HOST = 'dl1.lantmateriet.se'
const OTHER_HOST = 'downloads.example.org'
const CREDENTIALS = { username: 'anna', password: 'hemligt' }

const STORAGE_KEY = 'stac-browser:credentials'

/** Everything either storage currently holds, as one searchable string. */
function dump(storage: Storage): string {
  const parts: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key) parts.push(key, storage.getItem(key) ?? '')
  }
  return parts.join('|')
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setActivePinia(createPinia())
})

describe('scoping', () => {
  it('keys credentials by asset host', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS)

    expect(store.has(HOST)).toBe(true)
    expect(store.has(OTHER_HOST)).toBe(false)
  })

  it('keeps separate credentials per host', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS)
    store.set(OTHER_HOST, { username: 'bo', password: 'annat' })

    expect(store.usernameFor(HOST)).toBe('anna')
    expect(store.usernameFor(OTHER_HOST)).toBe('bo')
  })

  it('has nothing for an unknown or missing host', () => {
    const store = useAuthStore()
    expect(store.get(null)).toBeNull()
    expect(store.authorizationFor(undefined)).toBeNull()
    expect(store.has('')).toBe(false)
  })

  it('builds the Authorization header on demand', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS)

    expect(store.authorizationFor(HOST)).toBe('Basic YW5uYTpoZW1saWd0')
  })
})

describe('storage guarantees', () => {
  it('writes nothing anywhere by default', () => {
    // In memory is the default; the user has to ask for anything more.
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS)

    expect(dump(sessionStorage)).not.toContain(CREDENTIALS.password)
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(dump(localStorage)).toBe('')
  })

  it('never touches localStorage, even when remembering', () => {
    // localStorage outlives the session and is shared across tabs, which is
    // exactly what a password must not do.
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS, 'session')

    expect(dump(localStorage)).toBe('')
    expect(dump(localStorage)).not.toContain(CREDENTIALS.password)
  })

  it('remembers for the tab only when explicitly asked', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS, 'session')

    expect(sessionStorage.getItem(STORAGE_KEY)).toContain('anna')
    expect(store.scopeFor(HOST)).toBe('session')
  })

  it('restores a remembered credential after a refresh', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS, 'session')

    // A refresh: a fresh store reading the same session.
    setActivePinia(createPinia())
    const revived = useAuthStore()

    expect(revived.usernameFor(HOST)).toBe('anna')
    expect(revived.authorizationFor(HOST)).toBe('Basic YW5uYTpoZW1saWd0')
  })

  it('loses an in-memory credential on refresh', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS)

    setActivePinia(createPinia())
    const revived = useAuthStore()

    expect(revived.has(HOST)).toBe(false)
  })

  it('does not persist other hosts held only in memory', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS, 'session')
    store.set(OTHER_HOST, { username: 'bo', password: 'inminne' })

    expect(sessionStorage.getItem(STORAGE_KEY)).not.toContain('inminne')
  })

  it('survives a corrupt payload rather than breaking the page', () => {
    sessionStorage.setItem(STORAGE_KEY, '{not json')
    setActivePinia(createPinia())

    expect(useAuthStore().hosts).toEqual([])
  })

  it('drops entries that are not credentials', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ a: { nope: true }, [HOST]: CREDENTIALS }),
    )
    setActivePinia(createPinia())

    expect(useAuthStore().hosts).toEqual([HOST])
  })
})

describe('signing out', () => {
  it('forgets one host and wipes it from storage', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS, 'session')

    store.clear(HOST)

    expect(store.has(HOST)).toBe(false)
    expect(dump(sessionStorage)).not.toContain(CREDENTIALS.password)
  })

  it('clears everything, storage included', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS, 'session')
    store.set(OTHER_HOST, { username: 'bo', password: 'annat' }, 'session')

    store.clearAll()

    expect(store.hosts).toEqual([])
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('removes the key entirely once the last remembered host goes', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS, 'session')

    store.clear(HOST)

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('discretion', () => {
  it('logs nothing', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    )

    const store = useAuthStore()
    store.set(HOST, CREDENTIALS, 'session')
    store.authorizationFor(HOST)
    store.clearAll()

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    for (const spy of spies) spy.mockRestore()
  })

  it('exposes hosts without exposing credentials', () => {
    const store = useAuthStore()
    store.set(HOST, CREDENTIALS)

    expect(JSON.stringify(store.hosts)).not.toContain(CREDENTIALS.password)
  })
})
