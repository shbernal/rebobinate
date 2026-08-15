import { readFileSync } from 'node:fs'
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

const badge = (page: import('@playwright/test').Page) =>
  page.locator('#rebobinate-speed-host')

const badgeDisplay = (page: import('@playwright/test').Page) =>
  badge(page).evaluate(node => getComputedStyle(node).display)

test.describe('with a content blocker running', () => {
  test('the badge still appears and still reads the speed', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 0 } })
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')

    await expect(badge(page)).toBeAttached()
    await expect.poll(() => badgeDisplay(page)).toBe('flex')
    await expect
      .poll(() =>
        badge(page).evaluate(
          node => node.shadowRoot?.querySelector('div')?.textContent ?? '',
        ),
      )
      .toBe('1.05×')
  })

  test('the blocker is really hiding things on the same page', async ({
    openFixture,
  }) => {
    const page = await openFixture('/simple')

    // Without this the test above passes just as well against a blocker that
    // was never loaded, which is the failure mode worth guarding: an e2e tier
    // that proves nothing while looking green.
    const hidden = await page.evaluate(() => {
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

    expect(hidden).toBe('none')
  })

  test('every filter in the corpus leaves the badge alone', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 0 } })
    const page = await openFixture('/simple')

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
    const page = await openFixture('/simple')

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
