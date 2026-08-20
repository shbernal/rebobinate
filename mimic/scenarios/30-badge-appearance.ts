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
      'The Settings section, scrolled down to the part about the marker that appears on top of the video. "Size" and "Opacity" are drag handles, and the four arrow buttons above them choose which corner of the video the marker sits in. Pinned to the top of the section are the on/off switch for the marker and, under it, a striped box holding a live sample of it.',
      { name: 'controls', mustShow: popup.locator('#badge-opacity') },
    )

    await popup.locator('#badge-size').fill('34')
    await popup.locator('#badge-opacity').fill('100')
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "Size" handle has been dragged most of the way right and the "Opacity" handle all the way right. The sample pinned at the top of the section has changed to match, and it and the on/off switch above it stay there while the handles below them are dragged.',
      { name: 'resized', mustShow: popup.locator('#badge-opacity') },
    )

    await popup.getByRole('button', { name: 'Text color' }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'Clicking the coloured square on the "Text color" row opened this panel. It is how the colour of the marker is chosen. The panel opens under both colour rows rather than under the row it belongs to, so the two rows — the marker\'s text and its background — are both still on screen above it; the square that was clicked has an accent-coloured border around it.',
      {
        name: 'picker',
        mustShow: popup.locator('.color-picker'),
      },
    )
  },
}
