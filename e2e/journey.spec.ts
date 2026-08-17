import { expect, test } from '@playwright/test'

/**
 * The one path every part of this app exists to serve: pick a catalog off
 * the front page, search it by drawing a bbox in by hand, select something
 * that matched, and walk away with a way to fetch it.
 *
 * Runs against the built preview server (this repo's default `baseURL`)
 * rather than the dev server the map-internals specs need — nothing here
 * reaches into Vue internals, so the production build is the more honest
 * thing to exercise. Hits the live Lantmäteriet API, like the rest of this
 * suite; the bbox below is the same Stockholm-sized box `layout.spec.ts`
 * already relies on returning a page of real results.
 *
 * Manifest export, not a folder or sequential download: those need either a
 * native directory picker or a signed-in credential round-trip against a
 * real asset, neither of which belongs in this flow. The manifest needs
 * neither — it is text, generated client-side — which makes it the one tier
 * a browser-driven test can complete honestly.
 */

const BBOX = ['17.9', '59.2', '18.2', '59.4']

test('registry → search by bbox → select → manifest export', async ({
  page,
}) => {
  // Registry: the front page lists the built-in catalogs without touching
  // the network, and links each one to its browse page.
  await page.goto('/')
  const card = page.locator('a.card-main', {
    hasText: 'Lantmäteriet — Ortofoto',
  })
  await expect(card).toBeVisible()
  await card.click()
  await expect(page).toHaveURL(/\/api\/lantmateriet-bild/)

  // Search by bbox: typed into the four fields by hand, the same path a
  // keyboard-only user takes — not a query-string shortcut.
  const bboxFields = page.locator('.bbox .field-input')
  await expect(bboxFields).toHaveCount(4)
  for (const [index, value] of BBOX.entries()) {
    await bboxFields.nth(index).fill(value)
  }

  await page.locator('.panel-foot .btn--primary').click()
  await expect(page.locator('.results .row').first()).toBeVisible({
    timeout: 30_000,
  })

  // Select: tick the first result and watch the basket pick it up.
  await page.locator('.results .row input[type="checkbox"]').first().check()
  await expect(page.locator('.basket .count')).toHaveText(/1/)
  await expect(page.locator('.basket .download')).toBeEnabled()

  // Manifest export: open the download dialog, choose the manifest tier —
  // explicitly, since the dialog may otherwise default to whichever tier
  // this browser and selection size steer it toward — and download the
  // aria2c list, the first and recommended format.
  await page.locator('.basket .download').click()
  const dialog = page.locator('dialog[open]')
  await expect(dialog).toBeVisible()

  await dialog.locator('input[type="radio"][value="manifest"]').check()
  const format = dialog.locator('.manifest .format').first()
  await expect(format).toBeEnabled()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    format.click(),
  ])

  expect(download.suggestedFilename()).toBe('stac-downloads.txt')

  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk as Buffer)
  const content = Buffer.concat(chunks).toString('utf-8')

  // The shape of an aria2c input file — real asset URLs on the protected
  // host, output filenames, and credential placeholders rather than a real
  // password, since nothing here ever signed in.
  expect(content).toContain('aria2c -i')
  expect(content).toContain('STAC_USER')
  expect(content).toContain('STAC_PASSWORD')
  expect(content).toContain('dl1.lantmateriet.se')
  expect(content).toContain('out=')
})
