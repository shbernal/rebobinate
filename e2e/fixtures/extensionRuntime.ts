import fs from 'node:fs'
import path from 'node:path'
import {
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test'

type LaunchExtensionContextOptions = {
  userDataDir: string
  headless: boolean
  /**
   * Other unpacked extensions to load next to the build — a content blocker,
   * for the ad-blocker checks. Chromium takes a comma-separated list, and both
   * flags have to name every one of them: `--disable-extensions-except` is what
   * keeps anything else out.
   */
  extraExtensions?: string[]
}

export const extensionPath = path.resolve(process.cwd(), 'dist')

/** The stand-in content blocker. `e2e/fixtures/blocker/blocker.js` says why. */
export const blockerPath = path.resolve(process.cwd(), 'e2e/fixtures/blocker')

export const resolveChromiumExecutable = () => {
  const explicitExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

  if (explicitExecutable) {
    return explicitExecutable
  }

  return [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].find(candidate => fs.existsSync(candidate))
}

export const launchExtensionContext = async ({
  userDataDir,
  headless,
  extraExtensions = [],
}: LaunchExtensionContextOptions) => {
  const executablePath = resolveChromiumExecutable()
  const loaded = [extensionPath, ...extraExtensions].join(',')

  return chromium.launchPersistentContext(userDataDir, {
    executablePath,
    // Playwright's default headless binary is the headless shell, which cannot
    // load extensions at all. The full Chromium build (new headless mode) can.
    ...(executablePath ? {} : { channel: 'chromium' as const }),
    headless,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${loaded}`,
      `--load-extension=${loaded}`,
      '--no-sandbox',
    ],
  })
}

export const closeExtensionContext = async (context: BrowserContext) => {
  try {
    await context.close()
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Target page, context or browser has been closed')
    ) {
      return
    }

    throw error
  }
}

// Told apart from a blocker's worker by the crxjs loader in the file name: with
// two extensions loaded, "the first service worker" is a coin flip.
export const isExtensionWorker = (worker: Worker) => {
  return (
    worker.url().startsWith('chrome-extension://') &&
    worker.url().includes('service-worker-loader')
  )
}

export const waitForExtensionWorker = async (context: BrowserContext) => {
  const existingWorker = context.serviceWorkers().find(isExtensionWorker)

  if (existingWorker) {
    return existingWorker
  }

  return context.waitForEvent('serviceworker', {
    predicate: isExtensionWorker,
  })
}

export const getExtensionId = async (context: BrowserContext) => {
  const worker = await waitForExtensionWorker(context)

  return new URL(worker.url()).hostname
}

export const setStorageValue = async <Value>(
  context: BrowserContext,
  key: string,
  value: Value,
) => {
  const worker = await waitForExtensionWorker(context)

  await worker.evaluate(
    ({ storageKey, storageValue }) =>
      new Promise<void>(resolve => {
        chrome.storage.local.set({ [storageKey]: storageValue }, () => {
          resolve()
        })
      }),
    { storageKey: key, storageValue: value },
  )
}

export const getStorageValue = async <Value>(
  context: BrowserContext,
  key: string,
): Promise<Value | undefined> => {
  const worker = await waitForExtensionWorker(context)

  return worker.evaluate(
    storageKey =>
      new Promise<unknown>(resolve => {
        chrome.storage.local.get(storageKey, stored => {
          resolve(stored?.[storageKey])
        })
      }),
    key,
  ) as Promise<Value | undefined>
}

export const removeStorageValues = async (
  context: BrowserContext,
  keys: string[],
) => {
  const worker = await waitForExtensionWorker(context)

  await worker.evaluate(
    storageKeys =>
      new Promise<void>(resolve => {
        chrome.storage.local.remove(storageKeys, () => {
          resolve()
        })
      }),
    keys,
  )
}

export const openExtensionPage = async (
  context: BrowserContext,
  extensionId: string,
  pagePath: string,
) => {
  const page: Page = await context.newPage()
  const normalizedPath = pagePath.startsWith('/') ? pagePath : `/${pagePath}`

  await page.goto(`chrome-extension://${extensionId}${normalizedPath}`)

  return page
}
