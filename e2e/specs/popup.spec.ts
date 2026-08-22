import type { Page } from '@playwright/test'
import { BACKUP_FORMAT, BACKUP_VERSION } from '../../src/shared/backup'
import { DOMAINS_SCHEMA_VERSION } from '../../src/shared/domains'
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
 * Both halves of a backup go through a textarea, because a popup cannot open a
 * file picker on Gecko. What only a real browser can show is that the two
 * stores really are written: the settings by the popup, the site list by the
 * service worker.
 */
test.describe('popup backup', () => {
  test('exports what is actually stored', async ({
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

    const popup = await openPopup()
    await openTab(popup, 'Settings')
    // The pair arrives on Export, so there is nothing to press to read it.
    await expect(popup.getByRole('button', { name: 'Export' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const exported = JSON.parse(
      await popup.getByLabel('Backup').inputValue(),
    ) as { format: string; domains: { entries: Record<string, unknown> } }

    expect(exported.format).toBe(BACKUP_FORMAT)
    expect(exported.domains.entries['player.test']).toBeDefined()
  })

  test('restores the settings and replaces the site list', async ({
    openFixture,
    openPopup,
    rememberedSites,
  }) => {
    const page = await openFixture('/simple')
    await page.bringToFront()

    await pressSpeedKey(page, '+')
    await expect
      .poll(async () => Object.keys(await rememberedSites()))
      .toEqual(['player.test'])

    const backup = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      settings: { step: 0.5 },
      domains: {
        schemaVersion: DOMAINS_SCHEMA_VERSION,
        entries: { 'restored.example': { speed: 2, updatedAt: 9 } },
      },
    })

    const popup = await openPopup()
    await openTab(popup, 'Settings')
    await popup.getByRole('button', { name: 'Import' }).click()
    await popup.getByLabel('Backup to restore').fill(backup)
    await popup
      .getByRole('button', { name: 'Replace settings' })
      .dispatchEvent('click')

    // The map the backup carried, and only it: the site the keystroke above
    // remembered is gone.
    await expect
      .poll(async () => Object.keys(await rememberedSites()))
      .toEqual(['restored.example'])

    // And the restored step is the one the page is driven at.
    await page.bringToFront()
    await pressSpeedKey(page, '0')
    await pressSpeedKey(page, '+')

    await expect.poll(() => rateOf(page)).toBeCloseTo(1.5, 3)
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

/**
 * The row for the site the service worker resolved, under the "This tab"
 * heading. Addressed through the heading rather than as the first `.sites`
 * list, because when there is no row the first such list is the
 * remembered-sites one below, which names the same site and would answer for
 * it. The `hr` closes the section, so matching it too means an absent row
 * resolves to something empty rather than to the list below.
 */
const thisTabBlock = (popup: Page) =>
  popup
    .locator('h2.pane-heading', { hasText: 'This tab' })
    .locator('xpath=following-sibling::*[self::ul or self::hr][1]')

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

    // The row is the domain the service worker resolved, not anything the popup
    // worked out for itself.
    const thisTab = thisTabBlock(popup)

    await expect(thisTab).toContainText('player.test')
    // Exact: the row's ✕ names the same outcome as the select's `Use default`
    // option, so its label contains this one as a substring.
    await expect(
      thisTab.getByLabel('Speed for player.test', { exact: true }),
    ).toHaveValue('1.05')
  })

  // Chromium answers for the popup's own tab with no URL at all — the key is
  // absent, not a `chrome-extension://` one — so a service worker that reads a
  // missing URL as an ordinary page takes that tab for the site and names
  // nothing. Which document happens to be in front is not something the answer
  // may depend on: a real popup is an overlay and never faces this, but the
  // popup document opened in a tab is a click away in development.
  test('shows the site with the popup document itself in front', async ({
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

    // Deliberately not handed back to the page. The popup asks once, on mount,
    // so it has to be brought to the front and re-mounted — opening it and
    // raising it afterwards would ask the question while the page was still
    // active and prove nothing.
    const popup = await openPopup()
    await popup.bringToFront()
    await popup.reload()
    await popup.getByRole('tab', { name: 'Sites' }).click()

    await expect(thisTabBlock(popup)).toContainText('player.test')
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
    // One control carries the whole state of a row, so switching a site off is
    // an option of the same select that sets its speed.
    await popup
      .getByLabel('Speed for player.test', { exact: true })
      .selectOption('never')

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
