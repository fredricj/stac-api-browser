import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatCount,
  formatDate,
  formatResolution,
} from '@/utils/format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1_500, '1.5 kB'],
    [692_361_773, '692 MB'],
    [2_500_000_000, '2.5 GB'],
    [45_000_000_000, '45 GB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes, 'en')).toBe(expected)
  })

  it('uses SI units, matching what the OS shows for the same file', () => {
    // 1 GB, not 1 GiB: agreeing with the file listing matters more here than
    // the binary convention.
    expect(formatBytes(1_000_000_000, 'en')).toBe('1 GB')
  })

  it('renders an unknown size as a dash rather than zero', () => {
    // Zero would understate a bulk download instead of admitting ignorance.
    expect(formatBytes(null, 'en')).toBe('—')
    expect(formatBytes(undefined, 'en')).toBe('—')
  })

  it('rejects nonsense rather than rendering NaN', () => {
    expect(formatBytes(Number.NaN, 'en')).toBe('—')
    expect(formatBytes(-1, 'en')).toBe('—')
  })
})

describe('formatDate', () => {
  it('formats an acquisition date without the time of day', () => {
    expect(formatDate('2025-05-31T09:21:07Z', 'en')).toBe('May 31, 2025')
  })

  it('reads the timestamp in UTC, not the viewer local zone', () => {
    // Otherwise the same tile shows a different acquisition day either side
    // of midnight depending on who is looking.
    expect(formatDate('2025-05-31T23:30:00Z', 'en')).toBe('May 31, 2025')
  })

  it('is empty for a missing or unparseable value', () => {
    expect(formatDate(null, 'en')).toBe('')
    expect(formatDate('not a date', 'en')).toBe('')
  })
})

describe('formatResolution', () => {
  it('keeps sub-metre precision, which is the interesting range here', () => {
    expect(formatResolution(0.16, 'en')).toBe('0.16 m/px')
  })

  it('drops needless decimals as the value grows', () => {
    expect(formatResolution(1, 'en')).toBe('1 m/px')
    expect(formatResolution(50, 'en')).toBe('50 m/px')
  })

  it('is empty when unknown', () => {
    expect(formatResolution(null, 'en')).toBe('')
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1240, 'en')).toBe('1,240')
  })
})
