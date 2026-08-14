/**
 * Vitest setup.
 *
 * Node 26 defines its own experimental `localStorage` global, which is
 * `undefined` unless the process was started with `--localstorage-file`. It
 * takes precedence over the one jsdom would otherwise install, so web storage
 * is missing in tests even though `window` and `document` are present.
 *
 * Install an in-memory implementation when that happens. Real browsers are
 * unaffected — this file is never bundled.
 */

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()

  return {
    get length() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
    getItem(key: string) {
      return entries.has(key) ? (entries.get(key) as string) : null
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null
    },
    removeItem(key: string) {
      entries.delete(key)
    },
    setItem(key: string, value: string) {
      entries.set(key, String(value))
    },
  } as Storage
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (!globalThis[name]) {
    Object.defineProperty(globalThis, name, {
      value: createMemoryStorage(),
      configurable: true,
      writable: true,
    })
  }
}
