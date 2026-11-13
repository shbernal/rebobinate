// Where the built extension is and which Chromium loads it, for everything that
// launches one: the scripts here, the e2e fixtures and the mimic config. Kept
// free of `@playwright/test` so mimic, which injects its own `chromium`, can
// import it without pulling in a second browser build.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const extensionPath = path.resolve(process.cwd(), 'dist')

/**
 * The Chromium to launch, or undefined to fall back to Playwright's `chromium`
 * channel. Never the default headless shell, which cannot load extensions.
 *
 * @returns {string | undefined}
 */
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

/**
 * Removes a reused profile's service-worker store before launch.
 *
 * Chromium keeps the extension's service worker in that store and goes on
 * running the cached script after `dist/` is rebuilt, as long as the manifest
 * version is unchanged: the new content script then talks to the old service
 * worker, and any message it does not know is dropped without an error. The
 * extension registers its worker again on load, and site logins live elsewhere
 * in the profile, so nothing worth keeping goes with it.
 *
 * @param {string} profilePath
 */
export const dropCachedServiceWorkers = profilePath => {
  fs.rmSync(path.join(profilePath, 'Default', 'Service Worker'), {
    recursive: true,
    force: true,
  })
}
