import type { Page } from '@playwright/test'
import {
  look,
  metaOf,
  openVideoPage,
  pinned,
  wheelUntil,
  type Ctx,
} from '../page.ts'

/**
 * The panel's geography, and the only exhibit of it that is about scrolling.
 *
 * Stills cannot answer the two questions this pane raises. The panel is 320px
 * wide and its Settings tab is 530px tall against a pane that shows 440 of it,
 * so most of what is on that tab is off screen when it opens — and what holds still while
 * the rest of it moves is the whole design of the thing. The tab strip stays
 * put. The badge block's header, which carries the master switch and the live
 * sample, sticks to the top of the pane for the run of the controls it
 * previews. Two stills of a scrolled pane are two stills; they do not say
 * which of them moved.
 *
 * Filmed through `openPanel`, which opens the panel as its own tab, because
 * the real popup is reached over a second connection Playwright cannot record.
 * That costs the active tab, so this scenario claims nothing about the page
 * behind it — a real one is open, and the service worker resolves it, but the
 * subject here is the panel's own geography. Live tab state belongs to the
 * scenarios that declare it and get the real overlay.
 *
 * The frame is the panel at 1:1, so unlike `70-badge-lifetime` the text in the
 * recording is the size it is on screen and survives the judge's sampling. The
 * window is the height of the Settings tab, which is the tallest of the three,
 * so on the shorter tabs there is window below the panel. That band is tinted
 * grey by the launch hook so it cannot be read as the panel having an empty
 * bottom, and the narration names it.
 */

/** Whether the pane has run out of anything else to scroll to. */
const atEnd = (panel: Page): Promise<boolean> =>
  panel
    .locator('.pane')
    .evaluate(
      pane => pane.scrollTop >= pane.scrollHeight - pane.clientHeight - 1,
    )

export default {
  id: 'panel-scrolling',
  title: 'Reaching the settings that are not on screen',
  intent:
    "Someone wants the marker the extension draws over a video to be bigger, and to stop vanishing a couple of seconds after they change the speed. Both controls are on the panel's Settings tab, below what it shows when it opens, so before they can change anything they have to get to them.",
  video: true,

  async run(s: Ctx) {
    // A page with a video on it, open behind the panel. Nothing here is about
    // that page; it is what makes the panel's readings real rather than the
    // defaults it shows with no site to report on.
    await openVideoPage(s.context)

    const panel = await metaOf(s).openPanel()
    s.use(panel)
    await panel.waitForTimeout(1200)

    await panel.getByRole('tab', { name: 'Settings' }).click()
    await panel.waitForTimeout(600)

    await look(
      s,
      panel,
      "The panel's Settings tab, at the top, as it looks the moment it is opened. A row for the speed step, the three key rows under it — Faster is bound to three keys and carries them over two lines — a switch for the toolbar badge, and then the block for the marker drawn over the video, of which the switch and the sample of the marker itself are on screen. The tab does not end there: the bottom edge cuts through the grid of corners under the sample, and the last rows fade down into that edge.",
      { name: 'settings-top', mustShow: panel.locator('#step') },
    )

    // Far enough that the block's header has to stick: the whole block, from
    // the corner grid to the sentence at its foot, is then on screen under it.
    const size = panel.locator('#badge-size')
    const autoHide = panel.locator('#badge-autohide')
    await wheelUntil(
      panel,
      () => pinned(panel),
      'where the marker block header sticks',
    )

    await look(
      s,
      panel,
      "Scrolled down into the marker block. The block's header — the switch that governs it, and the sample of the marker — has stopped at the top of the scrolling area while the block goes on moving under it: the corner grid that sat below the sample is now half beneath it, cut by a hairline, and the rest of the block stands clear underneath. Everything outside the pane has held still too, the panel's title and its three tabs.",
      { name: 'pinned-sample', mustShow: size },
    )

    // Sixteen presses rather than a jump to the end of the range: what the
    // pinned sample is for is answering while a control is being moved, and an
    // instant 14 to 30 is a cut between two states rather than an answer.
    await size.focus()

    for (let press = 0; press < 16; press += 1) {
      await panel.keyboard.press('ArrowRight')
      await panel.waitForTimeout(80)
    }

    await panel.waitForTimeout(500)

    await look(
      s,
      panel,
      'The Size slider has been moved from 14px to 30px. The readout beside it counts as it goes, and the sample stuck above grows with it — the marker in the sample is the size the marker over the video will be, so what the setting does is answered where it is being set rather than on the next video the person opens.',
      { name: 'bigger-sample', mustShow: size },
    )

    await autoHide.selectOption('0')
    await panel.waitForTimeout(700)

    await look(
      s,
      panel,
      '"Hide after" has been set to "Never", without scrolling again — the whole block fits under its own header. The sentence at the foot of the block, which a moment ago read that the marker is shown for 2 seconds after a speed change, has rewritten itself to say it is always shown while a video is playing. It still ends with the other half of the rule, that the marker is hidden at 1.0×, which is the switch directly above that sentence.',
      {
        name: 'always-shown',
        mustShow: panel.getByText('Always shown while a video is playing', {
          exact: false,
        }),
      },
    )

    // On to the foot of the pane, which is close: the block was scrolled to
    // the top to pin its header, and there is little else under it. What that
    // last stretch answers is the question the first frame asks — how much of
    // this tab was off screen — and the header is still stuck when it lands.
    await wheelUntil(panel, () => atEnd(panel), 'the end of the pane')
    await panel.waitForTimeout(600)

    // Back to the tab it opened on, which is where the height of the panel
    // changes on camera.
    await panel.getByRole('tab', { name: 'Speed' }).click()
    await panel.waitForTimeout(1500)

    s.showVideo(
      'The same visit as a recording, at real speed, filmed in a window the width of the panel and the height of its tallest tab. In order: the panel opens on Speed, which is short, so the grey band under it for the first second is the window it is being filmed in rather than the panel — it is tinted for exactly that reason; Settings is picked and the panel fills the window; the pane is scrolled by wheel, and the title, the tab strip and the marker\'s own switch and sample all stay where they are while the controls run underneath; the Size slider is walked from 14px to 30px and the sample stuck above it grows as it goes; "Hide after" is set to "Never" and the sentence below it rewrites itself; the pane runs out shortly after that, with the block\'s header still stuck to the top of it; and Speed is picked again, where the panel shrinks back to the height it opened at.',
    )
  },
}
