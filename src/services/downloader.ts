/**
 * The download queue.
 *
 * The hard part of this app, and the reason for most of the decisions above
 * it. Each asset is hundreds of megabytes and a realistic selection is tens of
 * gigabytes, which rules out the two obvious approaches: a client-side zip is
 * memory-bound and offers nothing over separate files, and `<a download>`
 * cannot carry an `Authorization` header so it would simply 401.
 *
 * What is left is fetching each file with credentials and streaming the body
 * to disk. Concurrency is deliberately low — this is a free public service,
 * and three parallel requests is neighbourly where thirty is not.
 *
 * Everything here is framework-free so it can be unit tested without a
 * browser; the UI subscribes through `onChange`.
 */

import { basicAuthHeader, type BasicCredentials } from '@/services/auth'
import {
  hasCompleteFile,
  safeFilename,
  streamToFile,
} from '@/services/fsAccess'

export type TaskStatus =
  | 'pending'
  | 'active'
  | 'done'
  /** Already on disk, complete, from an earlier run. */
  | 'skipped'
  | 'failed'
  | 'cancelled'

export type FailureKind =
  /** 401 — the credentials are wrong. Retrying will not help. */
  | 'auth'
  /** 403 — valid credentials without access to this product. */
  | 'forbidden'
  | 'notfound'
  | 'network'
  /** The disk write failed: out of space, or permission withdrawn. */
  | 'write'
  | 'http'

export interface DownloadTask {
  key: string
  url: string
  filename: string
  /** From `file:size`, when the catalog reports it. */
  expectedSize: number | null
  status: TaskStatus
  received: number
  /** From `Content-Length`, which the asset host exposes via CORS. */
  total: number | null
  attempts: number
  failure?: FailureKind
}

export type QueueState = 'idle' | 'running' | 'paused' | 'finished'

export interface QueueSnapshot {
  state: QueueState
  tasks: DownloadTask[]
  /** Bytes actually transferred this run; skipped files contribute nothing. */
  receivedBytes: number
  totalBytes: number
  done: number
  skipped: number
  failed: number
}

export interface DownloadSource {
  key: string
  url: string
  expectedSize: number | null
}

export interface DownloadQueueOptions {
  sources: DownloadSource[]
  directory: FileSystemDirectoryHandle
  credentials: BasicCredentials | null
  /** 2–3. Higher is not faster here and is rude to a public service. */
  concurrency?: number
  /** Attempts after the first, for transient failures only. */
  retries?: number
  onChange?: (snapshot: QueueSnapshot) => void
  fetchImpl?: typeof globalThis.fetch
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_CONCURRENCY = 3
const DEFAULT_RETRIES = 2

/** 401 and 403 are settled facts; retrying just annoys the server. */
const RETRYABLE: ReadonlySet<FailureKind> = new Set(['network', 'http'])

/** What one attempt concluded. Kept explicit so `runTask` owns `status`. */
type AttemptResult =
  | { outcome: 'done' }
  | { outcome: 'skipped' }
  | { outcome: 'failed'; failure: FailureKind }

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface DownloadQueue {
  snapshot(): QueueSnapshot
  start(): Promise<QueueSnapshot>
  pause(): void
  resume(): void
  cancel(): void
  /** Re-queue everything that failed, keeping what succeeded. */
  retryFailed(): Promise<QueueSnapshot>
}

export function createDownloadQueue(
  options: DownloadQueueOptions,
): DownloadQueue {
  const {
    sources,
    directory,
    credentials,
    concurrency = DEFAULT_CONCURRENCY,
    retries = DEFAULT_RETRIES,
    onChange,
    fetchImpl = globalThis.fetch.bind(globalThis),
    sleep = defaultSleep,
  } = options

  // Names are derived once so two assets that would collapse to the same
  // filename can be told apart before anything is written.
  const tasks: DownloadTask[] = withUniqueNames(sources)

  let state: QueueState = 'idle'
  let controller = new AbortController()
  /** Resolved when a paused queue is released. */
  let resumeSignal: (() => void) | null = null

  function snapshot(): QueueSnapshot {
    let receivedBytes = 0
    let totalBytes = 0
    let done = 0
    let skipped = 0
    let failed = 0

    for (const task of tasks) {
      receivedBytes += task.received
      totalBytes += task.total ?? task.expectedSize ?? 0
      if (task.status === 'done') done++
      else if (task.status === 'skipped') skipped++
      else if (task.status === 'failed') failed++
    }

    return {
      state,
      // Copied, so a consumer holding the snapshot never sees it mutate
      // underneath them mid-render.
      tasks: tasks.map((task) => ({ ...task })),
      receivedBytes,
      totalBytes,
      done,
      skipped,
      failed,
    }
  }

  function emit() {
    onChange?.(snapshot())
  }

  /** Block here while paused, so a pause takes effect between files. */
  async function waitWhilePaused(): Promise<void> {
    while (state === 'paused' && !controller.signal.aborted) {
      await new Promise<void>((resolve) => {
        resumeSignal = resolve
      })
    }
  }

  async function runTask(task: DownloadTask): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      await waitWhilePaused()
      if (controller.signal.aborted) {
        task.status = 'cancelled'
        return
      }

      task.attempts = attempt + 1
      task.status = 'active'
      task.received = 0
      task.failure = undefined
      emit()

      const result = await attemptOnce(task)
      if (result.outcome !== 'failed') {
        task.status = result.outcome
        emit()
        return
      }

      if (controller.signal.aborted) {
        task.status = 'cancelled'
        emit()
        return
      }

      task.failure = result.failure
      // A wrong password will still be wrong in two seconds.
      if (!RETRYABLE.has(result.failure) || attempt === retries) {
        task.status = 'failed'
        emit()
        return
      }

      // Exponential backoff with jitter, so a batch that hits a blip does not
      // retry in lockstep.
      await sleep(Math.random() * Math.min(8_000, 500 * 2 ** attempt))
    }
  }

  /**
   * One attempt at one file.
   *
   * Returns its outcome rather than writing `task.status` itself: the caller
   * owns that field, and a status set from inside here would be invisible to
   * anyone reading `runTask`.
   */
  async function attemptOnce(task: DownloadTask): Promise<AttemptResult> {
    // Cheap resume: a complete file from an earlier run is left alone.
    try {
      if (await hasCompleteFile(directory, task.filename, task.expectedSize)) {
        task.received = 0
        return { outcome: 'skipped' }
      }
    } catch {
      // Unreadable directory entry; fall through and just fetch it.
    }

    let response: Response
    try {
      const headers: Record<string, string> = {}
      if (credentials) headers.Authorization = basicAuthHeader(credentials)

      response = await fetchImpl(task.url, {
        headers,
        // We send our own header; the browser must not attach cookies or pop
        // its native auth prompt.
        credentials: 'omit',
        signal: controller.signal,
      })
    } catch {
      // Offline, DNS, TLS, CORS, or our own abort — all indistinguishable
      // here, and all handled the same by the caller.
      return { outcome: 'failed', failure: 'network' }
    }

    if (!response.ok) {
      if (response.status === 401) return { outcome: 'failed', failure: 'auth' }
      if (response.status === 403)
        return { outcome: 'failed', failure: 'forbidden' }
      if (response.status === 404)
        return { outcome: 'failed', failure: 'notfound' }
      return { outcome: 'failed', failure: 'http' }
    }

    const length = Number(response.headers.get('Content-Length'))
    task.total = Number.isFinite(length) && length > 0 ? length : null
    if (!response.body) return { outcome: 'failed', failure: 'network' }

    try {
      await streamToFile(
        directory,
        task.filename,
        response.body,
        (chunk) => {
          task.received += chunk
          emit()
        },
        controller.signal,
      )
    } catch {
      // Out of disk, permission withdrawn, or the run was cancelled.
      return { outcome: 'failed', failure: 'write' }
    }

    return { outcome: 'done' }
  }

  /** Run `queue` with at most `concurrency` in flight. */
  async function drain(queue: DownloadTask[]): Promise<void> {
    let cursor = 0

    const worker = async () => {
      while (cursor < queue.length && !controller.signal.aborted) {
        const task = queue[cursor++]
        await runTask(task)
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.max(1, Math.min(concurrency, queue.length)) },
        worker,
      ),
    )
  }

  async function run(queue: DownloadTask[]): Promise<QueueSnapshot> {
    if (queue.length === 0) {
      state = 'finished'
      emit()
      return snapshot()
    }

    controller = new AbortController()
    state = 'running'
    emit()

    await drain(queue)

    state = 'finished'
    emit()
    return snapshot()
  }

  return {
    snapshot,

    start() {
      return run(tasks.filter((task) => task.status === 'pending'))
    },

    pause() {
      if (state === 'running') {
        state = 'paused'
        emit()
      }
    },

    resume() {
      if (state !== 'paused') return
      state = 'running'
      resumeSignal?.()
      resumeSignal = null
      emit()
    },

    cancel() {
      controller.abort()
      // Release anything parked in `waitWhilePaused` so the run can unwind.
      resumeSignal?.()
      resumeSignal = null
      for (const task of tasks) {
        if (task.status === 'pending' || task.status === 'active') {
          task.status = 'cancelled'
        }
      }
      state = 'finished'
      emit()
    },

    retryFailed() {
      const failed = tasks.filter((task) => task.status === 'failed')
      for (const task of failed) {
        task.status = 'pending'
        task.received = 0
        task.failure = undefined
      }
      return run(failed)
    },
  }
}

/**
 * Derive a filename per source, disambiguating collisions.
 *
 * Two catalogs can name a tile identically, and the sanitiser can map two
 * different hrefs onto one name. Silently overwriting would leave the user
 * with fewer files than they selected and no indication why.
 */
export function withUniqueNames(sources: DownloadSource[]): DownloadTask[] {
  const used = new Set<string>()

  return sources.map((source) => {
    const base = safeFilename(source.url)
    let filename = base

    if (used.has(filename)) {
      const dot = base.lastIndexOf('.')
      const stem = dot > 0 ? base.slice(0, dot) : base
      const extension = dot > 0 ? base.slice(dot) : ''
      let suffix = 2
      while (used.has(`${stem}-${suffix}${extension}`)) suffix++
      filename = `${stem}-${suffix}${extension}`
    }
    used.add(filename)

    return {
      key: source.key,
      url: source.url,
      filename,
      expectedSize: source.expectedSize,
      status: 'pending',
      received: 0,
      total: null,
      attempts: 0,
    }
  })
}

/* ------------------------------------------------------------------ *
 * Tier 2 — one file at a time, through memory
 * ------------------------------------------------------------------ */

/**
 * The Firefox and Safari path: no directory handle, so each file is buffered
 * into a blob and handed to the browser's own downloader.
 *
 * Strictly worse than tier 1 — the whole file sits in memory, and the tab must
 * stay open — so the UI says so and steers large selections to tier 3.
 */
export async function downloadViaBlob(
  url: string,
  filename: string,
  credentials: BasicCredentials | null,
  options: { fetchImpl?: typeof globalThis.fetch; signal?: AbortSignal } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const headers: Record<string, string> = {}
  if (credentials) headers.Authorization = basicAuthHeader(credentials)

  const response = await fetchImpl(url, {
    headers,
    credentials: 'omit',
    signal: options.signal,
  })
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`)
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()

  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
}
