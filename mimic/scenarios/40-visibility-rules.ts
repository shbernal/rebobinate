import { look, start, toggle, type Ctx } from '../page.ts'

/**
 * The two settings that decide when the marker is allowed on screen, and the
 * sentence under the preview that reads them both back. Each frame changes one
 * of the two and the sentence changes with it, which is the whole point of
 * showing them together rather than one at a time.
 *
 * An earlier draft narrated "has been turned on" over a click that turned the
 * switch off — a caption a code-blind judge would have had no way to catch. The
 * switch has since been inverted to "Show at 1.0×", so it now ships off and this
 * scenario turns it on; the caption has to follow, not the habit.
 *
 * The first blind probe, before any of this existed, flagged that the live
 * sample draws the marker while the marker is meant to be hidden at normal
 * speed. Whether that is a real contradiction is triage's call; this scenario
 * just shows the states honestly and lets the judge reach its own conclusion.
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

    // The sentence is the last thing in the block, so bringing it into view
    // brings both settings and the live sample with it.
    const note = popup.locator('.preview + .note')

    await look(
      s,
      popup,
      'The part of the Settings section that decides when the marker is allowed on screen, as it comes out of the box: a dropdown for how long it stays, and a switch for whether it shows at all when the video is at its normal speed. Below them is a live sample of the marker, and under that a sentence stating the rule the two settings currently add up to. The video behind the panel is playing at its normal speed and has not been sped up.',
      { name: 'rules', mustShow: note },
    )

    await toggle(popup, 'Show at 1.0×').click()
    await popup.waitForTimeout(400)
    await look(
      s,
      popup,
      'The switch labelled "Show at 1.0×" has been turned on, so the marker should now stay on screen even at normal speed. The sentence underneath has been rewritten to say so. The video behind the panel is still at its normal speed.',
      { name: 'show-at-normal', mustShow: note },
    )

    await popup.locator('#badge-autohide').selectOption('0')
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The dropdown labelled "Hide after" has been changed from "2s" to "Never", so the marker should no longer fade away by itself. That is the second half of the same sentence, and it has been rewritten too.',
      { name: 'autohide-never', mustShow: note },
    )
  },
}
