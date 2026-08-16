/**
 * Handing the job to a real download manager.
 *
 * For fifty gigabytes this is not a fallback, it is the right answer: aria2c
 * resumes, parallelises and survives a closed laptop, and a browser tab does
 * none of those things. The UI recommends it rather than pretending otherwise.
 *
 * Two rules run through every generator here:
 *
 * 1. **Credentials are never written into a file.** The scripts read them from
 *    the environment, so a manifest can be committed, pasted into a ticket or
 *    shared with a colleague without leaking anything. A password baked into
 *    `curl -u` would also be visible in the process list to every other user
 *    on the machine.
 * 2. **Every catalog-supplied value is quoted for its target shell.** The URLs
 *    come from the API. A file the user is about to *execute* must not be able
 *    to gain a `;` or a `$(…)` from a response body.
 */

import type { BasketItem } from '@/stores/selectionStore'

/** Environment variables the generated scripts read credentials from. */
export const USER_ENV = 'STAC_USER'
export const PASSWORD_ENV = 'STAC_PASSWORD'

export type ManifestFormat =
  'aria2c' | 'curl' | 'wget' | 'powershell' | 'urls' | 'csv' | 'geojson'

export interface ManifestFile {
  filename: string
  /** MIME type for the download blob. */
  contentType: string
  content: string
}

/* ------------------------------------------------------------------ *
 * Quoting
 * ------------------------------------------------------------------ */

/**
 * A POSIX shell single-quoted string.
 *
 * Inside single quotes the shell interprets nothing at all, so the only case
 * to handle is a single quote itself: close, emit an escaped quote, reopen.
 */
export function shellQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`
}

/**
 * A PowerShell single-quoted string.
 *
 * PowerShell escapes an embedded single quote by doubling it, and expands
 * nothing else inside single quotes.
 */
export function powerShellQuote(value: string): string {
  return `'${value.split("'").join("''")}'`
}

/** A CSV field, quoted per RFC 4180. */
export function csvField(value: string): string {
  return `"${value.split('"').join('""')}"`
}

/* ------------------------------------------------------------------ *
 * Generators
 * ------------------------------------------------------------------ */

interface Entry {
  url: string
  filename: string
  item: BasketItem
}

function entriesOf(items: BasketItem[], nameFor: (item: BasketItem) => string) {
  return items
    .filter((item): item is BasketItem & { href: string } => Boolean(item.href))
    .map<Entry>((item) => ({
      url: item.href,
      filename: nameFor(item),
      item,
    }))
}

const HEADER_NOTE = [
  '# Credentials are read from the environment and are not stored in this file.',
  `#   export ${USER_ENV}='your-geotorget-username'`,
  `#   export ${PASSWORD_ENV}='your-geotorget-password'`,
  '#',
  '# Files are large. aria2c resumes an interrupted run; re-running is safe.',
]

/**
 * An aria2c input file.
 *
 * The recommended route for a large selection: `aria2c -i list.txt -x4
 * --continue`. Credentials are passed on the command line by the user, or via
 * `--http-user`/`--http-passwd` from their own shell.
 */
export function toAria2c(
  items: BasketItem[],
  nameFor: (i: BasketItem) => string,
): ManifestFile {
  const entries = entriesOf(items, nameFor)

  const lines = [
    ...HEADER_NOTE,
    '#',
    '# Usage:',
    `#   aria2c -i stac-downloads.txt -x4 --continue --http-user="$${USER_ENV}" --http-passwd="$${PASSWORD_ENV}"`,
    '',
  ]

  for (const entry of entries) {
    lines.push(entry.url, `  out=${entry.filename}`)
  }

  return {
    filename: 'stac-downloads.txt',
    contentType: 'text/plain;charset=utf-8',
    content: `${lines.join('\n')}\n`,
  }
}

/** A `curl` script. `--netrc`-free: credentials come from the environment. */
export function toCurl(
  items: BasketItem[],
  nameFor: (i: BasketItem) => string,
): ManifestFile {
  const entries = entriesOf(items, nameFor)

  const lines = [
    '#!/bin/sh',
    'set -eu',
    ...HEADER_NOTE,
    '',
    `: "\${${USER_ENV}:?set ${USER_ENV}}"`,
    `: "\${${PASSWORD_ENV}:?set ${PASSWORD_ENV}}"`,
    '',
  ]

  for (const entry of entries) {
    // `--user "$VAR:$VAR"` keeps the secret out of the script text; the shell
    // substitutes it at run time.
    lines.push(
      `curl --fail --location --continue-at - --user "$${USER_ENV}:$${PASSWORD_ENV}" \\`,
      `  --output ${shellQuote(entry.filename)} ${shellQuote(entry.url)}`,
    )
  }

  return {
    filename: 'stac-downloads.sh',
    contentType: 'text/x-shellscript;charset=utf-8',
    content: `${lines.join('\n')}\n`,
  }
}

/** A `wget` script. */
export function toWget(
  items: BasketItem[],
  nameFor: (i: BasketItem) => string,
): ManifestFile {
  const entries = entriesOf(items, nameFor)

  const lines = [
    '#!/bin/sh',
    'set -eu',
    ...HEADER_NOTE,
    '',
    `: "\${${USER_ENV}:?set ${USER_ENV}}"`,
    `: "\${${PASSWORD_ENV}:?set ${PASSWORD_ENV}}"`,
    '',
  ]

  for (const entry of entries) {
    lines.push(
      `wget --continue --user="$${USER_ENV}" --password="$${PASSWORD_ENV}" \\`,
      `  --output-document=${shellQuote(entry.filename)} ${shellQuote(entry.url)}`,
    )
  }

  return {
    filename: 'stac-downloads-wget.sh',
    contentType: 'text/x-shellscript;charset=utf-8',
    content: `${lines.join('\n')}\n`,
  }
}

/** A PowerShell script, for the Windows users this catalog mostly serves. */
export function toPowerShell(
  items: BasketItem[],
  nameFor: (i: BasketItem) => string,
): ManifestFile {
  const entries = entriesOf(items, nameFor)

  const lines = [
    '# Credentials are read from the environment and are not stored in this file.',
    `#   $env:${USER_ENV} = 'your-geotorget-username'`,
    `#   $env:${PASSWORD_ENV} = 'your-geotorget-password'`,
    '',
    '$ErrorActionPreference = "Stop"',
    `if (-not $env:${USER_ENV}) { throw "Set ${USER_ENV}" }`,
    `if (-not $env:${PASSWORD_ENV}) { throw "Set ${PASSWORD_ENV}" }`,
    '',
    `$secure = ConvertTo-SecureString $env:${PASSWORD_ENV} -AsPlainText -Force`,
    `$cred = New-Object System.Management.Automation.PSCredential($env:${USER_ENV}, $secure)`,
    '',
  ]

  for (const entry of entries) {
    lines.push(
      `Invoke-WebRequest -Uri ${powerShellQuote(entry.url)} -OutFile ${powerShellQuote(entry.filename)} -Credential $cred -AllowUnencryptedAuthentication`,
    )
  }

  return {
    filename: 'stac-downloads.ps1',
    contentType: 'text/plain;charset=utf-8',
    content: `${lines.join('\n')}\n`,
  }
}

/** Just the URLs, for whatever tool the user already trusts. */
export function toUrlList(items: BasketItem[]): ManifestFile {
  const urls = items
    .map((item) => item.href)
    .filter((href): href is string => Boolean(href))

  return {
    filename: 'stac-urls.txt',
    contentType: 'text/plain;charset=utf-8',
    content: `${urls.join('\n')}\n`,
  }
}

/** A CSV of the selection, for a spreadsheet or a record of what was fetched. */
export function toCsv(
  items: BasketItem[],
  nameFor: (i: BasketItem) => string,
): ManifestFile {
  const rows = [
    ['id', 'collection', 'datetime', 'filename', 'bytes', 'url']
      .map(csvField)
      .join(','),
  ]

  for (const item of items) {
    rows.push(
      [
        csvField(item.id),
        csvField(item.collection),
        csvField(item.datetime ?? ''),
        csvField(nameFor(item)),
        csvField(item.size == null ? '' : String(item.size)),
        csvField(item.href ?? ''),
      ].join(','),
    )
  }

  return {
    filename: 'stac-selection.csv',
    contentType: 'text/csv;charset=utf-8',
    content: `${rows.join('\n')}\n`,
  }
}

/** The selection as GeoJSON, so it can go straight into GIS. */
export function toGeoJson(items: BasketItem[]): ManifestFile {
  const features = items
    .filter((item) => item.bbox)
    .map((item) => {
      const [west, south, east, north] = item.bbox!
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
        properties: {
          id: item.id,
          collection: item.collection,
          datetime: item.datetime,
          // The href is data, not an instruction, so it is safe in JSON.
          href: item.href,
          'file:size': item.size,
        },
      }
    })

  return {
    filename: 'stac-selection.geojson',
    contentType: 'application/geo+json;charset=utf-8',
    content: `${JSON.stringify({ type: 'FeatureCollection', features }, null, 2)}\n`,
  }
}

/** Build one manifest in the requested format. */
export function buildManifest(
  format: ManifestFormat,
  items: BasketItem[],
  nameFor: (item: BasketItem) => string,
): ManifestFile {
  switch (format) {
    case 'aria2c':
      return toAria2c(items, nameFor)
    case 'curl':
      return toCurl(items, nameFor)
    case 'wget':
      return toWget(items, nameFor)
    case 'powershell':
      return toPowerShell(items, nameFor)
    case 'urls':
      return toUrlList(items)
    case 'csv':
      return toCsv(items, nameFor)
    case 'geojson':
      return toGeoJson(items)
  }
}

/**
 * Hand a generated manifest to the browser as a download.
 *
 * These are kilobytes of text we produced ourselves, so an object URL is
 * exactly the right tool — unlike the assets themselves, which stream to disk.
 */
export function saveManifest(file: ManifestFile): void {
  const blob = new Blob([file.content], { type: file.contentType })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()

  // Revoking immediately can race the download in some browsers; a tick is
  // enough and keeps the blob from being held for the life of the page.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
