import { describe, expect, it, vi } from 'vitest'
import {
  createDownloadQueue,
  withUniqueNames,
  type DownloadSource,
} from '@/services/downloader'

const CREDENTIALS = { username: 'anna', password: 'hemligt' }

/**
 * An in-memory stand-in for a chosen folder.
 *
 * Records what was written so tests can assert on bytes landing on "disk",
 * and can simulate a file left over from an earlier run.
 */
function fakeDirectory(existing: Record<string, number> = {}) {
  const files = new Map<string, number[]>()
  for (const [name, size] of Object.entries(existing)) {
    files.set(
      name,
      Array.from({ length: size }, () => 0),
    )
  }
  const moved: Array<[string, string]> = []

  const directory = {
    files,
    moved,
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!opts?.create) throw new DOMException('nope', 'NotFoundError')
        files.set(name, [])
      }
      return {
        async getFile() {
          return { size: files.get(name)!.length }
        },
        async createWritable() {
          const bytes: number[] = []
          files.set(name, bytes)
          return new WritableStream<Uint8Array>({
            write(chunk) {
              bytes.push(...chunk)
            },
          })
        },
        async move(to: string) {
          moved.push([name, to])
          files.set(to, files.get(name) ?? [])
          files.delete(name)
        },
      }
    },
    async removeEntry(name: string) {
      files.delete(name)
    },
  }

  return directory as typeof directory & FileSystemDirectoryHandle
}

/** A response whose body streams in a couple of chunks. */
function streamingResponse(bytes: number, status = 200) {
  const half = Math.ceil(bytes / 2)
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(half))
        controller.enqueue(new Uint8Array(bytes - half))
        controller.close()
      },
    }),
    { status, headers: { 'Content-Length': String(bytes) } },
  )
}

function sources(count: number, size = 8): DownloadSource[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `coll/item-${index}`,
    url: `https://dl1.example/data/item-${index}.tif`,
    expectedSize: size,
  }))
}

/** `move` is Chromium-only; the fake provides it, so declare it globally. */
function withMoveSupport() {
  vi.stubGlobal(
    'FileSystemFileHandle',
    function FileSystemFileHandle() {} as unknown,
  )
  ;(
    globalThis.FileSystemFileHandle as unknown as { prototype: object }
  ).prototype = { move() {} }
}

describe('withUniqueNames', () => {
  it('derives a filename from each URL', () => {
    const [task] = withUniqueNames([
      { key: 'a', url: 'https://x.example/a/o65700.tif', expectedSize: null },
    ])
    expect(task.filename).toBe('o65700.tif')
  })

  it('disambiguates two assets that would share a name', () => {
    // Silently overwriting would leave the user with fewer files than they
    // selected, and nothing to explain why.
    const tasks = withUniqueNames([
      { key: 'a', url: 'https://x.example/one/tile.tif', expectedSize: null },
      { key: 'b', url: 'https://x.example/two/tile.tif', expectedSize: null },
      { key: 'c', url: 'https://x.example/three/tile.tif', expectedSize: null },
    ])

    expect(tasks.map((task) => task.filename)).toEqual([
      'tile.tif',
      'tile-2.tif',
      'tile-3.tif',
    ])
  })
})

describe('downloading', () => {
  it('streams every file to disk and reports done', async () => {
    withMoveSupport()
    const directory = fakeDirectory()
    const queue = createDownloadQueue({
      sources: sources(3),
      directory,
      credentials: CREDENTIALS,
      fetchImpl: vi.fn(async () => streamingResponse(8)),
    })

    const result = await queue.start()

    expect(result.done).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.state).toBe('finished')
    expect([...directory.files.keys()].sort()).toEqual([
      'item-0.tif',
      'item-1.tif',
      'item-2.tif',
    ])
  })

  it('sends the Authorization header', async () => {
    withMoveSupport()
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        streamingResponse(8),
    )
    const queue = createDownloadQueue({
      sources: sources(1),
      directory: fakeDirectory(),
      credentials: CREDENTIALS,
      fetchImpl,
    })

    await queue.start()

    const [, init] = fetchImpl.mock.calls[0]
    expect(init).toBeDefined()
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      'Basic YW5uYTpoZW1saWd0',
    )
    // Our own header, so the browser must not attach cookies or prompt.
    expect(init!.credentials).toBe('omit')
  })

  it('writes to a .part file and renames on success', async () => {
    // So an interrupted run never leaves a truncated file under the real name
    // for the resume check to mistake for a finished one.
    withMoveSupport()
    const directory = fakeDirectory()
    const queue = createDownloadQueue({
      sources: sources(1),
      directory,
      credentials: null,
      fetchImpl: vi.fn(async () => streamingResponse(8)),
    })

    await queue.start()

    expect(directory.moved).toEqual([['item-0.tif.part', 'item-0.tif']])
  })

  it('reports progress as bytes arrive, not just at the end', async () => {
    withMoveSupport()
    const seen: number[] = []
    const queue = createDownloadQueue({
      sources: sources(1, 100),
      directory: fakeDirectory(),
      credentials: null,
      concurrency: 1,
      fetchImpl: vi.fn(async () => streamingResponse(100)),
      onChange: (snapshot) => seen.push(snapshot.receivedBytes),
    })

    await queue.start()

    // The stream arrives in two chunks, so a mid-transfer figure must appear.
    expect(seen.some((bytes) => bytes > 0 && bytes < 100)).toBe(true)
    expect(seen.at(-1)).toBe(100)
  })

  it('honours the concurrency limit', async () => {
    withMoveSupport()
    let inFlight = 0
    let peak = 0

    const queue = createDownloadQueue({
      sources: sources(9),
      directory: fakeDirectory(),
      credentials: null,
      concurrency: 3,
      fetchImpl: vi.fn(async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
        return streamingResponse(8)
      }),
    })

    await queue.start()

    // This is a free public service; three at a time is neighbourly.
    expect(peak).toBeLessThanOrEqual(3)
  })
})

describe('resuming', () => {
  it('skips a file already on disk at the right size', async () => {
    withMoveSupport()
    const fetchImpl = vi.fn(async () => streamingResponse(8))
    const queue = createDownloadQueue({
      sources: sources(2),
      directory: fakeDirectory({ 'item-0.tif': 8 }),
      credentials: null,
      fetchImpl,
    })

    const result = await queue.start()

    expect(result.skipped).toBe(1)
    expect(result.done).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('re-downloads a truncated file from an interrupted run', async () => {
    withMoveSupport()
    const fetchImpl = vi.fn(async () => streamingResponse(8))
    const queue = createDownloadQueue({
      sources: sources(1),
      directory: fakeDirectory({ 'item-0.tif': 3 }),
      credentials: null,
      fetchImpl,
    })

    const result = await queue.start()

    expect(result.skipped).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('failures', () => {
  it.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'notfound'],
    [500, 'http'],
  ])('records %i as %s', async (status, kind) => {
    withMoveSupport()
    const queue = createDownloadQueue({
      sources: sources(1),
      directory: fakeDirectory(),
      credentials: null,
      retries: 0,
      fetchImpl: vi.fn(async () => new Response(null, { status })),
    })

    const result = await queue.start()

    expect(result.failed).toBe(1)
    expect(result.tasks[0].failure).toBe(kind)
  })

  it('does not retry a wrong password', async () => {
    // It will still be wrong in two seconds, and retrying only annoys the
    // server and the user.
    withMoveSupport()
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }))
    const queue = createDownloadQueue({
      sources: sources(1),
      directory: fakeDirectory(),
      credentials: null,
      retries: 3,
      sleep: async () => {},
      fetchImpl,
    })

    await queue.start()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure and can succeed', async () => {
    withMoveSupport()
    let call = 0
    const queue = createDownloadQueue({
      sources: sources(1),
      directory: fakeDirectory(),
      credentials: null,
      retries: 2,
      sleep: async () => {},
      fetchImpl: vi.fn(async () => {
        call++
        if (call === 1) return new Response(null, { status: 503 })
        return streamingResponse(8)
      }),
    })

    const result = await queue.start()

    expect(result.done).toBe(1)
    expect(result.tasks[0].attempts).toBe(2)
  })

  it('keeps successes when only some files fail', async () => {
    withMoveSupport()
    const queue = createDownloadQueue({
      sources: sources(3),
      directory: fakeDirectory(),
      credentials: null,
      retries: 0,
      concurrency: 1,
      fetchImpl: vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes('item-1')) {
          return new Response(null, { status: 403 })
        }
        return streamingResponse(8)
      }),
    })

    const result = await queue.start()

    expect(result.done).toBe(2)
    expect(result.failed).toBe(1)
  })

  it('retries only what failed, leaving finished files alone', async () => {
    withMoveSupport()
    let failFirst = true
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('item-1') && failFirst) {
        return new Response(null, { status: 503 })
      }
      return streamingResponse(8)
    })

    const queue = createDownloadQueue({
      sources: sources(3),
      directory: fakeDirectory(),
      credentials: null,
      retries: 0,
      fetchImpl,
      sleep: async () => {},
    })

    await queue.start()
    expect(queue.snapshot().failed).toBe(1)

    failFirst = false
    const callsBefore = fetchImpl.mock.calls.length
    const result = await queue.retryFailed()

    expect(result.failed).toBe(0)
    expect(result.done).toBe(3)
    // Only the one failure was re-fetched.
    expect(fetchImpl.mock.calls.length - callsBefore).toBe(1)
  })
})

describe('control', () => {
  it('cancels the run and marks what never started', async () => {
    withMoveSupport()
    const queue = createDownloadQueue({
      sources: sources(6),
      directory: fakeDirectory(),
      credentials: null,
      concurrency: 1,
      fetchImpl: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return streamingResponse(8)
      }),
    })

    const running = queue.start()
    await new Promise((resolve) => setTimeout(resolve, 8))
    queue.cancel()
    await running

    const after = queue.snapshot()
    expect(after.state).toBe('finished')
    expect(after.tasks.some((task) => task.status === 'cancelled')).toBe(true)
  })

  it('reports paused state and resumes', async () => {
    withMoveSupport()
    const queue = createDownloadQueue({
      sources: sources(4),
      directory: fakeDirectory(),
      credentials: null,
      concurrency: 1,
      fetchImpl: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2))
        return streamingResponse(8)
      }),
    })

    const running = queue.start()
    queue.pause()
    expect(queue.snapshot().state).toBe('paused')

    queue.resume()
    const result = await running

    expect(result.state).toBe('finished')
    expect(result.done).toBe(4)
  })

  it('finishes immediately with nothing to do', async () => {
    const queue = createDownloadQueue({
      sources: [],
      directory: fakeDirectory(),
      credentials: null,
      fetchImpl: vi.fn(),
    })

    const result = await queue.start()

    expect(result.state).toBe('finished')
    expect(result.tasks).toEqual([])
  })
})
