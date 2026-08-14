import { describe, expect, it } from 'vitest'
import router from '@/router'

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
