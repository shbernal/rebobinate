import { pressSpeedKey, rateOf } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'
import { EMBED_ORIGIN } from '../fixtures/pages'

test.describe('keyboard speed controls', () => {
  test('increases, decreases, and resets the speed', async ({
    openFixture,
  }) => {
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')
    expect(await rateOf(page)).toBeCloseTo(1.1, 3)

    await pressSpeedKey(page, '+')
    expect(await rateOf(page)).toBeCloseTo(1.2, 3)

    await pressSpeedKey(page, '-')
    expect(await rateOf(page)).toBeCloseTo(1.1, 3)

    await pressSpeedKey(page, '0')
    expect(await rateOf(page)).toBeCloseTo(1, 3)
  })

  test('follows a custom step', async ({ openFixture, seedSettings }) => {
    await seedSettings({ step: 0.25 })
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')

    expect(await rateOf(page)).toBeCloseTo(1.25, 3)
  })

  test('ignores keys typed into a search box', async ({ openFixture }) => {
    const page = await openFixture('/with-search')

    // Prove the extension is live in this page before testing that it holds
    // back, or the assertion would pass on a page where nothing is listening.
    await pressSpeedKey(page, '+')

    await page.locator('#search').click()
    await page.keyboard.press('+')

    await expect(page.locator('#search')).toHaveValue('+')
    expect(await rateOf(page)).toBeCloseTo(1.1, 3)
  })

  test('holds the speed when the site resets it', async ({ openFixture }) => {
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')

    await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement
      video.playbackRate = 1
    })

    await expect.poll(() => rateOf(page)).toBeCloseTo(1.1, 3)
  })

  test('applies the speed to a video added after the page loaded', async ({
    openFixture,
  }) => {
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')

    await page.evaluate(() => {
      document.querySelector('video')?.remove()
      const replacement = document.createElement('video')
      replacement.id = 'player'
      document.body.append(replacement)
    })

    await expect.poll(() => rateOf(page)).toBeCloseTo(1.1, 3)
  })

  test('finds a video inside a web component', async ({ openFixture }) => {
    const page = await openFixture('/shadow')
    const shadowRate = () =>
      page.evaluate(() => {
        const host = document.getElementById('host')
        const video = host?.shadowRoot?.querySelector('video')

        return (video as HTMLVideoElement | null)?.playbackRate ?? 0
      })

    await pressSpeedKey(page, '+', shadowRate)

    expect(await shadowRate()).toBeCloseTo(1.1, 3)
  })

  test('reaches a player inside an iframe from the top frame', async ({
    openFixture,
  }) => {
    const page = await openFixture('/embedder')
    const frame = page.frameLocator(`iframe[src^="${EMBED_ORIGIN}"]`)
    const embeddedRate = () => rateOf(frame)

    await page.locator('h1').click()
    await pressSpeedKey(page, '+', embeddedRate)

    expect(await embeddedRate()).toBeCloseTo(1.1, 3)
  })

  test('leaves a page without video alone', async ({ openFixture }) => {
    const page = await openFixture('/no-video')
    const pressed: string[] = []

    await page.exposeFunction('recordKey', (key: string) => {
      pressed.push(key)
    })
    await page.evaluate(() => {
      document.addEventListener('keydown', event => {
        ;(window as unknown as { recordKey: (key: string) => void }).recordKey(
          event.key,
        )
      })
    })

    await page.keyboard.press('+')

    await expect.poll(() => pressed).toEqual(['+'])
  })
})
