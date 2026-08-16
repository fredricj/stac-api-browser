/**
 * Number, size and date formatting for the UI.
 *
 * Everything takes an explicit locale rather than reaching for a global, so
 * the same helper works inside a component, inside a store, and inside a test
 * without any of them having to agree on ambient state.
 */

/**
 * Bytes as a human-readable size, in SI units.
 *
 * Decimal (kB, MB, GB), not binary (KiB), because that is what the operating
 * system's file listing and every download manager will show the user for the
 * same file — agreeing with those matters more here than the extra precision.
 */
export function formatBytes(
  bytes: number | null | undefined,
  locale = 'en',
): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'

  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB']
  const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1)
  const value = bytes / 1000 ** exponent

  // One decimal below 100 keeps "1.4 GB" readable without implying precision
  // the estimate does not have.
  const maximumFractionDigits = exponent === 0 ? 0 : value < 100 ? 1 : 0

  return `${new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)} ${units[exponent]}`
}

/** `2025-05-31`. Dates here are acquisition dates; the time of day is noise. */
export function formatDate(
  value: string | null | undefined,
  locale = 'en',
): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return ''

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(parsed)
}

/**
 * Ground resolution in metres per pixel.
 *
 * Sub-metre values are the interesting ones here (0.16 m orthophotos), so the
 * precision follows the magnitude rather than being fixed.
 */
export function formatResolution(
  metres: number | null | undefined,
  locale = 'en',
): string {
  if (metres == null || !Number.isFinite(metres)) return ''
  const digits = metres < 1 ? 2 : metres < 10 ? 1 : 0
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(metres)} m/px`
}

/** Thousands-separated integer, for counts. */
export function formatCount(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale).format(value)
}
