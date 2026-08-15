// Shared Chromium launching for the scripts that drive the built extension.
//
// The e2e fixtures do the same thing in TypeScript; plain Node cannot import
// those, so the knowledge lives twice on purpose. It does not need to live four
// times, which is what this module is for.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'

export const extensionPath = path.resolve(process.cwd(), 'dist')

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

export const requireBuild = () => {
  if (fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    return
  }

  console.error('dist/ is missing — run `pnpm build` first')
  process.exit(1)
}

/**
 * @param {object} options
 * @param {string} options.profilePath
 * @param {boolean} [options.headless]
 * @param {string[]} [options.extraExtensions] other unpacked extensions to load
 *   alongside `dist/` — a content blocker, for the ad-blocker checks.
 */
export const launchWithExtension = async ({
  profilePath,
  headless = true,
  extraExtensions = [],
}) => {
  const executablePath = resolveChromiumExecutable()
  const loaded = [extensionPath, ...extraExtensions].join(',')

  return chromium.launchPersistentContext(profilePath, {
    executablePath,
    // Playwright's default headless binary is the headless shell, which cannot
    // load extensions at all. The full Chromium build (new headless mode) can.
    ...(executablePath ? {} : { channel: 'chromium' }),
    headless,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${loaded}`,
      `--load-extension=${loaded}`,
      '--no-sandbox',
    ],
  })
}

/** The extension's own service worker, told apart from any blocker's. */
export const extensionWorker = async context => {
  const isOurs = worker => worker.url().includes('service-worker-loader')

  return (
    context.serviceWorkers().find(isOurs) ??
    context.waitForEvent('serviceworker', { predicate: isOurs })
  )
}

/**
 * Puts the tab at a speed other than 1×, which is what makes the badge appear.
 * Driven through the service worker rather than a keystroke so it does not
 * depend on the page having focus or on the current key bindings.
 *
 * crxjs loads the content script through an async loader, so a message sent
 * straight after a navigation can land before anything is listening. Same
 * answer as `e2e/fixtures/controls.ts` gives a keystroke: say it again.
 */
export const showBadge = async (context, page, speed = 1.5, attempts = 20) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await setTabSpeed(context, speed)

    try {
      await page.waitForSelector('#rebobinate-speed-host', {
        state: 'attached',
        timeout: 500,
      })

      return true
    } catch {
      // Not listening yet, or this page has no video to anchor to.
    }
  }

  return false
}

export const setTabSpeed = async (context, speed) => {
  const worker = await extensionWorker(context)

  await worker.evaluate(
    wanted =>
      new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          const tab = tabs[0]

          if (!tab?.id) {
            resolve(false)
            return
          }

          chrome.tabs.sendMessage(
            tab.id,
            { type: 'rebobinate:state', speed: wanted },
            () => {
              void chrome.runtime.lastError
              resolve(true)
            },
          )
        })
      }),
    speed,
  )
}

/**
 * What the badge is doing right now, and why.
 *
 * Computed style is the only reading that sees a blocker: element-hiding CSS is
 * injected at user origin, so it leaves no trace in the DOM the page can read —
 * the host is still attached, still styled by its own `:host` rule, and simply
 * not displayed.
 */
export const badgeProbe = () => {
  const host = document.getElementById('rebobinate-speed-host')
  const videos = Array.from(document.querySelectorAll('video'))

  if (!host) {
    return {
      present: false,
      videos: videos.length,
      verdict:
        videos.length === 0
          ? 'no video in this frame for the badge to sit on'
          : 'the content script never created the badge',
    }
  }

  const computed = getComputedStyle(host)
  const rect = host.getBoundingClientRect()
  const own = host.shadowRoot?.querySelector('style')?.textContent ?? ''
  const wanted = /display:([a-z-]+)!important/.exec(own)?.[1] ?? null
  const overridden = wanted !== null && computed.display !== wanted

  return {
    present: true,
    videos: videos.length,
    parent: host.parentElement?.tagName.toLowerCase() ?? null,
    inlineStyle: host.getAttribute('style'),
    wantedDisplay: wanted,
    computed: {
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      position: computed.position,
      zIndex: computed.zIndex,
    },
    rect: {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
    },
    labelText: host.shadowRoot?.querySelector('div')?.textContent ?? null,
    verdict: overridden
      ? 'overridden from outside the page — user-origin CSS, which is what a content blocker injects'
      : wanted === 'none'
        ? 'the badge hid itself: no anchor video, off screen, or auto-hidden'
        : rect.width === 0 || rect.height === 0
          ? 'the badge is displayed but has no box'
          : 'the badge is visible',
  }
}
