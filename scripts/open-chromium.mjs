// Opens a persistent Chromium with the built extension loaded and leaves it
// open, so the manual validation list in docs/testing.md can be walked without
// installing an unpacked extension by hand. Run after `pnpm build`.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'
import { printHelpAndExit } from './help.mjs'

printHelpAndExit(`
Usage: pnpm dev:chrome [url] [--help]

Opens Chromium with dist/ loaded as an unpacked extension and leaves it open,
for the manual validation list in docs/testing.md.

  url   page to open (default: https://www.youtube.com/)

The profile lives under node_modules/.tmp/ and survives between runs, so a site
you logged into once stays logged in.

Environment
  REBOBINATE_PROFILE_DIR   profile directory (default the one above)
  REBOBINATE_OPEN_URL      start URL when no positional argument is given
  REBOBINATE_HEADLESS=1    new headless mode, for driving over CDP
`)

const defaultProfilePath = 'node_modules/.tmp/dev-profile'
const defaultOpenUrl = 'https://www.youtube.com/'
const extensionPath = path.resolve(process.cwd(), 'dist')

// Duplicated from `e2e/fixtures/extensionRuntime.ts` on purpose: this script is
// plain Node and cannot import the TypeScript fixtures.
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

if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
  console.error('dist/ is missing — run `pnpm build` first')
  process.exit(1)
}

const profilePath = path.resolve(
  process.cwd(),
  process.env.REBOBINATE_PROFILE_DIR ?? defaultProfilePath,
)
// Flags are skipped rather than taken positionally, so the bare `--` left by
// the npm-style `pnpm dev:chrome -- --help` cannot end up being opened as a URL.
const openUrl =
  process.argv.slice(2).find(argument => !argument.startsWith('-')) ??
  process.env.REBOBINATE_OPEN_URL ??
  defaultOpenUrl
const headless = process.env.REBOBINATE_HEADLESS === '1'
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

const page = context.pages()[0] ?? (await context.newPage())
await page.goto(openUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })

console.log(
  JSON.stringify(
    {
      url: page.url(),
      profile: profilePath,
      executable: executablePath ?? 'playwright channel: chromium',
      headless,
      extensionId,
      popup: `chrome-extension://${extensionId}/src/popup/index.html`,
    },
    null,
    2,
  ),
)
console.log('Chromium is open. Close the browser window to end this command.')

await new Promise(resolve => {
  context.on('close', resolve)
})
