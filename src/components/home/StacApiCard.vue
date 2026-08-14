<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StacApiEntry } from '@/types/registry'

const props = defineProps<{
  entry: StacApiEntry
}>()

const emit = defineEmits<{ remove: [id: string] }>()

const { t, te } = useI18n()

/**
 * Built-ins carry a translation key; custom entries carry literal text,
 * captured once when the catalog was added.
 */
const description = computed(() => {
  const key = props.entry.descriptionKey
  if (key && te(key)) return t(key)
  return props.entry.description ?? ''
})

const host = computed(() => {
  try {
    return new URL(props.entry.url).host
  } catch {
    return props.entry.url
  }
})

function confirmRemove() {
  if (window.confirm(t('card.removeConfirm', { title: props.entry.title }))) {
    emit('remove', props.entry.id)
  }
}
</script>

<template>
  <article class="card">
    <RouterLink
      class="card-main"
      :to="{ name: 'api-browser', params: { apiId: entry.id } }"
    >
      <header class="card-head">
        <h3 class="card-title">{{ entry.title }}</h3>
      </header>

      <p v-if="description" class="card-desc">{{ description }}</p>

      <ul class="facts">
        <li>
          {{
            entry.auth === 'basic' ? t('card.authBasic') : t('card.authNone')
          }}
        </li>
        <li v-if="entry.license">{{ entry.license }}</li>
      </ul>
    </RouterLink>

    <footer class="card-foot">
      <span class="host" :title="entry.url">{{ host }}</span>
      <a
        v-if="entry.docsUrl"
        class="foot-link"
        :href="entry.docsUrl"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ t('card.docs') }}
      </a>
      <button
        v-if="entry.custom"
        type="button"
        class="foot-link foot-link--danger"
        @click="confirmRemove"
      >
        {{ t('card.remove') }}
      </button>
    </footer>
  </article>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  transition:
    border-color var(--transition),
    box-shadow var(--transition);
}
.card:hover {
  border-color: var(--c-accent-border);
  box-shadow: var(--shadow-md);
}

.card-main {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  flex: 1 1 auto;
  padding: var(--sp-5) var(--sp-5) var(--sp-4);
  color: var(--c-text);
}
.card-main:hover {
  text-decoration: none;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}

.card-title {
  font-size: var(--fs-lg);
  font-weight: 600;
}

.card-desc {
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}

.facts {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: auto;
  padding-top: var(--sp-2);
}

.facts li {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
  background: var(--c-surface-2);
  border-radius: var(--r-full);
  padding: var(--sp-1) var(--sp-3);
}

.card-foot {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-5);
  border-top: 1px solid var(--c-border);
  font-size: var(--fs-xs);
}

.host {
  color: var(--c-text-faint);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: auto;
}

.foot-link {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  color: var(--c-accent);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
.foot-link:hover {
  text-decoration: underline;
}
.foot-link--danger {
  color: var(--c-danger);
}
</style>
