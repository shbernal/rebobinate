import { look, start, toggle, type Ctx } from '../page.ts'

/**
 * The switch is asked as "Show at 1.0×" and ships off, so this scenario turns
 * it on; the dropdown ships at 2s, so this scenario takes it to Never. Each
 * caption has to name the direction the click actually went: "turned on" over
 * a click that turned a switch off is a lie a code-blind judge cannot catch.
 *
 * The live sample cannot act either setting out — it would have to blank
 * itself to do so — and the sentence under the two controls is what states
 * them instead. So every frame here is anchored on that sentence rather than
 * on a control: the whole question this scenario asks is whether the panel
 * says anything back, and a frame scrolled past the only answer would be
 * asking a judge to confirm the panel is silent.
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

    // The sentence that states both rules, and the last thing in the block, so
    // scrolling to it brings the two controls it reads along with it.
    const rule = popup.locator('.badge-settings > .rule')

    await look(
      s,
      popup,
      'The part of the Settings section about when the marker should be visible, as it comes out of the box: a dropdown for how long it stays, a switch for whether it shows at all at normal speed, and under the two of them a sentence saying when the marker will be on screen. It currently reads "Shown for 2 seconds after a speed change, and hidden at 1.0×." Pinned to the top of the section are the on/off switch for the marker and, under it, a line reading "Preview" over a striped box holding a live sample of it — the caption matters here, because the sentence below says the marker is hidden at 1.0× while the box above shows one reading 1.0×. The video behind the panel is playing at its normal speed and has not been sped up.',
      { name: 'rules', mustShow: rule },
    )

    await toggle(popup, 'Show at 1.0×').click()
    await popup.waitForTimeout(400)
    await look(
      s,
      popup,
      'The switch labelled "Show at 1.0×" has been turned on, so the marker should now stay on screen even at normal speed. The sentence under it has changed to match: its second half now says "including at 1.0×" where it said "hidden at 1.0×" before. The video behind the panel is still at its normal speed.',
      { name: 'show-at-normal', mustShow: rule },
    )

    await popup.locator('#badge-autohide').selectOption('0')
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The dropdown labelled "Hide after" has been changed from "2s" to "Never", so the marker should no longer fade away by itself. The sentence under the two controls has changed again, and now reads "Always shown while a video is playing, including at 1.0×." — the only thing in the panel that says what the two settings add up to.',
      { name: 'autohide-never', mustShow: rule },
    )
  },
}
