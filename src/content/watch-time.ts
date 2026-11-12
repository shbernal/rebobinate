import type { StatsSample } from '@/shared/stats'
import { localDay, speedBucket } from '@/shared/stats'

/**
 * Adds up how long this frame's videos actually play, per day and speed
 * bucket, and hands the totals over to be stored.
 *
 * Driven by `timeupdate` alone, which a playing video fires a few times a
 * second and a paused one does not; there is no timer, so a frame with nothing
 * playing costs nothing. Each tick counts the wall-clock time since the
 * previous one, at the rate the video is really playing — which is the site's
 * when the site has overridden the speed.
 *
 * The clock is per frame rather than per video, so two videos playing at once
 * count the time once.
 */

/**
 * A longer gap between ticks is not playback: the tab was throttled, the
 * machine slept, or the video stalled. The tick restarts the clock instead of
 * counting the gap.
 */
const MAX_TICK_GAP_MS = 2000

/** How often the totals are handed over while a video keeps playing. */
const FLUSH_INTERVAL_MS = 30_000

/** Events after which the next tick does not continue the previous one. */
const BREAK_EVENTS = ['pause', 'seeking', 'emptied', 'ended'] as const

type WatchTimeOptions = {
  document: Document
  /** Read on every tick, so switching recording off takes effect at once. */
  isRecording: () => boolean
  onFlush: (samples: StatsSample[]) => void
  now?: () => number
}

const isVideo = (target: EventTarget | null): target is HTMLVideoElement =>
  typeof HTMLVideoElement !== 'undefined' && target instanceof HTMLVideoElement

/**
 * A muted video with no box is a background player — an autoplaying preview
 * or an ad slot — and nobody is watching it.
 */
const isUnwatched = (video: HTMLVideoElement) => {
  if (!video.muted) {
    return false
  }

  const rect = video.getBoundingClientRect()

  return rect.width <= 0 || rect.height <= 0
}

export const createWatchTimeRecorder = ({
  document: doc,
  isRecording,
  onFlush,
  now = () => Date.now(),
}: WatchTimeOptions) => {
  const pending = new Map<string, StatsSample>()
  let lastTick: number | null = null
  let lastFlush = now()

  const flush = () => {
    lastFlush = now()

    if (pending.size === 0) {
      return
    }

    const samples = [...pending.values()]

    pending.clear()
    onFlush(samples)
  }

  const handleTick = (event: Event) => {
    const video = event.target

    if (!isVideo(video)) {
      return
    }

    const timestamp = now()
    const previous = lastTick

    lastTick = timestamp

    if (
      previous === null ||
      video.paused ||
      doc.visibilityState === 'hidden' ||
      !isRecording() ||
      isUnwatched(video)
    ) {
      return
    }

    const elapsed = timestamp - previous

    if (elapsed <= 0 || elapsed > MAX_TICK_GAP_MS) {
      return
    }

    // Counted on the day the tick lands, so time played across midnight
    // starts filling the new day from the first tick after it.
    const day = localDay(timestamp)
    const bucket = speedBucket(video.playbackRate)
    const key = `${day}|${bucket}`
    const sample = pending.get(key) ?? { day, bucket, seconds: 0 }

    sample.seconds += elapsed / 1000
    pending.set(key, sample)

    if (timestamp - lastFlush >= FLUSH_INTERVAL_MS) {
      flush()
    }
  }

  const handleBreak = () => {
    lastTick = null
  }

  const handleVisibility = () => {
    lastTick = null

    if (doc.visibilityState === 'hidden') {
      flush()
    }
  }

  const view = doc.defaultView

  const start = () => {
    doc.addEventListener('timeupdate', handleTick, { capture: true })
    BREAK_EVENTS.forEach(eventName => {
      doc.addEventListener(eventName, handleBreak, { capture: true })
    })
    doc.addEventListener('visibilitychange', handleVisibility)
    view?.addEventListener('pagehide', flush)
  }

  const stop = () => {
    doc.removeEventListener('timeupdate', handleTick, { capture: true })
    BREAK_EVENTS.forEach(eventName => {
      doc.removeEventListener(eventName, handleBreak, { capture: true })
    })
    doc.removeEventListener('visibilitychange', handleVisibility)
    view?.removeEventListener('pagehide', flush)
    pending.clear()
  }

  return { start, stop, flush }
}
