<script setup lang="ts">
/**
 * One catalog's browse page: search panel on the left, map on the right.
 *
 * The view owns the wiring between the two — the store holds the search, the
 * map holds the camera, and this decides when one should move the other.
 * Selection is still local; the basket store arrives with the results list in
 * the next phase.
 */
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRegistryStore } from '@/stores/registryStore'
import { useSearchStore } from '@/stores/searchStore'
import { useUrlState, type MapView } from '@/composables/useUrlState'
import type { BBox2D } from '@/types/stac'
import StacMap from '@/components/map/StacMap.vue'
import SearchPanel from '@/components/search/SearchPanel.vue'

const props = defineProps<{ apiId: string }>()

const { t, n } = useI18n()
const registry = useRegistryStore()
const store = useSearchStore()

const entry = computed(() => registry.byId(props.apiId))
const mapRef = useTemplateRef<InstanceType<typeof StacMap>>('map')

const selectedKeys = ref<Set<string>>(new Set())
const hoveredKey = ref<string | null>(null)

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

function toggle(key: string) {
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
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
          :selected-keys="selectedKeys"
          :hovered-key="hoveredKey"
          :bbox="store.bbox"
          :busy="store.loading"
          :initial-view="initialView"
          @toggle="toggle"
          @hover="hoveredKey = $event"
          @update:bbox="store.setBbox($event)"
          @search-area="onSearchArea"
          @view-change="view = $event"
        />

        <footer class="map-foot">
          <span class="count">
            {{ t('map.selectedCount', { count: selectedKeys.size }) }}
          </span>

          <!-- Never "page 3 of 57": these APIs report no total, so the only
               honest statement is what is loaded and whether more remain. -->
          <span v-if="store.hasSearched" class="loaded">
            {{
              t('search.results.loadedCount', { count: n(store.items.length) })
            }}
            <template v-if="store.isComplete">
              · {{ t('search.results.allLoaded') }}
            </template>
          </span>

          <button
            v-if="store.hasMore"
            type="button"
            class="more"
            :disabled="store.loadingMore"
            @click="store.loadMore()"
          >
            {{
              store.loadingMore
                ? t('common.loading')
                : t('search.results.loadMore')
            }}
          </button>

          <span v-else-if="store.hitPageCap" class="capped">
            {{ t('search.results.pageCap') }}
          </span>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.browser {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  flex: 1 1 auto;
  min-height: 0;
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

.layout {
  display: grid;
  grid-template-columns: var(--sidebar-w) 1fr;
  gap: var(--sp-4);
  flex: 1 1 auto;
  min-height: 32rem;
}

.map-column {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
  min-height: 0;
}

.map-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.count {
  color: var(--c-text);
}

.loaded {
  font-variant-numeric: tabular-nums;
}

.more {
  padding: var(--sp-1) var(--sp-3);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-surface);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.more:hover:not(:disabled) {
  background: var(--c-surface-hover);
}
.more:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.capped {
  font-size: var(--fs-xs);
  color: var(--c-warning);
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

@media (max-width: 52rem) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
