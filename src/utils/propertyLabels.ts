/**
 * Human labels for the Swedish property names in Lantmäteriet's catalogs.
 *
 * The data is Swedish and the property names come straight off the wire —
 * `flygar`, `flyghojd`, `upplosning`, `spektraltyp`. The UI is not Swedish
 * only, so English readers get a translation and Swedish readers get the
 * spelling the schema itself gets wrong (`uppösning` in `stac-bild`'s
 * queryables, for one).
 *
 * Deliberately a lookup, not a rule: there is no way to derive "flight
 * altitude" from `flyghojd`, and a catalog we know nothing about should fall
 * back to its own schema title rather than to a mangled guess.
 */

export interface PropertyLabel {
  en: string
  sv: string
}

export const PROPERTY_LABELS: Record<string, PropertyLabel> = {
  /* stac-bild */
  flygar: { en: 'Flight year', sv: 'Flygår' },
  flyghojd: { en: 'Flight altitude (m)', sv: 'Flyghöjd (m)' },
  upplosning: { en: 'Resolution (m/pixel)', sv: 'Upplösning (m/pixel)' },
  spektraltyp: { en: 'Spectral type', sv: 'Spektraltyp' },

  /* stac-hojd */
  skanningsomrade: { en: 'Scanning area', sv: 'Skanningsområde' },
  andringsdatum: { en: 'Changed', sv: 'Ändringsdatum' },
  data_modified: { en: 'Data modified', sv: 'Data ändrad' },

  /* stac-vektor */
  lanskod: { en: 'County code', sv: 'Länskod' },

  /* Common STAC fields worth naming */
  datetime: { en: 'Acquired', sv: 'Insamlad' },
  created: { en: 'Published', sv: 'Publicerad' },
  updated: { en: 'Updated', sv: 'Uppdaterad' },
  gsd: { en: 'Ground sample distance (m)', sv: 'Upplösning på marken (m)' },
  'proj:code': { en: 'Projection', sv: 'Projektion' },
  'proj:bbox': {
    en: 'Extent (native CRS)',
    sv: 'Utbredning (eget koordinatsystem)',
  },
}

/**
 * The label for a property, or null when we have none — callers fall back to
 * the schema's own title, which is better than inventing one.
 */
export function labelForProperty(name: string, locale: string): string | null {
  const entry = PROPERTY_LABELS[name]
  if (!entry) return null
  return locale.toLowerCase().startsWith('sv') ? entry.sv : entry.en
}
