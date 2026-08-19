/**
 * Light, dark, or the browser's own preference.
 *
 * Applied as a `data-theme` attribute on `<html>`, which `tokens.css` keys
 * its overrides off — see that file. A preference, not a secret, so it is
 * remembered in `localStorage` the same way the locale, download-tier and
 * page-limit choices are.
 */

import { ref } from 'vue'

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

const STORAGE_KEY = 'stac-browser:theme'

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value)
}

/** The remembered choice, or "system" when there is none or it is unusable. */
export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : 'system'
  } catch {
    return 'system' // Private mode, or storage disabled.
  }
}

/** "system" clears the attribute, leaving `prefers-color-scheme` in charge. */
function applyToDocument(next: Theme): void {
  if (next === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', next)
}

export const theme = ref<Theme>(loadTheme())

/**
 * Applies the choice to the document synchronously, rather than through a
 * `watch` on `theme` — a watcher's callback runs on the next microtask, and
 * this is the one place `theme` ever changes, so there is nothing a watcher
 * would add except a delay between the click and the repaint.
 */
export function setTheme(next: Theme): void {
  theme.value = next
  applyToDocument(next)
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Out of quota or storage disabled; the choice still stands this session.
  }
}

// Applied once at import time, before Vue mounts, so the right theme is
// already on screen at first paint rather than flashing from light to dark.
applyToDocument(theme.value)
