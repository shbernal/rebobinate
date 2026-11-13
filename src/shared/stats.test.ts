import { describe, expect, it } from 'vitest'
import {
  STATS_SCHEMA_VERSION,
  localDay,
  mergeStats,
  normalizeStats,
  pruneStats,
  speedBucket,
} from './stats'

describe('speedBucket', () => {
  it('rounds to the nearest quarter and keeps the slowest speeds', () => {
    expect(speedBucket(1)).toBe('1')
    expect(speedBucket(1.1)).toBe('1')
    expect(speedBucket(1.2)).toBe('1.25')
    expect(speedBucket(1.4)).toBe('1.5')
    expect(speedBucket(0.1)).toBe('0.25')
    expect(speedBucket(40)).toBe('16')
  })
})

describe('localDay', () => {
  it('is the local calendar date', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
    expect(localDay(new Date(2026, 0, 6, 0, 0).getTime())).toBe('2026-01-06')
  })
})

describe('normalizeStats', () => {
  it('turns anything that is not a store into an empty one', () => {
    for (const value of [undefined, null, 'x', 4, [], { days: [] }]) {
      expect(normalizeStats(value)).toEqual({
        schemaVersion: STATS_SCHEMA_VERSION,
        days: {},
      })
    }
  })

  it('drops each malformed piece on its own and keeps the rest', () => {
    const store = normalizeStats({
      schemaVersion: 1,
      days: {
        '2026-01-05': {
          'youtube.com': {
            '1.5': 60,
            '1.3': 10,
            NaN: 5,
            '': 5,
            '2': -1,
            '3': 'x',
          },
          '': { '1': 10 },
          'vimeo.com': { '1': 0 },
        },
        '2026-02-31': { 'youtube.com': { '1': 10 } },
        yesterday: { 'youtube.com': { '1': 10 } },
        '2026-01-06': 'x',
        '2026-01-07': { 'vimeo.com': 'x' },
      },
    })

    expect(store.days).toEqual({
      '2026-01-05': { 'youtube.com': { '1.5': 60 } },
    })
  })

  // No version came before `1`, so anything stored under another version, or
  // under none, is read on the same terms rather than thrown away.
  it('reads a store with a missing or foreign schemaVersion', () => {
    const days = { '2026-01-05': { 'youtube.com': { '2': 30 } } }

    expect(normalizeStats({ days }).days).toEqual(days)
    expect(normalizeStats({ schemaVersion: 0, days }).schemaVersion).toBe(
      STATS_SCHEMA_VERSION,
    )
  })
})

describe('mergeStats', () => {
  it('adds into existing buckets and opens new ones', () => {
    const start = normalizeStats({
      days: { '2026-01-05': { 'youtube.com': { '1.5': 60 } } },
    })

    const merged = mergeStats(start, 'youtube.com', [
      { day: '2026-01-05', bucket: '1.5', seconds: 30 },
      { day: '2026-01-05', bucket: '2', seconds: 10 },
      { day: '2026-01-06', bucket: '1.5', seconds: 5 },
    ])

    expect(merged.days).toEqual({
      '2026-01-05': { 'youtube.com': { '1.5': 90, '2': 10 } },
      '2026-01-06': { 'youtube.com': { '1.5': 5 } },
    })
    expect(start.days['2026-01-05']['youtube.com']['1.5']).toBe(60)
  })
})

describe('pruneStats', () => {
  const store = normalizeStats({
    days: {
      '2025-01-01': { 'a.com': { '1': 1 } },
      '2025-10-07': { 'a.com': { '1': 1 } },
      '2025-10-08': { 'a.com': { '1': 1 } },
      '2026-01-05': { 'a.com': { '1': 1 } },
    },
  })
  const now = new Date(2026, 0, 5, 12).getTime()

  it('keeps the window with today as its last day', () => {
    // 90 days ending 2026-01-05 start on 2025-10-08.
    expect(Object.keys(pruneStats(store, 90, now).days)).toEqual([
      '2025-10-08',
      '2026-01-05',
    ])
  })

  it('keeps everything at 0', () => {
    expect(pruneStats(store, 0, now)).toBe(store)
  })
})
