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

/**
 * jsdom has no `ResizeObserver`.
 *
 * Anything that sizes itself to its container goes dormant without one — the
 * virtualised collection list in particular concludes it has a zero-height
 * viewport and renders no rows at all, which would make its tests pass
 * vacuously. This stub reports the element's current rect once on `observe`,
 * which is enough for code that only needs an initial measurement. Tests that
 * care about a specific size stub `getBoundingClientRect` alongside it.
 */
if (typeof globalThis.ResizeObserver !== 'function') {
  class TestResizeObserver implements ResizeObserver {
    // A plain field, not a parameter property: the project builds with
    // `erasableSyntaxOnly`, which rules out TypeScript-only constructor sugar.
    callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }

    observe(target: Element): void {
      const rect = target.getBoundingClientRect()
      const size = { inlineSize: rect.width, blockSize: rect.height }
      this.callback(
        [
          {
            target,
            contentRect: rect,
            borderBoxSize: [size],
            contentBoxSize: [size],
            devicePixelContentBoxSize: [size],
          } as unknown as ResizeObserverEntry,
        ],
        this,
      )
    }

    unobserve(): void {}
    disconnect(): void {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: TestResizeObserver,
    configurable: true,
    writable: true,
  })
}
