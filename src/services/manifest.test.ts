import { describe, expect, it } from 'vitest'
import {
  PASSWORD_ENV,
  USER_ENV,
  buildManifest,
  csvField,
  powerShellQuote,
  shellQuote,
  type ManifestFormat,
} from '@/services/manifest'
import type { BasketItem } from '@/stores/selectionStore'

const ITEM: BasketItem = {
  key: 'orto-o2-2025/o65700',
  id: 'o65700',
  collection: 'orto-o2-2025',
  datetime: '2025-05-31T09:21:07Z',
  size: 692_361_773,
  href: 'https://dl1.lantmateriet.se/bild/data/orto/o65700.tif',
  thumbnail: 'https://dl1.lantmateriet.se/pub/o65700.jpg',
  bbox: [17.9, 59.2, 18.2, 59.4],
}

const nameFor = (item: BasketItem) => `${item.id}.tif`

const SCRIPT_FORMATS: ManifestFormat[] = [
  'aria2c',
  'curl',
  'wget',
  'powershell',
]
const ALL_FORMATS: ManifestFormat[] = [
  ...SCRIPT_FORMATS,
  'urls',
  'csv',
  'geojson',
]

describe('quoting', () => {
  it('neutralises a single quote for a POSIX shell', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`)
  })

  it('neutralises a single quote for PowerShell', () => {
    expect(powerShellQuote("a'b")).toBe("'a''b'")
  })

  it('doubles a quote in a CSV field', () => {
    expect(csvField('a"b')).toBe('"a""b"')
  })
})

describe('credentials are never written to a file', () => {
  it('cannot receive credentials in the first place', () => {
    // The strongest guarantee available: format, items and the filename
    // strategy are the only inputs, so there is no channel through which a
    // password could reach a generated file.
    expect(buildManifest.length).toBe(3)
  })

  it.each(ALL_FORMATS)(
    '%s mentions passwords only as a placeholder',
    (format) => {
      const file = buildManifest(format, [ITEM], nameFor)

      // These files get committed, pasted into tickets and shared with
      // colleagues, so every occurrence must be the env var name or the
      // documented placeholder — never a value.
      for (const line of file.content.match(/.*password.*/gi) ?? []) {
        expect(line).toMatch(
          new RegExp(`${PASSWORD_ENV}|your-geotorget-password`),
        )
      }
    },
  )

  it.each(SCRIPT_FORMATS)(
    '%s reads credentials from the environment',
    (format) => {
      const file = buildManifest(format, [ITEM], nameFor)

      expect(file.content).toContain(USER_ENV)
      expect(file.content).toContain(PASSWORD_ENV)
    },
  )

  it('never puts a password on a curl command line', () => {
    // `curl -u user:pass` is visible in the process list to every other user
    // on the machine; the shell must substitute it instead.
    const file = buildManifest('curl', [ITEM], nameFor)

    expect(file.content).toContain(`--user "$${USER_ENV}:$${PASSWORD_ENV}"`)
  })
})

describe('injection through catalog-controlled URLs', () => {
  const hostile: BasketItem = {
    ...ITEM,
    id: "evil'; rm -rf ~; echo '",
    href: "https://x.example/a.tif'; rm -rf ~; echo '",
  }

  it.each(['curl', 'wget'] as ManifestFormat[])(
    'quotes a hostile href for %s',
    (format) => {
      // The href arrives in a response body and ends up in a file the user
      // executes. A `;` must not be able to escape its quoting.
      const content = buildManifest(format, [hostile], nameFor).content

      expect(content).not.toMatch(/[^'\\]; rm -rf ~/)
      expect(content).toContain(`'\\''`)
    },
  )

  it('quotes a hostile href for PowerShell', () => {
    const content = buildManifest('powershell', [hostile], nameFor).content
    expect(content).toContain("''")
    expect(content).not.toMatch(/-Uri '[^']*';\s*rm/)
  })

  it('quotes a hostile value in CSV', () => {
    const content = buildManifest(
      'csv',
      [{ ...ITEM, id: 'a"b,c' }],
      nameFor,
    ).content
    expect(content).toContain('"a""b,c"')
  })

  it('keeps a hostile value inert in GeoJSON', () => {
    // JSON has no execution semantics, so the value only needs to round-trip.
    const parsed = JSON.parse(
      buildManifest('geojson', [hostile], nameFor).content,
    )
    expect(parsed.features[0].properties.href).toBe(hostile.href)
  })
})

describe('aria2c', () => {
  it('pairs each URL with its output name', () => {
    const content = buildManifest('aria2c', [ITEM], nameFor).content

    expect(content).toContain(ITEM.href)
    expect(content).toContain('  out=o65700.tif')
  })

  it('says how to run it', () => {
    expect(buildManifest('aria2c', [ITEM], nameFor).content).toContain(
      'aria2c -i stac-downloads.txt',
    )
  })
})

describe('csv', () => {
  it('has a header and one row per item', () => {
    const lines = buildManifest(
      'csv',
      [ITEM, { ...ITEM, id: 'b', key: 'c/b' }],
      nameFor,
    )
      .content.trim()
      .split('\n')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('"id"')
    expect(lines[1]).toContain('"o65700"')
    expect(lines[1]).toContain('"692361773"')
  })
})

describe('geojson', () => {
  it('produces a FeatureCollection of the footprints', () => {
    const parsed = JSON.parse(buildManifest('geojson', [ITEM], nameFor).content)

    expect(parsed.type).toBe('FeatureCollection')
    expect(parsed.features).toHaveLength(1)
    expect(parsed.features[0].geometry.coordinates[0]).toHaveLength(5)
    expect(parsed.features[0].properties.id).toBe('o65700')
  })

  it('leaves out items with no footprint rather than emitting null geometry', () => {
    const parsed = JSON.parse(
      buildManifest('geojson', [{ ...ITEM, bbox: null }], nameFor).content,
    )
    expect(parsed.features).toEqual([])
  })
})

describe('items without a downloadable asset', () => {
  it.each(SCRIPT_FORMATS)('%s skips them', (format) => {
    const content = buildManifest(
      format,
      [{ ...ITEM, href: null }],
      nameFor,
    ).content

    // No command should be generated for something with nowhere to fetch from.
    expect(content).not.toContain('o65700.tif')
  })
})

describe('filenames', () => {
  it.each(ALL_FORMATS)('%s names its own file sensibly', (format) => {
    const file = buildManifest(format, [ITEM], nameFor)
    expect(file.filename).toMatch(/^stac-/)
    expect(file.contentType).toContain('charset=utf-8')
  })
})
