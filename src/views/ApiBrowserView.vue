<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRegistryStore } from '@/stores/registryStore'
import StacMap from '@/components/map/StacMap.vue'
import type { StacItem } from '@/types/stac'
import searchFixture from '@/services/__fixtures__/search-get-page1.json'

const props = defineProps<{ apiId: string }>()

const { t } = useI18n()
const registry = useRegistryStore()

const entry = computed(() => registry.byId(props.apiId))

// Cast through unknown: the JSON import widens tuples like `bbox` to number[].
const items = computed(
  () => (searchFixture as unknown as { features: StacItem[] }).features,
)

const selectedKeys = ref<Set<string>>(new Set())
const hoveredKey = ref<string | null>(null)

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
      <aside class="panel" aria-label="Search">
        <p class="notice">{{ t('map.fixtureNotice') }}</p>
        <p class="count">
          {{ t('map.selectedCount', { count: selectedKeys.size }) }}
        </p>
      </aside>

      <StacMap
        :items="items"
        :selected-keys="selectedKeys"
        :hovered-key="hoveredKey"
        @toggle="toggle"
        @hover="hoveredKey = $event"
      />
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
  min-height: 28rem;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
}

.notice {
  font-size: var(--fs-xs);
  color: var(--c-warning);
  background: var(--c-warning-bg);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
}

.count {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
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
