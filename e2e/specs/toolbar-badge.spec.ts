import { pressSpeedKey } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'
import { FIXTURE_ORIGIN } from '../fixtures/pages'

const SIMPLE = `${FIXTURE_ORIGIN}/simple`

/**
 * The toolbar itself is browser chrome, which Playwright cannot see. What it
 * can do is ask the service worker what it wrote, which is the only automated
 * proof that the browser accepted the calls at all — a rejected `chrome.action`
 * call is silent, and every unit test would still pass.
 */
test.describe('the speed on the toolbar icon', () => {
  test('follows the tab as the speed changes', async ({
    openFixture,
    actionBadge,
  }) => {
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')

    await expect.poll(async () => (await actionBadge(SIMPLE)).text).toBe('1.05')
    expect((await actionBadge(SIMPLE)).title).toBe('Rebobinate — 1.05×')
  })

  test('shows a remembered speed before the first keystroke', async ({
    openFixture,
    rememberedSites,
    actionBadge,
  }) => {
    const page = await openFixture('/simple')
    await pressSpeedKey(page, '+')

    // The per-site write is debounced by a second, and the second visit has
    // nothing to remember until it lands.
    await expect
      .poll(async () => (await rememberedSites())['player.test']?.speed)
      .toBeCloseTo(1.05, 3)

    await page.close()

    // A second visit: the speed comes back from the per-site memory, and the
    // icon has to say so without the user touching anything.
    await openFixture('/simple')

    await expect.poll(async () => (await actionBadge(SIMPLE)).text).toBe('1.05')
  })

  test('shows the default on a tab it has never heard from', async ({
    seedSettings,
    actionBadge,
  }) => {
    await seedSettings({ defaultSpeed: 1.5 })

    await expect.poll(async () => (await actionBadge()).text).toBe('1.5')
  })

  test('stays empty while the setting is off', async ({
    seedSettings,
    openFixture,
    actionBadge,
  }) => {
    await seedSettings({ toolbarBadge: false })
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')

    expect((await actionBadge(SIMPLE)).text).toBe('')
  })
})
