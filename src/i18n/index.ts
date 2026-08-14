import { createI18n } from 'vue-i18n'
import en from '@/locales/en.json'
import sv from '@/locales/sv.json'

export const SUPPORTED_LOCALES = ['en', 'sv'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

const STORAGE_KEY = 'stac-browser:locale'

function isLocale(value: string | null): value is Locale {
  return (
    value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value)
  )
}

function resolveInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (isLocale(stored)) return stored
  // The data is Swedish; default Swedish browsers to Swedish, everyone else
  // to English.
  return navigator.language.toLowerCase().startsWith('sv') ? 'sv' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveInitialLocale(),
  fallbackLocale: 'en',
  messages: { en, sv },
})

/** Persist the choice and keep `<html lang>` in sync for assistive tech. */
export function persistLocale(next: Locale) {
  localStorage.setItem(STORAGE_KEY, next)
  document.documentElement.lang = next
}

// Apply the initial choice to the document on load.
document.documentElement.lang = i18n.global.locale.value

export default i18n
