import type { FrameLocator, Page } from '@playwright/test'

/**
 * crxjs loads the content script through an asynchronous loader, so for a short
 * moment after a navigation the page is live but the extension is not listening
 * yet. A key pressed inside that window is simply not ours and is gone.
 *
 * The helper does what a user does when nothing happens: press again. It stops
 * as soon as the rate moves, so it never overshoots by stacking presses.
 */
const ATTEMPTS = 20
const SETTLE_MS = 250

export const rateOf = (
  scope: Page | FrameLocator,
  selector = '#player',
): Promise<number> =>
  scope
    .locator(selector)
    .evaluate(node => (node as HTMLVideoElement).playbackRate)

const waitForChange = async (
  read: () => Promise<number>,
  from: number,
  timeoutMs: number,
) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if ((await read()) !== from) {
      return true
    }

    await new Promise(resolve => setTimeout(resolve, 25))
  }

  return false
}

export const pressSpeedKey = async (
  page: Page,
  key: string,
  read: () => Promise<number> = () => rateOf(page),
) => {
  const before = await read()

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    await page.keyboard.press(key)

    if (await waitForChange(read, before, SETTLE_MS)) {
      return
    }
  }

  throw new Error(`speed never changed after pressing "${key}"`)
}
