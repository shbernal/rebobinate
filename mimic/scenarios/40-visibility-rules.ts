import { look, start, toggle, type Ctx } from '../page.ts'

/**
 * The switch is asked as "Show at 1.0×" and ships off, so this scenario turns
 * it on; the dropdown ships at 2s, so this scenario takes it to Never. Each
 * caption has to name the direction the click actually went: "turned on" over
 * a click that turned a switch off is a lie a code-blind judge cannot catch.
 *
 * The first blind probe, before any of this existed, flagged that the live
 * sample draws the marker while it is meant to be hidden at normal speed.
 * Whether that is a real contradiction is triage's call; this scenario just
 * shows the states honestly and lets the judge reach its own conclusion.
 */
export default {
  id: 'visibility-rules',
  title: 'Changing when the marker is allowed to appear',
  intent:
    'Someone wants the speed marker on screen whenever a video is playing, including while it is at normal speed, and does not want it disappearing on its own.',

  async run(s: Ctx) {
    const { popup } = await start(s)
    await popup.getByRole('tab', { name: 'Settings' }).click()
    await popup.waitForTimeout(300)

    await look(
      s,
      popup,
      'The part of the Settings section about when the marker should be visible, as it comes out of the box: a dropdown for how long it stays, and a switch for whether it shows at all at normal speed. Pinned to the top of the section are the on/off switch for the marker and, under it, a striped box holding a live sample of it. The video behind the panel is playing at its normal speed and has not been sped up.',
      { name: 'rules', mustShow: toggle(popup, 'Show at 1.0×') },
    )

    await toggle(popup, 'Show at 1.0×').click()
    await popup.waitForTimeout(400)
    await look(
      s,
      popup,
      'The switch labelled "Show at 1.0×" has been turned on, so the marker should now stay on screen even at normal speed. The video behind the panel is still at its normal speed.',
      { name: 'show-at-normal', mustShow: toggle(popup, 'Show at 1.0×') },
    )

    await popup.locator('#badge-autohide').selectOption('0')
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The dropdown labelled "Hide after" has been changed from "2s" to "Never", so the marker should no longer fade away by itself.',
      { name: 'autohide-never', mustShow: popup.locator('#badge-autohide') },
    )
  },
}
