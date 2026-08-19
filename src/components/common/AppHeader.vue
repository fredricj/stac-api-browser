<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SUPPORTED_LOCALES, persistLocale, type Locale } from '@/i18n'
import { THEMES, theme, setTheme } from '@/theme'

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

    <nav class="theme-switch" :aria-label="t('nav.theme')">
      <button
        v-for="option in THEMES"
        :key="option"
        type="button"
        class="theme-btn"
        :class="{ 'is-active': theme === option }"
        :aria-current="theme === option ? 'true' : undefined"
        :aria-label="t(`theme.${option}`)"
        :title="t(`theme.${option}`)"
        @click="setTheme(option)"
      >
        <svg
          v-if="option === 'light'"
          class="theme-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" />
        </svg>
        <svg
          v-else-if="option === 'dark'"
          class="theme-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <!-- "system": a half-filled disc, rather than a third glyph unrelated
             to the other two — it reads as "either of the above". -->
        <svg
          v-else
          class="theme-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
          stroke="currentColor"
          stroke-width="2"
          fill="none"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path
            d="M12 3.5a8.5 8.5 0 0 1 0 17z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      </button>
    </nav>

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

.theme-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--c-surface-2);
  border-radius: var(--r-full);
}

.theme-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--c-text-muted);
  padding: var(--sp-1);
  border-radius: var(--r-full);
  cursor: pointer;
  transition:
    background var(--transition),
    color var(--transition);
}
.theme-btn:hover {
  color: var(--c-text);
}
.theme-btn.is-active {
  background: var(--c-surface);
  color: var(--c-accent);
  box-shadow: var(--shadow-sm);
}

.theme-icon {
  width: 1rem;
  height: 1rem;
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
