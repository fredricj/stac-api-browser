/**
 * Credentials for protected asset hosts.
 *
 * The rules here come from §3.5 and are deliberately strict, because this is
 * the one place the app handles something that is genuinely the user's to
 * lose:
 *
 * - **In memory by default.** Nothing is written anywhere unless the user
 *   ticks *remember for this tab*, and even then only to `sessionStorage`,
 *   which dies with the tab.
 * - **Never `localStorage`, never the URL.** `localStorage` outlives the
 *   session and is shared across tabs; a URL is shared by definition, gets
 *   pasted into chats and lands in browser history and server logs.
 * - **Scoped per asset host**, not per catalog — assets live on a different
 *   origin from the catalog on every built-in entry.
 *
 * Nothing in here logs. A credential store that writes to the console is one
 * screen-share away from disclosing a password.
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { basicAuthHeader, type BasicCredentials } from '@/services/auth'

const STORAGE_KEY = 'stac-browser:credentials'

/** Where a host's credentials live. */
export type CredentialScope =
  /** This page load only. Gone on refresh. The default. */
  | 'memory'
  /** This tab only, surviving a refresh. Opt-in, and clearly labelled. */
  | 'session'

interface StoredEntry extends BasicCredentials {
  scope: CredentialScope
}

/* ------------------------------------------------------------------ *
 * Persistence — session only, and never fatal
 * ------------------------------------------------------------------ */

function loadSession(): Map<string, StoredEntry> {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return new Map() // Private mode, or storage disabled.
  }
  if (!raw) return new Map()

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return new Map()

    const entries = new Map<string, StoredEntry>()
    for (const [host, value] of Object.entries(parsed)) {
      const entry = value as Partial<StoredEntry>
      if (
        typeof entry?.username === 'string' &&
        typeof entry?.password === 'string'
      ) {
        entries.set(host, {
          username: entry.username,
          password: entry.password,
          scope: 'session',
        })
      }
    }
    return entries
  } catch {
    return new Map()
  }
}

/** Write only the entries the user asked to be remembered. */
function persistSession(entries: Map<string, StoredEntry>): void {
  const remembered = [...entries].filter(
    ([, entry]) => entry.scope === 'session',
  )

  try {
    if (remembered.length === 0) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        Object.fromEntries(
          remembered.map(([host, entry]) => [
            host,
            { username: entry.username, password: entry.password },
          ]),
        ),
      ),
    )
  } catch {
    // Out of quota or storage disabled. The credentials still work for this
    // page load; only surviving a refresh is lost.
  }
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export const useAuthStore = defineStore('auth', () => {
  /** Keyed by asset host, e.g. `dl1.lantmateriet.se`. */
  const entries = ref<Map<string, StoredEntry>>(loadSession())

  /** Hosts we currently hold credentials for. Never the credentials. */
  const hosts = computed(() => [...entries.value.keys()])

  function has(host: string | null | undefined): boolean {
    return host ? entries.value.has(host) : false
  }

  function get(host: string | null | undefined): BasicCredentials | null {
    if (!host) return null
    const entry = entries.value.get(host)
    return entry ? { username: entry.username, password: entry.password } : null
  }

  /** The username alone, so the UI can say who is signed in. */
  function usernameFor(host: string | null | undefined): string | null {
    return host ? (entries.value.get(host)?.username ?? null) : null
  }

  function scopeFor(host: string | null | undefined): CredentialScope | null {
    return host ? (entries.value.get(host)?.scope ?? null) : null
  }

  /**
   * The `Authorization` header value for a host, or null.
   *
   * Built on demand rather than stored, so an encoded copy of the password is
   * not lying around in reactive state waiting to be serialised by a devtools
   * snapshot or an error reporter.
   */
  function authorizationFor(host: string | null | undefined): string | null {
    const credentials = get(host)
    return credentials ? basicAuthHeader(credentials) : null
  }

  function set(
    host: string,
    credentials: BasicCredentials,
    scope: CredentialScope = 'memory',
  ): void {
    const next = new Map(entries.value)
    next.set(host, { ...credentials, scope })
    entries.value = next
    persistSession(next)
  }

  function clear(host: string): void {
    const next = new Map(entries.value)
    next.delete(host)
    entries.value = next
    persistSession(next)
  }

  /** Sign out everywhere, including anything remembered for the tab. */
  function clearAll(): void {
    entries.value = new Map()
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // Nothing to clean up if storage was never available.
    }
  }

  return {
    entries,
    hosts,
    has,
    get,
    usernameFor,
    scopeFor,
    authorizationFor,
    set,
    clear,
    clearAll,
  }
})
