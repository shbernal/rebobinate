// Prints a JSON snapshot of the built extension as a real Chromium sees it:
// the id, the permissions the browser actually granted, the tabs the service
// worker can read a URL from, what the popup is told about the active tab, and
// the extension's stored state.
//
// This exists because none of that is visible from the source tree, and the
// extension is never installed in a personal browser profile — `pnpm dev:chrome`
// and the Playwright suite both load `dist/` into a throwaway profile under
// `node_modules/.tmp/`. Guessing at runtime state from the code is how a
// question like "why does the popup say this page has no site?" gets answered
// wrongly; this answers it with what the browser reports.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'
import { printHelpAndExit } from './help.mjs'

printHelpAndExit(`
Usage: pnpm inspect:chrome [url] [--profile-only] [--help]

Loads dist/ into a headless Chromium, drives it, and prints a JSON snapshot of
what the extension looks like from the inside. Run after \`pnpm build\`.

  url              page to open (default: https://www.youtube.com/)
  --profile-only   only read the profile's granted permissions off disk and
                   exit, without launching. Use this while \`pnpm dev:chrome\`
                   holds the profile open, pointing REBOBINATE_PROFILE_DIR at
                   node_modules/.tmp/dev-profile.

Reported
  extension    id, load location, and the permissions Chromium granted, read
               back out of the profile rather than out of the manifest
  tabs         every tab the service worker can see, and whether its URL is
               readable — a tab whose URL is withheld is the usual reason the
               extension resolves the wrong one
  popupState   the rebobinate:popup-state reply, asked twice: with the web page
               in front, and with the popup document in front
  storage      the normalized settings and the per-site speed map

Environment
  REBOBINATE_PROFILE_DIR   profile directory
                           (default: node_modules/.tmp/inspect-profile)
  REBOBINATE_HEADLESS=0    run headed
  PLAYWRIGHT_CHROMIUM_EXECUTABLE   browser executable
`)

const defaultProfilePath = 'node_modules/.tmp/inspect-profile'
const defaultOpenUrl = 'https://www.youtube.com/'
const extensionPath = path.resolve(process.cwd(), 'dist')

// Duplicated from `scripts/open-chromium.mjs` for the same reason it duplicates
// the e2e fixture: these are plain Node and cannot import the TypeScript ones.
const resolveChromiumExecutable = () => {
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

// Chromium's own name for how an extension got loaded. Only the ones this
// project can produce are named; anything else is left as the raw number.
const LOAD_LOCATIONS = { 4: 'unpacked', 8: 'command line', 10: 'component' }

/**
 * The permissions Chromium granted, read out of the profile.
 *
 * `granted_permissions` is what the user agreed to and `active_permissions`
 * what is in force right now; they differ when host access is withheld, which
 * is what "Site access: on click" does. A withheld host is invisible from the
 * manifest and shows up only as tabs whose URL the extension cannot read, so
 * this is the file that answers whether that is what happened.
 */
const readGrantedPermissions = profilePath => {
  const candidates = ['Preferences', 'Secure Preferences'].map(name =>
    path.join(profilePath, 'Default', name),
  )

  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      continue
    }

    let parsed

    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      // A profile of a running browser can be caught mid-write. The other
      // candidate, or a later run, will do.
      continue
    }

    const settings = parsed.extensions?.settings ?? {}

    for (const [id, entry] of Object.entries(settings)) {
      if (path.resolve(entry.path ?? '') !== extensionPath) {
        continue
      }

      return {
        id,
        source: path.basename(file),
        loadedAs: LOAD_LOCATIONS[entry.location] ?? entry.location,
        granted: entry.granted_permissions ?? null,
        active: entry.active_permissions ?? null,
        hostAccessWithheld: entry.withholding_permissions === true,
      }
    }
  }

  return null
}

const profilePath = path.resolve(
  process.cwd(),
  process.env.REBOBINATE_PROFILE_DIR ?? defaultProfilePath,
)
const argv = process.argv.slice(2)
const profileOnly = argv.includes('--profile-only')
// Flags are skipped rather than taken positionally, matching the other scripts.
const openUrl =
  argv.find(argument => !argument.startsWith('-')) ??
  process.env.REBOBINATE_OPEN_URL ??
  defaultOpenUrl

const print = value => {
  console.log(JSON.stringify(value, null, 2))
}

if (profileOnly) {
  print({
    profile: profilePath,
    extension: readGrantedPermissions(profilePath),
  })
  process.exit(0)
}

if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
  console.error('dist/ is missing — run `pnpm build` first')
  process.exit(1)
}

const headless = process.env.REBOBINATE_HEADLESS !== '0'
const executablePath = resolveChromiumExecutable()

const context = await chromium.launchPersistentContext(profilePath, {
  executablePath,
  // Playwright's default headless binary is the headless shell, which cannot
  // load extensions at all. The full Chromium build (new headless mode) can.
  ...(executablePath ? {} : { channel: 'chromium' }),
  headless,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
  ],
})

const worker =
  context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
const extensionId = new URL(worker.url()).hostname

/** Every tab the service worker can see, and whether it can read its URL. */
const readTabs = () =>
  worker.evaluate(
    () =>
      new Promise(resolve => {
        chrome.tabs.query({}, tabs => {
          resolve(
            tabs.map(tab => ({
              id: tab.id,
              url: tab.url ?? null,
              // Chromium omits the URL of a tab the extension has no access to
              // — every chrome-extension:// and chrome:// page, and every page
              // at all when host access is withheld. The extension then sees a
              // tab it cannot tell apart from a site it simply has not read.
              urlReadable: typeof tab.url === 'string',
              active: tab.active === true,
              windowId: tab.windowId,
            })),
          )
        })
      }),
  )

/** The reply the popup gets when it asks which site the active tab is on. */
const askPopupState = page =>
  page.evaluate(
    () =>
      new Promise(resolve => {
        const timer = setTimeout(
          () => resolve({ error: 'no reply within 5s' }),
          5_000,
        )

        chrome.runtime.sendMessage(
          { type: 'rebobinate:popup-state' },
          reply => {
            clearTimeout(timer)
            resolve(
              reply ?? {
                error: chrome.runtime.lastError?.message ?? 'no reply',
              },
            )
          },
        )
      }),
  )

const page = context.pages()[0] ?? (await context.newPage())
await page.goto(openUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })

const popup = await context.newPage()
await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)

// A real popup is an overlay and the page underneath stays the active tab. The
// popup document opened as a tab is the active one instead, and the two are not
// the same question — so both get asked, and the difference is the finding.
await page.bringToFront()
const withPageActive = {
  tabs: await readTabs(),
  popupState: await askPopupState(popup),
}

await popup.bringToFront()
const withPopupActive = {
  tabs: await readTabs(),
  popupState: await askPopupState(popup),
}

const storage = await worker.evaluate(
  () =>
    new Promise(resolve => {
      chrome.storage.local.get(null, resolve)
    }),
)

await context.close()

print({
  url: openUrl,
  profile: profilePath,
  extensionPath,
  executable: executablePath ?? 'playwright channel: chromium',
  headless,
  extensionId,
  // Read after the context closes, so the browser has flushed the profile.
  extension: readGrantedPermissions(profilePath),
  withPageActive,
  withPopupActive,
  storage,
})
