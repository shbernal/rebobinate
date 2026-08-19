import { look, start, type Ctx } from '../page.ts'

/**
 * The colour picker is custom-built rather than the browser's own, which makes
 * it the single most likely place for a blind judge to find something.
 */
export default {
  id: 'badge-appearance',
  title: 'Making the speed marker less distracting',
  intent:
    'Someone finds the little speed marker that sits on top of the video too small and too faint, and wants it easier to see without it getting in the way.',

  async run(s: Ctx) {
    const { popup } = await start(s)
    await popup.getByRole('tab', { name: 'Settings' }).click()
    await popup.waitForTimeout(300)

    await look(
      s,
      popup,
      'The Settings section, scrolled down to the part about the marker that appears on top of the video. "Size" and "Opacity" are drag handles, and the four arrow buttons above them choose which corner of the video the marker sits in.',
      { name: 'controls', mustShow: popup.locator('#badge-size') },
    )

    await popup.locator('#badge-size').fill('34')
    await popup.locator('#badge-opacity').fill('100')
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "Size" handle has been dragged most of the way right and the "Opacity" handle all the way right. The box at the bottom is a live sample of the marker and has changed to match.',
      { name: 'resized', mustShow: popup.locator('.preview') },
    )

    await popup.getByRole('button', { name: 'Text color' }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'Clicking the first of the two coloured squares next to "Colors" opened this panel. It is how the colour of the marker is chosen.',
      { name: 'picker', mustShow: popup.locator('.color-picker') },
    )
  },
}
