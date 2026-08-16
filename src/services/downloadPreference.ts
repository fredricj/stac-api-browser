/**
 * Which download route the user last chose.
 *
 * A preference, not a secret and not session state: someone who downloads
 * with aria2c every week should not re-pick it every week. So this is the one
 * piece of download state that belongs in `localStorage` — unlike the basket
 * (a session's work) and the credentials (never on disk at all).
 */

export type DownloadTier = 'folder' | 'sequential' | 'manifest'

const STORAGE_KEY = 'stac-browser:download-tier'

const TIERS: readonly DownloadTier[] = ['folder', 'sequential', 'manifest']

function isTier(value: unknown): value is DownloadTier {
  return typeof value === 'string' && TIERS.includes(value as DownloadTier)
}

/** The remembered choice, or null when there is none or it is unusable. */
export function loadPreferredTier(): DownloadTier | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isTier(raw) ? raw : null
  } catch {
    // Private mode, or storage disabled. The dialog just uses its default.
    return null
  }
}

export function savePreferredTier(tier: DownloadTier): void {
  try {
    localStorage.setItem(STORAGE_KEY, tier)
  } catch {
    // Out of quota or storage disabled; the choice still stands this session.
  }
}

export interface InitialTierInput {
  /** What the user picked last time, if anything. */
  remembered: DownloadTier | null
  /** False in Firefox and Safari, where there is no directory handle. */
  canStreamToFolder: boolean
  /** True once the selection is past the point a browser handles it well. */
  oversized: boolean
}

/**
 * Which route the dialog should open on.
 *
 * A remembered choice wins, because it was deliberate — including over the
 * size recommendation, which keeps its banner either way. Silently overriding
 * someone's explicit preference and hoping they notice the radio moved is
 * worse than advising them and letting them decide.
 *
 * The one exception is a choice this browser cannot honour: `folder` needs a
 * directory handle Firefox and Safari do not have, so it falls back rather
 * than opening on an option that is disabled.
 */
export function resolveInitialTier(input: InitialTierInput): DownloadTier {
  const { remembered, canStreamToFolder, oversized } = input

  if (remembered && (remembered !== 'folder' || canStreamToFolder)) {
    return remembered
  }

  // No usable preference yet: steer by what actually fits the job.
  if (!canStreamToFolder) return 'manifest'
  return oversized ? 'manifest' : 'folder'
}
