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

/** A page with a video on it, at an origin the extension can remember. */
export async function openVideoPage(context: BrowserContext): Promise<Page> {
  await context.route(`${VIDEO_ORIGIN}/**`, route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: PAGE,
    }),
  )
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
