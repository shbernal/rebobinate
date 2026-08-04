import type { Page } from '@playwright/test'
import { pressSpeedKey, rateOf } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'

/**
 * The popup opens on the Speed tab, so anything else has to be selected first.
 * A reload puts it back — the selected tab is not persisted.
 */
const openTab = async (popup: Page, name: string) => {
  await popup.getByRole('tab', { name }).click()
}

test.describe('popup', () => {
  test('drives the speed of the active tab', async ({
    openFixture,
    openPopup,
  }) => {
    const page = await openFixture('/simple')
    await page.bringToFront()

    // Wait for the content script to be listening, then hand the page back at
    // normal speed, so the popup assertions below start from a known state.
    await pressSpeedKey(page, '+')
    await pressSpeedKey(page, '0')

    const popup = await openPopup()

    // A real popup is an overlay, not a tab, so the page underneath stays the
    // active one. Playwright can only open the popup document as a tab, so the
    // page is brought back to the front and the buttons are driven without
    // focus — otherwise the extension would resolve the popup's own tab as the
    // target and there would be nothing to control.
    await page.bringToFront()
    await popup.getByRole('button', { name: 'Faster' }).dispatchEvent('click')

    await expect(popup.locator('.readout')).toHaveText('1.05×')
    await expect.poll(() => rateOf(page)).toBeCloseTo(1.05, 3)

    await popup.getByRole('button', { name: 'Reset' }).dispatchEvent('click')

    await expect.poll(() => rateOf(page)).toBeCloseTo(1, 3)
  })

  test('saves the step and uses it on the page', async ({
    openFixture,
    openPopup,
  }) => {
    const page = await openFixture('/simple')
    await page.bringToFront()

    const popup = await openPopup()
    await openTab(popup, 'Settings')
    await popup.locator('#step').fill('0.5')
    await popup.locator('#step').blur()

    await page.bringToFront()
    await pressSpeedKey(page, '+')

    expect(await rateOf(page)).toBeCloseTo(1.5, 3)
  })

  test('remembers the badge corner', async ({ openPopup }) => {
    const popup = await openPopup()
    await openTab(popup, 'Settings')

    await popup.getByRole('button', { name: 'bottom-right' }).click()
    await expect(
      popup.getByRole('button', { name: 'bottom-right' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await popup.reload()
    await openTab(popup, 'Settings')

    await expect(
      popup.getByRole('button', { name: 'bottom-right' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('rebinds a key and uses it on the page', async ({
    openFixture,
    openPopup,
  }) => {
    const page = await openFixture('/simple')
    await page.bringToFront()

    const popup = await openPopup()
    await openTab(popup, 'Settings')

    // The capture reads a real keystroke, so the button has to hold focus.
    await popup.getByRole('button', { name: 'Add a key for Faster' }).click()
    await popup.keyboard.press('u')

    await expect(
      popup.getByRole('button', { name: 'Remove u from Faster' }),
    ).toBeEnabled()

    await page.bringToFront()
    await page.keyboard.press('u')

    await expect.poll(() => rateOf(page)).toBeCloseTo(1.05, 3)
  })
})

/**
 * A real popup is an overlay and the page underneath stays the active tab,
 * which is how the service worker finds the tab a popup is asking about.
 * Playwright can only open the popup document as a tab of its own, so the page
 * is handed back the front and the popup re-mounted: that is the only way it
 * asks the question the way a browser asks it.
 */
const openPopupOver = async (page: Page, popup: Page) => {
  await page.bringToFront()
  await popup.reload()

  return popup
}

test.describe('popup sites tab', () => {
  test('shows the site of the tab behind it', async ({
    openFixture,
    openPopup,
    rememberedSites,
  }) => {
    const page = await openFixture('/simple')
    await page.bringToFront()

    await pressSpeedKey(page, '+')
    await expect
      .poll(async () => (await rememberedSites())['player.test']?.speed)
      .toBeCloseTo(1.05, 3)

    const popup = await openPopupOver(page, await openPopup())
    await popup.getByRole('tab', { name: 'Sites' }).dispatchEvent('click')

    // The first list is the "This tab" row, which is the domain the service
    // worker resolved rather than anything the popup worked out for itself.
    const thisTab = popup.locator('.sites').first()

    await expect(thisTab).toContainText('player.test')
    await expect(thisTab.getByLabel('Speed for player.test')).toHaveValue(
      '1.05',
    )
  })

  test('switches a site out of the memory', async ({
    openFixture,
    openPopup,
    rememberedSites,
  }) => {
    const first = await openFixture('/simple')
    await first.bringToFront()

    await pressSpeedKey(first, '+')
    await expect
      .poll(async () => (await rememberedSites())['player.test']?.speed)
      .toBeCloseTo(1.05, 3)

    const popup = await openPopup()
    await openTab(popup, 'Sites')
    // The switch's checkbox is transparent and zero-sized — the visible control
    // is the label around it, which is what a user clicks too.
    await popup
      .locator('.switch', {
        has: popup.getByLabel('Never remember player.test'),
      })
      .click()

    await expect
      .poll(async () => (await rememberedSites())['player.test']?.never)
      .toBe(true)

    // The next visit starts at the default, and the speed chosen on it is not
    // written down again.
    const second = await openFixture('/simple')
    await expect.poll(() => rateOf(second)).toBeCloseTo(1, 3)

    await second.bringToFront()
    await pressSpeedKey(second, '+')
    await second.waitForTimeout(1500)

    expect((await rememberedSites())['player.test'].never).toBe(true)
  })
})
