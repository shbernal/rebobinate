import type { Page } from '@playwright/test'
import {
  look,
  metaOf,
  openVideoPage,
  pressSpeed,
  speedOf,
  toggle,
  type Ctx,
} from '../page.ts'

/**
 * The one switch above the tab strip, and what it does to the three tabs under
 * it.
 *
 * It is the only control in the panel that is not about a setting: it is about
 * the extension. Everything else on the three tabs is a preference the switch
 * governs, so the interesting question is not what it stores but what the panel
 * does when it is off — whether the tabs go quiet, grey out, say anything at
 * all, or carry on exactly as they were.
 *
 * A still cannot ask that, because the answer is a comparison. What the panel
 * does is deliberately uneven: the Speed tab collapses, because with the switch
 * off the service worker refuses everything those controls send, while the
 * Sites and Settings tabs stay entirely live, because pausing the extension is
 * very often the step before changing the setting that made you pause it. One
 * line under the header is what carries the news to all three.
 *
 * What the switch really turns off is on the page, not in the panel: the
 * keyboard stops answering and the video is put back to normal speed. Neither
 * of those is in frame here — the panel is filmed at its own width, and the page
 * behind it is another tab — so both are measured instead, in the same
 * configuration, before and after. The keypress that does nothing while the
 * switch is off is proved by the same keypress working again when it goes back
 * on, at the foot of the scenario: without that control, a key that failed to
 * arrive and a key that arrived and was ignored look identical.
 *
 * Filmed through `openPanel`, in the window the panel tops out at.
 */

/** The site behind the panel, which is what the Sites tab lists under "This tab". */
const SITE = 'player.test'

/** Ten steps off 1.0× at the default 0.05, set the ordinary way: from the keyboard. */
const PRESSES = 10

/** The chip reached for while the switch is off, and the speed it would set. */
const PRESET = '2.0×'

/** What a row's dropdown is showing, read as the word on screen rather than as a number. */
const rowReads = (panel: Page, domain: string): Promise<string> =>
  panel
    .getByLabel(`Speed for ${domain}`, { exact: true })
    .evaluate(
      node => (node as HTMLSelectElement).selectedOptions[0]?.textContent ?? '',
    )

export default {
  id: 'the-master-switch',
  title: 'Turning the whole thing off',
  intent:
    'Someone wants this extension to stop doing anything for a while — not uninstalled, not reconfigured, just out of the way — and wants to be able to tell at a glance that it is off.',
  video: true,

  async run(s: Ctx) {
    const video = await openVideoPage(s.context)

    // Set before the panel is opened, from the keyboard on the page, which is
    // how a speed is normally set and the thing the switch is about to stop.
    await pressSpeed(video, '+', PRESSES)
    const set = await speedOf(video)

    if (set <= 1) {
      throw new Error('the keyboard never got the video off 1.0×')
    }

    const panel = await metaOf(s).openPanel()
    s.use(panel)
    // Long enough for the per-site write behind the keypresses to land, so the
    // Sites tab below is showing a stored entry rather than one in flight.
    await panel.waitForTimeout(2500)

    const master = toggle(panel, 'Enabled')
    const readout = panel.locator('output.readout')
    const speedTab = panel.getByRole('tab', { name: 'Speed' })
    /** The line the panel adds under the header while the switch is off. */
    const offLine = panel.locator('main.popup > p.rule')
    const faster = panel.getByRole('button', { name: 'Faster' })
    const chip = panel.getByRole('button', { name: PRESET, exact: true })

    const showing = (await readout.textContent()) ?? ''

    if ((await offLine.count()) !== 0) {
      throw new Error(
        'the panel is already saying it is off with it switched on',
      )
    }

    await look(
      s,
      panel,
      `The panel as it opens, over a page with a video playing at ${showing} — set a moment ago by pressing the speed-up key ${PRESSES} times on the page itself. At the very top, above the three tabs and outside all of them, is the extension's name and a switch labelled "Enabled", larger than any other switch in the panel and currently on. Under it the Speed tab: a minus, the big ${showing} readout, a plus; a "Reset" button; a row of speed chips; and a line saying the speed is being remembered for this site. Nothing between the title and the tabs.`,
      { name: 'on', mustShow: master },
    )

    await master.click()
    await panel.waitForTimeout(1200)

    const snapped = await speedOf(video)
    const stillShowing = (await readout.textContent()) ?? ''
    const said = ((await offLine.textContent()) ?? '').trim()

    if (snapped !== 1) {
      throw new Error(
        `the video is at ${snapped}× with the extension off, not back to normal`,
      )
    }

    if (stillShowing === showing) {
      throw new Error(
        `the readout is still claiming ${stillShowing} over a video that is back at 1.0×`,
      )
    }

    if (said === '') {
      throw new Error('nothing in the panel says the extension is off')
    }

    if (await faster.isEnabled()) {
      throw new Error(
        'the plus is still pressable, and the service worker would refuse it',
      )
    }

    await look(
      s,
      panel,
      `The "Enabled" switch has been turned off, and three things changed at once. A new line has appeared between the title and the tabs, where the switch is and so on screen whichever tab is open: "${said}" It is set in a band of its own — a faint grey fill with rounded corners, no icon and no colour — which is what separates it from the ordinary sentences further down the panel that explain a control the reader is looking at. This one is about the whole extension. The Speed tab under it has gone quiet — the plus, the minus, "Reset" and every chip in the row are greyed and unpressable, because with the switch off the extension refuses all of them rather than taking the press and doing nothing with it. And the big readout no longer carries a number: it reads "${stillShowing}", because throwing the switch put the video on the page behind this panel back to 1.0× — measured, not assumed — and the panel is not going to print a speed nothing is holding. The one thing kept is the line at the foot saying a speed is remembered for this site, which is still true and applies again the moment the switch goes back on.`,
      { name: 'off', mustShow: readout },
    )

    // The thing the switch actually turns off. Delivery of the keypress itself
    // is what the last step of this scenario proves.
    const beforePress = await speedOf(video)
    await video.keyboard.press('+')
    await panel.waitForTimeout(700)
    const afterPress = await speedOf(video)

    if (afterPress !== beforePress) {
      throw new Error(
        `the speed-up key moved the video from ${beforePress}× to ${afterPress}× with the extension off`,
      )
    }

    await panel.getByRole('tab', { name: 'Sites' }).click()
    await panel.waitForTimeout(700)

    const remembered = await rowReads(panel, SITE)
    const drop = panel.getByRole('button', { name: `Stop remembering ${SITE}` })

    if (!remembered.includes('×')) {
      throw new Error(
        `the row for ${SITE} reads "${remembered}", so there is no stored speed on this tab to be about`,
      )
    }

    if (!(await drop.isEnabled())) {
      throw new Error(
        'the row is showing a stored speed with a dead ✕ beside it, so the caption is wrong about the row being live',
      )
    }

    await look(
      s,
      panel,
      `The Sites tab, with the extension still switched off. The banded line saying so is still at the top, above the tabs, unchanged and in the same place, because it belongs to the switch rather than to any one tab. Everything under it is fully live and deliberately so: "Default speed" opens, the "Remember per site" switch throws and is on, and under "This tab" the row for ${SITE} shows ${remembered} — the speed that was set from the keyboard before any of this, still stored, with a ✕ beside it that is live rather than greyed. Nothing here is dimmed, because someone who has just paused the extension is very often about to change the setting that made them pause it, and a list they cannot edit would be a trap. What the row promises is about the next visit; the line at the top is what says the promise is not being kept at the moment.`,
      { name: 'sites', mustShow: panel.locator('ul.sites').first() },
    )

    await panel.getByRole('tab', { name: 'Settings' }).click()
    await panel.waitForTimeout(700)

    const badgeSwitch = toggle(panel, 'On-video badge')

    if (!(await badgeSwitch.locator('input').isChecked())) {
      throw new Error(
        'the marker was already off, so this tab has nothing to say',
      )
    }

    await look(
      s,
      panel,
      `The Settings tab, still with the extension switched off, and the same banded line still at the top. The biggest block on it is about the marker drawn over the video, and its own switch — "On-video badge" — is on, with the live sample under it drawn as usual and every control below it working: the corner grid, both sliders, both colours, the timing. The sample is a sample rather than a promise: with the master switch off no marker is drawn over any video, and the line above the tabs is what says so. Greying the block instead would have claimed the badge settings were unavailable, when they are only inert — and they are exactly the settings someone might have paused the extension to come and change.`,
      { name: 'settings', mustShow: badgeSwitch },
    )

    await speedTab.click()
    await panel.waitForTimeout(600)

    if (await chip.isEnabled()) {
      throw new Error(
        `the ${PRESET} chip is still pressable with the switch off`,
      )
    }

    const held = await speedOf(video)
    const receipt =
      (await panel.locator('section.memory p.rule').textContent()) ?? ''

    if (held !== 1) {
      throw new Error(
        `the video is at ${held}× with the extension off and nothing pressed`,
      )
    }

    await look(
      s,
      panel,
      `Back on the Speed tab, with the switch still off, reaching for the ${PRESET} chip. It cannot be pressed — every chip in the row is greyed, as are the plus, the minus and "Reset" — so the panel offers no way in that the keyboard does not have. The video on the page behind the panel is still at ${held}×, measured on the video itself. The line at the foot is the one thing on this tab that still reads normally — "${receipt.trim()}" — because what is remembered for this site is a fact about the next visit rather than a claim about this one, and it survives the pause intact. Above the tabs, the same banded sentence as on the other two tabs is doing the explaining: the switch governs both ways into the extension, and the panel says which ones it took away.`,
      { name: 'preset', mustShow: readout },
    )

    // The control for the dead keypress above: the same key, the same page, the
    // same background tab, with only the switch changed back.
    await master.click()
    await panel.waitForTimeout(1200)

    // The readout comes back from the service worker rather than from the
    // number the panel was holding before the pause: the tab's speed was
    // dropped when the switch went off, so anything else would be a claim
    // about a video that is at 1.0×.
    const resumed = (await readout.textContent()) ?? ''

    if (resumed !== '1.0×') {
      throw new Error(
        `the readout came back reading ${resumed} over a video the switch put at 1.0×`,
      )
    }

    await pressSpeed(video, '+', 1)

    const alive = await speedOf(video)

    if (alive <= 1) {
      throw new Error(
        `the key was still dead at ${alive}× after the switch went back on, so the dead keypress above proves nothing`,
      )
    }

    if ((await offLine.count()) !== 0) {
      throw new Error('the panel is still saying it is off with it switched on')
    }

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel; the page with the video on it is a separate tab and is never in frame. In order: the panel opens on the Speed tab showing ${showing}, which was set from the keyboard on that page; the "Enabled" switch at the very top is turned off, and the panel answers in three ways at once — a line appears between the title and the tabs, in a shaded band of its own, the readout drops its number for "${stillShowing}", and the whole Speed tab greys out — while off screen the video drops back to 1.0× and the keyboard stops answering, both measured; the Sites tab is visited and is entirely live, still listing this site at ${remembered}; the Settings tab is visited and is entirely live, still drawing a sample of a marker that is not currently on any video; back on the Speed tab the ${PRESET} chip cannot be pressed at all and the video stays at 1.0×; and finally the switch goes back on, the line goes away, the controls come back reading "1.0×" rather than the ${showing} they were showing before the pause — because the pause put the video back to normal and the panel asks again rather than reprinting what it was holding — and the same key that did nothing works again — stepping from 1.0× to ${alive}×, from where the video actually is rather than from where it was before the pause. What to watch is the line above the tabs, which stays put through all three tabs, and which parts of the panel go quiet and which deliberately do not.`,
    )
  },
}
