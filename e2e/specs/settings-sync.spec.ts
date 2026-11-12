import type { Settings } from '../../src/shared/settings'
import { SETTINGS_STORAGE_KEY } from '../../src/shared/settings'
import { getStorageValue, setStorageValue } from '../fixtures/extensionRuntime'
import { expect, test } from '../fixtures/extension'

/**
 * Chromium with no account signed in keeps `storage.sync` on the device, which
 * is enough to drive both directions: a write to sync is what another
 * browser's edit looks like when it arrives.
 */
test.describe('settings sync', () => {
  test('copies a popup edit to sync', async ({
    extensionContext,
    openPopup,
  }) => {
    const popup = await openPopup()
    await popup.getByRole('tab', { name: 'Settings' }).click()
    // The checkbox itself is transparent and zero-sized; the track is what
    // a user clicks.
    await popup
      .locator('label.switch', {
        has: popup.getByRole('checkbox', { name: 'Toolbar badge' }),
      })
      .click()

    await expect
      .poll(
        async () =>
          (
            await getStorageValue<Settings>(
              extensionContext,
              SETTINGS_STORAGE_KEY,
              'sync',
            )
          )?.toolbarBadge,
      )
      .toBe(false)
  })

  test('applies a synced edit to an open popup', async ({
    extensionContext,
    openPopup,
  }) => {
    const popup = await openPopup()
    await popup.getByRole('tab', { name: 'Settings' }).click()
    const toggle = popup.getByRole('checkbox', { name: 'Toolbar badge' })
    await expect(toggle).toBeChecked()

    await setStorageValue(
      extensionContext,
      SETTINGS_STORAGE_KEY,
      { toolbarBadge: false },
      'sync',
    )

    await expect(toggle).not.toBeChecked()
  })
})
