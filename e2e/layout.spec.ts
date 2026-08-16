import { expect, test } from '@playwright/test'

/**
 * The browse page is an app shell, not a document.
 *
 * Guards the shape of the layout, which unit tests cannot see: the page must
 * not scroll, the map must fit the viewport whatever the result count, and
 * the results list must scroll inside itself.
 */

const DEV_URL = 'http://localhost:5199'
const URL = `${DEV_URL}/api/lantmateriet-bild?bbox=17.9,59.2,18.2,59.4&map=18.05,59.3,9`
const SETUP = `document.querySelector('.map-root')?.__vueParentComponent?.setupState`

test.describe('browse layout', () => {
  test('fits the viewport with a long result list', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto(URL)
    await page.waitForFunction(`${SETUP}?.isReady === true`, null, {
      timeout: 30_000,
    })
    // Wait for a full page of results — the condition that used to stretch
    // the map into a ribbon.
    await page.waitForFunction(`${SETUP}.items.length > 100`, null, {
      timeout: 30_000,
    })

    const metrics = await page.evaluate(() => {
      const el = (selector: string) =>
        document.querySelector(selector) as HTMLElement
      const rect = (selector: string) => el(selector).getBoundingClientRect()
      const scroller = document.querySelector(
        '.results .scroller',
      ) as HTMLElement
      // Try to scroll the page. If it moves at all, the shell is not pinned.
      window.scrollTo(0, 5000)
      const scrolledBy = window.scrollY
      window.scrollTo(0, 0)

      return {
        itemCount: document.querySelectorAll('.row').length,
        pageScrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        scrolledBy,
        map: rect('.map-root').height,
        results: rect('.results').height,
        scrollerClient: scroller.clientHeight,
        scrollerScroll: scroller.scrollHeight,
      }
    })

    // The page itself does not scroll: everything fits the viewport.
    // Asserted by actually trying, because a scroll container that is not a
    // containing block lets absolutely positioned descendants escape it and
    // stretch the document while every box still measures as contained.
    expect(metrics.scrolledBy).toBe(0)
    expect(metrics.pageScrollHeight).toBeLessThanOrEqual(
      metrics.viewportHeight + 1,
    )

    // The map is a usable shape, not a ribbon stretched by the result count.
    expect(metrics.map).toBeGreaterThan(300)
    expect(metrics.map).toBeLessThanOrEqual(metrics.viewportHeight)

    // The results list scrolls inside itself.
    expect(metrics.results).toBeLessThanOrEqual(metrics.viewportHeight)
    expect(metrics.scrollerScroll).toBeGreaterThan(metrics.scrollerClient)
  })

  test('the map height does not depend on how many results loaded', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 })

    await page.goto(`${DEV_URL}/api/lantmateriet-bild`)
    await page.waitForFunction(`${SETUP}?.isReady === true`, null, {
      timeout: 30_000,
    })
    const empty = await page.evaluate(
      () => document.querySelector('.map-root')!.getBoundingClientRect().height,
    )

    await page.goto(URL)
    await page.waitForFunction(`${SETUP}?.isReady === true`, null, {
      timeout: 30_000,
    })
    await page.waitForFunction(`${SETUP}.items.length > 100`, null, {
      timeout: 30_000,
    })
    const loaded = await page.evaluate(
      () => document.querySelector('.map-root')!.getBoundingClientRect().height,
    )

    expect(loaded).toBeCloseTo(empty, 0)
  })

  test('stacks and lets the page scroll on a narrow screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await page.goto(URL)
    await page.waitForFunction(`${SETUP}?.isReady === true`, null, {
      timeout: 30_000,
    })

    const metrics = await page.evaluate(() => ({
      pageScrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      map: document.querySelector('.map-root')!.getBoundingClientRect().height,
    }))

    // Squeezing three regions into one short viewport would leave each of
    // them useless, so here the page is what scrolls.
    expect(metrics.pageScrollHeight).toBeGreaterThan(metrics.viewportHeight)
    expect(metrics.map).toBeGreaterThan(250)
  })
})
