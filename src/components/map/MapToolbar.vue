<script setup lang="ts">
/**
 * The map's own search controls.
 *
 * *Search this area* is here rather than in the sidebar on purpose — it is
 * the cheapest of the three search paths to build and, in practice, the one
 * people reach for most: pan until the place is on screen, then search what
 * they can see.
 */
import { useI18n } from 'vue-i18n'

defineProps<{
  drawing: boolean
  hasBbox: boolean
  /**
   * True when the last attempt to start the drawing tool failed.
   *
   * The button stays on screen and says so, rather than disappearing: a
   * control that silently vanishes reads as a broken app, and the other two
   * ways of setting an extent still work.
   */
  drawFailed: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  toggleDraw: []
  clearBbox: []
  searchArea: []
}>()

const { t } = useI18n()
</script>

<template>
  <div class="toolbar" role="group" :aria-label="t('map.toolbar.label')">
    <button
      type="button"
      class="tool"
      :disabled="busy"
      @click="emit('searchArea')"
    >
      {{ t('map.toolbar.searchArea') }}
    </button>

    <button
      type="button"
      class="tool"
      :class="{ 'is-on': drawing, 'is-failed': drawFailed }"
      :aria-pressed="drawing"
      :title="drawFailed ? t('map.toolbar.drawUnavailable') : undefined"
      @click="emit('toggleDraw')"
    >
      {{ drawing ? t('map.toolbar.drawing') : t('map.toolbar.drawBox') }}
    </button>

    <button
      v-if="hasBbox"
      type="button"
      class="tool"
      @click="emit('clearBbox')"
    >
      {{ t('map.toolbar.clearBox') }}
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: var(--sp-1);
  padding: var(--sp-1);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-sm);
}

.tool {
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: none;
  font-size: var(--fs-xs);
  color: var(--c-text);
  cursor: pointer;
  white-space: nowrap;
}
.tool:hover:not(:disabled) {
  background: var(--c-surface-hover);
}
.tool:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Border as well as fill, so the active tool is not signalled by colour alone. */
.tool.is-on {
  background: var(--c-accent-bg);
  border-color: var(--c-accent);
  color: var(--c-accent);
  font-weight: 600;
}

.tool.is-failed {
  color: var(--c-warning);
  border-color: var(--c-warning);
}
</style>
