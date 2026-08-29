import {
  assertMarker,
  assertPlaying,
  openVideoPage,
  pressSpeed,
  speedOf,
  type Ctx,
} from '../page.ts'

/**
 * The other direction, and the key that undoes everything.
 *
 * In fourteen runs no judge has been shown the extension slowing anything down,
 * and none has seen the reset key at all — every exhibit that touches speed goes
 * up and stays up. Both halves need a recording: half speed is a rate, and a
 * still of a video is the same still whatever rate it is running at; reset is
 * the one control whose whole job is to leave no trace, which a still cannot
 * tell apart from a control that did nothing.
 *
 * The pace is read off the counter the test page draws under the player, for
 * the reason set out in `page.ts` — the clip is a four-second gradient loop and
 * carries no pace of its own once it is sampled once a second. At 0.5× the
 * counter gains a second of video for every two that pass.
 *
 * Reset does two things at once, and the narration says both. It puts the video
 * back to normal speed, and because the marker is hidden at 1.0× by default it
 * takes the marker off screen with it — so the frame after the reset is a page
 * with no sign of the extension on it, which is exactly the frame this scenario
 * opened on. Saying only "the speed went back" over that frame would leave a
 * judge to guess why the marker went too.
 */
export default {
  id: 'slowing-right-down',
  title: 'Slowing a video down to catch something, then putting it back',
  intent:
    'Someone is watching a demonstration and something happens too fast to follow. They want to slow the video right down to see it, and then get straight back to normal without hunting for what normal was.',
  video: true,

  async run(s: Ctx) {
    const video = await openVideoPage(s.context, { playing: true, clock: true })
    s.use(video)
    await assertPlaying(video)

    await video.waitForTimeout(4000)
    await assertMarker(video, 'normal', { shown: false })
    await s.show(
      'A talk playing at its normal speed, with nothing on screen from the extension. The footage is a short placeholder clip on a loop, stretched well past the size it was made at, so it is soft — that is the fixture, not the site. The big number under the talk is the test page counting how many seconds of video have played; it is labelled as such, and it is not part of the extension.',
      { name: 'normal' },
    )

    // Five presses of the 0.1 step, from 1.0 down to 0.5. Half speed rather
    // than a nudge, because a nudge is not something a recording can show.
    await pressSpeed(video, '-', 5)

    const slowed = await speedOf(video)
    if (slowed !== 0.5) {
      throw new Error(`five presses of "-" landed on ${slowed}×, not 0.5×`)
    }

    await assertMarker(video, 'halved', { shown: true, text: '0.5×' })
    await s.show(
      'The person pressed the "−" key five times. The marker in the top-left corner reads "0.5×" and the talk is now playing at half its normal rate, slowly enough to watch something happen in it — from here the counter underneath gains one second of video for every two seconds that pass.',
      { name: 'halved' },
    )

    // Long enough at half speed for the loop behind the talk to fail to come
    // round, which is what makes the slowness visible rather than asserted.
    await video.waitForTimeout(6000)

    // One key, from anywhere in the range, rather than ten presses back up.
    await pressSpeed(video, '0', 1)

    const back = await speedOf(video)
    if (back !== 1) {
      throw new Error(`"0" left the talk at ${back}×, not back at normal`)
    }

    await assertMarker(video, 'reset', { shown: false })
    await s.show(
      'The person pressed "0" once. The talk is back at its normal speed — not five presses back up, one key from wherever it happened to be. The marker has gone from the corner as well, because the extension ships hiding it at normal speed, so apart from the counter having moved on this is the same picture the page started as.',
      { name: 'reset' },
    )

    await video.waitForTimeout(3000)

    s.showVideo(
      'The same visit as a recording of the page, at real speed. First about four seconds of the talk at its normal speed, during which the counter under it climbs by about one per second — that counter is the test page\'s, not the extension\'s, and it counts seconds of video played. Then the "−" key is pressed five times and the marker counts down to 0.5×, and for the six seconds after that the counter climbs at about half its earlier rate: the same footage, getting through half as much talk per real second. Then "0" is pressed once, and in a single frame the counter goes back to climbing at its original rate and the marker disappears with it, because the extension ships hiding the marker at normal speed. What the marker says is too small to read here — the pictures above are for that.',
    )
  },
}
