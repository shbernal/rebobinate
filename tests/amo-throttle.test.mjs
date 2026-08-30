import { describe, expect, it } from 'vitest'
import {
  FALLBACK_THROTTLE_WAIT_MS,
  budgetLeft,
  MAX_PACE_WAIT_MS,
  PACE_MARGIN_MS,
  SCOPE_LIMITS,
  paceDelay,
  throttleScope,
  throttleWaitMs,
} from '../scripts/amo-throttle.mjs'

// This file is `.mjs` because the module under test is: the publish scripts are
// plain ESM run by node, not part of a TypeScript project reference.

const NOW = 1_000_000_000
const { submission } = SCOPE_LIMITS

// A history of `count` calls, the most recent `ago` ms back and one second
// apart, ascending as the script records them.
const sentAgo = (count, ago) =>
  Array.from(
    { length: count },
    (_, index) => NOW - ago - (count - 1 - index) * 1000,
  )

describe('throttleScope', () => {
  it('leaves reads alone: AMO throttles unsafe methods only', () => {
    expect(throttleScope('GET', '/addons/addon/x/')).toBeNull()
    expect(throttleScope('GET', '/addons/upload/uuid/')).toBeNull()
  })

  it('bills a package upload to its own scope, not the submission budget', () => {
    expect(throttleScope('POST', '/addons/upload/')).toBe('upload')
  })

  it('bills every other write to the submission budget', () => {
    expect(throttleScope('PUT', '/addons/addon/x/')).toBe('submission')
    expect(throttleScope('POST', '/addons/addon/x/previews/')).toBe(
      'submission',
    )
    expect(throttleScope('DELETE', '/addons/addon/x/previews/1/')).toBe(
      'submission',
    )
  })
})

describe('paceDelay', () => {
  it('sends immediately when nothing is in flight', () => {
    expect(paceDelay([], NOW, submission)).toEqual({ waitMs: 0, limit: null })
  })

  it('sends immediately while under every limit', () => {
    expect(paceDelay(sentAgo(2, 1000), NOW, submission).waitMs).toBe(0)
  })

  // The call that fills the window has to age out of it; a sliding window does
  // not reset.
  it('holds until the oldest call leaves the burst window', () => {
    const history = sentAgo(3, 20_000)

    expect(paceDelay(history, NOW, submission)).toEqual({
      waitMs: 60_000 - 22_000 + PACE_MARGIN_MS,
      limit: '3/minute',
    })
  })

  it('reports the longest wait when more than one limit is spent', () => {
    const history = [...sentAgo(7, 1_800_000), ...sentAgo(3, 10_000)]

    expect(paceDelay(history, NOW, submission).limit).toBe('10/hour')
  })

  it('ignores calls that have already aged out', () => {
    expect(paceDelay(sentAgo(3, 61_000), NOW, submission).waitMs).toBe(0)
  })

  // An hourly wait is long but legitimate; anything past that means the daily
  // cap is gone and the run should say so rather than sleep until tomorrow.
  it('asks for more than a run should wait once the day is spent', () => {
    const history = sentAgo(24, 3_600_000)
    const { waitMs, limit } = paceDelay(history, NOW, submission)

    expect(limit).toBe('24/day')
    expect(waitMs).toBeGreaterThan(MAX_PACE_WAIT_MS)
  })

  it('keeps an hourly wait inside what a run will sit out', () => {
    expect(paceDelay(sentAgo(10, 1000), NOW, submission).waitMs).toBeLessThan(
      MAX_PACE_WAIT_MS,
    )
  })
})

// What a release checks before starting preview work: how much can be done now
// without the job going to sleep for the rest of the hour.
describe('budgetLeft', () => {
  it('is the whole allowance when nothing has been sent', () => {
    expect(budgetLeft([], NOW, submission)).toBe(10)
  })

  it('counts what this run has already spent', () => {
    expect(budgetLeft(sentAgo(3, 1000), NOW, submission)).toBe(7)
  })

  // A burst hold is seconds; deferring work over one would defer everything.
  it('ignores the minute limit, which is a wait rather than a budget', () => {
    expect(budgetLeft(sentAgo(3, 100), NOW, submission)).toBe(7)
  })

  it('takes the tightest of the long windows', () => {
    const history = [...sentAgo(9, 80_000_000), ...sentAgo(9, 100)]

    expect(budgetLeft(history, NOW, submission)).toBe(1)
  })

  it('does not go negative once a limit is spent', () => {
    expect(budgetLeft(sentAgo(30, 1000), NOW, submission)).toBe(0)
  })
})

describe('throttleWaitMs', () => {
  it('waits out the header AMO sends, plus a margin', () => {
    expect(throttleWaitMs('56')).toBe(56_000 + PACE_MARGIN_MS)
  })

  it('falls back when the header is missing or unusable', () => {
    for (const header of [null, '', 'soon', '0', '-1', 'Infinity']) {
      expect(throttleWaitMs(header)).toBe(FALLBACK_THROTTLE_WAIT_MS)
    }
  })
})
