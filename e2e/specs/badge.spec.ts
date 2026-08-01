import { pressSpeedKey, rateOf } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'

const badge = (page: import('@playwright/test').Page) =>
  page.locator('#rebobinate-badge-host')

test.describe('speed badge', () => {
  test('appears with the current speed and fades out', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 1000 } })
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')

    await expect(badge(page)).toBeAttached()
    await expect
      .poll(() =>
        badge(page).evaluate(node => node.shadowRoot?.textContent ?? ''),
      )
      .toBe('1.05×')

    await expect
      .poll(
        () => badge(page).evaluate(node => (node as HTMLElement).style.display),
        {
          timeout: 5000,
        },
      )
      .toBe('none')
  })

  test('sits in the configured corner, over the video', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({
      badge: { corner: 'bottom-right', autoHideMs: 0 },
    })
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')
    await expect(badge(page)).toBeAttached()

    const boxes = await page.evaluate(() => {
      const host = document.getElementById('rebobinate-badge-host')
      const video = document.querySelector('video')

      return {
        host: host?.getBoundingClientRect().toJSON(),
        video: video?.getBoundingClientRect().toJSON(),
        alignItems: host?.style.alignItems,
        justifyContent: host?.style.justifyContent,
      }
    })

    expect(boxes.alignItems).toBe('flex-end')
    expect(boxes.justifyContent).toBe('flex-end')
    expect(boxes.host?.left).toBeCloseTo(boxes.video?.left ?? -1, 0)
    expect(boxes.host?.top).toBeCloseTo(boxes.video?.top ?? -1, 0)
  })

  test('stays hidden at normal speed', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 0, hideAtNormalSpeed: true } })
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')
    await expect(badge(page)).toBeAttached()

    await pressSpeedKey(page, '0')

    await expect
      .poll(() =>
        badge(page).evaluate(node => (node as HTMLElement).style.display),
      )
      .toBe('none')
  })

  test('can be turned off entirely', async ({ openFixture, seedSettings }) => {
    await seedSettings({ badge: { enabled: false } })
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')

    expect(await rateOf(page)).toBeCloseTo(1.05, 3)
    await expect(badge(page)).toHaveCount(0)
  })

  test('follows the video when the page scrolls', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 0 } })
    const page = await openFixture('/scrolling')

    await pressSpeedKey(page, '+')
    await expect(badge(page)).toBeAttached()

    await page.mouse.wheel(0, 200)

    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = document.getElementById('rebobinate-badge-host')
          const video = document.querySelector('video')

          return Math.abs(
            (host?.getBoundingClientRect().top ?? 0) -
              (video?.getBoundingClientRect().top ?? 999),
          )
        }),
      )
      .toBeLessThan(2)
  })
})
