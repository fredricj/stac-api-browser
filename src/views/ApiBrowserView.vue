<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRegistryStore } from '@/stores/registryStore'

const props = defineProps<{ apiId: string }>()

const { t } = useI18n()
const registry = useRegistryStore()

const entry = computed(() => registry.byId(props.apiId))
</script>

<template>
  <div class="browser">
    <RouterLink class="back" :to="{ name: 'home' }">
      &larr; {{ t('nav.backToCatalogs') }}
    </RouterLink>

    <h1>{{ t('browser.heading', { name: entry?.title ?? apiId }) }}</h1>

    <!-- An id that is not in the registry: a stale bookmark, or a custom
         catalog removed on another device. -->
    <p v-if="!entry" class="not-found">
      {{ t('browser.notFound', { id: apiId }) }}
      <span class="hint">{{ t('browser.notFoundHint') }}</span>
    </p>

    <!-- Phase 3 replaces this with <StacMap>, Phase 4 with the search panel
         and Phase 5 with the results list and selection basket. -->
    <div v-else class="layout">
      <aside class="panel" aria-label="Search">
        <p class="stub">{{ t('common.comingSoon') }}</p>
      </aside>
      <div class="map-slot">
        <p class="stub">{{ t('common.comingSoon') }}</p>
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
  min-height: 24rem;
}

.panel,
.map-slot {
  display: grid;
  place-items: center;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
}

.stub {
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
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
