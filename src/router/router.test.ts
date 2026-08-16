import { describe, expect, it } from 'vitest'
import type {
  RouteLocationNormalized,
  RouteLocationNormalizedLoaded,
} from 'vue-router'
import router from '@/router'

/** Just enough of a route for `scrollBehavior`, which only reads `path`. */
function at(path: string, query: Record<string, string> = {}) {
  return {
    path,
    query,
    fullPath: path,
    hash: '',
  } as unknown as RouteLocationNormalized & RouteLocationNormalizedLoaded
}

/** Invoke the configured scroll behaviour directly. */
function scrollFor(
  to: ReturnType<typeof at>,
  from: ReturnType<typeof at>,
  savedPosition: { left: number; top: number } | null = null,
) {
  const behavior = router.options.scrollBehavior!
  return behavior(to, from, savedPosition)
}

describe('router', () => {
  it('resolves the catalog list at /', () => {
    expect(router.resolve('/').name).toBe('home')
  })

  it('resolves a catalog browser route and exposes apiId', () => {
    const route = router.resolve('/api/lantmateriet-bild')
    expect(route.name).toBe('api-browser')
    expect(route.params.apiId).toBe('lantmateriet-bild')
  })

  it('sends unknown paths back to the catalog list', () => {
    const route = router.resolve('/does-not-exist')
    const catchAll = route.matched.at(-1)
    expect(catchAll?.redirect).toEqual({ name: 'home' })
  })
})

describe('scroll behaviour', () => {
  const browse = '/api/lantmateriet-bild'

  it('leaves the page alone when only the query changed', () => {
    // The regression: the browse page mirrors its search into the query
    // string, so ticking a collection or panning the map is a
    // `router.replace`. Scrolling on those threw the page back to the header
    // mid-interaction.
    const result = scrollFor(
      at(browse, { collections: 'orto-o2-2025' }),
      at(browse, {}),
    )

    expect(result).toBe(false)
  })

  it.each([
    ['the map camera', { map: '18.05,59.30,9' }],
    ['the search extent', { bbox: '17.9,59.2,18.2,59.4' }],
    ['a property filter', { props: 'flygar:2020..2024' }],
  ])('leaves the page alone when %s changes', (_label, query) => {
    expect(scrollFor(at(browse, query), at(browse, {}))).toBe(false)
  })

  it('scrolls to the top on a real navigation', () => {
    expect(scrollFor(at(browse), at('/'))).toEqual({ top: 0 })
  })

  it('scrolls to the top when moving between catalogs', () => {
    expect(scrollFor(at('/api/lantmateriet-hojd'), at(browse))).toEqual({
      top: 0,
    })
  })

  it('restores the saved position on back and forward', () => {
    const saved = { left: 0, top: 640 }
    expect(scrollFor(at('/'), at(browse), saved)).toBe(saved)
  })

  it('prefers the saved position even within one page', () => {
    const saved = { left: 0, top: 320 }
    expect(scrollFor(at(browse, { bbox: '1,2,3,4' }), at(browse), saved)).toBe(
      saved,
    )
  })
})
