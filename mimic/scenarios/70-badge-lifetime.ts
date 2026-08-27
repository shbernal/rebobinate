import {
  assertMarker,
  assertPlaying,
  metaOf,
  openVideoPage,
  pressSpeed,
  type Ctx,
} from '../page.ts'

/**
 * The one scenario whose subject is time, and the only one that looks at the
 * page rather than at the panel.
 *
 * Every other scenario clips the popup, so in thirteen runs no judge has been
 * shown the marker the extension actually draws over the video — only the
 * sample of it pinned inside Settings, and sentences describing what it will
 * do. What it does is appear, wait two seconds, and vanish. No still can carry
 * that: a frame of a marker and a frame without one are two frames, and the
 * two seconds between them are exactly the thing being judged.
 *
 * Hence `video: true`. The stills are still here and still do the reading —
 * the recording is sampled about once a second by the judge and 14px of text
 * does not survive that — so the division of labour is deliberate. Stills say
 * what the marker reads. The recording says when it was there.
 *
 * The panel is not in the recording. It is a real popup over the page, not an
 * element in it, so it never lands in a recording of the page, and the caption
 * on the frame that depends on it says where the person went instead of
 * pretending the frame shows it.
 */
export default {
  id: 'badge-lifetime',
  title: 'Watching the speed marker come and go',
  intent:
    'Someone speeds up a video and wants to see, on the video itself, how fast it is now playing — and to find out whether that marker stays put or disappears on its own.',
  video: true,

  async run(s: Ctx) {
    // Not the shared `start()`: the frames here come from the page, and the
    // panel is opened later and only for the one setting it is needed for.
    const video = await openVideoPage(s.context, { playing: true })
    s.use(video)
    await assertPlaying(video)
    await video.waitForTimeout(1500)

    await assertMarker(video, 'playing', { shown: false })
    await s.show(
      'A page playing a conference talk at its normal speed, with the extension installed and doing nothing. There is no sign of it anywhere on screen. The footage itself is a short placeholder clip standing in for whatever the person would really be watching, stretched well past the size it was made at, so it is soft — that is the fixture, not the site.',
      { name: 'playing' },
    )

    // Three presses rather than one: a single step is 1.1x, and a caption that
    // rounds that to "faster" invites a critique of a step size nobody chose.
    await pressSpeed(video, '+', 3)
    await assertMarker(video, 'marker', { shown: true, text: '1.3×' })
    await s.show(
      'The person pressed the "+" key three times. A small marker has appeared in the top-left corner of the video, reading "1.3×" — how fast the talk is now playing. It is the only thing on screen saying the speed was changed at all.',
      { name: 'marker' },
    )

    // Two seconds is what the marker ships with, and this is the wait the whole
    // scenario exists to show. Half a second past it, so a timer that fires
    // late fails the frame instead of being caught mid-fade.
    await video.waitForTimeout(2500)
    await assertMarker(video, 'gone', { shown: false })
    await s.show(
      'Two seconds after that press, with nothing touched in between, the marker faded away by itself. The talk is still playing at 1.3×, and nothing on screen says so any more.',
      { name: 'gone' },
    )

    const popup = await metaOf(s).openPopup()
    await popup.getByRole('tab', { name: 'Settings' }).click()
    await popup.waitForTimeout(300)
    await popup.locator('#badge-autohide').selectOption('0')
    await popup.waitForTimeout(300)

    await video.bringToFront()
    await pressSpeed(video, '+', 1)
    await video.waitForTimeout(4000)
    await assertMarker(video, 'stays', { shown: true, text: '1.4×' })
    await s.show(
      'The person opened the extension\'s panel — a popup over this page, which is why it is not in this picture — set "Hide after" to "Never", closed it, and pressed "+" once more. Four seconds later the marker is still in the corner, now reading "1.4×", and it will stay there.',
      { name: 'stays' },
    )

    s.showVideo(
      'The same few minutes as a recording of the page, at real speed, from the moment it opened. In order: the talk plays with nothing over it; the marker appears in the top-left corner when "+" is pressed; it holds for two seconds and disappears on its own while the talk carries on; the page then sits unchanged for a few seconds, which is the person over in the panel turning that disappearance off; and when "+" is pressed again the marker comes back and this time stays for the rest of the recording. What the marker says is too small to read here — the pictures above are for that. What this is for is when it was on screen and when it was not.',
    )
  },
}
