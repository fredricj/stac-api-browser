<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SUPPORTED_LOCALES, persistLocale, type Locale } from '@/i18n'

const { t, locale } = useI18n()

function setLocale(next: Locale) {
  locale.value = next
  persistLocale(next)
}
</script>

<template>
  <header class="app-header">
    <RouterLink class="brand" :to="{ name: 'home' }">
      <svg
        class="brand-mark"
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M3 7.5 9 4.5l6 3 6-3v12l-6 3-6-3-6 3z" />
        <path d="M9 4.5v12M15 7.5v12" />
      </svg>
      <span class="brand-name">{{ t('app.title') }}</span>
    </RouterLink>

    <div class="spacer" />

    <nav class="locale-switch" :aria-label="t('nav.language')">
      <button
        v-for="code in SUPPORTED_LOCALES"
        :key="code"
        type="button"
        class="locale-btn"
        :class="{ 'is-active': locale === code }"
        :aria-current="locale === code ? 'true' : undefined"
        @click="setLocale(code)"
      >
        {{ code.toUpperCase() }}
      </button>
    </nav>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  height: var(--header-h);
  padding-inline: var(--sp-4);
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-border);
  flex: 0 0 auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--c-text);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.brand:hover {
  text-decoration: none;
  color: var(--c-accent);
}

.brand-mark {
  width: 1.5rem;
  height: 1.5rem;
  color: var(--c-accent);
  flex: 0 0 auto;
}

.spacer {
  flex: 1 1 auto;
}

.locale-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--c-surface-2);
  border-radius: var(--r-full);
}

.locale-btn {
  border: 0;
  background: transparent;
  color: var(--c-text-muted);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--r-full);
  cursor: pointer;
  transition:
    background var(--transition),
    color var(--transition);
}
.locale-btn:hover {
  color: var(--c-text);
}
.locale-btn.is-active {
  background: var(--c-surface);
  color: var(--c-text);
  box-shadow: var(--shadow-sm);
}

@media (max-width: 30rem) {
  .brand-name {
    display: none;
  }
}
</style>
