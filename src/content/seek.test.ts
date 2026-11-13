import { describe, expect, it } from 'vitest'
import { formatSeekLabel, seekVideo } from './seek'

const videoAt = (currentTime: number, duration: number) => {
  const video = document.createElement('video')

  Object.defineProperty(video, 'duration', { value: duration })
  Object.defineProperty(video, 'currentTime', {
    value: currentTime,
    writable: true,
  })

  return video
}

describe('seekVideo', () => {
  it('moves by the given seconds', () => {
    const video = videoAt(30, 100)

    expect(seekVideo(video, -10)).toBe(true)
    expect(video.currentTime).toBe(20)
  })

  it('clamps to the start and the end', () => {
    const early = videoAt(4, 100)
    const late = videoAt(95, 100)

    seekVideo(early, -10)
    seekVideo(late, 10)

    expect(early.currentTime).toBe(0)
    expect(late.currentTime).toBe(100)
  })

  it('leaves live streams and unloaded videos alone', () => {
    const live = videoAt(30, Infinity)
    const unloaded = videoAt(0, NaN)

    expect(seekVideo(live, 10)).toBe(false)
    expect(seekVideo(unloaded, 10)).toBe(false)
    expect(live.currentTime).toBe(30)
  })
})

describe('formatSeekLabel', () => {
  it('signs the seconds', () => {
    expect(formatSeekLabel(-10)).toBe('−10s')
    expect(formatSeekLabel(5)).toBe('+5s')
  })
})
