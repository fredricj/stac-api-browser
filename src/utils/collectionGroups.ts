/**
 * Turning a flat list of collections into something a person can navigate.
 *
 * `stac-bild` publishes 731 collections named `orto-<region>-<year>`. An
 * alphabetical list of those is unusable — nobody looks for imagery by the
 * first letter of a municipality. Almost every real question is "what covers
 * this place, and how recently", so the list groups by year, newest first,
 * and searches across id, title and the region parsed out of the id.
 */

import type { StacCollection } from '@/types/stac'

export interface CollectionOption {
  id: string
  title: string
  /** Acquisition year, or null when neither the extent nor the id gives one. */
  year: number | null
  /** Region slug parsed from the id, folded into the search text. */
  region: string | null
  /** Lowercased id + title + region, matched against the query. */
  searchText: string
}

export interface CollectionGroup {
  /** Stable key: the year as a string, or `unknown`. */
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
    searchText: [collection.id, title, region]
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
