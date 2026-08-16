<script setup lang="ts">
/**
 * Collections as a filter, not a navigation tree.
 *
 * `stac-bild` has 731 of them. Rendering that as DOM costs several thousand
 * nodes and makes every keystroke in the search box janky, so the list is
 * virtualised: only the rows on screen exist. Grouping is by year, newest
 * first, because "the most recent imagery of this place" is the question
 * almost everyone actually has.
 */
import { computed, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { StacCollection } from '@/types/stac'
import {
  filterGroups,
  groupCollectionsByYear,
  toRows,
} from '@/utils/collectionGroups'
import { useDebouncedRef } from '@/composables/useDebounce'

const props = defineProps<{
  collections: StacCollection[]
  selected: string[]
  loading?: boolean
}>()

const emit = defineEmits<{ 'update:selected': [ids: string[]] }>()

const { t, n } = useI18n()

const query = ref('')
// 731 entries re-filtered on every keystroke is enough work to feel it.
const debouncedQuery = useDebouncedRef(query, 150)

const groups = computed(() => groupCollectionsByYear(props.collections))
const visibleGroups = computed(() =>
  filterGroups(groups.value, debouncedQuery.value),
)
const rows = computed(() => toRows(visibleGroups.value))

const selectedSet = computed(() => new Set(props.selected))
const matchCount = computed(() =>
  visibleGroups.value.reduce((total, group) => total + group.options.length, 0),
)

const scroller = useTemplateRef<HTMLElement>('scroller')

const HEADER_HEIGHT = 26
const OPTION_HEIGHT = 32

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scroller.value,
    // Headings are shorter than options; an accurate estimate keeps the
    // scrollbar from jumping as rows are measured.
    estimateSize: (index: number) =>
      rows.value[index]?.type === 'header' ? HEADER_HEIGHT : OPTION_HEIGHT,
    overscan: 8,
    getItemKey: (index: number) => rows.value[index]?.key ?? index,
  })),
)

/**
 * Paired with their row up front rather than indexed in the template: a
 * discriminated union only narrows through a stable local, which `v-for`
 * gives us and a repeated `rows[index]` lookup does not.
 */
const virtualRows = computed(() =>
  virtualizer.value
    .getVirtualItems()
    .map((virtualRow) => ({
      start: virtualRow.start,
      row: rows.value[virtualRow.index],
    }))
    .filter((entry) => entry.row !== undefined),
)

const totalHeight = computed(() => virtualizer.value.getTotalSize())

function toggle(id: string) {
  const next = new Set(props.selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  emit('update:selected', [...next])
}

/** Select everything the current query matches — the bulk path for a year. */
function selectVisible() {
  const next = new Set(props.selected)
  for (const group of visibleGroups.value) {
    for (const option of group.options) next.add(option.id)
  }
  emit('update:selected', [...next])
}

function clear() {
  emit('update:selected', [])
}

function groupLabel(key: string, label: string): string {
  return key === 'unknown' ? t('search.collections.undated') : label
}
</script>

<template>
  <fieldset class="collections">
    <legend class="legend">{{ t('search.collections.legend') }}</legend>

    <input
      v-model="query"
      type="search"
      class="search"
      :placeholder="t('search.collections.searchPlaceholder')"
      :aria-label="t('search.collections.searchPlaceholder')"
      autocomplete="off"
    />

    <p v-if="loading" class="status">{{ t('search.collections.loading') }}</p>
    <p v-else class="status" role="status">
      {{
        t('search.collections.matchCount', {
          matching: n(matchCount),
          total: n(collections.length),
        })
      }}
      <span v-if="selected.length" class="selected-count">
        ·
        {{ t('search.collections.selectedCount', { count: selected.length }) }}
      </span>
    </p>

    <div
      ref="scroller"
      class="scroller"
      role="group"
      :aria-label="t('search.collections.legend')"
    >
      <div class="spacer" :style="{ height: `${totalHeight}px` }">
        <div
          v-for="entry in virtualRows"
          :key="entry.row.key"
          class="row"
          :style="{ transform: `translateY(${entry.start}px)` }"
        >
          <p v-if="entry.row.type === 'header'" class="group-head">
            <span class="group-label">
              {{ groupLabel(entry.row.groupKey, entry.row.label) }}
            </span>
            <span class="group-count">{{ entry.row.count }}</span>
          </p>

          <label v-else class="option">
            <input
              type="checkbox"
              :checked="selectedSet.has(entry.row.option.id)"
              @change="toggle(entry.row.option.id)"
            />
            <span class="option-text">
              <span class="option-title">{{ entry.row.option.title }}</span>
              <span class="option-id">{{ entry.row.option.id }}</span>
            </span>
          </label>
        </div>
      </div>

      <p v-if="!loading && rows.length === 0" class="empty">
        {{ t('search.collections.noMatches') }}
      </p>
    </div>

    <div class="bulk">
      <button
        type="button"
        class="link"
        :disabled="matchCount === 0"
        @click="selectVisible"
      >
        {{ t('search.collections.selectMatching', { count: matchCount }) }}
      </button>
      <button
        type="button"
        class="link"
        :disabled="selected.length === 0"
        @click="clear"
      >
        {{ t('search.collections.clear') }}
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.collections {
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

.legend {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-text-faint);
  padding-inline: var(--sp-1);
}

.search {
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm);
  background: var(--c-bg);
  font-size: var(--fs-sm);
}

.status {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.selected-count {
  color: var(--c-accent);
}

.scroller {
  position: relative;
  height: 14rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-bg);
}

.spacer {
  position: relative;
  width: 100%;
}

/* Absolutely positioned and translated, which is what lets the virtualiser
   render a handful of rows inside a full-height scroll area. */
.row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

.group-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 26px;
  padding: 0 var(--sp-2);
  background: var(--c-surface-2);
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--c-text-muted);
}

.group-count {
  margin-left: auto;
  color: var(--c-text-faint);
  font-weight: 400;
}

.option {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 32px;
  padding: 0 var(--sp-2);
  cursor: pointer;
  min-width: 0;
}
.option:hover {
  background: var(--c-surface-hover);
}

.option-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}

.option-title {
  font-size: var(--fs-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.option-id {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty {
  padding: var(--sp-3);
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
  text-align: center;
}

.bulk {
  display: flex;
  gap: var(--sp-3);
}

.link {
  border: 0;
  background: none;
  padding: 0;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  cursor: pointer;
}
.link:hover:not(:disabled) {
  text-decoration: underline;
}
.link:disabled {
  color: var(--c-text-faint);
  cursor: not-allowed;
}
</style>
