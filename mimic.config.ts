import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
// Type-only, so nothing is resolved at run time: Node strips it before it
// ever looks at the path.
import type { SeedSite } from './mimic/page.ts'

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

/** The browser window every scenario is captured in, and recorded at. */
const VIEWPORT = { width: 1280, height: 800 }

/**
 * Except for the scenarios filmed inside the panel, which are captured in a
 * window the size of the panel.
 *
 * Playwright records a page at the context's video size and pads anything
 * smaller rather than cropping to it, so a 320px panel filmed in a 1280px
 * window is a stamp in the middle of a black field. 320 is the panel's own
 * width, set in `src/popup/index.css`.
 *
 * The height is per scenario because the panel's is: each tab is as tall as
 * what is on it, and a window sized for the tallest tab a scenario visits
 * leaves a band of bare window under the shorter ones. That band is not the
 * panel having an empty bottom, and every one of these scenarios says so in
 * the narration over its recording rather than leaving a judge to read it as
 * design.
 */
const PANEL_WINDOWS: Record<string, number> = {
  'panel-scrolling': 540,
  'moving-between-tabs': 540,
  'setting-a-speed': 250,
  'following-the-link': 540,
  'a-list-of-sites': 540,
  'binding-a-new-key': 540,
  'choosing-a-colour': 540,
  'turning-the-marker-off': 540,
}

/** Keyed by scenario id, which is all the launch hook is told about one. */
const windowFor = (scenario: string) => {
  const height = PANEL_WINDOWS[scenario]

  return height === undefined ? VIEWPORT : { width: 320, height }
}

/**
 * Where the extension keeps its per-site speeds, repeated here rather than
 * imported.
 *
 * Node runs this file by stripping the types, which resolves no extensions, and
 * `src/shared/domains.ts` imports its own neighbours without any — so importing
 * the real constant is not available to this file. Drift is caught rather than
 * assumed: a scenario that seeds sites asserts the count the panel then lists,
 * so a renamed key fails the capture instead of quietly seeding nothing.
 */
const DOMAINS_STORAGE_KEY = 'rebobinate:domains'

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
    // A judge that can take video. Most cannot: the frontier text-and-image
    // models refuse a video part outright, and one scenario now hands over a
    // recording rather than a storyboard.
    model: 'google/gemini-3.1-pro-preview',
    concurrency: 4,

    // The lens is mimic's — a persona, reusable across targets. What belongs
    // here is what the thing *is*: without it, "modern web standards" invites a
    // critique asking a 360px panel for a hero section.
    lens: 'design',
    notes:
      'A browser extension for changing how fast a video plays. It has two surfaces, and an exhibit shows one or the other. The first is its popup panel, about 360px wide, opened over the page the person is watching: a compact utility panel, not a page — judge it against other extension popups and system panels, not against a website. The second is a small marker the extension draws on top of the video itself, on whatever site the person happens to be on. It sits over arbitrary video sites, so neither surface can rely on anything behind it.',
  },

  async launch({
    chromium,
    needsLiveTabState,
    recordVideo,
    scenario,
  }: {
    chromium: typeof import('@playwright/test').chromium
    needsLiveTabState: boolean
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
    const viewport = windowFor(scenario)

    const context = await chromium.launchPersistentContext(profilePath, {
      ...(executablePath === undefined
        ? // Playwright's default headless binary is the headless shell, which
          // cannot load extensions at all. The full Chromium build can.
          { channel: 'chromium' }
        : { executablePath }),
      headless: true,
      viewport,
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
      // Passed through with a size, which mimic deliberately leaves to the
      // target: Playwright otherwise scales a recording down to fit an 800px
      // box, and the wide viewport is 1280. The marker recorded at that size is
      // 14px of text, and shrinking the frame by a third is how a judge ends up
      // reporting a legibility problem the recorder invented.
      ...(recordVideo === undefined
        ? {}
        : { recordVideo: { ...recordVideo, size: viewport } }),
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
     * The popup document can also be opened as an ordinary tab — `openPanel`
     * below — and that is the trap: a tab-opened popup is itself the active
     * tab, so anything that depends on which tab is active renders a plausible
     * lie. `chrome.action.openPopup()` avoids that entirely. Playwright does
     * not surface the resulting page on its own context, so it is reached over
     * a second CDP connection.
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

    /**
     * Open the popup document as an ordinary tab, which is the only version of
     * the panel that can be filmed.
     *
     * `recordVideo` films the pages the launched context owns, and the real
     * popup is not one of them: it is reached over the second connection above
     * and has no `video()` at all. A tab is a page like any other, and at
     * `PANEL_WINDOW` it is the panel and nothing else.
     *
     * What the tab costs is the active tab. The service worker falls back to
     * the last web tab in the window when an extension page is frontmost, so
     * the panel here still reads a real site and really drives it — but "the
     * page the person is looking at" and "the last web page they touched" are
     * the same tab only while one is open. A scenario that turns on live tab
     * state is refused this path rather than filmed through that assumption.
     */
    const openPanel = async (): Promise<Page> => {
      if (needsLiveTabState) {
        throw new Error(
          'openPanel() opens the panel as a tab, which does not observe the ' +
            'live active tab. Use openPopup(), or drop needsLiveTabState.',
        )
      }

      const page = await context.newPage()
      await page.goto(`${prefix()}src/popup/index.html`)
      await page.waitForSelector('main.popup')

      // Tint what is not the panel. The window is sized for the tallest tab a
      // scenario visits, so on a shorter one there is bare window under the
      // panel — and the panel's own background is the page's, so that band
      // came out the same colour as the panel and read as the popup having a
      // large empty bottom. It is the recorder, not the product, and a judge
      // has no way to know that from the pixels.
      //
      // `main.popup` is transparent and takes its colour from the body, so the
      // tint has to be handed back to it explicitly — `Canvas` is what
      // `src/popup/index.css` sets on the body, and is therefore the colour
      // the panel is already painted. Tinting the body alone put grey through
      // every gap between the panel's own rows.
      await page.addStyleTag({
        content:
          'body { background: #4a4a55 } main.popup { background: Canvas }',
      })

      return page
    }

    /**
     * Put sites in the extension's memory before the panel is opened.
     *
     * Every other scenario builds its state by clicking, which is the honest
     * way and stays the default. It cannot reach this one: the panel remembers
     * a speed against the domain of the tab behind it, the recorded panel is a
     * tab of its own, and there is exactly one fixture origin — so a list of a
     * dozen sites is a dozen browsing sessions on a dozen domains, and no
     * amount of clicking inside one capture produces it.
     *
     * What that licence is allowed to cover, and nothing else:
     *
     * - **The extension's own store, in the extension's own shape.** One write
     *   to the one key it reads, holding the same three fields
     *   `rememberDomain` writes: a speed, a timestamp, and the never marker.
     *   No invented fields, no second key.
     * - **Time, not behaviour.** Every entry is one a person could have made by
     *   pressing a key on that site. The timestamps are what a scenario cannot
     *   sit through — they are spaced a minute apart, newest first, which is
     *   what "most recently touched" means to the list.
     * - **Nothing the panel itself owns.** No open tab, no typed filter, no
     *   setting. Anything a scenario claims about the panel is still reached by
     *   clicking it, and a seeded row is real enough that the ✕ on it deletes a
     *   real entry.
     *
     * Written from inside the service worker, so it is the extension's own
     * `chrome.storage.local` and the popup's subscription sees it arrive the
     * way it sees any other write.
     */
    const seedDomains = async (sites: SeedSite[]) => {
      const now = Date.now()
      const entries = Object.fromEntries(
        sites.map((site, index) => [
          site.domain,
          {
            speed: site.speed ?? 1,
            updatedAt: now - index * 60_000,
            never: site.never === true,
          },
        ]),
      )

      await worker.evaluate(
        ({ key, store }) => chrome.storage.local.set({ [key]: store }),
        { key: DOMAINS_STORAGE_KEY, store: { schemaVersion: 2, entries } },
      )
    }

    return {
      context,
      // The real popup observes the real active tab, so scenarios that turn on
      // live tab state are honest here. What keeps that true is the guard in
      // `openPanel`: the tab path refuses those scenarios itself.
      observesLiveTabState: true,
      meta: { extensionId, openPopup, openPanel, seedDomains },
      close: async () => {
        await cdp?.close()
      },
    }
  },
}
