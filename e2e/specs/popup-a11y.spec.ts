import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '../fixtures/extension'

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

    for (const name of ['Speed', 'Sites', 'Settings']) {
      await popup.getByRole('tab', { name }).click()
      await expect(popup.getByRole('tabpanel')).toBeVisible()

      const { violations } = await new AxeBuilder({
        page: popup,
      }).analyze()

      expect(
        violations.map(({ id, nodes }) => ({
          tab: name,
          id,
          targets: nodes.map(node => node.target.join(' ')),
        })),
      ).toEqual([])
    }
  })
}
