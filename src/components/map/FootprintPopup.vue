<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { FootprintProperties } from '@/composables/useFootprintLayer'

defineProps<{
  /** Every footprint under the click, topmost first. */
  hits: FootprintProperties[]
  selectedKeys: Set<string>
  /** Position in map-container pixels. */
  x: number
  y: number
}>()

const emit = defineEmits<{
  toggle: [key: string]
  hover: [key: string | null]
  close: []
}>()

const { t, d } = useI18n()

function formatDate(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? '' : d(parsed, 'short')
}
</script>

<template>
  <div
    class="popup"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="dialog"
    :aria-label="t('map.popup.title', { count: hits.length })"
    @keydown.esc="emit('close')"
  >
    <header class="popup-head">
      <span class="popup-title">{{
        t('map.popup.title', { count: hits.length })
      }}</span>
      <button
        type="button"
        class="popup-close"
        :aria-label="t('common.close')"
        @click="emit('close')"
      >
        &times;
      </button>
    </header>

    <ul class="hit-list">
      <li v-for="hit in hits" :key="hit.key">
        <button
          type="button"
          class="hit"
          :class="{ 'is-selected': selectedKeys.has(hit.key) }"
          :aria-pressed="selectedKeys.has(hit.key)"
          @click="emit('toggle', hit.key)"
          @mouseenter="emit('hover', hit.key)"
          @mouseleave="emit('hover', null)"
          @focus="emit('hover', hit.key)"
          @blur="emit('hover', null)"
        >
          <span class="hit-check" aria-hidden="true">
            {{ selectedKeys.has(hit.key) ? '✓' : '' }}
          </span>
          <span class="hit-text">
            <span class="hit-id">{{ hit.id }}</span>
            <span class="hit-meta">
              {{ hit.collection }}
              <template v-if="formatDate(hit.datetime)">
                · {{ formatDate(hit.datetime) }}
              </template>
            </span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.popup {
  position: absolute;
  z-index: 5;
  /* Anchor above the click point, like a map pin's callout. */
  transform: translate(-50%, calc(-100% - 0.75rem));
  width: max-content;
  max-width: min(22rem, 80%);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.popup::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
  border-bottom: 1px solid var(--c-border);
  transform: rotate(45deg);
}

.popup-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface-2);
}

.popup-title {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-text-muted);
  margin-right: auto;
}

.popup-close {
  border: 0;
  background: none;
  cursor: pointer;
  color: var(--c-text-muted);
  font-size: var(--fs-lg);
  line-height: 1;
  padding: 0 var(--sp-1);
}
.popup-close:hover {
  color: var(--c-text);
}

.hit-list {
  list-style: none;
  max-height: 14rem;
  overflow-y: auto;
}

.hit {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}
.hit:hover {
  background: var(--c-surface-hover);
}
.hit.is-selected {
  background: var(--c-success-bg);
}

.hit-check {
  flex: 0 0 1rem;
  color: var(--c-success);
  font-size: var(--fs-sm);
  line-height: 1.4;
}

.hit-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hit-id {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text);
  overflow: hidden;
  text-overflow: ellipsis;
}

.hit-meta {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}
</style>
