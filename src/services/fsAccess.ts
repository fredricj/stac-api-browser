/**
 * Writing straight to a folder on disk.
 *
 * This is what makes a serious download possible at all in a browser. Each
 * asset here is hundreds of megabytes and a real selection is tens of
 * gigabytes; buffering that into memory to hand to a blob URL would take the
 * tab down. With a directory handle the response body streams to disk and
 * memory stays flat regardless of file size.
 *
 * Only Chromium browsers have it, hence the capability detection — Firefox
 * and Safari fall back to tier 2 or tier 3 in `downloader.ts`.
 */

/** Whether tier 1 — streaming straight to a chosen folder — is available. */
export function isDirectoryPickerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function'
  )
}

/**
 * Ask the user for a folder.
 *
 * Returns null when they cancel, which is an ordinary outcome and not an
 * error. Must be called from a user gesture; browsers reject it otherwise.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isDirectoryPickerSupported()) return null

  try {
    return await window.showDirectoryPicker!({
      id: 'stac-downloads',
      mode: 'readwrite',
      startIn: 'downloads',
    })
  } catch (error) {
    // AbortError is the user closing the picker — not worth surfacing.
    if ((error as { name?: string })?.name === 'AbortError') return null
    throw error
  }
}

/**
 * Confirm we may still write to a handle.
 *
 * A handle kept across a reload comes back with its permission revoked, so
 * this re-requests rather than assuming. Re-requesting also needs a user
 * gesture, which is why it happens when the download is started.
 */
export async function ensureWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const descriptor = { mode: 'readwrite' } as const

  if (typeof handle.queryPermission === 'function') {
    if ((await handle.queryPermission(descriptor)) === 'granted') return true
  }
  if (typeof handle.requestPermission === 'function') {
    return (await handle.requestPermission(descriptor)) === 'granted'
  }
  // No permission API at all: assume the picker's grant still stands.
  return true
}

/**
 * A safe filename for an asset URL.
 *
 * The href comes from the catalog, which is data we do not control. Without
 * this, a href ending `/../../../autorun.inf` would be handed straight to
 * `getFileHandle` and try to escape the folder the user chose. Everything
 * outside a conservative set is replaced, and the result can never be empty,
 * a traversal segment, or a Windows reserved device name.
 */
export function safeFilename(url: string, fallback = 'download'): string {
  let candidate = ''
  try {
    // Decode first, *then* take the basename. Splitting first would leave
    // `%2e%2e%2f` intact inside the last segment, so an encoded traversal
    // would be sanitised into a strange name instead of being resolved away
    // like the literal `../` it is.
    candidate = decodeURIComponent(new URL(url).pathname).split('/').pop() ?? ''
  } catch {
    candidate = ''
  }

  // Strip anything that could change the meaning of the path, then collapse.
  // The leading-dot strip is what defeats `..`, and also stops a href from
  // writing a hidden file the user then cannot find.
  candidate = candidate
    .replace(/[\\/]/g, '_')
    .replace(/\p{Cc}/gu, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()

  if (!candidate) return fallback

  // CON, PRN, AUX, NUL, COM1-9, LPT1-9 are unusable as filenames on Windows
  // whatever the extension.
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(candidate)) {
    candidate = `_${candidate}`
  }

  // Leave room for the `.part` suffix within the usual 255-byte limit.
  return candidate.slice(0, 240)
}

/**
 * Whether a finished file of this name and size is already there.
 *
 * The point is cheap resumption of an interrupted run. Size is compared
 * rather than mere existence, because an interrupted run leaves a *partial*
 * file behind, and treating a truncated 692 MB tile as complete would be a
 * silent data-corruption bug that only surfaces when someone opens it.
 *
 * When the expected size is unknown we decline to skip, since there is then
 * no way to tell complete from truncated.
 */
export async function hasCompleteFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
  expectedSize: number | null,
): Promise<boolean> {
  if (expectedSize == null || expectedSize <= 0) return false

  try {
    const handle = await directory.getFileHandle(filename)
    const file = await handle.getFile()
    return file.size === expectedSize
  } catch {
    // NotFoundError, or anything else we cannot read: treat as not present.
    return false
  }
}

/**
 * Stream a response body into a file, reporting bytes as they land.
 *
 * Writes to `<name>.part` and renames on success, so an interrupted run never
 * leaves a truncated file under the real name for `hasCompleteFile` to
 * mistake for a finished one. `move` is Chromium-only; without it the write
 * goes directly to the final name and resumption falls back to the size check
 * alone.
 */
export async function streamToFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
  body: ReadableStream<Uint8Array>,
  onBytes: (chunk: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const canRename =
    typeof FileSystemFileHandle === 'function' &&
    typeof (FileSystemFileHandle.prototype as { move?: unknown }).move ===
      'function'
  const writeName = canRename ? `${filename}.part` : filename

  const handle = await directory.getFileHandle(writeName, { create: true })
  const writable = await handle.createWritable()

  // Counting in a transform keeps memory flat: chunks are measured on their
  // way past, never accumulated.
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      onBytes(chunk.byteLength)
      controller.enqueue(chunk)
    },
  })

  try {
    await body.pipeThrough(counter, { signal }).pipeTo(writable, { signal })
  } catch (error) {
    // `pipeTo` closes the writable on failure; removing the stub keeps a
    // cancelled run from leaving debris behind.
    try {
      await directory.removeEntry(writeName)
    } catch {
      // Nothing to clean up, or the directory is gone.
    }
    throw error
  }

  if (canRename) {
    const written = await directory.getFileHandle(writeName)
    await (
      written as unknown as { move: (name: string) => Promise<void> }
    ).move(filename)
  }
}
