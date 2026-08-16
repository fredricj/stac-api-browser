/**
 * The parts of the File System Access API TypeScript's DOM library still
 * omits.
 *
 * `FileSystemDirectoryHandle`, `createWritable` and `move` are all typed
 * already; only the entry point and the permission query are missing, so this
 * declares exactly those rather than pulling in a whole ambient package.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface ShowDirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: FileSystemHandle | string
}

interface FileSystemHandle {
  /** Non-standard but shipping wherever the picker is; absent elsewhere. */
  queryPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>
  requestPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>
}

interface Window {
  showDirectoryPicker?(
    options?: ShowDirectoryPickerOptions,
  ): Promise<FileSystemDirectoryHandle>
}
