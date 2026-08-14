<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { BASEMAPS, type BasemapId } from '@/config/basemaps'

defineProps<{ current: BasemapId }>()
const emit = defineEmits<{ change: [id: BasemapId] }>()

const { t } = useI18n()
</script>

<template>
  <div
    class="basemap-switcher"
    role="group"
    :aria-label="t('map.basemap.label')"
  >
    <button
      v-for="basemap in BASEMAPS"
      :key="basemap.id"
      type="button"
      class="option"
      :class="{ 'is-active': basemap.id === current }"
      :aria-pressed="basemap.id === current"
      @click="emit('change', basemap.id)"
    >
      {{ t(basemap.labelKey) }}
    </button>
  </div>
</template>

<style scoped>
.basemap-switcher {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-sm);
}

.option {
  border: 0;
  background: none;
  cursor: pointer;
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-sm);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  white-space: nowrap;
}
.option:hover {
  background: var(--c-surface-hover);
  color: var(--c-text);
}
.option.is-active {
  background: var(--c-accent-bg);
  color: var(--c-accent);
  font-weight: 600;
}
</style>
