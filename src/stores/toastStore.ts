/**
 * Brief, non-blocking confirmations — "added Ortofoto Nedladdning" and the
 * like. Nothing that blocks a decision belongs here: a toast disappears on
 * its own, so anything the user must act on is a dialog or an inline error
 * instead.
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

export type ToastVariant = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

/** How long a toast stays before it dismisses itself. */
const DEFAULT_DURATION_MS = 5000

let nextId = 0

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])

  function push(
    message: string,
    variant: ToastVariant = 'info',
    durationMs = DEFAULT_DURATION_MS,
  ): number {
    const id = nextId++
    toasts.value = [...toasts.value, { id, message, variant }]
    if (durationMs > 0) {
      setTimeout(() => dismiss(id), durationMs)
    }
    return id
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  return { toasts, push, dismiss }
})
