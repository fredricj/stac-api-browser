import { describe, expect, it, vi } from 'vitest'
import { assetHostOf, basicAuthHeader, checkCredentials } from '@/services/auth'

const CREDENTIALS = { username: 'anna', password: 'hemligt' }
const ASSET = 'https://dl1.lantmateriet.se/bild/data/orto/x.tif'

function respondWith(status: number) {
  return vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status }),
  )
}

describe('basicAuthHeader', () => {
  it('encodes user:password as RFC 7617 Basic', () => {
    // btoa('anna:hemligt')
    expect(basicAuthHeader(CREDENTIALS)).toBe('Basic YW5uYTpoZW1saWd0')
  })

  it('handles the Swedish characters a real password contains', () => {
    // `btoa` alone throws outside Latin-1, so the string is encoded to UTF-8
    // bytes first. A password with å/ä/ö is entirely ordinary here.
    const header = basicAuthHeader({ username: 'åsa', password: 'lösenörd' })

    expect(() => atob(header.replace('Basic ', ''))).not.toThrow()
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(header.replace('Basic ', '')), (c) =>
        c.charCodeAt(0),
      ),
    )
    expect(decoded).toBe('åsa:lösenörd')
  })

  it('keeps a colon in the password intact', () => {
    // Only the first colon separates the two fields.
    const header = basicAuthHeader({ username: 'a', password: 'p:ss:word' })
    expect(atob(header.replace('Basic ', ''))).toBe('a:p:ss:word')
  })
})

describe('checkCredentials', () => {
  it('sends a HEAD with the Authorization header', async () => {
    const fetchImpl = respondWith(200)

    await checkCredentials(ASSET, CREDENTIALS, { fetchImpl })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(init).toBeDefined()
    expect(url).toBe(ASSET)
    // HEAD, because the point is the status code and these files run to
    // hundreds of megabytes.
    expect(init!.method).toBe('HEAD')
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      'Basic YW5uYTpoZW1saWd0',
    )
  })

  it('omits browser credentials so no native auth prompt appears', async () => {
    // With `include`, the browser handles the 401 itself and pops its own
    // Basic-auth dialog over ours — two password boxes, one unreadable.
    const fetchImpl = respondWith(401)

    await checkCredentials(ASSET, CREDENTIALS, { fetchImpl })

    const [, init] = fetchImpl.mock.calls[0]
    expect(init).toBeDefined()
    expect(init!.credentials).toBe('omit')
  })

  it.each([
    [200, 'ok'],
    [401, 'invalid'],
    [403, 'forbidden'],
    [404, 'missing'],
    [500, 'unexpected'],
  ])('maps %i to %s', async (httpStatus, expected) => {
    const result = await checkCredentials(ASSET, CREDENTIALS, {
      fetchImpl: respondWith(httpStatus),
    })
    expect(result.status).toBe(expected)
  })

  it('separates a wrong password from a missing subscription', async () => {
    // The distinction that matters: on Geotorget access is granted per
    // product, so 403 means "right account, wrong product" and sending that
    // user to reset their password wastes their time.
    const invalid = await checkCredentials(ASSET, CREDENTIALS, {
      fetchImpl: respondWith(401),
    })
    const forbidden = await checkCredentials(ASSET, CREDENTIALS, {
      fetchImpl: respondWith(403),
    })

    expect(invalid.status).toBe('invalid')
    expect(forbidden.status).toBe('forbidden')
  })

  it('reports an unreachable host rather than throwing', async () => {
    const result = await checkCredentials(ASSET, CREDENTIALS, {
      fetchImpl: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })

    expect(result.status).toBe('unreachable')
  })

  it('propagates an abort, which is the caller deciding', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      checkCredentials(ASSET, CREDENTIALS, {
        signal: controller.signal,
        fetchImpl: vi.fn(async () => {
          throw new DOMException('aborted', 'AbortError')
        }),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('credentials never leak', () => {
  it.each([401, 403, 500])(
    'keeps the password out of the result for a %i',
    async (status) => {
      // Results are rendered to the user and end up in screenshots and bug
      // reports; a result object quoting the request would disclose it.
      const result = await checkCredentials(ASSET, CREDENTIALS, {
        fetchImpl: respondWith(status),
      })

      const serialised = JSON.stringify(result)
      expect(serialised).not.toContain(CREDENTIALS.password)
      expect(serialised).not.toContain(CREDENTIALS.username)
      expect(serialised).not.toContain('Basic ')
    },
  )

  it('keeps the password out of an unreachable result', async () => {
    const result = await checkCredentials(ASSET, CREDENTIALS, {
      fetchImpl: vi.fn(async () => {
        throw new TypeError(`Failed to fetch ${ASSET}`)
      }),
    })

    expect(JSON.stringify(result)).not.toContain(CREDENTIALS.password)
  })

  it('logs nothing at all', async () => {
    // A credential path that writes to the console is one screen-share away
    // from disclosing a password.
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    )

    await checkCredentials(ASSET, CREDENTIALS, { fetchImpl: respondWith(401) })
    await checkCredentials(ASSET, CREDENTIALS, {
      fetchImpl: vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    })

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    for (const spy of spies) spy.mockRestore()
  })
})

describe('assetHostOf', () => {
  it('scopes credentials to the asset host, not the catalog host', () => {
    // Every built-in entry serves assets from a different origin than its
    // catalog, so keying by the API origin would file them under a host that
    // never asks for them.
    expect(assetHostOf(ASSET)).toBe('dl1.lantmateriet.se')
    expect(assetHostOf('https://api.lantmateriet.se/stac-bild/v1/')).toBe(
      'api.lantmateriet.se',
    )
  })

  it('is null for something that is not a URL', () => {
    expect(assetHostOf('not a url')).toBeNull()
  })
})
