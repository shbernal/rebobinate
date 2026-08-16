import { look, start, toggle, type Ctx } from '../page.ts'

/**
 * Both of these settings ship switched on, so this scenario turns them off. An
 * earlier draft narrated "has been turned on" over a click that turned the
 * switch off — a caption a code-blind judge would have had no way to catch.
 *
 * The first blind probe, before any of this existed, flagged that the live
 * sample draws the marker while "Hide at 1.0×" is on at normal speed. Whether
 * that is a real contradiction is triage's call; this scenario just shows the
 * states honestly and lets the judge reach its own conclusion.
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
      'The part of the Settings section about when the marker should be visible, as it comes out of the box. Below the two settings is a live sample of the marker. The video behind the panel is playing at its normal speed and has not been sped up.',
      { name: 'rules', scrollTo: popup.locator('#badge-autohide') },
    )

    await toggle(popup, 'Hide at 1.0×').click()
    await popup.waitForTimeout(400)
    await look(
      s,
      popup,
      'The switch labelled "Hide at 1.0×" has been turned off, so the marker should now stay on screen even at normal speed. The video behind the panel is still at its normal speed.',
      { name: 'hide-off', scrollTo: popup.locator('.preview') },
    )

    await popup.locator('#badge-autohide').selectOption('0')
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The dropdown labelled "Hide after" has been changed from "2s" to "Never", so the marker should no longer fade away by itself.',
      { name: 'autohide-never', scrollTo: popup.locator('#badge-autohide') },
    )
  },
}
