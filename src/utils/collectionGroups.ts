/**
 * Turning a flat list of collections into something a person can navigate.
 *
 * `stac-bild` publishes 731 collections named `orto-<region>-<year>`. An
 * alphabetical list of those is unusable — nobody looks for imagery by the
 * first letter of a municipality. Almost every real question is "what covers
 * this place, and how recently", so the list groups by year, newest first,
 * and searches across id, title, keywords and the region parsed out of the
 * id.
 *
 * `stac-hojd` is a different shape entirely: 78 collections that are really
 * just two *products* — one split into many identically-structured tiles,
 * each with its own multi-year acquisition window, so "year" groups them
 * almost at random. `groupCollectionsByProduct` handles that case, grouping
 * by the collection's title with its per-tile suffix stripped instead. Which
 * one applies is a per-catalog choice — see `StacApiEntry.collectionGrouping`.
 */

import type { StacCollection } from '@/types/stac'

export interface CollectionOption {
  id: string
  title: string
  /** Acquisition year, or null when neither the extent nor the id gives one. */
  year: number | null
  /** Region slug parsed from the id, folded into the search text. */
  region: string | null
  /** Lowercased id + title + region + keywords, matched against the query. */
  searchText: string
}

export interface CollectionGroup {
  /** Stable key: the year as a string, `unknown`, or a product name. */
  key: string
  label: string
  options: CollectionOption[]
}

/**
 * Year of first acquisition.
 *
 * The temporal extent is authoritative and is already in every payload, so it
 * is tried first; the id is only parsed when a collection has an open-ended
 * or missing extent.
 */
export function collectionYear(collection: StacCollection): number | null {
  const start = collection.extent?.temporal?.interval?.[0]?.[0]
  if (start) {
    const year = Number(start.slice(0, 4))
    if (Number.isFinite(year) && year > 1800 && year < 2200) return year
  }

  // `orto-historiska-1940-1959` and `orto-o2-2025` both end in a year.
  const matches = collection.id?.match(/(?:^|[^0-9])(1[89]\d{2}|20\d{2})/g)
  if (!matches?.length) return null

  const years = matches
    .map((match) => Number(match.replace(/[^0-9]/g, '')))
    .filter((year) => year > 1800 && year < 2200)

  return years.length ? Math.min(...years) : null
}

/**
 * The place name in `orto-<region>-<year>`.
 *
 * Best-effort and Lantmäteriet-shaped, which is fine: it only widens what the
 * search box matches, and a catalog named differently simply contributes
 * nothing here rather than breaking.
 */
export function collectionRegion(id: string): string | null {
  const match = id?.match(/^[a-z]+-(.+?)-(?:1[89]\d{2}|20\d{2})/i)
  return match ? match[1].replace(/-/g, ' ') : null
}

export function toOption(collection: StacCollection): CollectionOption {
  const region = collectionRegion(collection.id)
  const title = collection.title?.trim() || collection.id

  return {
    id: collection.id,
    title,
    year: collectionYear(collection),
    region,
    searchText: [collection.id, title, region, ...(collection.keywords ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }
}

/** Group by year, newest first, with undated collections last. */
export function groupCollectionsByYear(
  collections: StacCollection[],
): CollectionGroup[] {
  const byYear = new Map<number | null, CollectionOption[]>()

  for (const collection of collections) {
    if (!collection?.id) continue
    const option = toOption(collection)
    const bucket = byYear.get(option.year)
    if (bucket) bucket.push(option)
    else byYear.set(option.year, [option])
  }

  const groups: CollectionGroup[] = []
  const years = [...byYear.keys()]
    .filter((year): year is number => year !== null)
    .sort((a, b) => b - a)

  for (const year of years) {
    groups.push({
      key: String(year),
      label: String(year),
      options: sortByTitle(byYear.get(year) ?? []),
    })
  }

  const undated = byYear.get(null)
  if (undated?.length) {
    groups.push({ key: 'unknown', label: '', options: sortByTitle(undated) })
  }

  return groups
}

/**
 * The product name in a title like `Markhöjdmodell 65_3` — everything before
 * a trailing run of digits, underscores and hyphens. A title with no such
 * suffix (`Laserdata Skog`) is already just the product name.
 */
export function productName(title: string): string {
  const match = title.match(/^(.+?)\s+[\d_-]+$/)
  return match ? match[1] : title
}

/**
 * Group by product — the collection's title with its per-tile suffix
 * stripped — rather than by year. Alphabetical, since unlike a year there is
 * no "newest" to put first; every collection lands in a real group, since
 * every collection has a title.
 */
export function groupCollectionsByProduct(
  collections: StacCollection[],
): CollectionGroup[] {
  const byProduct = new Map<string, CollectionOption[]>()

  for (const collection of collections) {
    if (!collection?.id) continue
    const option = toOption(collection)
    const product = productName(option.title)
    const bucket = byProduct.get(product)
    if (bucket) bucket.push(option)
    else byProduct.set(product, [option])
  }

  return [...byProduct.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'sv'))
    .map(([product, options]) => ({
      key: product,
      label: product,
      options: sortByTitle(options),
    }))
}

function sortByTitle(options: CollectionOption[]): CollectionOption[] {
  return [...options].sort((a, b) => a.title.localeCompare(b.title, 'sv'))
}

/**
 * Narrow the groups to those matching a query, dropping any left empty.
 *
 * Every term must match somewhere in the option's text, so `arvidsjaur 2024`
 * behaves the way a search box is expected to.
 */
export function filterGroups(
  groups: CollectionGroup[],
  query: string,
): CollectionGroup[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return groups

  const filtered: CollectionGroup[] = []
  for (const group of groups) {
    const options = group.options.filter((option) =>
      terms.every(
        (term) => option.searchText.includes(term) || group.key.includes(term),
      ),
    )
    if (options.length) filtered.push({ ...group, options })
  }
  return filtered
}

/** A row in the virtual list: either a group heading or a selectable option. */
export type CollectionRow =
  | {
      type: 'header'
      /** Unique across the whole row list; headings and options can collide. */
      key: string
      /** The group's own key, which the UI needs to label the undated group. */
      groupKey: string
      label: string
      count: number
    }
  | { type: 'option'; key: string; option: CollectionOption }

/**
 * Flatten groups into one row list.
 *
 * A virtualiser measures a single flat sequence, so the headings have to live
 * in the same list as the options rather than wrapping them.
 */
export function toRows(groups: CollectionGroup[]): CollectionRow[] {
  const rows: CollectionRow[] = []
  for (const group of groups) {
    rows.push({
      type: 'header',
      key: `header:${group.key}`,
      groupKey: group.key,
      label: group.label,
      count: group.options.length,
    })
    for (const option of group.options) {
      rows.push({ type: 'option', key: option.id, option })
    }
  }
  return rows
}
