import { pressSpeedKey, rateOf } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'

/**
 * The fixture origin is `https://player.test`, so the domain the extension
 * keys on is `player.test`.
 */
const SITE = 'player.test'

test.describe('per-site speed memory', () => {
  test('re-applies the speed chosen on a site to the next visit', async ({
    openFixture,
    rememberedSites,
  }) => {
    const first = await openFixture('/simple')

    await pressSpeedKey(first, '+')
    await pressSpeedKey(first, '+')
    expect(await rateOf(first)).toBeCloseTo(1.2, 3)

    // The write is debounced, so wait for it rather than for a fixed delay.
    await expect
      .poll(async () => (await rememberedSites())[SITE]?.speed)
      .toBeCloseTo(1.2, 3)

    const second = await openFixture('/simple')

    await expect.poll(() => rateOf(second)).toBeCloseTo(1.2, 3)
  })

  test('starts a site it has not seen at the default speed', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ defaultSpeed: 1.5 })

    const page = await openFixture('/simple')

    await expect.poll(() => rateOf(page)).toBeCloseTo(1.5, 3)
  })

  test('forgets the site when the speed is reset', async ({
    openFixture,
    rememberedSites,
  }) => {
    const first = await openFixture('/simple')

    await pressSpeedKey(first, '+')
    await expect.poll(async () => SITE in (await rememberedSites())).toBe(true)

    await pressSpeedKey(first, '0')
    await expect.poll(async () => SITE in (await rememberedSites())).toBe(false)

    const second = await openFixture('/simple')

    await expect.poll(() => rateOf(second)).toBeCloseTo(1, 3)
  })

  test('writes nothing while the memory is turned off', async ({
    openFixture,
    seedSettings,
    rememberedSites,
  }) => {
    await seedSettings({ rememberPerDomain: false })

    const first = await openFixture('/simple')
    await pressSpeedKey(first, '+')

    // Well past the debounce window, so an absent entry means it was never
    // scheduled rather than not written yet.
    await first.waitForTimeout(1500)
    expect(await rememberedSites()).toEqual({})

    const second = await openFixture('/simple')

    await expect.poll(() => rateOf(second)).toBeCloseTo(1, 3)
  })

  test('gives an embedded player the speed of the page around it', async ({
    openFixture,
    rememberedSites,
  }) => {
    // The embed is served from a different origin. It follows the address bar,
    // which is what makes one setting cover a site and everything it embeds.
    const first = await openFixture('/simple')

    await pressSpeedKey(first, '+')
    await expect
      .poll(async () => (await rememberedSites())[SITE]?.speed)
      .toBeCloseTo(1.1, 3)

    const embedder = await openFixture('/embedder')
    const frame = embedder.frameLocator('iframe')

    await expect
      .poll(() =>
        frame.locator('#player').evaluate(video => {
          return (video as HTMLVideoElement).playbackRate
        }),
      )
      .toBeCloseTo(1.1, 3)

    expect(Object.keys(await rememberedSites())).toEqual([SITE])
  })
})
