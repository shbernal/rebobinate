import { describe, expect, it } from 'vitest'
import { createEnforcer } from './enforcer'

const createVideo = () => document.createElement('video')

describe('createEnforcer', () => {
  it('applies the desired speed to every video', () => {
    const first = createVideo()
    const second = createVideo()
    const enforcer = createEnforcer({ videos: () => [first, second] })

    enforcer.setSpeed(1.5)

    expect(first.playbackRate).toBe(1.5)
    expect(second.playbackRate).toBe(1.5)
    expect(first.defaultPlaybackRate).toBe(1.5)
  })

  it('re-applies the speed when the site resets it', () => {
    const video = createVideo()
    const enforcer = createEnforcer({ videos: () => [video] })

    enforcer.setSpeed(2)
    video.playbackRate = 1
    enforcer.reconcile(video)

    expect(video.playbackRate).toBe(2)
  })

  it('leaves a rate that is already ours alone', () => {
    const video = createVideo()
    const enforcer = createEnforcer({ videos: () => [video] })

    enforcer.setSpeed(2)
    enforcer.reconcile(video)

    expect(video.playbackRate).toBe(2)
    expect(enforcer.isSuppressed(video)).toBe(false)
  })

  it('gives up after a site fights back too many times in a row', () => {
    const video = createVideo()
    let now = 0
    const enforcer = createEnforcer({ videos: () => [video], now: () => now })

    enforcer.setSpeed(2)

    for (let index = 0; index < 30; index += 1) {
      video.playbackRate = 1
      enforcer.reconcile(video)
    }

    expect(enforcer.isSuppressed(video)).toBe(true)
    expect(video.playbackRate).toBe(1)

    // A new window starts once the site stops hammering.
    now += 2000
    video.playbackRate = 1
    enforcer.reconcile(video)

    expect(video.playbackRate).toBe(2)
  })

  it('starts a fresh budget whenever the user sets a speed', () => {
    const video = createVideo()
    let now = 0
    const enforcer = createEnforcer({ videos: () => [video], now: () => now })

    enforcer.setSpeed(2)

    for (let index = 0; index < 30; index += 1) {
      video.playbackRate = 1
      enforcer.reconcile(video)
    }

    expect(enforcer.isSuppressed(video)).toBe(true)

    enforcer.setSpeed(3)

    expect(video.playbackRate).toBe(3)
    expect(enforcer.isSuppressed(video)).toBe(false)
  })

  it('survives a player that rejects the rate', () => {
    const video = createVideo()
    Object.defineProperty(video, 'playbackRate', {
      get: () => 1,
      set: () => {
        throw new Error('not supported')
      },
    })

    const enforcer = createEnforcer({ videos: () => [video] })

    expect(() => enforcer.setSpeed(2)).not.toThrow()
    expect(enforcer.getSpeed()).toBe(2)
  })
})
