/**
 * The catalog registry: which STAC APIs the app offers, and what we have
 * learned about each one at runtime.
 */

/** How downloading an asset authenticates. */
export type AuthType = 'none' | 'basic'

export interface StacApiEntry {
  /** Stable, URL-safe — this is the `:apiId` route parameter. */
  id: string
  title: string
  /**
   * i18n message key for the description. Built-ins use this so the copy is
   * translated; custom entries carry a literal `description` instead.
   */
  descriptionKey?: string
  description?: string
  /** STAC API landing page. */
  url: string
  /**
   * Host serving the assets, when it differs from the API host. Credentials
   * are scoped to this, not to `url` — Lantmäteriet serves data from
   * `dl1.lantmateriet.se` while the catalog lives on `api.lantmateriet.se`.
   */
  assetHost?: string
  auth: AuthType
  /** Projection to offer first in the coordinate box, e.g. `EPSG:3006`. */
  defaultCrs?: string
  license?: string
  /** Where a user goes to request access or read the product docs. */
  docsUrl?: string
  /**
   * How the collection filter groups this catalog's collections.
   *
   * `'year'` (the default) groups by acquisition year — right for a catalog
   * like stac-bild, where 731 collections are the same kind of thing
   * repeated per place and year, and "newest first" is the useful axis.
   * `'product'` instead groups by the collection's title with its trailing
   * per-tile suffix stripped (`groupCollectionsByProduct` in
   * `utils/collectionGroups.ts`) — right for a catalog like stac-hojd, where
   * a handful of distinct products (each split into many same-named tiles)
   * is the more useful way to slice the list, and there is no meaningful
   * "newest" to sort by.
   */
  collectionGrouping?: 'year' | 'product'
  /** User-added entries are removable; built-ins are not. */
  custom?: boolean
  addedAt?: string
}

export type ProbeState = 'online' | 'unreachable'

/**
 * What a landing-page probe told us about a URL.
 *
 * Only produced by the add-catalog dialog, in response to an explicit "Check
 * catalog" click. The catalog list itself is static and never probes, so
 * there is no pending or unknown state to model here.
 */
export interface ApiProbe {
  state: ProbeState
  /** Title and description as the API reports them right now. */
  title?: string
  description?: string
  /** False when the landing page does not advertise the item-search class. */
  supportsItemSearch?: boolean
  /** Human-readable reason the probe failed. */
  error?: string
  /** True when the failure looked like CORS rather than a bad URL. */
  likelyCors?: boolean
  checkedAt?: number
}
