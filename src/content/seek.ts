/**
 * Moves a video by `seconds`, clamped to `[0, duration]`.
 *
 * Returns whether it moved. A live stream (`duration === Infinity`) has no end
 * to clamp to and its own idea of where "now" is, and a video with no metadata
 * yet (`NaN`) has nothing to seek through; both are left alone.
 */
export const seekVideo = (
  video: HTMLVideoElement,
  seconds: number,
): boolean => {
  const { duration } = video

  if (!Number.isFinite(duration)) {
    return false
  }

  video.currentTime = Math.min(
    duration,
    Math.max(0, video.currentTime + seconds),
  )

  return true
}

/** `−10s` / `+10s`, with a true minus sign to match the badge's typography. */
export const formatSeekLabel = (seconds: number): string =>
  `${seconds < 0 ? '−' : '+'}${Math.abs(seconds)}s`
