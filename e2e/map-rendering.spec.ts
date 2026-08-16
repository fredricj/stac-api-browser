import { expect, test, type Page } from '@playwright/test'

/**
 * Does the map actually paint what the app puts on it?
 *
 * Every other test in this repo drives a fake MapLibre. Those prove the app
 * *asks* for the right sources, layers and data, but cannot prove a single
 * pixel is drawn — which is exactly the class of bug this file exists for:
 * "the search box never appears on the map".
 *
 * Runs against the dev server, because the handle used to reach the map
 * (`__vueParentComponent`) only exists in a development build.
 */

const DEV_URL = 'http://localhost:5199'
const CATALOG = 'lantmateriet-bild'

/** Reaches the map instance through the component that owns it. */
const SETUP = `document.querySelector('.map-root')?.__vueParentComponent?.setupState`

async function waitForMapReady(page: Page) {
  await page.waitForFunction(`${SETUP}?.isReady === true`, null, {
    timeout: 30_000,
  })
}

/**
 * Whether this browser renders MapLibre at all.
 *
 * Headless Chromium and some sandboxes provide a WebGL context but never
 * complete a render pass, so *nothing* rasterises — not even a plain
 * background layer. Asserting about our layers there would report a failure
 * that says nothing about our code, so the render assertions skip instead.
 */
async function canRasterise(page: Page): Promise<boolean> {
  return page.evaluate(`(async () => {
    const map = ${SETUP}.map
    map.setStyle({
      version: 8,
      sources: {},
      layers: [{ id: 'probe-bg', type: 'background',
                 paint: { 'background-color': '#101418' } }],
    }, { diff: false })
    await new Promise((resolve) => {
      map.once('style.load', resolve)
      setTimeout(resolve, 8000)
    })
    await new Promise((r) => setTimeout(r, 2000))
    return map.queryRenderedFeatures().length > 0 || map.loaded()
  })()`)
}

test.describe('map rendering', () => {
  test('puts the search box and the footprints on the map', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(String(error)))

    await page.goto(
      `${DEV_URL}/api/${CATALOG}?bbox=17.9,59.2,18.2,59.4&map=18.05,59.3,9`,
    )
    await waitForMapReady(page)

    // The footprints arrive from the live API a moment after the map is ready.
    // Waited on synchronously: a predicate returning a Promise is truthy the
    // instant it is created, so an async one would not wait at all.
    await page.waitForFunction(`${SETUP}.items.length > 0`, null, {
      timeout: 30_000,
    })

    // What the app handed to MapLibre. This half is environment-independent:
    // it is true whether or not the GPU ever paints.
    const handed = await page.evaluate(`(async () => {
      const map = ${SETUP}.map
      const read = async (id) => {
        const data = await map.getSource(id).getData()
        return data.features.length
      }
      return {
        layers: map.getStyle().layers.map((l) => l.id)
          .filter((id) => /^(stac-footprints|search-bbox)/.test(id)),
        bboxFeatures: await read('search-bbox'),
        footprintFeatures: await read('stac-footprints'),
      }
    })()`)

    // Order matters: the search box must sit above the footprints it bounds.
    expect(handed.layers).toEqual([
      'stac-footprints-fill',
      'stac-footprints-line',
      'search-bbox-fill',
      'search-bbox-line',
    ])
    expect(handed.bboxFeatures).toBe(1)
    expect(handed.footprintFeatures).toBeGreaterThan(0)
    expect(errors).toEqual([])

    test.skip(
      !(await canRasterise(page)),
      'this browser never completes a MapLibre render pass',
    )

    // Reload, since canRasterise swapped the style out from under the app.
    await page.goto(
      `${DEV_URL}/api/${CATALOG}?bbox=17.9,59.2,18.2,59.4&map=18.05,59.3,9`,
    )
    await waitForMapReady(page)

    await page.waitForFunction(
      `${SETUP}.map.queryRenderedFeatures({ layers: ['search-bbox-fill'] }).length > 0`,
      null,
      { timeout: 30_000 },
    )
  })

  test('shows a box set from the toolbar, with no drawing tool involved', async ({
    page,
  }) => {
    await page.goto(`${DEV_URL}/api/${CATALOG}`)
    await waitForMapReady(page)

    await page
      .getByRole('button', { name: /Search this area|Sök i detta område/ })
      .click()

    // The regression this guards: three of the four ways to set an extent
    // never touch Terra Draw, and used to leave the map showing nothing.
    await page.waitForFunction(`${SETUP}.bboxRef !== null`, null, {
      timeout: 20_000,
    })

    const features = await page.evaluate(
      `${SETUP}.map.getSource('search-bbox').getData()
         .then((data) => data.features.length)`,
    )
    expect(features).toBe(1)
  })
})
