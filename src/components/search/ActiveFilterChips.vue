<script setup lang="ts">
/**
 * What the current search is actually constrained by, in one line.
 *
 * The panel is long enough that a filter set three sections down is easy to
 * forget, and an unexpectedly empty result set is almost always a filter
 * nobody remembers setting. Each chip removes exactly its own constraint.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BBox2D } from '@/types/stac'
import {
  isActiveValue,
  type QueryableField,
  type QueryableValue,
  type QueryableValues,
} from '@/services/queryables'
import { labelForProperty } from '@/utils/propertyLabels'

const props = defineProps<{
  bbox: BBox2D | null
  collections: string[]
  datetime: string | null
  fields: QueryableField[]
  values: QueryableValues
}>()

const emit = defineEmits<{
  clearBbox: []
  clearCollections: []
  clearDatetime: []
  clearQueryable: [name: string]
  clearAll: []
}>()

const { t, locale } = useI18n()

function fieldLabel(field: QueryableField): string {
  return labelForProperty(field.name, locale.value) ?? field.label
}

/** A short, readable summary of what a queryable value narrows to. */
function describeValue(value: QueryableValue): string {
  switch (value.kind) {
    case 'number': {
      if (value.min != null && value.max != null)
        return `${value.min}–${value.max}`
      if (value.min != null) return `≥ ${value.min}`
      return `≤ ${value.max}`
    }
    case 'enum':
      return value.selected.join(', ')
    case 'string':
      return value.text.trim()
    case 'boolean':
      return String(value.value)
  }
}

/** `2024-01-01T00:00:00Z/..` reads better as `2024-01-01 →`. */
const datetimeLabel = computed(() => {
  if (!props.datetime) return ''
  const [start, end] = props.datetime.split('/')
  const from = start && start !== '..' ? start.slice(0, 10) : null
  const to = end && end !== '..' ? end.slice(0, 10) : null

  if (from && to) return `${from} – ${to}`
  if (from) return `${from} →`
  if (to) return `← ${to}`
  return props.datetime
})

const queryableChips = computed(() =>
  props.fields
    .filter((field) => isActiveValue(field, props.values[field.name]))
    .map((field) => ({
      name: field.name,
      label: fieldLabel(field),
      value: describeValue(props.values[field.name]),
    })),
)

const hasAny = computed(
  () =>
    props.bbox !== null ||
    props.collections.length > 0 ||
    props.datetime !== null ||
    queryableChips.value.length > 0,
)
</script>

<template>
  <div
    v-if="hasAny"
    class="chips"
    role="group"
    :aria-label="t('search.chips.legend')"
  >
    <button v-if="bbox" type="button" class="chip" @click="emit('clearBbox')">
      <span class="chip-key">{{ t('search.chips.area') }}</span>
      <span class="chip-value">
        {{ bbox.map((value) => value.toFixed(3)).join(', ') }}
      </span>
      <span class="chip-x" aria-hidden="true">×</span>
      <span class="sr-only">{{ t('search.chips.remove') }}</span>
    </button>

    <button
      v-if="collections.length"
      type="button"
      class="chip"
      @click="emit('clearCollections')"
    >
      <span class="chip-key">{{ t('search.chips.collections') }}</span>
      <span class="chip-value">
        {{
          collections.length === 1
            ? collections[0]
            : t('search.chips.collectionCount', { count: collections.length })
        }}
      </span>
      <span class="chip-x" aria-hidden="true">×</span>
      <span class="sr-only">{{ t('search.chips.remove') }}</span>
    </button>

    <button
      v-if="datetime"
      type="button"
      class="chip"
      @click="emit('clearDatetime')"
    >
      <span class="chip-key">{{ t('search.chips.dates') }}</span>
      <span class="chip-value">{{ datetimeLabel }}</span>
      <span class="chip-x" aria-hidden="true">×</span>
      <span class="sr-only">{{ t('search.chips.remove') }}</span>
    </button>

    <button
      v-for="chip in queryableChips"
      :key="chip.name"
      type="button"
      class="chip"
      @click="emit('clearQueryable', chip.name)"
    >
      <span class="chip-key">{{ chip.label }}</span>
      <span class="chip-value">{{ chip.value }}</span>
      <span class="chip-x" aria-hidden="true">×</span>
      <span class="sr-only">{{ t('search.chips.remove') }}</span>
    </button>

    <button type="button" class="clear-all" @click="emit('clearAll')">
      {{ t('search.chips.clearAll') }}
    </button>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}

.chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--sp-1);
  max-width: 100%;
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-accent-border);
  border-radius: var(--r-full);
  background: var(--c-accent-bg);
  color: var(--c-text);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.chip:hover {
  background: var(--c-surface-hover);
}

.chip-key {
  color: var(--c-text-muted);
}

.chip-value {
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-x {
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
  line-height: 1;
}

.clear-all {
  border: 0;
  background: none;
  padding: 0;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  cursor: pointer;
}
.clear-all:hover {
  text-decoration: underline;
}
</style>
