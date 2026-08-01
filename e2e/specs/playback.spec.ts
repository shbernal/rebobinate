import type { Page } from '@playwright/test'
import { pressSpeedKey, rateOf } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'

/**
 * Every other spec asserts `playbackRate`, which is the property the extension
 * just wrote — it proves the plumbing, not the outcome. These two run against
 * the real clips in `e2e/fixtures/media/`, so they can watch decoded output.
 */

/**
 * Media seconds consumed per wall-clock second. At 1x this sits near 1; at 2x
 * it should sit near 2. The absolute number drifts with how much decode budget
 * the machine has, which is why the test compares two measurements instead of
 * asserting either one against a fixed target.
 */
const progressRate = (page: Page, windowMs: number) =>
  page.evaluate(async ms => {
    const video = document.querySelector('video') as HTMLVideoElement

    video.currentTime = 0
    await video.play()

    // The first frames after a seek are the slowest to arrive. Let them land
    // before the clock starts, or the measurement reads the decoder warming up.
    await new Promise(resolve => setTimeout(resolve, 250))

    const startMedia = video.currentTime
    const startWall = performance.now()

    await new Promise(resolve => setTimeout(resolve, ms))

    const advanced = video.currentTime - startMedia
    const elapsed = (performance.now() - startWall) / 1000

    video.pause()

    return advanced / elapsed
  }, windowMs)

test.describe('real media playback', () => {
  test('doubling the rate doubles how fast the video plays', async ({
    openFixture,
    seedSettings,
  }) => {
    // One press to 2x, instead of the twenty a 0.05 step would need.
    await seedSettings({ step: 1 })
    const page = await openFixture('/playing')

    const atNormal = await progressRate(page, 800)

    // A stalled video would advance at the same rate whatever the speed, and
    // every comparison below would hold vacuously.
    expect(atNormal).toBeGreaterThan(0.5)

    await pressSpeedKey(page, '+')
    expect(await rateOf(page)).toBeCloseTo(2, 3)

    const atDouble = await progressRate(page, 800)

    expect(atDouble).toBeGreaterThan(atNormal * 1.5)
  })

  test('holds the speed when the player swaps its source', async ({
    openFixture,
  }) => {
    const page = await openFixture('/playing')

    await pressSpeedKey(page, '+')
    expect(await rateOf(page)).toBeCloseTo(1.05, 3)

    // Reloading `src` on the same element is how players change quality or
    // move to the next item, and Chromium really does drop the rate back to
    // `defaultPlaybackRate` when it happens.
    //
    // Three separate mechanisms catch that: `defaultPlaybackRate` (so the
    // browser restores the right value itself), the `loadstart`/`loadedmetadata`
    // re-apply, and the `ratechange` reconcile. Removing any one of them still
    // passes this test — removing all three fails it. That redundancy is the
    // point, so the test is written against the outcome rather than any single
    // mechanism.
    await page.evaluate(async () => {
      const video = document.querySelector('video') as HTMLVideoElement

      video.src = '/media/clip.webm'

      await new Promise(resolve => {
        video.addEventListener('loadeddata', resolve, { once: true })
      })
    })

    // Proves the WebM decoded rather than merely 404ing quietly, which would
    // leave the rate untouched and pass the assertion below for the wrong
    // reason.
    expect(
      await page
        .locator('#player')
        .evaluate(node => (node as HTMLVideoElement).videoHeight),
    ).toBe(180)

    await expect.poll(() => rateOf(page)).toBeCloseTo(1.05, 3)
  })
})
