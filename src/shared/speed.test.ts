import { describe, expect, it } from 'vitest'
import {
  clampSpeed,
  formatSpeed,
  formatSpeedLabel,
  roundSpeed,
  speedsEqual,
  stepSpeed,
} from './speed'

describe('stepSpeed', () => {
  it('steps by the configured increment from normal speed', () => {
    expect(stepSpeed(1, 0.05, 1, 0.1, 16)).toBe(1.05)
    expect(stepSpeed(1, 0.05, -1, 0.1, 16)).toBe(0.95)
  })

  it('does not accumulate floating point drift', () => {
    let speed = 1

    for (let index = 0; index < 20; index += 1) {
      speed = stepSpeed(speed, 0.05, 1, 0.1, 16)
    }

    expect(speed).toBe(2)
  })

  it('snaps back onto the grid when a site left an odd rate', () => {
    expect(stepSpeed(1.07, 0.05, 1, 0.1, 16)).toBe(1.1)
    expect(stepSpeed(1.07, 0.05, -1, 0.1, 16)).toBe(1.05)
  })

  it('honours a custom increment', () => {
    expect(stepSpeed(1, 0.25, 1, 0.1, 16)).toBe(1.25)
    expect(stepSpeed(1, 0.1, -1, 0.1, 16)).toBe(0.9)
  })

  it('clamps at the bounds instead of overshooting', () => {
    expect(stepSpeed(16, 0.05, 1, 0.1, 16)).toBe(16)
    expect(stepSpeed(0.1, 0.05, -1, 0.1, 16)).toBe(0.1)
  })

  it('falls back to a sane increment when the step is invalid', () => {
    expect(stepSpeed(1, 0, 1, 0.1, 16)).toBe(1.05)
  })
})

describe('clampSpeed', () => {
  it('keeps values inside the range', () => {
    expect(clampSpeed(20, 0.1, 16)).toBe(16)
    expect(clampSpeed(0.01, 0.1, 16)).toBe(0.1)
    expect(clampSpeed(1.5, 0.1, 16)).toBe(1.5)
  })

  it('falls back to normal speed for non-numbers', () => {
    expect(clampSpeed(Number.NaN, 0.1, 16)).toBe(1)
    expect(clampSpeed(Number.POSITIVE_INFINITY, 0.1, 16)).toBe(1)
  })
})

describe('roundSpeed and speedsEqual', () => {
  it('rounds to three decimals', () => {
    expect(roundSpeed(1.1000000000000001)).toBe(1.1)
  })

  it('treats imperceptible differences as equal', () => {
    expect(speedsEqual(1.0001, 1)).toBe(true)
    expect(speedsEqual(1.05, 1)).toBe(false)
  })
})

describe('formatSpeed', () => {
  it('always shows at least one decimal', () => {
    expect(formatSpeed(1)).toBe('1.0')
    expect(formatSpeed(2)).toBe('2.0')
  })

  it('keeps the second decimal only when it carries information', () => {
    expect(formatSpeed(1.05)).toBe('1.05')
    expect(formatSpeed(1.1)).toBe('1.1')
    expect(formatSpeed(0.75)).toBe('0.75')
  })

  it('appends the multiplier sign in the label', () => {
    expect(formatSpeedLabel(1.25)).toBe('1.25×')
  })
})
