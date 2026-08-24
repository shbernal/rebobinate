import { fileURLToPath } from 'node:url'
import type { BrowserContext, Locator, Page } from '@playwright/test'

/**
 * Shared setup for the mimic scenarios.
 *
 * This file sits outside `scenarios/` on purpose — mimic globs that directory
 * and expects every file in it to default-export a scenario.
 */

/**
 * An invented origin, served by intercepting the request. The same trick the e2e
 * fixtures use: content scripts inject on these navigations, and a real domain
 * is what makes the per-site memory meaningful. `file://` would need an extra
 * Chrome permission and has no domain to remember.
 */
export const VIDEO_ORIGIN = 'https://player.test'

const PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Designing for the small screen — a talk</title></head>
  <body style="margin:0;background:#0f0f14;color:#eee;font:16px/1.5 system-ui">
    <div style="max-width:900px;margin:0 auto;padding:24px">
      <video
        controls
        style="width:100%;aspect-ratio:16/9;background:linear-gradient(135deg,#2b2d6e,#4b2aa8 55%,#7b3fd4);display:block"
      ></video>
      <h1 style="font-size:20px;margin:16px 0 4px">Designing for the small screen</h1>
      <p style="margin:0;color:#9c98b3">A 48 minute conference talk</p>
    </div>
  </body>
</html>`

/**
 * The e2e suite's clip, reused rather than copied. Four seconds of animation at
 * 320x180, committed there on purpose, and the only real footage in the repo.
 */
const MEDIA_FILE = fileURLToPath(
  new URL('../e2e/fixtures/media/clip.mp4', import.meta.url),
)
const MEDIA_PATH = '/media/clip.mp4'

/**
 * The same page with footage actually running behind the player, and a bigger
 * one.
 *
 * Only the scenario that records video asks for this. A source-less `<video>`
 * is enough to set a speed on, which is all the still scenarios need, but a
 * recording of one is a film of a frozen rectangle: nothing in it shows that a
 * video is playing, and whether the marker keeps up with a playing video is
 * half of what a recording is for. The clip is upscaled well past its 320x180,
 * so it is soft — the narration says so, because a judge told nothing about it
 * would be right to call it out.
 */
const PLAYING_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Designing for the small screen — a talk</title></head>
  <body style="margin:0;background:#0f0f14;color:#eee;font:16px/1.5 system-ui">
    <div style="max-width:1120px;margin:0 auto;padding:20px">
      <video
        src="${MEDIA_PATH}"
        autoplay
        muted
        loop
        playsinline
        preload="auto"
        style="width:100%;aspect-ratio:16/9;background:#000;display:block"
      ></video>
      <h1 style="font-size:20px;margin:14px 0 4px">Designing for the small screen</h1>
      <p style="margin:0;color:#9c98b3">A 48 minute conference talk</p>
    </div>
  </body>
</html>`

/** A page with a video on it, at an origin the extension can remember. */
export async function openVideoPage(
  context: BrowserContext,
  options: { playing?: boolean } = {},
): Promise<Page> {
  await context.route(`${VIDEO_ORIGIN}/**`, route => {
    if (new URL(route.request().url()).pathname === MEDIA_PATH) {
      return route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        path: MEDIA_FILE,
      })
    }

    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: options.playing === true ? PLAYING_PAGE : PAGE,
    })
  })
  const page = await context.newPage()
  await page.goto(`${VIDEO_ORIGIN}/talk`)
  await page.bringToFront()
  return page
}

/** What this target's `launch` hook puts on `s.meta`. */
export interface Meta {
  extensionId: string
  openPopup(): Promise<Page>
}

/** The slice of mimic's scenario context these scenarios use. */
export interface Ctx {
  readonly context: BrowserContext
  readonly page: Page
  readonly meta: Record<string, unknown>
  use(page: Page): void
  show(
    says: string,
    options?: {
      name?: string
      fullPage?: boolean
      clip?: { x: number; y: number; width: number; height: number }
    },
  ): Promise<void>
  /** Only valid when the scenario declares `video: true`. */
  showVideo(says: string): void
}

export const metaOf = (s: Ctx): Meta => s.meta as unknown as Meta

/**
 * Open the video page, then the real popup, and point the frames at the popup.
 * Every scenario starts this way.
 *
 * The video page comes back too, because bringing it to the front is how a
 * popup is dismissed — and the popup holding focus is what stops the extension
 * from seeing an active browser window at all.
 */
export async function start(s: Ctx): Promise<{ video: Page; popup: Page }> {
  const video = await openVideoPage(s.context)
  const popup = await metaOf(s).openPopup()
  s.use(popup)
  return { video, popup }
}

type Clip = { x: number; y: number; width: number; height: number }

/**
 * Fail the frame unless `mustShow` is really on it.
 *
 * A caption saying "scrolled down to the part about the marker" is only worth
 * capturing if it can be false, and the box test alone cannot make it false: an
 * element can sit squarely inside the clip and still be painted over by
 * anything sticky or layered above it. So the geometry is checked, and then the
 * pixel at the element's centre is asked what is actually on top of it. A frame
 * that fails here is cheap; a frame that ships a true-sounding caption over the
 * wrong screen buys a whole round of confident, wrong critique.
 */
async function assertShown(
  mustShow: Locator,
  clip: Clip,
  name: string,
): Promise<void> {
  const box = await mustShow.boundingBox()

  if (box === null) {
    throw new Error(`frame "${name}": what it is about is not rendered at all`)
  }

  const inside =
    box.x >= clip.x &&
    box.y >= clip.y &&
    box.x + box.width <= clip.x + clip.width &&
    box.y + box.height <= clip.y + clip.height

  if (!inside) {
    throw new Error(
      `frame "${name}": what it is about lies outside the captured panel`,
    )
  }

  const covering = await mustShow.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const hit = element.ownerDocument.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    )

    if (hit === null) return 'nothing at all'
    if (hit === element || element.contains(hit)) return null

    const classes =
      typeof hit.className === 'string' && hit.className !== ''
        ? `.${hit.className.trim().split(/\s+/).join('.')}`
        : ''

    return `${hit.tagName.toLowerCase()}${classes}`
  })

  if (covering !== null) {
    throw new Error(
      `frame "${name}": what it is about is covered by ${covering}`,
    )
  }
}

/**
 * Capture the frame a person would see, with its narration. One call, so the
 * caption cannot drift from the pixels.
 *
 * Two things have to be undone first. Reached over CDP the popup page renders at
 * the browser's viewport, so the 320px panel sits in the corner of a much wider
 * page with nothing beside it — hence the clip, since `setViewportSize` is
 * rejected outright by an extension popup target. And the pane inside the panel
 * is its own scrolling container, so scrolling `mustShow` into view scrolls it
 * exactly as a person would.
 */
export async function look(
  s: Ctx,
  popup: Page,
  says: string,
  options: { name: string; mustShow?: Locator },
): Promise<void> {
  if (options.mustShow !== undefined) {
    await options.mustShow.scrollIntoViewIfNeeded()
    await popup.waitForTimeout(200)
  }

  const panel = await popup.locator('main.popup').boundingBox()
  const page = await popup.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  const x = Math.max(0, panel?.x ?? 0)
  const y = Math.max(0, panel?.y ?? 0)
  const clip = {
    x,
    y,
    width: Math.min(panel?.width ?? 320, page.width - x),
    height: Math.min(panel?.height ?? page.height, page.height - y),
  }

  if (options.mustShow !== undefined) {
    await assertShown(options.mustShow, clip, options.name)
  }

  await s.show(says, { name: options.name, clip })
}

/**
 * Click one of the on/off sliders by its label.
 *
 * The checkbox itself is transparent and zero-sized so it keeps a real
 * checkbox's keyboard behaviour, which means it cannot be clicked directly. The
 * enclosing label is what a person actually clicks.
 */
export function toggle(popup: Page, label: string | RegExp) {
  return popup
    .locator('label.switch')
    .filter({ has: popup.getByRole('checkbox', { name: label }) })
}

/**
 * What the marker over the video currently is, read the way a person reads it:
 * is it on screen, and what does it say.
 *
 * The marker styles itself from a rule inside its own shadow root rather than
 * from a style attribute, so the only honest reading is the computed one.
 */
export function marker(page: Page): Promise<{ shown: boolean; text: string }> {
  return page.evaluate(() => {
    const host = document.getElementById('rebobinate-speed-host')

    if (host === null) return { shown: false, text: '' }

    return {
      shown: getComputedStyle(host).display !== 'none',
      text: host.shadowRoot?.querySelector('div')?.textContent ?? '',
    }
  })
}

/**
 * Fail the frame unless the marker is in the state its caption claims.
 *
 * The page frames have no `mustShow` to lean on, and their captions are all
 * claims about a thing that comes and goes on its own — "it has appeared", "it
 * faded away", "it is still there". A caption like that is worth capturing only
 * if it can be false, and after a wait it very much can: a timer that fires
 * late, a marker that never showed, a speed that never took. This is what makes
 * the wait an assertion instead of a hope.
 */
export async function assertMarker(
  page: Page,
  name: string,
  expected: { shown: boolean; text?: string },
): Promise<void> {
  const seen = await marker(page)

  if (seen.shown !== expected.shown) {
    throw new Error(
      `frame "${name}": the marker is ${seen.shown ? 'on screen' : 'not on screen'}, and the caption says it is ${expected.shown ? 'on screen' : 'not'}`,
    )
  }

  if (expected.text !== undefined && seen.text !== expected.text) {
    throw new Error(
      `frame "${name}": the marker reads "${seen.text}", and the caption says "${expected.text}"`,
    )
  }
}

/** The speed the video is actually playing at, not the one anything claims. */
export function speedOf(page: Page): Promise<number> {
  return page
    .locator('video')
    .evaluate(node => (node as HTMLVideoElement).playbackRate)
}

/**
 * Press one of the extension's speed keys, and do not return until the video
 * really changed speed.
 *
 * The content script is loaded through an asynchronous loader, so for a moment
 * after the page opens it is not listening yet and a key pressed then is simply
 * gone. Pressing again is what a person does when nothing happens, and stopping
 * at the first change is what stops it from overshooting.
 */
export async function pressSpeed(
  page: Page,
  key: string,
  times = 1,
): Promise<void> {
  for (let press = 0; press < times; press += 1) {
    const before = await speedOf(page)
    let changed = false

    for (let attempt = 0; attempt < 20 && !changed; attempt += 1) {
      await page.keyboard.press(key)

      const deadline = Date.now() + 250
      while (Date.now() < deadline && !changed) {
        await page.waitForTimeout(25)
        changed = (await speedOf(page)) !== before
      }
    }

    if (!changed) {
      throw new Error(`the video never changed speed after pressing "${key}"`)
    }
  }
}

/** Fail unless the video is genuinely running, so "playing" is not a claim. */
export async function assertPlaying(page: Page): Promise<void> {
  const video = page.locator('video')
  await video.evaluate(async node => {
    await (node as HTMLVideoElement).play().catch(() => undefined)
  })

  const at = () =>
    video.evaluate(node => (node as HTMLVideoElement).currentTime)
  const before = await at()

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(100)
    if ((await at()) > before) return
  }

  throw new Error('the video never started playing, so nothing is moving')
}
