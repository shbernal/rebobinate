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
 * takes eight of them off the tab: the sample, the grid of corners, both
 * sliders, both colour rows, the auto-hide dropdown, the switch about normal
 * speed and the sentence reading the last two. What is left is the switch
 * itself and one line of text saying the settings are kept. Whether that reads
 * as one control governing a block or as the panel losing most of a tab is a
 * judgement about a transition, and a still of the tab afterwards is a still of
 * a short tab.
 *
 * The collapse takes about 330px out of a 440px pane, and the question that
 * asks is what happens to the view. Backup sits under this block and keeps the
 * tab overflowing either way, so the panel stays the height it was — but the
 * pane is left with that much less to scroll, and the plain answer to that is
 * the browser clamping the scroll position, which drags the switch that was
 * just clicked a long way down the pane and pulls rows from further up the tab
 * in above it. The panel pays for the collapse instead: it holds the vanished
 * height as empty space at the foot of the pane, so the old scroll position is
 * still a valid one and nothing moves, and it melts that space away as the
 * pane is scrolled back up — so the cost is a stretch of bare pane under the
 * last section on the tab, spent by one scroll, rather than a hole in the
 * middle of it. A click that
 * does or does not move the view under the pointer is exactly the sort of
 * thing a still taken afterwards cannot report, so this scenario measures it
 * and says so.
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

/** Where the pane is scrolled to, which one click here used to change unasked. */
const paneScrollTop = (panel: Page): Promise<number> =>
  panel.locator('.pane').evaluate(pane => Math.round(pane.scrollTop))

/**
 * The empty space held at the foot of the pane to pay for the collapse, in
 * pixels. It is nothing at rest, so its absence is as much a reading as its
 * presence.
 */
const paneSlack = async (panel: Page): Promise<number> => {
  const slack = panel.locator('.pane-slack')

  return (await slack.count()) === 0
    ? 0
    : slack.evaluate(node => Math.round(node.getBoundingClientRect().height))
}

/** Wheeled back up to the top of the pane, the way the space at its foot is spent. */
const wheelToTop = async (panel: Page): Promise<void> => {
  await panel.mouse.move(160, 300)

  for (let notch = 0; notch < 30; notch += 1) {
    if ((await paneScrollTop(panel)) === 0) {
      await panel.waitForTimeout(300)
      return
    }

    await panel.mouse.wheel(0, -80)
    await panel.waitForTimeout(90)
  }

  throw new Error('the pane never wheeled back to the top')
}

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
    const kept = panel.locator('.badge-header > .note')
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
    const wasOffset = await offsetInPane(master)

    await master.click()
    await panel.waitForTimeout(700)

    const nowBlock = await blockHeight(panel)
    const nowPanel = await panelHeight(panel)
    const nowOffset = await offsetInPane(master)
    const heldSlack = await paneSlack(panel)

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

    // The whole claim of the frame below: the control that was pressed is
    // where it was pressed, to the pixel.
    if (nowOffset !== wasOffset) {
      throw new Error(
        `the switch was ${wasOffset}px down the pane before the click and ${nowOffset}px after it`,
      )
    }

    if (heldSlack <= 0) {
      throw new Error(
        'nothing is holding the foot of the pane open, so the scroll position that did not move is not the one being reported',
      )
    }

    if (nowBlock >= wasBlock) {
      throw new Error(
        `the block is ${nowBlock}px after the switch and was ${wasBlock}px before it`,
      )
    }

    const gone = await Promise.all(
      [sample, corners, size, opacity, autoHide, rule].map(control =>
        control.isVisible(),
      ),
    )

    if (gone.some(Boolean)) {
      throw new Error('something the caption says has gone is still on screen')
    }

    if (!(await kept.isVisible())) {
      throw new Error(
        'nothing was left under the switch to say where the block went',
      )
    }

    if (!(await toolbar.isVisible())) {
      throw new Error('the row about the toolbar badge left with the block')
    }

    await look(
      s,
      panel,
      `The "On-video badge" switch has been turned off, and this is the whole of what is left of the block: the switch itself, and under it one line of small text reading "Size, colours and timing are kept." Gone at once are the sample from under the switch, the grid of corners, the two sliders, both colour rows, "Hide after", the switch about normal speed and the sentence that read the last two back. The block went from ${wasBlock}px to ${nowBlock}px. Nothing else moved: the panel is the same ${nowPanel}px it was, and the switch that was clicked is still the top line of the scrolling area, ${nowOffset}px down it, exactly where it was when it was pressed. Underneath it the Backup section, which was already the last thing on the tab, has come up into view whole. That is bought rather than free, and the price is the bottom of this frame: ${wasBlock - nowBlock}px left the middle of the tab, the pane would have had that much less to scroll, and rather than let the view be dragged back to fill it the panel is holding ${heldSlack}px of bare pane under the Backup section. It is a temporary gap and not a permanent one — it shrinks as the pane is scrolled and is gone by the time the top of the tab is reached — so what is being chosen here is a stretch of empty pane that one scroll spends, over a view that slides under the hand that just clicked.`,
      { name: 'off', mustShow: master },
    )

    // The other half of that claim, which no still can hold: the space at the
    // foot is temporary. Wheeled rather than jumped, because melting it is
    // what scrolling does.
    await wheelToTop(panel)

    const leftOver = await paneSlack(panel)

    if (leftOver !== 0) {
      throw new Error(
        `${leftOver}px of empty space is still at the foot of the pane with it scrolled to the top`,
      )
    }

    if (!(await overflows(panel))) {
      throw new Error(
        'the collapsed tab stopped overflowing once the held space was spent, so it is no longer the tab the frames above describe',
      )
    }

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

    if (!(await corners.isVisible())) {
      throw new Error('the corner grid did not come back with the block')
    }

    if (await kept.isVisible()) {
      throw new Error(
        'the line about the settings being kept outstayed the collapse',
      )
    }

    await look(
      s,
      panel,
      `The switch has been turned back on. Everything that left has come back, and it has come back as it was rather than as it ships: "Size" still reads ${back.size}px and "Opacity" still reads ${back.opacity}%, the two colours are the ones that were set, and the sample above is the marker at that size again. Turning the marker off puts it away rather than throwing it out, and the line that said so while it was off has gone with the rest of the block coming back.`,
      { name: 'back', mustShow: size },
    )

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel and the height of its tallest tab, which is the one it is on throughout. In order: the Settings tab is picked and the pane scrolled down to the block about the marker over the video, whose header stops at the top of the scrolling area and holds a live sample; "Size" is walked from 14px to 30px and "Opacity" from 75% to 100%, the sample growing and solidifying as they go; the "On-video badge" switch at the top of the block is turned off, and the sample, the corner grid, both sliders, both colour rows, the dropdown, the second switch and the sentence at the foot all go at once, leaving the switch and a line of text under it — and the switch itself does not budge, because the panel holds ${heldSlack}px of bare pane under the Backup section rather than let the view slide back to fill the gap; the pane is then wheeled back up to the top of the tab and that bare stretch shrinks away as it goes, so it is a gap on the way out rather than a hole to scroll through; and the switch is turned back on, where all of it returns at the values it had. What to watch is the moment of the collapse — how much of the panel changes on one click, whether the one line left behind is enough to explain where the rest went, and whether the eye has to go looking for the switch afterwards.`,
    )
  },
}
