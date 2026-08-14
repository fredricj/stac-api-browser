<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ apiId: string }>()

const { t } = useI18n()
</script>

<template>
  <div class="browser">
    <RouterLink class="back" :to="{ name: 'home' }">
      &larr; {{ t('nav.backToCatalogs') }}
    </RouterLink>

    <h1>{{ t('browser.heading', { name: apiId }) }}</h1>

    <!-- Phase 3 replaces this with <StacMap>, Phase 4 with the search panel
         and Phase 5 with the results list and selection basket. -->
    <div class="layout">
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

@media (max-width: 52rem) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
