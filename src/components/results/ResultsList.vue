<script setup lang="ts">
/**
 * The result set, as a list.
 *
 * The map is not the only way to work here: every item is reachable,
 * inspectable and selectable from this list with the keyboard alone, and
 * hover is mirrored both ways so pointing at a row highlights its footprint
 * and vice versa.
 *
 * Virtualised, because a bounded run of *Load more* reaches several thousand
 * rows and each one carries a thumbnail.
 */
import { computed, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { StacItem } from '@/types/stac'
import { itemKey } from '@/types/stac'
import { formatCount } from '@/utils/format'
import ResultItemRow from '@/components/results/ResultItemRow.vue'

const props = defineProps<{
  items: StacItem[]
  selectedKeys: Set<string>
  hoveredKey: string | null
  loading?: boolean
  loadingMore?: boolean
  hasSearched?: boolean
  /** No `next` link remains: what is loaded really is everything. */
  complete?: boolean
  hasMore?: boolean
  /** More exists, but only a narrower search will reach it. */
  hitPageCap?: boolean
}>()

const emit = defineEmits<{
  toggle: [key: string]
  hover: [key: string | null]
  open: [item: StacItem]
  loadMore: []
}>()

const { t, locale } = useI18n()

const scroller = useTemplateRef<HTMLElement>('scroller')

const ROW_HEIGHT = 68
/** Enough to fill a typical panel height without over-promising a page size. */
const SKELETON_ROWS = 6

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.items.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    getItemKey: (index: number) => {
      const item = props.items[index]
      return item ? itemKey(item) : index
    },
  })),
)

const virtualRows = computed(() =>
  virtualizer.value
    .getVirtualItems()
    .map((row) => ({ start: row.start, item: props.items[row.index] }))
    .filter((entry) => entry.item !== undefined),
)

const totalHeight = computed(() => virtualizer.value.getTotalSize())

/**
 * Scroll a row into view when the map highlights it.
 *
 * Without this, hovering a footprint highlights a row thousands of pixels
 * below the fold, which reads as nothing happening at all.
 */
watch(
  () => props.hoveredKey,
  (key) => {
    if (!key) return
    const index = props.items.findIndex((item) => itemKey(item) === key)
    if (index >= 0) {
      virtualizer.value.scrollToIndex(index, {
        align: 'auto',
        behavior: 'auto',
      })
    }
  },
)

const countLabel = computed(() => {
  if (!props.hasSearched) return t('search.results.notYet')
  const count = formatCount(props.items.length, locale.value)
  return props.complete
    ? t('search.results.completeCount', { count })
    : t('search.results.loadedCount', { count })
})
</script>

<template>
  <section class="results" :aria-label="t('results.label')">
    <header class="head">
      <!-- Announced politely: the count changes as pages load, and should not
           interrupt whatever the user is doing. -->
      <p class="count" role="status" aria-live="polite">{{ countLabel }}</p>
      <slot name="actions" />
    </header>

    <!-- Nothing on screen yet: a shape of what is coming reads faster than a
         line of text over an empty box. Once there are stale results to keep
         showing while a new search runs, that text is enough — replacing
         real rows with placeholders mid-search would just cause a flicker. -->
    <template v-if="loading && items.length === 0">
      <p class="sr-only" role="status" aria-live="polite">
        {{ t('common.loading') }}
      </p>
      <ul class="skeleton-rows" aria-hidden="true">
        <li v-for="n in SKELETON_ROWS" :key="n" class="skeleton-row">
          <span class="skeleton skeleton-thumb"></span>
          <span class="skeleton-lines">
            <span class="skeleton skeleton-line skeleton-line--id"></span>
            <span class="skeleton skeleton-line skeleton-line--meta"></span>
          </span>
        </li>
      </ul>
    </template>
    <p v-else-if="loading" class="state">{{ t('common.loading') }}</p>
    <p v-else-if="hasSearched && items.length === 0" class="state">
      {{ t('results.empty') }}
    </p>

    <div v-show="!loading || items.length > 0" ref="scroller" class="scroller">
      <div class="spacer" :style="{ height: `${totalHeight}px` }">
        <div
          v-for="entry in virtualRows"
          :key="itemKey(entry.item)"
          class="row-holder"
          :style="{ transform: `translateY(${entry.start}px)` }"
        >
          <ResultItemRow
            :item="entry.item"
            :selected="selectedKeys.has(itemKey(entry.item))"
            :hovered="hoveredKey === itemKey(entry.item)"
            @toggle="emit('toggle', itemKey(entry.item))"
            @hover="emit('hover', $event ? itemKey(entry.item) : null)"
            @open="emit('open', entry.item)"
          />
        </div>
      </div>
    </div>

    <footer v-if="hasSearched && items.length" class="foot">
      <button
        v-if="hasMore"
        type="button"
        class="more"
        :disabled="loadingMore"
        @click="emit('loadMore')"
      >
        {{ loadingMore ? t('common.loading') : t('search.results.loadMore') }}
      </button>

      <!-- The terminal states. These APIs report no total, so saying which of
           the two applies is the only honest way to end the list. -->
      <p v-else-if="complete" class="terminal">
        {{ t('search.results.allLoaded') }}
      </p>
      <p v-else-if="hitPageCap" class="capped">
        {{ t('search.results.pageCap') }}
      </p>
    </footer>
  </section>
</template>

<style scoped>
.results {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  background: var(--c-surface);
  overflow: hidden;
  /* A clipping box must also be a containing block, or absolutely positioned
     descendants resolve against an outer one and escape it entirely. */
  position: relative;
}

.head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface-2);
}

.count {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: auto;
}

.state {
  padding: var(--sp-4);
  font-size: var(--fs-sm);
  color: var(--c-text-faint);
  text-align: center;
}

.scroller {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.skeleton-rows {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  list-style: none;
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 68px;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--c-border);
}

.skeleton-thumb {
  flex: none;
  width: 3.25rem;
  height: 3.25rem;
}

.skeleton-lines {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.skeleton-line {
  height: 0.6rem;
}
.skeleton-line--id {
  width: 55%;
}
.skeleton-line--meta {
  width: 35%;
}

.spacer {
  position: relative;
  width: 100%;
}

/* Absolutely positioned and translated — what lets the virtualiser render a
   handful of rows inside a full-height scroll area. */
.row-holder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

.foot {
  display: flex;
  justify-content: center;
  padding: var(--sp-2);
  border-top: 1px solid var(--c-border);
}

.more {
  padding: var(--sp-1) var(--sp-4);
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

.terminal {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.capped {
  font-size: var(--fs-xs);
  color: var(--c-warning);
}
</style>
