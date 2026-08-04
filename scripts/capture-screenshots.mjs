// Captures the store listing screenshots from the real extension: the popup,
// the speed badge over a player, and the "contribute on GitHub" card. Run after
// `pnpm build`.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'
import { printHelpAndExit } from './help.mjs'

printHelpAndExit(`
Usage: node scripts/capture-screenshots.mjs [--help]

Captures the three listing screenshots from the built extension in dist/, so
they can be regenerated instead of retouched. Run pnpm build first.

Output goes to store/screenshots/ at 1280x800, which both stores accept and
neither needs post-processed. The images are shared: the Chrome dashboard takes
them as they are and amo/previews.json orders and captions the same files, so
replacing one here means checking that manifest still describes it.

See docs/store-listings.md.
`)

const root = process.cwd()
const extensionPath = path.join(root, 'dist')
const outputDir = path.join(root, 'store', 'screenshots')
const profileDir = path.join(root, 'node_modules', '.tmp', 'screenshot-profile')

if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
  console.error('dist/ is missing — run `pnpm build` first')
  process.exit(1)
}

const page = (title, body) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: #12121a;
        color: #eceaf5;
        font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
        display: flex;
        justify-content: center;
        padding: 56px 40px;
      }
      main { width: 900px; }
      h1 { font-size: 24px; margin: 0 0 4px; }
      p.meta { margin: 0 0 20px; color: #9c98b3; font-size: 14px; }
      .player {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        border-radius: 10px;
        overflow: hidden;
        background: linear-gradient(135deg, #2b2d6e, #4b2aa8 55%, #7b3fd4);
      }
      video { width: 100%; height: 100%; display: block; opacity: 0; }
      .chrome {
        position: absolute;
        inset: auto 0 0 0;
        height: 44px;
        background: linear-gradient(transparent, rgba(0, 0, 0, 0.55));
      }
      .bar {
        position: absolute;
        left: 16px;
        right: 16px;
        bottom: 18px;
        height: 4px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.3);
      }
      .bar::after {
        content: '';
        position: absolute;
        inset: 0 62% 0 0;
        border-radius: 2px;
        background: #fff;
      }
      ul { margin: 24px 0 0; padding-left: 20px; color: #b9b5cd; }
      li { margin-bottom: 6px; }
      kbd {
        background: #2a2838;
        border: 1px solid #3d3a52;
        border-radius: 4px;
        padding: 1px 6px;
        font: inherit;
      }
    </style>
  </head>
  <body>${body}</body>
</html>
`

const PLAYER_PAGE = page(
  'Rebobinate',
  `<main>
    <h1>Long-form talk · part 3</h1>
    <p class="meta">1:42:08 · press + to speed up, - to slow down, 0 to reset</p>
    <div class="player">
      <video id="player"></video>
      <div class="chrome"></div>
      <div class="bar"></div>
    </div>
    <ul>
      <li><kbd>+</kbd> and <kbd>-</kbd> step the speed by 0.05, or whatever you set</li>
      <li><kbd>0</kbd> puts it back to normal</li>
      <li>The badge shows the current speed, in the corner and style you choose</li>
    </ul>
  </main>`,
)

const REPO_SLUG = 'shbernal/rebobinate'

// Breathing room around the popup on the 1280x800 listing canvas.
const MARGIN = 48

// The GitHub mark. The path is a disc with the octocat as negative space, so a
// flat white fill is all it takes to read correctly on a dark card.
const GITHUB_MARK = `<svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
  <path fill="#ffffff" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
</svg>`

const CARD_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Rebobinate is free software</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        width: 1280px;
        height: 800px;
        background: #12121a;
        color: #ffffff;
        font-family: 'Noto Sans', system-ui, -apple-system, 'Segoe UI',
          sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: 118px;
      }
      h1 {
        margin: 0;
        max-width: 900px;
        font-size: 46px;
        font-weight: 700;
        line-height: 1.6;
        text-align: center;
        letter-spacing: -0.01em;
      }
      .repo {
        display: flex;
        align-items: center;
        gap: 36px;
        margin-top: 118px;
      }
      .mark { width: 120px; height: 120px; display: block; }
      .slug { font-size: 32px; font-weight: 600; letter-spacing: -0.01em; }
    </style>
  </head>
  <body>
    <h1>FOSS project, contribute on Github<br />and leave a star!</h1>
    <div class="repo">
      ${GITHUB_MARK}
      <span class="slug">${REPO_SLUG}</span>
    </div>
  </body>
</html>
`

const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
  ],
})

const worker =
  context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
const extensionId = new URL(worker.url()).hostname

await worker.evaluate(
  settings =>
    new Promise(resolve => {
      chrome.storage.local.set({ 'rebobinate:settings': settings }, () =>
        resolve(),
      )
    }),
  {
    badge: { autoHideMs: 0, corner: 'top-right', fontSize: 18, opacity: 0.85 },
  },
)

await context.route('https://player.test/**', route =>
  route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: PLAYER_PAGE,
  }),
)

fs.mkdirSync(outputDir, { recursive: true })

const player = await context.newPage()
await player.goto('https://player.test/watch')

// The content script loads asynchronously, so press until the speed moves.
for (let attempt = 0; attempt < 20; attempt += 1) {
  await player.keyboard.press('+')
  await player.waitForTimeout(200)

  const rate = await player
    .locator('#player')
    .evaluate(node => node.playbackRate)

  if (rate >= 1.25) {
    break
  }
}

await player.waitForTimeout(400)
await player.screenshot({ path: path.join(outputDir, 'rebobinate-1.png') })

const popup = await context.newPage()
await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
await popup.waitForTimeout(600)

// Screenshot the popup element itself, then centre it on the listing canvas.
// The scale is computed rather than fixed: the popup grows and shrinks as
// controls change, and a hardcoded zoom silently crops it when it does.
const shot = await popup.locator('main.popup').screenshot()
const box = await popup.locator('main.popup').boundingBox()
const scale = Math.min(
  (1280 - MARGIN * 2) / box.width,
  (800 - MARGIN * 2) / box.height,
)

const canvas = await context.newPage()
await canvas.setContent(
  `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Rebobinate popup</title></head>
  <body style="margin:0;width:1280px;height:800px;background:#12121a;display:flex;align-items:center;justify-content:center">
    <img
      src="data:image/png;base64,${shot.toString('base64')}"
      style="width:${Math.round(box.width * scale)}px"
      alt=""
    />
  </body>
</html>`,
  { waitUntil: 'load' },
)
await canvas.screenshot({ path: path.join(outputDir, 'rebobinate-2.png') })

// The card is plain markup at the listing size, so it needs no compositing.
const card = await context.newPage()
await card.setContent(CARD_PAGE, { waitUntil: 'load' })
await card.evaluate(() => document.fonts.ready)
await card.screenshot({ path: path.join(outputDir, 'rebobinate-3.png') })

await context.close()

console.log(`wrote screenshots to ${path.relative(root, outputDir)}`)
