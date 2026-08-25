import type { Locator, Page } from '@playwright/test'
import {
  look,
  offsetInPane,
  metaOf,
  openVideoPage,
  panelHeight,
  pinned,
  toggle,
  wheelUntil,
  type Ctx,
} from '../page.ts'

/**
 * The largest thing one click in this panel does.
 *
 * The marker block is nine controls under a header, and its master switch
 * takes seven of them off the tab: the sample, both sliders, both colour rows,
 * the auto-hide dropdown, the switch about normal speed and the sentence
 * reading the last two. What is left is the switch itself and the grid of
 * corners, which stays on screen and goes dead rather than leaving with the
 * rest. Whether that reads as one control governing a block or as the panel
 * losing half its contents is a judgement about a transition, and a still of
 * the tab afterwards is a still of a short tab.
 *
 * The collapse takes about 300px out of a 440px pane, and what it moves is not
 * the panel. Backup sits under this block and keeps the tab overflowing either
 * way, so the panel stays the height it was; the pane simply has less to scroll
 * and slides back, carrying the switch that was just clicked away from the top
 * of the pane and pulling controls from further up the tab into view. A click
 * that moves the view under the pointer is exactly the sort of thing a still
 * taken afterwards cannot report, so this scenario measures it and says so.
 *
 * The scenario changes two settings before it throws the switch, because the
 * question a person actually has here is not what disappears. It is whether
 * turning the marker off has thrown away what they set up, and the only way to
 * answer it is to set something up, turn it off and turn it back on. The
 * answer is that the settings are kept: `enabled` is one field of the badge
 * object and the rest of it is written and read whatever that field says.
 *
 * Filmed through `openPanel`, so it claims nothing about the page behind it.
 */

/** How tall the marker block is, which is the thing collapsing. */
const blockHeight = (panel: Page): Promise<number> =>
  panel
    .locator('.badge-settings')
    .evaluate(node => Math.round(node.getBoundingClientRect().height))

/** Where the pane is scrolled to, which one click here changes without being asked. */
const paneScrollTop = (panel: Page): Promise<number> =>
  panel.locator('.pane').evaluate(pane => Math.round(pane.scrollTop))

/** Whether the pane has more in it than it can show, which is what makes it scroll. */
const overflows = (panel: Page): Promise<boolean> =>
  panel
    .locator('.pane')
    .evaluate(pane => pane.scrollHeight > pane.clientHeight + 1)

/** Walked rather than jumped: a slider that arrives instantly is a cut, not a drag. */
const walk = async (panel: Page, slider: Locator, presses: number) => {
  await slider.focus()

  for (let press = 0; press < presses; press += 1) {
    await panel.keyboard.press('ArrowRight')
    await panel.waitForTimeout(45)
  }

  await panel.waitForTimeout(400)
}

export default {
  id: 'turning-the-marker-off',
  title: 'Turning the marker off, and finding the settings still there',
  intent:
    'Someone has the marker over their video set up the way they like it, and now wants it gone — but only for a while, and not at the cost of setting it all up again when they want it back.',
  video: true,

  async run(s: Ctx) {
    // A real site behind the panel. Nothing here is about it; it is what keeps
    // the panel reading a live extension rather than defaults with no subject.
    await openVideoPage(s.context)

    const panel = await metaOf(s).openPanel()
    s.use(panel)
    await panel.waitForTimeout(1000)

    await panel.getByRole('tab', { name: 'Settings' }).click()
    await panel.waitForTimeout(600)

    const master = toggle(panel, 'On-video badge')
    const sample = panel.locator('.preview')
    const corners = panel.locator('fieldset.corners')
    const size = panel.locator('#badge-size')
    const opacity = panel.locator('#badge-opacity')
    const autoHide = panel.locator('#badge-autohide')
    const rule = panel.locator('.badge-settings > .rule')
    const toolbar = panel.locator('.field').filter({ hasText: 'Toolbar badge' })

    // Far enough that the block's header sticks, which puts the whole block on
    // screen under it: every control that is about to disappear is then in the
    // frame that says it was there.
    await wheelUntil(
      panel,
      () => pinned(panel),
      'where the marker block header sticks',
    )

    await look(
      s,
      panel,
      'The whole of the block about the marker drawn over the video, on the Settings tab, scrolled to. Its header has stopped at the top of the scrolling area: an on/off switch reading "On-video badge", and under it a striped box holding a live sample of the marker at its current size and colour. Under the header, in order: a grid of four arrows for which corner of the video the marker sits in, a "Size" slider reading 14px, an "Opacity" slider reading 75%, a row for the text colour and a row for the backdrop colour, each printing its colour as a code, a "Hide after" dropdown reading 2s, a switch for whether the marker shows at normal speed, and a sentence at the foot reading the last two back: "Shown for 2 seconds after a speed change, and hidden at 1.0×."',
      { name: 'block', mustShow: size },
    )

    await walk(panel, size, 16)
    await walk(panel, opacity, 25)

    const setUp = {
      size: await size.inputValue(),
      opacity: await opacity.inputValue(),
    }

    if (setUp.size !== '30' || setUp.opacity !== '100') {
      throw new Error(
        `the sliders ended at ${setUp.size}px and ${setUp.opacity}%, not where the caption says`,
      )
    }

    await look(
      s,
      panel,
      'Two of those controls have been moved, so that there is something to lose: "Size" has been walked from 14px to 30px and "Opacity" from 75% to 100%. The sample stuck at the top of the pane grew and solidified as they moved — this is a person setting the marker up the way they want it, not a demonstration of the sliders.',
      { name: 'set-up', mustShow: opacity },
    )

    const wasBlock = await blockHeight(panel)
    const wasPanel = await panelHeight(panel)
    const wasScroll = await paneScrollTop(panel)

    await master.click()
    await panel.waitForTimeout(700)

    const nowBlock = await blockHeight(panel)
    const nowPanel = await panelHeight(panel)
    const nowScroll = await paneScrollTop(panel)
    const nowOffset = await offsetInPane(master)

    if (nowPanel !== wasPanel) {
      throw new Error(
        `the panel is ${nowPanel}px after the switch and was ${wasPanel}px before it`,
      )
    }

    if (!(await overflows(panel))) {
      throw new Error(
        'the tab stopped overflowing its pane, so the caption about the panel keeping its height is wrong',
      )
    }

    if (nowScroll >= wasScroll) {
      throw new Error(
        `the pane was at ${wasScroll}px before the switch and ${nowScroll}px after, so it did not slide back`,
      )
    }

    if (nowBlock >= wasBlock) {
      throw new Error(
        `the block is ${nowBlock}px after the switch and was ${wasBlock}px before it`,
      )
    }

    const gone = await Promise.all(
      [sample, size, opacity, autoHide, rule].map(control =>
        control.isVisible(),
      ),
    )

    if (gone.some(Boolean)) {
      throw new Error('something the caption says has gone is still on screen')
    }

    if (!(await corners.isVisible())) {
      throw new Error('the corner grid left with the rest of the block')
    }

    if (await corners.getByRole('button').first().isEnabled()) {
      throw new Error('the corner grid stayed on screen and stayed live')
    }

    if (!(await toolbar.isVisible())) {
      throw new Error('the row about the toolbar badge left with the block')
    }

    await look(
      s,
      panel,
      `The "On-video badge" switch has been turned off, and this is the whole of what is left of the block: the switch itself, and the grid of corners, which stayed rather than leaving with the rest and is greyed out and no longer clickable. Gone are the sample from under the switch, the two sliders, both colour rows, "Hide after", the switch about normal speed and the sentence that read the last two back. The block went from ${wasBlock}px to ${nowBlock}px. The panel is the same ${nowPanel}px it was — what sits under this block still fills the pane — but the view moved on its own: with ${wasBlock - nowBlock}px gone from the middle of the tab there was less left to scroll, so the pane slid back by ${wasScroll - nowScroll}px, taking the switch that was just clicked from the top of the scrolling area to ${nowOffset}px down it. What has arrived above it, unasked, is the foot of the block of keyboard shortcuts and the row for the number drawn on the extension's own toolbar icon. That row is a different marker in a different place and was not touched by any of this: it is still on.`,
      { name: 'off', mustShow: master },
    )

    await master.click()
    await panel.waitForTimeout(800)

    const back = {
      size: await size.inputValue(),
      opacity: await opacity.inputValue(),
    }

    if (back.size !== setUp.size || back.opacity !== setUp.opacity) {
      throw new Error(
        `the sliders came back at ${back.size}px and ${back.opacity}%, having been left at ${setUp.size}px and ${setUp.opacity}%`,
      )
    }

    if (!(await corners.getByRole('button').first().isEnabled())) {
      throw new Error('the corner grid stayed dead after the block came back')
    }

    await look(
      s,
      panel,
      `The switch has been turned back on. Everything that left has come back, and it has come back as it was rather than as it ships: "Size" still reads ${back.size}px and "Opacity" still reads ${back.opacity}%, the two colours are the ones that were set, and the sample above is the marker at that size again. Turning the marker off puts it away rather than throwing it out, and nothing warned about that in either direction because there is nothing to warn about. The corner grid is live again.`,
      { name: 'back', mustShow: size },
    )

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel and the height of its tallest tab, which is the one it is on throughout. In order: the Settings tab is picked and the pane scrolled down to the block about the marker over the video, whose header stops at the top of the scrolling area and holds a live sample; "Size" is walked from 14px to 30px and "Opacity" from 75% to 100%, the sample growing and solidifying as they go; the "On-video badge" switch at the top of the block is turned off, and the sample, both sliders, both colour rows, the dropdown, the second switch and the sentence at the foot all go at once, leaving the switch and a greyed-out grid of corners, while the pane slides back by ${wasScroll - nowScroll}px under the pointer because there is that much less of the tab left to scroll; and the switch is turned back on, where all of it returns at the values it had. What to watch is the moment of the collapse — how much of the panel changes on one click, what is left behind to explain it, whether the one control that stayed rather than left is better or worse for having stayed, and where the person's eye is left afterwards.`,
    )
  },
}
