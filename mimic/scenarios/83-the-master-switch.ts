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
 * A still cannot ask that, because the answer is a comparison. The tabs off and
 * the tabs on are the same pixels except for the switch itself, and a pair of
 * stills of two identical screens is a pair a judge has no reason to read as a
 * finding rather than as a repeat.
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
 * The panel's own two answers to the same question disagree, and that
 * disagreement is the exhibit. Filmed through `openPanel`, in the window the
 * panel tops out at.
 */

/** The site behind the panel, which is what the Sites tab lists under "This tab". */
const SITE = 'player.test'

/** Ten steps off 1.0× at the default 0.05, set the ordinary way: from the keyboard. */
const PRESSES = 10

/** The chip pressed while the switch is off, and the speed it claims to set. */
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

    const showing = (await readout.textContent()) ?? ''

    await look(
      s,
      panel,
      `The panel as it opens, over a page with a video playing at ${showing} — set a moment ago by pressing the speed-up key ${PRESSES} times on the page itself. At the very top, above the three tabs and outside all of them, is the extension's name and a switch labelled "Enabled", larger than any other switch in the panel and currently on. Under it the Speed tab: a minus, the big ${showing} readout, a plus; a "Reset" button; a row of speed chips; and a line saying the speed is being remembered for this site.`,
      { name: 'on', mustShow: master },
    )

    await master.click()
    await panel.waitForTimeout(1200)

    const snapped = await speedOf(video)
    const stillShowing = (await readout.textContent()) ?? ''

    if (snapped !== 1) {
      throw new Error(
        `the video is at ${snapped}× with the extension off, not back to normal`,
      )
    }

    if (stillShowing !== showing) {
      throw new Error(
        `the readout moved to ${stillShowing} on its own when the switch was thrown`,
      )
    }

    await look(
      s,
      panel,
      `The "Enabled" switch has been turned off, and this is the whole of what changed in the panel: the switch. Every control under it is exactly as it was — the plus and minus are pressable, the chips are pressable, the "Reset" button is pressable, and the line at the foot still says a speed is being remembered for this site. Nothing is greyed out, dimmed, or captioned; no tab is missing. The big readout still says ${showing}, and that is now wrong: throwing the switch put the video on the page behind this panel back to 1.0× — measured, not assumed — and nothing told the readout. Two claims about the same video, on screen at once, and the panel is showing the stale one.`,
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
      `The Sites tab, with the extension still switched off. It is fully live: "Default speed" opens, the "Remember per site" switch throws and is on, and under "This tab" the row for ${SITE} shows ${remembered} — the speed that was set from the keyboard before any of this, still stored, with a ✕ beside it that is live rather than greyed. Under that, "Other sites" and a line saying none is remembered yet. Nothing anywhere on the tab says that none of it is in force at the moment; the whole screen reads exactly as it would with the switch on, which is what makes this a poor place to find out that it is off.`,
      { name: 'sites', mustShow: panel.locator('ul.sites').first() },
    )

    await panel.getByRole('tab', { name: 'Settings' }).click()
    await panel.waitForTimeout(700)

    const badgeSwitch = toggle(panel, 'On-video badge')

    if (!(await badgeSwitch.locator('input').isChecked())) {
      throw new Error('the marker was already off, so this tab has nothing to say')
    }

    await look(
      s,
      panel,
      `The Settings tab, still with the extension switched off. The biggest block on it is about the marker drawn over the video, and its own switch — "On-video badge" — is on, with the live sample under it drawn as usual and every control below it working: the corner grid, both sliders, both colours, the timing. That sample is a promise the extension is not currently keeping; with the master switch off no marker is drawn over any video at all. The keyboard block above it lists shortcuts that do nothing at the moment, in the same type as ever. Two switches are in play on this screen and only one of them is winning, and the tab does not mention the other.`,
      { name: 'settings', mustShow: badgeSwitch },
    )

    await speedTab.click()
    await panel.waitForTimeout(600)

    await panel.getByRole('button', { name: PRESET, exact: true }).click()
    await panel.waitForTimeout(1200)

    const droveTo = await speedOf(video)
    const nowShowing = (await readout.textContent()) ?? ''
    const receipt = (await panel.locator('section.memory p.rule').textContent()) ?? ''

    if (droveTo !== 2) {
      throw new Error(
        `the ${PRESET} chip left the video at ${droveTo}× with the extension off`,
      )
    }

    await look(
      s,
      panel,
      `Back on the Speed tab, with the switch still off, the ${PRESET} chip has been pressed once. It worked: the video on the page behind the panel is now genuinely playing at ${droveTo}× — measured on the video itself — and the readout has followed it to ${nowShowing}, with the chip drawn as the selected one. The line at the foot has been rewritten too — "${receipt.trim()}" — so with the extension switched off the panel has just changed a video's speed and written down a new speed to start that site at. The same instruction from the keyboard a moment ago did nothing. So "Enabled" governs one of the two ways into this extension and not the other: the keys are off, the panel is not, and a switch that stops the shortcuts while leaving the buttons under it live has no way to say which of the two it meant.`,
      { name: 'preset', mustShow: readout },
    )

    // The control for the dead keypress above: the same key, the same page, the
    // same background tab, with only the switch changed back.
    await master.click()
    await panel.waitForTimeout(1200)
    await pressSpeed(video, '+', 1)

    const alive = await speedOf(video)

    if (alive <= droveTo) {
      throw new Error(
        `the key was still dead at ${alive}× after the switch went back on, so the dead keypress above proves nothing`,
      )
    }

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel; the page with the video on it is a separate tab and is never in frame. In order: the panel opens on the Speed tab showing ${showing}, which was set from the keyboard on that page; the "Enabled" switch at the very top is turned off, and nothing in the panel changes but the switch — while off screen the video drops back to 1.0× and the keyboard stops answering, both measured; the Sites tab is visited and is entirely live, still listing this site at ${remembered}; the Settings tab is visited and is entirely live, still drawing a sample of a marker that will not appear; back on the Speed tab the ${PRESET} chip is pressed and really does drive the video to ${droveTo}×, with the extension switched off throughout; and finally the switch goes back on and the same key that did nothing works again. What to watch is how little the panel does when the switch is thrown, and that the one thing the switch is meant to stop can still be done from inside the panel.`,
    )
  },
}
