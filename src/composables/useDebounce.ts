import { onScopeDispose, ref, watch, type Ref } from 'vue'

/**
 * Call `fn` only once the caller stops calling it for `delayMs`.
 *
 * Cancels itself when the owning component unmounts, so a pending callback
 * can never run against a torn-down map or a disposed store.
 */
export function useDebounceFn<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs = 250,
): ((...args: Args) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Args | null = null

  function cancel() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = null
  }

  function flush() {
    if (timer === null || !pending) return
    const args = pending
    cancel()
    fn(...args)
  }

  const debounced = (...args: Args) => {
    pending = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      pending = null
      fn(...args)
    }, delayMs)
  }

  onScopeDispose(cancel)

  return Object.assign(debounced, { cancel, flush })
}

/**
 * A read-only mirror of `source` that settles `delayMs` after it stops
 * changing.
 *
 * Used for the type-as-you-go filters — the collection search box runs over
 * 731 entries on every keystroke, and the coordinate box reprojects on every
 * one.
 */
export function useDebouncedRef<T>(source: Ref<T>, delayMs = 250): Ref<T> {
  const debounced = ref(source.value) as Ref<T>

  const update = useDebounceFn((value: T) => {
    debounced.value = value
  }, delayMs)

  watch(source, (value) => update(value))

  return debounced
}
