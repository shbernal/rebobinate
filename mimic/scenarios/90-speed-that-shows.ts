import {
  assertMarker,
  assertPlaying,
  openVideoPage,
  pressSpeed,
  speedOf,
  type Ctx,
} from '../page.ts'

/**
 * The claim the whole extension rests on, which no exhibit has ever carried:
 * that the video actually plays faster.
 *
 * Every panel exhibit shows a number, and `70-badge-lifetime` shows a marker
 * arriving and leaving. A number is not a speed. A judge has so far only ever
 * been told the talk sped up, by a caption, over footage that could have been
 * running at any rate at all — and a critique of a speed control that has never
 * seen anything change speed is a critique of a readout.
 *
 * So this is a recording and almost nothing else, over a page that counts. The
 * clip behind it is a four-second loop of a smooth gradient, and a loop like
 * that carries no pace at all when it is sampled once a second — which is how a
 * judge watches a recording. Hence the counter the test page draws under the
 * player: it climbs by a second of video per second at 1.0× and by two at 2.0×,
 * so the difference this scenario is about is arithmetic in the frames rather
 * than something a judge has to feel.
 *
 * The recording is in three parts on purpose — normal, the climb, then fast —
 * because the middle is the honest part. Ten presses is what the default 0.1
 * step costs to reach 2.0×, the caption says ten, and if that is too many the
 * judge should be free to say so.
 */
export default {
  id: 'speed-that-shows',
  title: 'Getting a talk to actually play faster',
  intent:
    'Someone has a 48 minute conference talk to get through and no 48 minutes to spend on it. They want it playing at about twice the speed, and they want to be able to tell that it worked.',
  video: true,

  async run(s: Ctx) {
    const video = await openVideoPage(s.context, { playing: true, clock: true })
    s.use(video)
    await assertPlaying(video)

    // Long enough that the loop behind the talk comes round at least once at
    // its normal rate. Without that there is nothing for the fast stretch to be
    // fast compared to.
    await video.waitForTimeout(5000)
    await assertMarker(video, 'normal', { shown: false })
    await s.show(
      'A conference talk playing at its normal speed, with the extension installed and nothing on screen from it. The footage is a short placeholder clip on a loop, standing in for whatever the person would really be watching and stretched well past the size it was made at, so it is soft — that is the fixture, not the site. The big number under the talk is the test page counting how many seconds of video have played; it is labelled as such, and it is not part of the extension.',
      { name: 'normal' },
    )

    // Ten, because the step ships at 0.1 and 1.0 plus ten steps is 2.0. Pressed
    // one at a time rather than jumped, so the climb is on camera.
    await pressSpeed(video, '+', 10)

    const reached = await speedOf(video)
    if (reached !== 2) {
      throw new Error(`ten presses of "+" landed on ${reached}×, not 2×`)
    }

    await assertMarker(video, 'doubled', { shown: true, text: '2.0×' })
    await s.show(
      'The person pressed the "+" key ten separate times, which is what the extension\'s default step of 0.1 costs to get from normal speed to double. The marker in the top-left corner of the video reads "2.0×" and the talk is now playing at twice its normal rate — from here the test page\'s counter underneath gains two seconds of video for every second that passes.',
      { name: 'doubled' },
    )

    // The marker takes itself off screen two seconds after the last press, and
    // the rest of this is the talk running without it — which is the point. The
    // speed is a property of the video, not of the marker announcing it.
    await video.waitForTimeout(6000)
    await assertMarker(video, 'still-fast', { shown: false })

    const held = await speedOf(video)
    if (held !== 2) {
      throw new Error(`the talk fell back to ${held}× on its own`)
    }

    await s.show(
      'Six seconds later. The marker has taken itself off screen, as it does two seconds after a speed change, and the talk is still playing at double speed — nothing on screen says so any more, and nothing had to. The counter has moved on by about twelve, which is twelve seconds of talk in six seconds of sitting there.',
      { name: 'still-fast' },
    )

    s.showVideo(
      'The same visit as a recording of the page, at real speed, in three stretches. First about five seconds of the talk at its normal speed, during which the counter under it climbs by about one per second — that counter is the test page\'s, not the extension\'s, and it counts seconds of video played. Then the "+" key is pressed ten times in a row, over about a second, and the marker in the top-left counts up as it goes. Then about six seconds at double speed, during which the marker disappears on its own and the counter climbs by about two per second instead of one. That change of rate is the whole claim: the same footage, the same real seconds, twice as much talk getting through. What the marker says is too small to read here — the pictures above are for that.',
    )
  },
}
