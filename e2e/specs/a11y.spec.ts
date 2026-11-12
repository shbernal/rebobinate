import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { lastDays } from '../../src/shared/stats-summary'
import { expect, test } from '../fixtures/extension'

const violationsOn = async (page: Page, where: string) => {
  const { violations } = await new AxeBuilder({ page }).analyze()

  return violations.map(({ id, nodes }) => ({
    where,
    id,
    targets: nodes.map(node => node.target.join(' ')),
  }))
}

/**
 * axe over every tab of the popup, in both colour schemes: the popup draws
 * with system colour keywords, so contrast is only known once the browser has
 * resolved them per theme.
 *
 * The pane's scroll cues are background gradients, and axe gives up on the
 * contrast of any text over a gradient rather than measuring it. Away from the
 * 18px at each edge they resolve to flat Canvas, so they are dropped for the
 * scan and every text node gets a real contrast verdict.
 */
for (const colorScheme of ['light', 'dark'] as const) {
  test(`popup has no axe violations in ${colorScheme} mode`, async ({
    openPopup,
  }) => {
    const popup = await openPopup()
    await popup.emulateMedia({ colorScheme })
    await popup.addStyleTag({ content: '.pane { background: Canvas; }' })

    for (const name of ['Speed', 'Sites', 'Stats', 'Settings']) {
      await popup.getByRole('tab', { name }).click()
      await expect(popup.getByRole('tabpanel')).toBeVisible()

      expect(await violationsOn(popup, name)).toEqual([])
    }
  })

  // Seeded, so the chart, the site table and the Clear button are all there
  // to be checked rather than the empty states.
  test(`stats page has no axe violations in ${colorScheme} mode`, async ({
    openStatsPage,
    seedStats,
  }) => {
    const [first, , third] = lastDays(3, Date.now())
    await seedStats({
      [first]: { 'youtube.com': { '1.5': 1800 } },
      [third]: { 'vimeo.com': { '0.75': 600 } },
    })

    const page = await openStatsPage()
    await page.emulateMedia({ colorScheme })
    await expect(page.locator('.chart-bar').first()).toBeVisible()

    expect(await violationsOn(page, 'stats page')).toEqual([])
  })
}
