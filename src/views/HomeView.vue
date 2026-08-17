<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRegistryStore } from '@/stores/registryStore'
import { useToastStore } from '@/stores/toastStore'
import type { StacApiEntry } from '@/types/registry'
import StacApiCard from '@/components/home/StacApiCard.vue'
import AddCustomApiDialog from '@/components/home/AddCustomApiDialog.vue'

const { t } = useI18n()
const registry = useRegistryStore()
const toast = useToastStore()
const addDialog =
  useTemplateRef<InstanceType<typeof AddCustomApiDialog>>('addDialog')

// The catalog list is static: everything shown here comes from config or from
// what was captured when a custom catalog was added. Nothing is fetched, so
// the page renders instantly and works offline.
const builtIns = computed(() => registry.entries.filter((e) => !e.custom))
const customs = computed(() => registry.entries.filter((e) => e.custom))

function onAdded(entry: StacApiEntry) {
  toast.push(t('addDialog.addedToast', { title: entry.title }), 'success')
}
</script>

<template>
  <div class="home">
    <header class="home-head">
      <h1>{{ t('home.heading') }}</h1>
      <p class="intro">{{ t('home.intro') }}</p>
      <div class="head-actions">
        <button
          type="button"
          class="btn btn--primary"
          @click="addDialog?.open()"
        >
          {{ t('home.addCustom') }}
        </button>
      </div>
    </header>

    <section aria-labelledby="builtin-heading">
      <h2 id="builtin-heading" class="section-heading">
        {{ t('home.builtIn') }}
      </h2>
      <ul class="api-grid">
        <li v-for="entry in builtIns" :key="entry.id">
          <StacApiCard :entry="entry" />
        </li>
      </ul>
    </section>

    <section v-if="customs.length" aria-labelledby="custom-heading">
      <h2 id="custom-heading" class="section-heading">
        {{ t('home.yourCatalogs') }}
      </h2>
      <ul class="api-grid">
        <li v-for="entry in customs" :key="entry.id">
          <StacApiCard :entry="entry" @remove="registry.removeCustomEntry" />
        </li>
      </ul>
    </section>

    <AddCustomApiDialog ref="addDialog" @added="onAdded" />
  </div>
</template>

<style scoped>
.home {
  width: 100%;
  max-width: var(--content-max);
  margin-inline: auto;
  padding: var(--sp-7) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}

.home-head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.intro {
  max-width: 46rem;
  color: var(--c-text-muted);
  font-size: var(--fs-lg);
}

.head-actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}

.section-heading {
  font-size: var(--fs-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-text-faint);
  margin-bottom: var(--sp-3);
}

.api-grid {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
  gap: var(--sp-4);
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
.btn:hover {
  background: var(--c-surface-hover);
}

.btn--primary {
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: var(--c-text-inverse);
}
.btn--primary:hover {
  background: var(--c-accent-hover);
  border-color: var(--c-accent-hover);
}
</style>
