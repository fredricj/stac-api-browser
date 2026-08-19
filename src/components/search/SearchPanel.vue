<script setup lang="ts">
/**
 * The search sidebar.
 *
 * Reads and writes the search store directly rather than threading a dozen
 * props through: the store *is* the search, and every child here edits one
 * facet of it. The panel's own job is layout, the search button, and the
 * area guard that stands between a careless drag and a hundred thousand
 * items.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSearchStore } from '@/stores/searchStore'
import { emptyValue } from '@/services/queryables'
import {
  PAGE_LIMIT_OPTIONS,
  type PageLimit,
} from '@/services/pageLimitPreference'
import type { BBox2D } from '@/types/stac'
import { resolveCrs } from '@/utils/projections'
import ActiveFilterChips from '@/components/search/ActiveFilterChips.vue'
import BboxInput from '@/components/search/BboxInput.vue'
import CollectionFilter from '@/components/search/CollectionFilter.vue'
import CoordinateSearchBox from '@/components/search/CoordinateSearchBox.vue'
import DateRangeFilter from '@/components/search/DateRangeFilter.vue'
import QueryableFilters from '@/components/search/QueryableFilters.vue'

const emit = defineEmits<{
  /** A coordinate search wants the map moved to the parsed extent. */
  locate: [bbox: BBox2D]
  /**
   * Run the search. The panel owns the area guard and decides *whether* to
   * search; the view owns the map and decides what a search does to it.
   */
  search: []
}>()

const { t, n } = useI18n()
const store = useSearchStore()

const nativeCrs = computed(() => resolveCrs(store.entry?.defaultCrs))

/**
 * Cleared whenever the box changes, so confirming one large area never
 * silently authorises the next one.
 */
const largeAreaConfirmed = ref(false)
watch(
  () => store.bbox,
  () => {
    largeAreaConfirmed.value = false
  },
)

const needsConfirmation = computed(
  () => store.isLargeArea && !largeAreaConfirmed.value,
)

function runSearch() {
  if (needsConfirmation.value) return
  emit('search')
}

function confirmAndSearch() {
  largeAreaConfirmed.value = true
  emit('search')
}

function onLocate(bbox: BBox2D) {
  store.setBbox(bbox)
  emit('locate', bbox)
}

/** Chips remove one constraint; a queryable's chip resets just that field. */
function clearQueryable(name: string) {
  const field = store.queryableFields.find((entry) => entry.name === name)
  const next = { ...store.queryableValues }
  if (field) next[name] = emptyValue(field)
  else delete next[name]
  store.setQueryableValues(next)
}

/** The `<select>` only ever offers `PAGE_LIMIT_OPTIONS`, so the value read
 *  back from it is always one of them. */
function onPageLimitChange(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value) as PageLimit
  store.setPageLimit(value)
}

const resultSummary = computed(() => {
  if (!store.hasSearched) return null
  // Never a total: `numberMatched` is null on these APIs, so the only honest
  // statement is how many are loaded and whether more remain.
  return store.isComplete
    ? t('search.results.completeCount', { count: n(store.items.length) })
    : t('search.results.loadedCount', { count: n(store.items.length) })
})
</script>

<template>
  <aside class="panel" :aria-label="t('search.panelLabel')">
    <div class="panel-scroll">
      <ActiveFilterChips
        :bbox="store.bbox"
        :collections="store.collections"
        :datetime="store.datetime"
        :fields="store.queryableFields"
        :values="store.queryableValues"
        @clear-bbox="store.setBbox(null)"
        @clear-collections="store.setCollections([])"
        @clear-datetime="store.setDatetime(null)"
        @clear-queryable="clearQueryable"
        @clear-all="store.clearFilters()"
      />

      <CoordinateSearchBox :default-crs="nativeCrs" @locate="onLocate" />

      <BboxInput
        :model-value="store.bbox"
        @update:model-value="store.setBbox($event)"
      />

      <DateRangeFilter
        :model-value="store.datetime"
        @update:model-value="store.setDatetime($event)"
      />

      <CollectionFilter
        :collections="store.allCollections"
        :selected="store.collections"
        :loading="store.collectionsLoading"
        :error="store.collectionsError"
        :grouping="store.entry?.collectionGrouping"
        @update:selected="store.setCollections($event)"
        @retry="store.loadCollections()"
      />

      <QueryableFilters
        :fields="store.queryableFields"
        :values="store.queryableValues"
        :loading="store.queryablesLoading"
        :error="store.queryablesError"
        @update:values="store.setQueryableValues($event)"
        @retry="store.loadQueryables()"
      />
    </div>

    <footer class="panel-foot">
      <div class="page-limit">
        <label class="page-limit-label" for="page-limit">
          {{ t('search.pageLimit.label') }}
        </label>
        <select
          id="page-limit"
          class="page-limit-select"
          :value="store.pageLimit"
          @change="onPageLimitChange"
        >
          <option
            v-for="option in PAGE_LIMIT_OPTIONS"
            :key="option"
            :value="option"
          >
            {{ n(option) }}
          </option>
        </select>
      </div>

      <div class="actions">
        <!-- The area guard. Item counts grow with the square of the box and
             there is no total to warn afterwards, so this asks first. -->
        <div v-if="needsConfirmation" class="guard" role="alert">
          <p class="guard-text">
            {{
              t('search.guard.warning', {
                area: n(Math.round(store.areaKm2)),
              })
            }}
          </p>
          <button type="button" class="btn btn--warn" @click="confirmAndSearch">
            {{ t('search.guard.searchAnyway') }}
          </button>
        </div>

        <button
          v-else
          type="button"
          class="btn btn--primary"
          :disabled="!store.canSearch"
          @click="runSearch"
        >
          {{ store.loading ? t('search.searching') : t('search.search') }}
        </button>

        <button
          v-if="store.loading"
          type="button"
          class="btn"
          @click="store.cancel()"
        >
          {{ t('common.cancel') }}
        </button>
      </div>

      <!-- Announced politely: result counts matter to screen reader users, but
           should not interrupt whatever they are doing in the panel. -->
      <p class="summary" role="status" aria-live="polite">
        <template v-if="store.error">
          <span class="error">{{ t('search.results.failed') }}</span>
        </template>
        <template v-else-if="resultSummary">{{ resultSummary }}</template>
        <template v-else-if="!store.hasSearched">
          {{ t('search.results.notYet') }}
        </template>
      </p>

      <p v-if="store.error" class="error-detail">
        {{ store.error.message }}
        <span v-if="store.error.likelyCors" class="error-hint">
          {{ t('search.results.corsHint') }}
        </span>
      </p>
    </footer>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  padding: var(--sp-4);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  min-height: 0;
  /* The frame no longer scrolls; `.panel-scroll` inside it does, which is
     what keeps the footer on screen. */
  overflow: hidden;
  /*
   * Load-bearing despite nothing here being positioned. `overflow` only clips
   * descendants whose containing block is inside the scroll container, so a
   * static panel let the absolutely positioned `.sr-only` labels resolve
   * against the initial containing block and stretch the whole document.
   */
  position: relative;
}

.panel-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding-right: var(--sp-2);
  margin-right: calc(var(--sp-2) * -1);
}

.panel-foot {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--c-border);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}

.page-limit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}

.page-limit-label {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

.page-limit-select {
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-sm);
  background: var(--c-bg);
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
}

.guard {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  width: 100%;
  padding: var(--sp-3);
  border-radius: var(--r-md);
  background: var(--c-warning-bg);
}

.guard-text {
  font-size: var(--fs-xs);
  color: var(--c-warning);
}

.btn {
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-surface);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition:
    background var(--transition),
    border-color var(--transition);
}
.btn:hover:not(:disabled) {
  background: var(--c-surface-hover);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary {
  flex: 1 1 auto;
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: var(--c-text-inverse);
}
.btn--primary:hover:not(:disabled) {
  background: var(--c-accent-hover);
  border-color: var(--c-accent-hover);
}

.btn--warn {
  align-self: flex-start;
  border-color: var(--c-warning);
  color: var(--c-warning);
  background: var(--c-surface);
}

.summary {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.error {
  color: var(--c-danger);
}

.error-detail {
  font-size: var(--fs-xs);
  color: var(--c-danger);
  background: var(--c-danger-bg);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
}

.error-hint {
  display: block;
  margin-top: var(--sp-1);
  opacity: 0.9;
}
</style>
