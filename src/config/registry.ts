import type { StacApiEntry } from '@/types/registry'

/**
 * The catalogs shipped with the app.
 *
 * All three are Lantmäteriet's, all three are STAC 1.0.0 with item-search and
 * CQL2, and all three serve their assets from `dl1.lantmateriet.se` behind
 * HTTP Basic. Browsing needs no credentials; only the `data` assets do.
 *
 * Everything here is static: the catalog list makes no network requests, so
 * nothing on it can go stale mid-session or fail when offline.
 */
export const BUILTIN_APIS: StacApiEntry[] = [
  {
    id: 'lantmateriet-bild',
    title: 'Lantmäteriet — Ortofoto',
    descriptionKey: 'catalogs.bild',
    url: 'https://api.lantmateriet.se/stac-bild/v1/',
    assetHost: 'dl1.lantmateriet.se',
    auth: 'basic',
    // SWEREF99 TM — the national grid the tiles are cut on.
    defaultCrs: 'EPSG:3006',
    license: 'CC BY 4.0',
    docsUrl:
      'https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/ortofoto-nedladdning/',
  },
  {
    id: 'lantmateriet-hojd',
    title: 'Lantmäteriet — Höjddata',
    descriptionKey: 'catalogs.hojd',
    url: 'https://api.lantmateriet.se/stac-hojd/v1/',
    assetHost: 'dl1.lantmateriet.se',
    auth: 'basic',
    // SWEREF99 TM + RH2000 heights.
    defaultCrs: 'EPSG:3006',
    license: 'CC BY 4.0',
    docsUrl:
      'https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/markhojdmodell-nedladdning/',
  },
  {
    id: 'lantmateriet-vektor',
    title: 'Lantmäteriet — Vektordata',
    descriptionKey: 'catalogs.vektor',
    url: 'https://api.lantmateriet.se/stac-vektor/v1/',
    assetHost: 'dl1.lantmateriet.se',
    auth: 'basic',
    defaultCrs: 'EPSG:3006',
    license: 'CC BY 4.0',
    docsUrl:
      'https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/',
  },
]

export function findBuiltin(id: string): StacApiEntry | undefined {
  return BUILTIN_APIS.find((entry) => entry.id === id)
}
