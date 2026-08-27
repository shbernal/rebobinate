import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { pressSpeedKey } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'
import { blockerPath } from '../fixtures/extensionRuntime'

/**
 * What an ad blocker does to the badge, and what it cannot do.
 *
 * The blocker here is the fixture one, not uBlock Origin: uBO's Chromium build
 * is Manifest V2 and modern Chromium will not install it, and uBO Lite only
 * applies the filters of hostnames that are in the lists, which a fixture
 * origin never is. `docs/ad-blockers.md` covers both, and covers the tiers that
 * do run the real thing.
 *
 * The mechanism is what this tier holds still: element-hiding CSS injected at
 * user origin, from the selectors that are in the lists today.
 */
const filters = JSON.parse(
  readFileSync(new URL('../fixtures/blocker/filters.json', import.meta.url), {
    encoding: 'utf8',
  }),
) as { selectors: string[] }

test.use({ blockers: [blockerPath] })

const badge = (page: Page) => page.locator('#rebobinate-speed-host')

const badgeDisplay = (page: Page) =>
  badge(page).evaluate(node => getComputedStyle(node).display)

/**
 * A decoy shaped like the overlays the corpus hides, measured and taken back
 * out inside the one evaluate so it can be asked as often as it takes.
 */
const decoyDisplay = (page: Page) =>
  page.evaluate(() => {
    const decoy = document.createElement('div')
    decoy.setAttribute(
      'style',
      'position:fixed;z-index:2147483647;display:flex',
    )
    document.documentElement.append(decoy)
    const display = getComputedStyle(decoy).display
    decoy.remove()

    return display
  })

/**
 * A fixture page the blocker has demonstrably reached.
 *
 * Its CSS lands a few milliseconds *after* `goto` resolves — always after, and
 * unavoidably so: a service worker reacting to a navigation that has already
 * committed cannot beat the load it is reacting to, and neither can a real
 * MV3 blocker. Reading the page before then is the failure mode this whole tier
 * exists to catch, and the quiet direction of it is the dangerous one: a test
 * that reports the badge survived cosmetic filtering when nothing had been
 * filtered yet. Waiting for the decoy to go is what makes the rest of the file
 * mean what it says.
 */
const openBlocked = async (
  openFixture: (pathname: string) => Promise<Page>,
  pathname: string,
) => {
  const page = await openFixture(pathname)

  await expect.poll(() => decoyDisplay(page)).toBe('none')

  return page
}

test.describe('with a content blocker running', () => {
  test('the badge still appears and still reads the speed', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 0 } })
    const page = await openBlocked(openFixture, '/simple')

    await pressSpeedKey(page, '+')

    await expect(badge(page)).toBeAttached()
    await expect.poll(() => badgeDisplay(page)).toBe('flex')
    await expect
      .poll(() =>
        badge(page).evaluate(
          node => node.shadowRoot?.querySelector('div')?.textContent ?? '',
        ),
      )
      .toBe('1.1×')
  })

  test('the blocker is really hiding things on the same page', async ({
    openFixture,
  }) => {
    const page = await openFixture('/simple')

    // Without this the tests around it pass just as well against a blocker that
    // was never loaded, which is the failure mode worth guarding: an e2e tier
    // that proves nothing while looking green. They wait on the same reading
    // through `openBlocked`; this is where it is named.
    await expect.poll(() => decoyDisplay(page)).toBe('none')
  })

  test('every filter in the corpus leaves the badge alone', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 0 } })
    const page = await openBlocked(openFixture, '/simple')

    await pressSpeedKey(page, '+')
    await expect(badge(page)).toBeAttached()

    // The corpus is scoped to particular sites in the real lists. Matching it
    // against the host directly is the site-independent question: is there a
    // hostname where turning a blocker on would take the badge away?
    const matched = await badge(page).evaluate(
      (node, selectors) => selectors.filter(selector => node.matches(selector)),
      filters.selectors,
    )

    expect(matched).toEqual([])
  })

  test('user-origin CSS still wins when it does match', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 0 } })
    const page = await openBlocked(openFixture, '/simple')

    await pressSpeedKey(page, '+')
    await expect(badge(page)).toBeAttached()

    // The honest limit. If a list ever names the badge, nothing in the page can
    // answer that — `!important` at user origin outranks every author
    // declaration, inline ones included. Knowing this is why the fix is to not
    // match the selectors rather than to try to outrank them.
    const beaten = await page.evaluate(async () => {
      const style = document.createElement('style')
      style.textContent =
        '#rebobinate-speed-host{display:none!important;visibility:hidden!important}'
      document.documentElement.append(style)

      const host = document.getElementById('rebobinate-speed-host')

      return getComputedStyle(host!).display
    })

    // Author origin loses to the badge's own important rule…
    expect(beaten).toBe('flex')

    // …which is exactly the guarantee a blocker does not have to respect.
  })
})
