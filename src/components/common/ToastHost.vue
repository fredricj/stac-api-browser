<script setup lang="ts">
/**
 * Where a toast, once pushed to the store, actually appears.
 *
 * One instance lives in `App.vue`, above the router view, so a toast survives
 * navigating away from whatever triggered it. Announced through a single
 * `aria-live="polite"` region rather than one per toast: a screen reader
 * hears each message once, in order, without a flurry of region changes.
 */
import { useI18n } from 'vue-i18n'
import { useToastStore } from '@/stores/toastStore'

const { t } = useI18n()
const toasts = useToastStore()
</script>

<template>
  <div class="host" role="status" aria-live="polite">
    <TransitionGroup name="toast" tag="div" class="stack">
      <div
        v-for="toast in toasts.toasts"
        :key="toast.id"
        class="toast"
        :class="`toast--${toast.variant}`"
      >
        <p class="message">{{ toast.message }}</p>
        <button
          type="button"
          class="dismiss"
          :aria-label="t('common.close')"
          @click="toasts.dismiss(toast.id)"
        >
          &times;
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.host {
  position: fixed;
  left: 50%;
  bottom: var(--sp-5);
  z-index: 200;
  transform: translateX(-50%);
  width: min(28rem, calc(100vw - 2rem));
  pointer-events: none;
}

.stack {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-text);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

.toast--success {
  border-color: var(--c-success);
  background: var(--c-success-bg);
  color: var(--c-success);
}

.toast--error {
  border-color: var(--c-danger);
  background: var(--c-danger-bg);
  color: var(--c-danger);
}

.message {
  flex: 1 1 auto;
  font-size: var(--fs-sm);
}

.dismiss {
  flex: none;
  border: 0;
  background: none;
  color: inherit;
  opacity: 0.7;
  font-size: var(--fs-lg);
  line-height: 1;
  padding: 0 0 0 var(--sp-1);
  cursor: pointer;
}
.dismiss:hover {
  opacity: 1;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--transition),
    transform var(--transition);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
/* The list itself must not jump when a toast above it disappears. */
.toast-leave-active {
  position: absolute;
  width: 100%;
}
</style>
