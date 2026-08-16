<script setup lang="ts">
/**
 * One catalog's browse page: search on the left, map and results on the right.
 *
 * The view owns the wiring between the three — the search store holds the
 * query, the selection store holds the basket, the map holds the camera — and
 * decides when one should move another. Hover is mirrored between the map and
 * the results list in both directions, so the two always agree about which
 * item is under attention.
 */
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRegistryStore } from '@/stores/registryStore'
import { useSearchStore } from '@/stores/searchStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useUrlState, type MapView } from '@/composables/useUrlState'
import type { BBox2D, StacItem } from '@/types/stac'
import StacMap from '@/components/map/StacMap.vue'
import SearchPanel from '@/components/search/SearchPanel.vue'
import ResultsList from '@/components/results/ResultsList.vue'
import ItemDetailDrawer from '@/components/results/ItemDetailDrawer.vue'
import SelectionBasket from '@/components/download/SelectionBasket.vue'

const props = defineProps<{ apiId: string }>()

const { t } = useI18n()
const registry = useRegistryStore()
const store = useSearchStore()
const selection = useSelectionStore()

const entry = computed(() => registry.byId(props.apiId))
const mapRef = useTemplateRef<InstanceType<typeof StacMap>>('map')

const hoveredKey = ref<string | null>(null)
const detailItem = ref<StacItem | null>(null)

/** Camera, mirrored into the URL so a shared link reopens the same view. */
const view = ref<MapView | null>(null)

/**
 * Point the store at the catalog and pull down what the panel needs.
 *
 * Collections and queryables are fetched up front — both are needed before
 * the filter controls can render anything, and both are a single request.
 *
 * Ordering matters, and is the reason this sits above `useUrlState`:
 * `configure` clears every search input, so hydrating the URL first meant a
 * shared link had its bbox and filters wiped a moment after they were read,
 * and the query string rewritten empty.
 */
watch(
  entry,
  (next) => {
    store.configure(next ?? null)
    // The basket is per-catalog and restored from this session's storage, so
    // a refresh mid-selection is an inconvenience rather than lost work.
    selection.configure(next?.id ?? null)
    if (!next) return
    void store.loadCollections()
    void store.loadQueryables()
  },
  { immediate: true },
)

const { initialView, hasSearchParams } = useUrlState({ store, view })

// A shared link already describes a search; run it rather than making the
// recipient press a button to see what they were sent. Deferred to mount so
// the map exists and can fit itself to the results.
onMounted(() => {
  if (hasSearchParams && entry.value) runSearch()
})

function runSearch() {
  // Re-arm the auto-fit: an explicit search means the user wants to be taken
  // to the results, even if they had panned away beforehand.
  mapRef.value?.resetAutoFit()
  void store.search()
}

function onSearchArea(bbox: BBox2D) {
  store.setBbox(bbox)
  runSearch()
}

/** A coordinate search moves the map, then searches there. */
function onLocate(bbox: BBox2D) {
  mapRef.value?.fitToBbox(bbox)
  runSearch()
}

/** The map and the list both toggle by key; the store resolves it to an item. */
function toggleKey(key: string) {
  selection.toggleKey(key, store.items)
}
</script>

<template>
  <div class="browser">
    <header class="browser-head">
      <RouterLink class="back" :to="{ name: 'home' }">
        &larr; {{ t('nav.backToCatalogs') }}
      </RouterLink>
      <h1>{{ t('browser.heading', { name: entry?.title ?? apiId }) }}</h1>
    </header>

    <!-- An id that is not in the registry: a stale bookmark, or a custom
         catalog removed on another device. -->
    <p v-if="!entry" class="not-found">
      {{ t('browser.notFound', { id: apiId }) }}
      <span class="hint">{{ t('browser.notFoundHint') }}</span>
    </p>

    <div v-else class="layout">
      <SearchPanel @locate="onLocate" @search="runSearch" />

      <div class="map-column">
        <StacMap
          ref="map"
          :items="store.items"
          :selected-keys="selection.keys"
          :hovered-key="hoveredKey"
          :bbox="store.bbox"
          :busy="store.loading"
          :initial-view="initialView"
          @toggle="toggleKey"
          @hover="hoveredKey = $event"
          @update:bbox="store.setBbox($event)"
          @search-area="onSearchArea"
          @view-change="view = $event"
        />
      </div>

      <div class="results-column">
        <SelectionBasket :items="store.items" :bbox="store.bbox" />

        <ResultsList
          class="results-fill"
          :items="store.items"
          :selected-keys="selection.keys"
          :hovered-key="hoveredKey"
          :loading="store.loading"
          :loading-more="store.loadingMore"
          :has-searched="store.hasSearched"
          :complete="store.isComplete"
          :has-more="store.hasMore"
          :hit-page-cap="store.hitPageCap"
          @toggle="toggleKey"
          @hover="hoveredKey = $event"
          @open="detailItem = $event"
          @load-more="store.loadMore()"
        />
      </div>
    </div>

    <ItemDetailDrawer
      :item="detailItem"
      :selected="
        detailItem
          ? selection.has(`${detailItem.collection}/${detailItem.id}`)
          : false
      "
      @close="detailItem = null"
      @toggle="detailItem && selection.toggle(detailItem)"
    />
  </div>
</template>

<style scoped>
.browser {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  height: calc(100dvh - var(--header-h));
  min-height: 0;
  overflow: hidden;
  padding: var(--sp-5) var(--sp-4);
}

.browser-head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.back {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  align-self: flex-start;
}
.back:hover {
  color: var(--c-accent);
}

/* Search, map, results. The map takes the slack because it is the thing
   worth enlarging on a wide screen; the two panels stay legible-width. */
.layout {
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr) var(--sidebar-w);
  grid-template-rows: minmax(0, 1fr);
  gap: var(--sp-4);
  flex: 1 1 auto;
  min-height: 0;
}

.map-column {
  --map-min-h: 0px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
  min-height: 0;
}

.results-column {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
  min-height: 0;
}

/* The results list owns the leftover height so its own scroller, not the
   page, is what moves. */
.results-fill {
  flex: 1 1 auto;
  min-height: 0;
}

.not-found {
  padding: var(--sp-4);
  border-radius: var(--r-md);
  background: var(--c-danger-bg);
  color: var(--c-danger);
  font-size: var(--fs-sm);
}

.not-found .hint {
  display: block;
  margin-top: var(--sp-1);
  opacity: 0.85;
}

/* Below three columns, drop the results beside the map rather than shrinking
   all three into uselessness. */
@media (max-width: 80rem) {
  .browser {
    height: auto;
    min-height: calc(100dvh - var(--header-h));
    overflow: visible;
  }
  .layout {
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    grid-template-rows: minmax(20rem, 1fr) auto;
  }
  .results-column {
    grid-column: 1 / -1;
  }
  .results-fill {
    height: 30rem;
    flex: 0 0 auto;
  }
}

@media (max-width: 52rem) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(24rem, auto) auto;
  }
  .map-column {
    min-height: 24rem;
  }
}
</style>
