import { pressSpeedKey, rateOf } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'

test('records the time a video plays under its site and speed', async ({
  openFixture,
  seedSettings,
  storedStats,
}) => {
  // One press to 2x, so the time lands in a bucket that is not the default's.
  await seedSettings({ step: 1 })
  const page = await openFixture('/playing')

  await pressSpeedKey(page, '+')
  expect(await rateOf(page)).toBeCloseTo(2, 3)

  const played = await page.evaluate(async () => {
    const video = document.querySelector('video') as HTMLVideoElement

    await video.play()

    const start = performance.now()

    // The clip is four seconds long, so at 2x it ends after two.
    await new Promise(resolve => setTimeout(resolve, 1500))
    video.pause()

    return (performance.now() - start) / 1000
  })

  // Closing the page is the `pagehide` that hands the totals over.
  await page.close()

  await expect
    .poll(async () => Object.values(await storedStats()), { timeout: 5000 })
    .toHaveLength(1)

  const [sites] = Object.values(await storedStats())
  const seconds = sites['player.test']?.['2'] ?? 0

  // A tick or two at either end falls outside the window the page measured.
  expect(seconds).toBeGreaterThan(played - 0.75)
  expect(seconds).toBeLessThan(played + 0.25)
})
