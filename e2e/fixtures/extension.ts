import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import type { BadgeSettings, Settings } from '../../src/shared/settings'
import { SETTINGS_STORAGE_KEY } from '../../src/shared/settings'

/**
 * Seeded settings go through `normalizeSettings` in the extension, so a test
 * only has to state the fields it cares about.
 */
type PartialSettings = Partial<Omit<Settings, 'badge'>> & {
  badge?: Partial<BadgeSettings>
}
import {
  closeExtensionContext,
  getExtensionId,
  launchExtensionContext,
  openExtensionPage as openExtensionPageInContext,
  removeStorageValues,
  setStorageValue,
  waitForExtensionWorker,
} from './extensionRuntime'
import { FIXTURE_ORIGIN, installFixtureRoutes } from './pages'

type ExtensionFixtures = {
  extensionContext: BrowserContext
  extensionId: string
  openFixture: (pathname: string) => Promise<Page>
  openPopup: () => Promise<Page>
  seedSettings: (settings: PartialSettings) => Promise<void>
}

export const test = base.extend<ExtensionFixtures>({
  extensionContext: async ({ headless }, use, testInfo) => {
    const context = await launchExtensionContext({
      userDataDir: testInfo.outputPath('chromium-profile'),
      headless,
    })

    await installFixtureRoutes(context)
    await waitForExtensionWorker(context)
    await use(context)
    await closeExtensionContext(context)
  },

  extensionId: async ({ extensionContext }, use) => {
    await use(await getExtensionId(extensionContext))
  },

  seedSettings: async ({ extensionContext }, use) => {
    await use(async settings => {
      if (Object.keys(settings).length === 0) {
        await removeStorageValues(extensionContext, [SETTINGS_STORAGE_KEY])
        return
      }

      await setStorageValue(extensionContext, SETTINGS_STORAGE_KEY, settings)
    })
  },

  openFixture: async ({ extensionContext }, use) => {
    await use(async pathname => {
      const page = await extensionContext.newPage()
      await page.goto(`${FIXTURE_ORIGIN}${pathname}`)
      await page.waitForLoadState('domcontentloaded')

      return page
    })
  },

  openPopup: async ({ extensionContext, extensionId }, use) => {
    await use(async () =>
      openExtensionPageInContext(
        extensionContext,
        extensionId,
        '/src/popup/index.html',
      ),
    )
  },
})

export { expect }
