import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatsSample } from '@/shared/stats'
import { createWatchTimeRecorder } from './watch-time'

let clock = 0
let recording = true
let flushes: StatsSample[][] = []

const createVideo = ({ muted = false, rate = 1 } = {}) => {
  const video = document.createElement('video')

  Object.defineProperty(video, 'paused', { value: false, writable: true })
  video.muted = muted
  video.playbackRate = rate
  video.getBoundingClientRect = () =>
    ({ width: muted ? 0 : 640, height: muted ? 0 : 360 }) as DOMRect
  document.body.append(video)

  return video
}

/** A tick at `at` milliseconds on the fake clock. */
const tick = (video: HTMLVideoElement, at: number) => {
  clock = at
  video.dispatchEvent(new Event('timeupdate'))
}

const secondsByBucket = () => {
  const totals: Record<string, number> = {}

  for (const sample of flushes.flat()) {
    const key = `${sample.day} ${sample.bucket}`
    totals[key] = (totals[key] ?? 0) + sample.seconds
  }

  return totals
}

let recorder: ReturnType<typeof createWatchTimeRecorder>

beforeEach(() => {
  clock = new Date(2026, 0, 5, 12).getTime()
  recording = true
  flushes = []
  recorder = createWatchTimeRecorder({
    document,
    isRecording: () => recording,
    onFlush: samples => flushes.push(samples),
    now: () => clock,
  })
  recorder.start()
})

afterEach(() => {
  recorder.stop()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('watch time', () => {
  it('counts the time between ticks at the rate the video plays', () => {
    const video = createVideo({ rate: 1.5 })
    const start = clock

    for (let step = 0; step <= 8; step += 1) {
      tick(video, start + step * 250)
    }

    recorder.flush()

    expect(secondsByBucket()).toEqual({ '2026-01-05 1.5': 2 })
  })

  it('does not count a pause or a gap', () => {
    const video = createVideo()
    const start = clock

    tick(video, start)
    tick(video, start + 1000)
    video.dispatchEvent(new Event('pause'))
    tick(video, start + 1500)
    tick(video, start + 2500)
    // The tab was throttled or the machine slept.
    tick(video, start + 60_000)
    tick(video, start + 60_500)

    recorder.flush()

    expect(secondsByBucket()).toEqual({ '2026-01-05 1': 2.5 })
  })

  it('counts nothing while switched off, hidden, or muted with no box', () => {
    const video = createVideo()
    const start = clock

    recording = false
    tick(video, start)
    tick(video, start + 1000)

    recording = true
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    tick(video, start + 2000)
    vi.restoreAllMocks()

    const background = createVideo({ muted: true })
    tick(background, start + 2500)

    recorder.flush()

    expect(flushes).toEqual([])
  })

  it('fills the new day from the first tick after midnight', () => {
    const video = createVideo()
    const midnight = new Date(2026, 0, 6).getTime()

    tick(video, midnight - 1000)
    tick(video, midnight - 250)
    tick(video, midnight + 250)
    recorder.flush()

    expect(secondsByBucket()).toEqual({
      '2026-01-05 1': 0.75,
      '2026-01-06 1': 0.5,
    })
  })

  it('hands the totals over every 30 seconds and on pagehide', () => {
    const video = createVideo()
    const start = clock

    for (let at = 0; at <= 31_000; at += 500) {
      tick(video, start + at)
    }

    expect(flushes).toHaveLength(1)
    expect(secondsByBucket()['2026-01-05 1']).toBe(30)

    tick(video, start + 31_500)
    window.dispatchEvent(new Event('pagehide'))

    expect(flushes).toHaveLength(2)
    expect(secondsByBucket()['2026-01-05 1']).toBe(31.5)
  })
})
