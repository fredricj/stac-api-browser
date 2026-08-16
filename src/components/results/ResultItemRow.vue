<script setup lang="ts">
/**
 * One search result.
 *
 * The thumbnail is the point of this row: Lantmäteriet serves it publicly
 * while the data asset behind it needs credentials, so a user can judge
 * whether a tile is cloud-free, correctly exposed and actually the place they
 * meant — before signing in, and before downloading 700 MB to find out.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StacItem } from '@/types/stac'
import { dataAsset, thumbnailAsset } from '@/types/stac'
import { formatBytes, formatDate, formatResolution } from '@/utils/format'

const props = defineProps<{
  item: StacItem
  selected: boolean
  hovered: boolean
}>()

const emit = defineEmits<{
  toggle: []
  hover: [hovering: boolean]
  open: []
}>()

const { t, locale } = useI18n()

const thumbnail = computed(() => thumbnailAsset(props.item)?.href ?? null)

const date = computed(() =>
  formatDate(
    props.item.properties.datetime ?? props.item.properties.start_datetime,
    locale.value,
  ),
)

/** `upplosning` is Lantmäteriet's; `gsd` is the STAC-standard equivalent. */
const resolution = computed(() => {
  const value = props.item.properties.upplosning ?? props.item.properties.gsd
  return typeof value === 'number' ? formatResolution(value, locale.value) : ''
})

const size = computed(() => {
  const bytes = dataAsset(props.item)?.['file:size']
  return typeof bytes === 'number' ? formatBytes(bytes, locale.value) : ''
})
</script>

<template>
  <div
    class="row"
    :class="{ 'is-selected': selected, 'is-hovered': hovered }"
    @mouseenter="emit('hover', true)"
    @mouseleave="emit('hover', false)"
  >
    <!-- A real checkbox, not a styled div: selection must be reachable and
         announced by the keyboard path, which is the only path for anyone
         who cannot use the map. -->
    <label class="check">
      <input
        type="checkbox"
        :checked="selected"
        :aria-label="t('results.selectItem', { id: item.id })"
        @change="emit('toggle')"
        @focus="emit('hover', true)"
        @blur="emit('hover', false)"
      />
    </label>

    <button
      type="button"
      class="body"
      :aria-label="t('results.openItem', { id: item.id })"
      @click="emit('open')"
      @focus="emit('hover', true)"
      @blur="emit('hover', false)"
    >
      <span class="thumb">
        <!-- Lazy: a page of 250 rows would otherwise fire 250 image requests
             at a public service the moment a search returns. -->
        <img
          v-if="thumbnail"
          :src="thumbnail"
          alt=""
          loading="lazy"
          decoding="async"
        />
        <span v-else class="thumb-empty" aria-hidden="true">—</span>
      </span>

      <span class="text">
        <span class="id">{{ item.id }}</span>
        <span class="collection">{{ item.collection }}</span>
        <span class="meta">
          <template v-if="date">{{ date }}</template>
          <template v-if="resolution"> · {{ resolution }}</template>
          <template v-if="size"> · {{ size }}</template>
        </span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: stretch;
  gap: var(--sp-1);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
}
.row.is-hovered {
  background: var(--c-surface-hover);
}
/* A left bar as well as a tint: selection is never signalled by colour alone. */
.row.is-selected {
  background: var(--c-success-bg);
  box-shadow: inset 3px 0 0 var(--c-selected-line);
}

.check {
  display: flex;
  align-items: center;
  padding-left: var(--sp-3);
  cursor: pointer;
}

.body {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.thumb {
  flex: none;
  display: grid;
  place-items: center;
  width: 3.25rem;
  height: 3.25rem;
  overflow: hidden;
  border-radius: var(--r-sm);
  background: var(--c-surface-2);
  border: 1px solid var(--c-border);
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-empty {
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}

.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.id {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  color: var(--c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collection {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  font-variant-numeric: tabular-nums;
}
</style>
