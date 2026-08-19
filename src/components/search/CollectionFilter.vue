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
import { computed, ref, watch, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { StacCollection } from '@/types/stac'
import type { SearchError } from '@/stores/searchStore'
import {
  filterGroups,
  groupCollectionsByProduct,
  groupCollectionsByYear,
  toRows,
} from '@/utils/collectionGroups'
import { useDebouncedRef } from '@/composables/useDebounce'

const props = withDefaults(
  defineProps<{
    collections: StacCollection[]
    selected: string[]
    loading?: boolean
    error?: SearchError | null
    /** See `StacApiEntry.collectionGrouping`. */
    grouping?: 'year' | 'product'
  }>(),
  { loading: false, error: null, grouping: 'year' },
)

const emit = defineEmits<{ 'update:selected': [ids: string[]]; retry: [] }>()

const { t, n } = useI18n()

const query = ref('')
// 731 entries re-filtered on every keystroke is enough work to feel it.
const debouncedQuery = useDebouncedRef(query, 150)

const groups = computed(() =>
  props.grouping === 'product'
    ? groupCollectionsByProduct(props.collections)
    : groupCollectionsByYear(props.collections),
)

/**
 * The top-level product picker, e.g. "Markhöjdmodell" / "Laserdata Skog" —
 * only meaningful (and only rendered) when there is more than one, so a
 * catalog whose products happen to number one still just shows the list.
 */
const activeProduct = ref<string | null>(null)
const productGroups = computed(() =>
  props.grouping === 'product'
    ? groups.value.map((group) => ({
        key: group.key,
        label: group.label,
        count: group.options.length,
      }))
    : [],
)

// A stale product selection surviving a catalog switch would silently filter
// the new list down to nothing, since its group keys mean nothing there.
watch(
  () => props.collections,
  () => {
    activeProduct.value = null
  },
)

const visibleGroups = computed(() => {
  const base = activeProduct.value
    ? groups.value.filter((group) => group.key === activeProduct.value)
    : groups.value
  return filterGroups(base, debouncedQuery.value)
})
const rows = computed(() => toRows(visibleGroups.value))

const selectedSet = computed(() => new Set(props.selected))
const matchCount = computed(() =>
  visibleGroups.value.reduce((total, group) => total + group.options.length, 0),
)

const scroller = useTemplateRef<HTMLElement>('scroller')

const HEADER_HEIGHT = 26
const OPTION_HEIGHT = 32
/** Enough to fill the scroller box without implying a known row count. */
const SKELETON_ROWS = 6

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

    <!-- The fetch that fills `collections` failed outright: there is nothing
         to search or select, so say so instead of showing an empty list that
         looks like the catalog simply has none. -->
    <div v-if="error && !loading" class="error" role="alert">
      <p class="error-text">{{ t('search.collections.error') }}</p>
      <p v-if="error.likelyCors" class="error-hint">
        {{ t('search.results.corsHint') }}
      </p>
      <button type="button" class="retry" @click="emit('retry')">
        {{ t('common.retry') }}
      </button>
    </div>

    <template v-else>
      <!-- Only for a catalog whose collections are really a handful of
           distinct products, not the years-of-imagery shape `stac-bild` has —
           see `StacApiEntry.collectionGrouping`. -->
      <div
        v-if="productGroups.length > 1"
        class="products"
        role="group"
        :aria-label="t('search.collections.productsLegend')"
      >
        <button
          type="button"
          class="product-chip"
          :class="{ 'is-on': activeProduct === null }"
          :aria-pressed="activeProduct === null"
          @click="activeProduct = null"
        >
          {{ t('search.collections.allProducts') }}
        </button>
        <button
          v-for="group in productGroups"
          :key="group.key"
          type="button"
          class="product-chip"
          :class="{ 'is-on': activeProduct === group.key }"
          :aria-pressed="activeProduct === group.key"
          @click="activeProduct = group.key"
        >
          {{ group.label }} ({{ n(group.count) }})
        </button>
      </div>

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
          {{
            t('search.collections.selectedCount', { count: selected.length })
          }}
        </span>
      </p>

      <div
        ref="scroller"
        class="scroller"
        role="group"
        :aria-label="t('search.collections.legend')"
      >
        <!-- Nothing is loaded yet, so the virtualiser has no rows to draw —
             placeholders shaped like the option list fill that box instead
             of leaving it visibly empty under the loading caption above. -->
        <ul v-if="loading" class="skeleton-rows" aria-hidden="true">
          <li v-for="row in SKELETON_ROWS" :key="row" class="skeleton-row">
            <span class="skeleton skeleton-check"></span>
            <span class="skeleton skeleton-line"></span>
          </li>
        </ul>

        <template v-else>
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

          <p v-if="rows.length === 0" class="empty">
            {{ t('search.collections.noMatches') }}
          </p>
        </template>
      </div>
    </template>

    <div v-if="!error || loading" class="bulk">
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

.products {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
}

.product-chip {
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-full);
  background: var(--c-surface);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.product-chip:hover {
  background: var(--c-surface-hover);
}
/* Border as well as fill: selection is never signalled by colour alone. */
.product-chip.is-on {
  background: var(--c-accent-bg);
  border-color: var(--c-accent);
  color: var(--c-accent);
  font-weight: 600;
}

.search {
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm);
  background: var(--c-bg);
  font-size: var(--fs-sm);
}

.error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border-radius: var(--r-md);
  background: var(--c-danger-bg);
}

.error-text {
  font-size: var(--fs-xs);
  color: var(--c-danger);
}

.error-hint {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  opacity: 0.9;
}

.retry {
  padding: var(--sp-1) var(--sp-3);
  border: 1px solid var(--c-danger);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  color: var(--c-danger);
  font-size: var(--fs-xs);
  cursor: pointer;
}
.retry:hover {
  background: var(--c-danger-bg);
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

.skeleton-rows {
  list-style: none;
  padding: var(--sp-1) 0;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 32px;
  padding: 0 var(--sp-2);
}

.skeleton-check {
  flex: none;
  width: 0.9rem;
  height: 0.9rem;
}

.skeleton-line {
  flex: 1 1 auto;
  max-width: 12rem;
  height: 0.6rem;
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
