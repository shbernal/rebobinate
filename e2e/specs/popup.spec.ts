import { pressSpeedKey, rateOf } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'

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
    await popup.locator('#step').fill('0.5')
    await popup.locator('#step').blur()

    await page.bringToFront()
    await pressSpeedKey(page, '+')

    expect(await rateOf(page)).toBeCloseTo(1.5, 3)
  })

  test('remembers the badge corner', async ({ openPopup }) => {
    const popup = await openPopup()

    await popup.getByRole('button', { name: 'bottom-right' }).click()
    await expect(
      popup.getByRole('button', { name: 'bottom-right' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await popup.reload()

    await expect(
      popup.getByRole('button', { name: 'bottom-right' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
