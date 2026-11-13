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

  /**
   * axe skips the contrast of a button whose content is a lone glyph (the
   * steppers' − and +, a chip's ✕), filing it as incomplete. Measured here
   * instead, against WCAG 1.4.11's 3:1 for non-text content: the glyph's colour,
   * opacity included, over the background its ancestors composite to.
   * Disabled buttons are exempt and left out.
   */
  test(`glyph buttons keep 3:1 non-text contrast in ${colorScheme} mode`, async ({
    openPopup,
  }) => {
    const popup = await openPopup()
    await popup.emulateMedia({ colorScheme })

    const ratiosOn = () =>
      popup.evaluate(() => {
        const ctx = document.createElement('canvas').getContext('2d')!
        const rgba = (css: string) => {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = css
          ctx.fillRect(0, 0, 1, 1)
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
          return [r, g, b, a / 255]
        }
        const over = (top: number[], below: number[]) => [
          ...top
            .slice(0, 3)
            .map((c, i) => c * top[3] + below[i] * (1 - top[3])),
          1,
        ]
        const backgroundOf = (el: Element) => {
          const layers: number[][] = []
          for (let e: Element | null = el; e; e = e.parentElement)
            layers.unshift(rgba(getComputedStyle(e).backgroundColor))
          return layers.reduce(
            (below, top) => over(top, below),
            [255, 255, 255, 1],
          )
        }
        const luminance = (c: number[]) => {
          const [r, g, b] = c.slice(0, 3).map(v => {
            const s = v / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }

        return [
          ...document.querySelectorAll<HTMLButtonElement>(
            '.speed button, .chip button',
          ),
        ]
          .filter(button => !button.disabled)
          .map(button => {
            const style = getComputedStyle(button)
            const glyph = rgba(style.color)
            glyph[3] *= Number(style.opacity)
            const background = backgroundOf(button)
            const [hi, lo] = [
              luminance(over(glyph, background)),
              luminance(background),
            ].sort((a, b) => b - a)

            return {
              name: button.title || button.ariaLabel,
              ratio: (hi + 0.05) / (lo + 0.05),
            }
          })
      })

    for (const name of ['Speed', 'Settings']) {
      await popup.getByRole('tab', { name }).click()
      const ratios = await ratiosOn()

      expect(ratios.length).toBeGreaterThan(0)
      expect(ratios.filter(({ ratio }) => ratio < 3)).toEqual([])
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
