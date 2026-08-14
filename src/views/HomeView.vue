<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// Placeholder until Phase 2 introduces config/registry.ts and registryStore.
// The IDs match the registry entries planned for the three Lantmäteriet
// catalogs, so the routes below are already the real ones.
const placeholderApis = [
  { id: 'lantmateriet-bild', name: 'Lantmäteriet — Ortofoto' },
  { id: 'lantmateriet-hojd', name: 'Lantmäteriet — Höjddata' },
  { id: 'lantmateriet-vektor', name: 'Lantmäteriet — Vektordata' },
]
</script>

<template>
  <div class="home">
    <header class="home-head">
      <h1>{{ t('home.heading') }}</h1>
      <p class="intro">{{ t('home.intro') }}</p>
    </header>

    <ul class="api-grid">
      <li v-for="api in placeholderApis" :key="api.id">
        <RouterLink
          class="api-card"
          :to="{ name: 'api-browser', params: { apiId: api.id } }"
        >
          <h2 class="api-name">{{ api.name }}</h2>
          <p class="api-status">{{ t('common.comingSoon') }}</p>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.home {
  width: 100%;
  max-width: var(--content-max);
  margin-inline: auto;
  padding: var(--sp-7) var(--sp-4);
}

.home-head {
  margin-bottom: var(--sp-6);
}

.intro {
  margin-top: var(--sp-3);
  max-width: 46rem;
  color: var(--c-text-muted);
  font-size: var(--fs-lg);
}

.api-grid {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
  gap: var(--sp-4);
}

.api-card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  height: 100%;
  padding: var(--sp-5);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  color: var(--c-text);
  transition:
    border-color var(--transition),
    box-shadow var(--transition),
    transform var(--transition);
}
.api-card:hover {
  text-decoration: none;
  border-color: var(--c-accent-border);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.api-name {
  font-size: var(--fs-lg);
  font-weight: 600;
}

.api-status {
  color: var(--c-text-faint);
  font-size: var(--fs-sm);
}
</style>
