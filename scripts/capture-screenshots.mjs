// Captures the Chrome Web Store listing screenshots from the real extension:
// the popup, and the speed badge over a player. Run after `pnpm build`.
//
//   node scripts/capture-screenshots.mjs
//
// Output is written to `chrome-web-store/screenshots/` at the 1280x800 size the
// Developer Dashboard expects.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'

const root = process.cwd()
const extensionPath = path.join(root, 'dist')
const outputDir = path.join(root, 'chrome-web-store', 'screenshots')
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
// Screenshot the popup element itself, not the viewport around it.
await popup.locator('main.popup').screenshot({
  path: path.join(outputDir, 'rebobinate-2-popup.png'),
})

await context.close()

console.log(`wrote screenshots to ${path.relative(root, outputDir)}`)
console.log(
  'rebobinate-2-popup.png is the bare popup — centre it on a 1280x800 canvas',
)
console.log('  magick -size 1280x800 xc:#12121a \\')
console.log('    \\( rebobinate-2-popup.png -resize 200% \\) \\')
console.log('    -gravity center -composite rebobinate-2.png')
