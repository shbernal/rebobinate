import {
  assertMarker,
  assertPlaying,
  openVideoPage,
  pressSpeed,
  speedOf,
  type Ctx,
} from '../page.ts'
import type { Page } from '@playwright/test'

/**
 * The per-site memory, seen from the page instead of from the panel.
 *
 * `50-per-site-memory` shows the panel's Sites list filling in, which is the
 * bookkeeping. This is the payoff, and it happens somewhere no still can reach:
 * a page loads, and a second or so later the speed the person chose last time is
 * simply on, without them touching anything. A frame of a video at 1.5× is
 * indistinguishable from a frame of a video anyone just set to 1.5× — the whole
 * claim is that nobody did.
 *
 * Hence the reload rather than a second tab. What has to be visible is the page
 * going away and coming back: the recording shows the talk stop, the page
 * repaint from nothing, and the speed arrive on its own after it. The counter
 * the test page draws under the player is what makes the arriving speed legible
 * — it resets to zero with the page and then climbs at one and a half seconds
 * of video per second, which is the same reading it had before the reload.
 *
 * The restore is waited for rather than slept through. A fixed wait would put a
 * caption saying "it came back fast" over a frame where it had not come back
 * yet, on any run where the service worker took a moment longer than usual.
 */
const restoredTo = async (video: Page, speed: number): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if ((await speedOf(video)) === speed) {
      return
    }
    await video.waitForTimeout(100)
  }

  throw new Error(
    `the reloaded page never went back to ${speed}× — it is at ${await speedOf(video)}×`,
  )
}

export default {
  id: 'remembered-on-return',
  title: 'Coming back to a site that remembers how you watch it',
  intent:
    'Someone always watches this particular site faster than normal and is tired of setting it every time they open something there. They want to find out whether it comes back on its own.',
  video: true,

  async run(s: Ctx) {
    const video = await openVideoPage(s.context, { playing: true, clock: true })
    s.use(video)
    await assertPlaying(video)
    await video.waitForTimeout(3000)

    // Ten presses of the 0.05 step, from 1.0 to 1.5. Enough that the footage is
    // visibly quicker, which is what the frame after the reload has to match.
    await pressSpeed(video, '+', 10)

    const chosen = await speedOf(video)
    if (chosen !== 1.5) {
      throw new Error(`ten presses of "+" landed on ${chosen}×, not 1.5×`)
    }

    await assertMarker(video, 'chosen', { shown: true, text: '1.5×' })
    await s.show(
      'The person pressed "+" ten times on a talk at player.test, taking it to one and a half times its normal speed. The marker in the top-left corner reads "1.5×". Nothing was opened and nothing was saved by hand; this is just someone setting the speed the way they always do. The big number under the talk is the test page counting how many seconds of video have played; it is labelled as such, and it is not part of the extension.',
      { name: 'chosen' },
    )

    // Past the second the extension waits before writing the speed down, so
    // what the reload finds is a settled choice rather than a keystroke.
    await video.waitForTimeout(2500)

    await video.reload()
    await assertPlaying(video)
    await restoredTo(video, 1.5)
    await assertMarker(video, 'returned', { shown: true, text: '1.5×' })
    await s.show(
      'The same page, loaded again from scratch — as it would be on the next visit, or the next talk on that site. No key has been pressed since it came back, and the counter underneath has started again from zero along with the page. The talk is already playing at 1.5× and the marker has appeared by itself in the corner to say so: the site was remembered, and the speed came with it.',
      { name: 'returned' },
    )

    await video.waitForTimeout(4000)
    await assertMarker(video, 'settled', { shown: false })

    const held = await speedOf(video)
    if (held !== 1.5) {
      throw new Error(`the restored speed slipped to ${held}×`)
    }

    await s.show(
      'Four seconds later the marker has taken itself off screen, as it does after any speed change, and the talk carries on at 1.5×: the counter has passed six, which is six seconds of talk in four seconds of sitting there. From here the page looks like an ordinary page, which is the point — the person did not have to do anything to it.',
      { name: 'settled' },
    )

    s.showVideo(
      'The same visit as a recording of the page, at real speed. First the talk at its normal speed, where the counter under it climbs by about one per second — that counter is the test page\'s, not the extension\'s, and it counts seconds of video played. Then "+" is pressed ten times, the marker counts up to 1.5×, and the counter starts climbing half again as fast. Then the page reloads: it goes blank, paints again from nothing, and the counter starts over at zero, which is the whole point of this recording. A moment after it comes back, with nothing touched, the counter is climbing at the quicker rate again and the marker has reappeared on its own to announce it before fading. Nobody pressed anything after the reload.',
    )
  },
}
