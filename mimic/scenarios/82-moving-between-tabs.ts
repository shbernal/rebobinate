import type { Page } from '@playwright/test'
import { look, metaOf, openVideoPage, type Ctx } from '../page.ts'

/**
 * The panel as a place with three rooms in it, rather than three separate
 * exhibits of one room each.
 *
 * Every other panel exhibit opens on the tab it is about and stays there, so
 * across fifteen runs no judge has been shown the move between them — and the
 * move is where this panel's only structural surprise lives. The panel is as
 * tall as whatever tab is showing, so picking a tab resizes the whole window:
 * Speed is short, Sites is middling, Settings is more than the pane can hold
 * and starts scrolling. A judge given three stills cannot tell that the second
 * one is a different size from the first, and cannot see that the title and the
 * tab strip are the only two things that survive the change.
 *
 * Filmed through `openPanel`, which opens the panel as its own tab, because the
 * real popup is reached over a second connection Playwright cannot record. That
 * costs the live active tab, so this scenario claims nothing about the page
 * behind it beyond it being a real site the panel is reading — which it is, and
 * which is what puts a domain in the Speed tab's sentence and a row under
 * "This tab".
 *
 * The window is the height of the Settings tab, the tallest of the three, so on
 * Speed and Sites there is window under the panel — a lot of it, since Speed is
 * well under half that height. The launch hook tints it grey so it reads as
 * window rather than as the panel having an empty bottom, and the narration
 * names it. That band is the recording, not the product.
 */

/** The panel's own height, which is the thing changing. */
const panelHeight = (panel: Page): Promise<number> =>
  panel
    .locator('main.popup')
    .evaluate(node => Math.round(node.getBoundingClientRect().height))

export default {
  id: 'moving-between-tabs',
  title: 'Finding your way around the panel',
  intent:
    'Someone has just installed this and clicked its icon for the first time. They want to know what is in here — what the three tabs are, and which one holds the thing they came for.',
  video: true,

  async run(s: Ctx) {
    // A real site behind the panel, so the Speed tab names a domain and the
    // Sites tab has something to put under "This tab". Nothing here is about
    // that page.
    await openVideoPage(s.context)

    const panel = await metaOf(s).openPanel()
    s.use(panel)
    await panel.waitForTimeout(1200)

    const speed = await panelHeight(panel)
    await look(
      s,
      panel,
      'The panel as it opens, which is on Speed. A title with an on/off switch beside it, then three tabs — Speed, Sites, Settings — and under them the whole of the Speed tab: a large readout of how fast the video is currently playing, a minus and a plus either side of it, a Reset underneath, a row of six speeds that go straight there rather than stepping, an underlined line saying speeds set here are kept for the site behind the panel — which is itself a button, and goes to the Sites tab where that rule can be changed — and a reminder of the three keys. This is the shortest of the three tabs.',
      { name: 'speed', mustShow: panel.locator('.speed-presets') },
    )

    await panel.getByRole('tab', { name: 'Sites' }).click()
    await panel.waitForTimeout(700)

    const sites = await panelHeight(panel)
    if (sites <= speed) {
      throw new Error(
        `Sites (${sites}px) is not taller than Speed (${speed}px), so the panel did not grow and the narration is wrong`,
      )
    }

    await look(
      s,
      panel,
      'Sites has been picked. The title and the three tabs have not moved; everything below them has been replaced, and the panel has grown taller to fit it. This tab is about which speed a site starts at: a default speed for everywhere, a switch for whether each site is remembered separately, and then the site in the tab behind the panel listed on its own under "This tab", with a speed against it. Nothing has been remembered yet, so there is no list of other sites under it.',
      { name: 'sites', mustShow: panel.locator('#default-speed') },
    )

    await panel.getByRole('tab', { name: 'Settings' }).click()
    await panel.waitForTimeout(700)

    const settings = await panelHeight(panel)
    if (settings <= sites) {
      throw new Error(
        `Settings (${settings}px) is not taller than Sites (${sites}px)`,
      )
    }

    await look(
      s,
      panel,
      'Settings has been picked, and the panel has grown again — this time past what it can show, so this tab scrolls where the other two did not. The top of it is how far the plus and minus move the speed, the keys those are bound to, and a switch for the number drawn on the extension\'s own toolbar icon. Below that the block for the marker drawn over the video begins, and the bottom edge of the panel cuts through it: the half-row showing is the only thing on screen saying there is more of this tab.',
      { name: 'settings', mustShow: panel.locator('#step') },
    )

    // Back to where it started, which is the only way to film the panel
    // shrinking rather than growing.
    await panel.getByRole('tab', { name: 'Speed' }).click()
    await panel.waitForTimeout(1200)

    const returned = await panelHeight(panel)
    if (returned !== speed) {
      throw new Error(
        `Speed came back at ${returned}px rather than the ${speed}px it opened at`,
      )
    }

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel and the height of its tallest tab — so where the panel is shorter than that, the grey band under it is the window it is being filmed in rather than the panel, tinted for exactly that reason. In order: the panel opens on Speed and fills about two thirds of the frame; Sites is picked and the panel grows to fit a longer tab; Settings is picked and it grows again, this time to the full height, where it starts scrolling instead; and Speed is picked last, where it shrinks back to exactly the height it opened at. Measured on this run the three heights were ${speed}px, ${sites}px and ${settings}px. What holds still through all of it is the title and the row of three tabs; everything under them is replaced each time.`,
    )
  },
}
