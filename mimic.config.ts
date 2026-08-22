import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

/**
 * Configuration for `mimic`, which drives this extension and has a code-blind
 * model critique what it sees. Run it with `mimic run --target .` from a
 * checkout where `mimic` is on PATH (`pnpm link --global` in ~/Work/mimic).
 *
 * Mimic knows nothing about extensions. Everything extension-shaped —  loading
 * `dist/`, finding the service worker, opening the popup — lives in the `launch`
 * hook below and reaches the scenarios through `s.meta`.
 *
 * Scenarios live in this repo rather than in mimic's, because when a control
 * moves, the scenario that clicks it and the narration describing it have to
 * change in the same commit.
 */

const extensionPath = path.resolve(process.cwd(), 'dist')

/**
 * The same knowledge as `scripts/chromium.mjs`, which cannot be imported here:
 * that module imports `@playwright/test` directly, and mimic injects its own
 * `chromium` precisely so one browser build is in play instead of two.
 */
const resolveChromiumExecutable = () =>
  [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].find(candidate => existsSync(candidate))

/**
 * Chrome writes the port it actually bound to here when asked for port 0.
 * Reading it beats picking a fixed port, which collides with a leftover browser.
 */
const readDevToolsPort = (profilePath: string) => {
  const file = path.join(profilePath, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, 'utf8').split('\n')
      if (port !== undefined && port.trim() !== '') return Number(port.trim())
    }
  }
  throw new Error(`Chrome never wrote ${file}`)
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default {
  name: 'rebobinate',

  // Mimic drives the built output. It never captures the source.
  build: 'pnpm build',

  // What "green" means here, handed to the agent phases.
  verify: ['pnpm typecheck', 'pnpm test'],

  scenarios: 'mimic/scenarios/*.ts',
  artifacts: '.tmp/mimic',
  env: '.env',

  judge: {
    provider: 'openrouter',
    model: 'openai/gpt-5.6-sol-pro',
    concurrency: 4,

    // The lens is mimic's — a persona, reusable across targets. What belongs
    // here is what the thing *is*: without it, "modern web standards" invites a
    // critique asking a 360px panel for a hero section.
    lens: 'design',
    notes:
      'A browser-extension popup, about 360px wide, opened over the page the person is watching. It is a compact utility panel, not a page — judge it against other extension popups and system panels, not against a website. It sits over arbitrary video sites, so it cannot rely on anything behind it.',
  },

  async launch({
    chromium,
    recordVideo,
    scenario,
  }: {
    chromium: typeof import('@playwright/test').chromium
    recordVideo?: { dir: string }
    scenario: string
  }) {
    // A throwaway profile per scenario, never a personal one. Per scenario
    // rather than shared so that what one scenario stores cannot leak into the
    // next and quietly change what the judge is shown.
    const profilePath = path.resolve(
      process.cwd(),
      'node_modules/.tmp/mimic-profiles',
      scenario,
    )

    // Wiped every launch, and this matters more than it looks. A persistent
    // context keeps extension storage, so a re-capture would open on whatever
    // the previous attempt left behind — the panel would show a setting nobody
    // in this run turned on, and the narration would describe a state that did
    // not come from these steps.
    rmSync(profilePath, { recursive: true, force: true })

    const executablePath = resolveChromiumExecutable()

    const context = await chromium.launchPersistentContext(profilePath, {
      ...(executablePath === undefined
        ? // Playwright's default headless binary is the headless shell, which
          // cannot load extensions at all. The full Chromium build can.
          { channel: 'chromium' }
        : { executablePath }),
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        // Without this the service worker never registers and the wait below
        // times out, which reads like a broken extension rather than a missing
        // flag.
        '--no-sandbox',
        // Port 0 lets Chrome choose; the popup is only reachable through a
        // second CDP connection, see openPopup.
        '--remote-debugging-port=0',
      ],
      ...(recordVideo === undefined ? {} : { recordVideo }),
    })

    const isOurs = (worker: { url(): string }) =>
      worker.url().includes('service-worker-loader')
    const worker =
      context.serviceWorkers().find(isOurs) ??
      (await context.waitForEvent('serviceworker', { predicate: isOurs }))
    const extensionId = new URL(worker.url()).hostname

    // Opened lazily, and only by the scenarios that need the real popup.
    let cdp: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null

    /**
     * Open the **real** popup — the overlay, which leaves the page underneath
     * as the active tab.
     *
     * The popup document can also be opened as an ordinary tab, and that is the
     * trap: a tab-opened popup is itself the active tab, so the service worker
     * resolves it instead of the video page, and anything that depends on which
     * tab is active renders a plausible lie. `chrome.action.openPopup()` avoids
     * that entirely. Playwright does not surface the resulting page on its own
     * context, so it is reached over a second CDP connection.
     */
    const prefix = () => `chrome-extension://${extensionId}/`

    const findPopup = (browser: NonNullable<typeof cdp>) =>
      browser
        .contexts()
        .flatMap(c => c.pages())
        .find(page => page.url().startsWith(prefix()))

    const openPopup = async (): Promise<Page> => {
      // Headless Chrome does not dismiss the popup when the page behind it
      // takes focus, and `openPopup()` refuses while one is already open.
      // Closing it explicitly is what makes "close the panel and open it
      // again" — an ordinary thing for a person to do — reproducible.
      if (cdp !== null) {
        await findPopup(cdp)?.close()
        await cdp.close()
        cdp = null
        await sleep(300)
      }

      await worker.evaluate(() => chrome.action.openPopup())
      await sleep(600)

      // Connected *after* the popup exists, deliberately. Playwright never
      // reports an extension popup target, so one created after the connection
      // is opened would stay invisible; a fresh connection sees it in its
      // initial snapshot.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        cdp ??= await chromium.connectOverCDP(
          `http://127.0.0.1:${readDevToolsPort(profilePath)}`,
        )
        const popup = findPopup(cdp)
        if (popup !== undefined) {
          await popup.waitForSelector('main.popup')
          return popup
        }
        await cdp.close()
        cdp = null
        await sleep(300)
      }
      throw new Error('the popup never appeared')
    }

    return {
      context,
      // The real popup observes the real active tab, so scenarios that turn on
      // live tab state are honest here. Never set this true for the tab path.
      observesLiveTabState: true,
      meta: { extensionId, openPopup },
      close: async () => {
        await cdp?.close()
      },
    }
  },
}
