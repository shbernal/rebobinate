import { speedsEqual } from '@/shared/speed'

/**
 * Holds the frame's videos at the desired rate.
 *
 * Sites reset `playbackRate` constantly: on source changes, on SPA navigation,
 * and — on short-form feeds — for every item. Setting the rate once is why
 * speed extensions feel broken on those sites; the fix is to re-assert whenever
 * the element reports a rate that is not ours.
 */

/**
 * A site that rewrites the rate in a loop would otherwise turn re-assertion
 * into a pegged CPU, and every correction costs a badge re-render with a layout
 * read. After this many corrections inside the window, back off and let the
 * site win until the speed is asked for again: the user setting one, or the
 * video's next media event (`apply`), which is how a new source arrives.
 */
const MAX_CORRECTIONS = 12
const CORRECTION_WINDOW_MS = 1000

export type Enforcer = {
  setSpeed: (speed: number) => void
  getSpeed: () => number
  apply: (video: HTMLVideoElement) => void
  applyAll: () => void
  reconcile: (video: HTMLVideoElement) => void
  isSuppressed: (video: HTMLVideoElement) => boolean
}

type CorrectionState = {
  count: number
  windowStart: number
  /** Sticky: only `apply` clears it, by dropping the whole state. */
  suppressed: boolean
}

export type EnforcerOptions = {
  videos: () => HTMLVideoElement[]
  now?: () => number
}

export const createEnforcer = ({
  videos,
  now = () => Date.now(),
}: EnforcerOptions): Enforcer => {
  const corrections = new WeakMap<HTMLVideoElement, CorrectionState>()
  let desired = 1

  const write = (video: HTMLVideoElement, speed: number) => {
    try {
      video.playbackRate = speed
      // Keeps the rate across source changes on players that reload `src`
      // without recreating the element.
      video.defaultPlaybackRate = speed
    } catch {
      // Some players throw on out-of-range rates. Nothing to do but skip.
    }
  }

  const apply = (video: HTMLVideoElement) => {
    corrections.delete(video)
    write(video, desired)
  }

  const applyAll = () => {
    videos().forEach(apply)
  }

  const isSuppressed = (video: HTMLVideoElement) =>
    corrections.get(video)?.suppressed === true

  /** Called on every `ratechange`: re-assert unless the rate is already ours. */
  const reconcile = (video: HTMLVideoElement) => {
    if (speedsEqual(video.playbackRate, desired)) {
      return
    }

    const timestamp = now()
    const state = corrections.get(video)

    if (state?.suppressed) {
      return
    }

    if (!state || timestamp - state.windowStart >= CORRECTION_WINDOW_MS) {
      corrections.set(video, {
        count: 1,
        windowStart: timestamp,
        suppressed: false,
      })
      write(video, desired)
      return
    }

    if (state.count >= MAX_CORRECTIONS) {
      state.suppressed = true
      return
    }

    state.count += 1
    write(video, desired)
  }

  const setSpeed = (speed: number) => {
    desired = speed
    applyAll()
  }

  return {
    setSpeed,
    getSpeed: () => desired,
    apply,
    applyAll,
    reconcile,
    isSuppressed,
  }
}
