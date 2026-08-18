/**
 * How many items one search page asks for.
 *
 * A preference, not a search input: unlike bbox, collections or dates, it
 * does not describe what a search is looking for, only how it is fetched —
 * so unlike those, it does not reset when the catalog changes, and like the
 * download tier choice, it belongs in `localStorage` rather than the store's
 * per-catalog state.
 */

/**
 * A fixed set rather than a free-form number: an unbounded input invites a
 * value large enough to be a poor citizen of a public API, or one the STAC
 * server itself rejects. Large enough to fill the map, small enough to feel
 * quick is the same rationale the original hardcoded 250 had.
 */
export const PAGE_LIMIT_OPTIONS = [50, 100, 250, 500, 1000] as const

export type PageLimit = (typeof PAGE_LIMIT_OPTIONS)[number]

export const DEFAULT_PAGE_LIMIT: PageLimit = 250

const STORAGE_KEY = 'stac-browser:page-limit'

function isPageLimit(value: unknown): value is PageLimit {
  return (
    typeof value === 'number' &&
    (PAGE_LIMIT_OPTIONS as readonly number[]).includes(value)
  )
}

/** The remembered choice, or null when there is none or it is unusable. */
export function loadPageLimit(): PageLimit | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = Number(raw)
    return isPageLimit(parsed) ? parsed : null
  } catch {
    // Private mode, or storage disabled. The default just applies.
    return null
  }
}

export function savePageLimit(limit: PageLimit): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(limit))
  } catch {
    // Out of quota or storage disabled; the choice still stands this session.
  }
}
