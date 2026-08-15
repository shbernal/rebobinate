import { pressSpeedKey, rateOf } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'

const badge = (page: import('@playwright/test').Page) =>
  page.locator('#rebobinate-speed-host')

/**
 * The badge is styled from a `:host` rule inside its shadow root, so what is
 * being asserted is the computed result rather than a style attribute. That is
 * also the only reading an ad blocker cannot fake out: a user-origin
 * `display: none` shows up here and nowhere else.
 */
const badgeDisplay = (page: import('@playwright/test').Page) =>
  badge(page).evaluate(node => getComputedStyle(node).display)

const badgeText = (page: import('@playwright/test').Page) =>
  badge(page).evaluate(
    node => node.shadowRoot?.querySelector('div')?.textContent ?? '',
  )

test.describe('speed badge', () => {
  test('appears with the current speed and fades out', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 1000 } })
    const page = await openFixture('/simple')

    await pressSpeedKey(page, '+')

    await expect(badge(page)).toBeAttached()
    await expect.poll(() => badgeText(page)).toBe('1.05×')

    await expect.poll(() => badgeDisplay(page), { timeout: 5000 }).toBe('none')
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
      const host = document.getElementById('rebobinate-speed-host')
      const video = document.querySelector('video')

      const hostStyle = host ? getComputedStyle(host) : null

      return {
        host: host?.getBoundingClientRect().toJSON(),
        video: video?.getBoundingClientRect().toJSON(),
        alignItems: hostStyle?.alignItems,
        justifyContent: hostStyle?.justifyContent,
        inlineStyle: host?.getAttribute('style'),
      }
    })

    // No style attribute is the point: filter lists hide `[style*="z-index:"]`.
    expect(boxes.inlineStyle).toBeNull()
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

    await expect.poll(() => badgeDisplay(page)).toBe('none')
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
          const host = document.getElementById('rebobinate-speed-host')
          const video = document.querySelector('video')

          return Math.abs(
            (host?.getBoundingClientRect().top ?? 0) -
              (video?.getBoundingClientRect().top ?? 999),
          )
        }),
      )
      .toBeLessThan(2)
  })

  test('follows the video when the page relayouts around it', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 0 } })
    const page = await openFixture('/shifting-panel')

    await pressSpeedKey(page, '+')
    await expect(badge(page)).toBeAttached()

    // Deliberate, and the point of the test: a speed change tracks the video
    // for `REPOSITION_BURST_MS` afterwards, which would carry this on its own.
    // The reported case is a panel opened long after the last keystroke, so
    // the burst has to be over before the layout moves.
    await page.waitForTimeout(800)

    // A panel opening beside the video: it slides sideways over a transition,
    // at an unchanged size, with no event the badge can listen for and no
    // `ResizeObserver` entry, because the video's own box never changes size.
    await page.click('#toggle')

    await expect
      .poll(() =>
        page.evaluate(() => {
          const host = document.getElementById('rebobinate-speed-host')
          const video = document.querySelector('video')

          return Math.abs(
            (host?.getBoundingClientRect().left ?? 0) -
              (video?.getBoundingClientRect().left ?? 999),
          )
        }),
      )
      .toBeLessThan(2)
  })
})

test.describe('under a page CSP that forbids stylesheets', () => {
  test('the badge still styles itself', async ({
    openFixture,
    seedSettings,
  }) => {
    await seedSettings({ badge: { autoHideMs: 0 } })
    const page = await openFixture('/strict-csp')

    await pressSpeedKey(page, '+')
    await expect(badge(page)).toBeAttached()

    // A content script's DOM is attributed to its isolated world, which has its
    // own CSP. If that ever stopped being true the badge would be attached,
    // unstyled and invisible — which is why this asserts the computed result
    // and not the presence of the element.
    await expect.poll(() => badgeDisplay(page)).toBe('flex')
    expect(
      await badge(page).evaluate(node => getComputedStyle(node).position),
    ).toBe('fixed')
  })
})
