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
import type { DomainMemory, DomainStore } from '../../src/shared/domains'
import { DOMAINS_STORAGE_KEY } from '../../src/shared/domains'
import {
  closeExtensionContext,
  getExtensionId,
  getStorageValue,
  launchExtensionContext,
  openExtensionPage as openExtensionPageInContext,
  readActionBadge,
  removeStorageValues,
  setStorageValue,
  waitForExtensionWorker,
} from './extensionRuntime'
import { FIXTURE_ORIGIN, installFixtureRoutes } from './pages'

type ExtensionFixtures = {
  /**
   * Unpacked extensions to load alongside the build. Set per file with
   * `test.use({ blockers: [blockerPath] })`; empty everywhere else, so the rest
   * of the suite keeps running against the extension on its own.
   */
  blockers: string[]
  extensionContext: BrowserContext
  extensionId: string
  openFixture: (pathname: string) => Promise<Page>
  openPopup: () => Promise<Page>
  seedSettings: (settings: PartialSettings) => Promise<void>
  /** What the extension has written down per site, as it stands right now. */
  rememberedSites: () => Promise<Record<string, DomainMemory>>
  /**
   * The badge and tooltip on the toolbar icon: for the tab open on `url`, or
   * the global pair every unvisited tab shows when `url` is left out.
   */
  actionBadge: (url?: string) => Promise<{ text: string; title: string }>
}

export const test = base.extend<ExtensionFixtures>({
  blockers: [[], { option: true }],

  extensionContext: async ({ headless, blockers }, use, testInfo) => {
    const context = await launchExtensionContext({
      userDataDir: testInfo.outputPath('chromium-profile'),
      headless,
      extraExtensions: blockers,
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

  rememberedSites: async ({ extensionContext }, use) => {
    await use(async () => {
      const stored = await getStorageValue<DomainStore>(
        extensionContext,
        DOMAINS_STORAGE_KEY,
      )

      return stored?.entries ?? {}
    })
  },

  actionBadge: async ({ extensionContext }, use) => {
    await use(async url => readActionBadge(extensionContext, url))
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
