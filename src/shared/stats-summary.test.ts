import { describe, expect, it } from 'vitest'
import { normalizeStats } from './stats'
import {
  dailyTotals,
  formatDuration,
  lastDays,
  siteTotals,
  totalsFor,
} from './stats-summary'

const store = normalizeStats({
  days: {
    '2026-01-04': { 'a.com': { '2': 600 } },
    '2026-01-05': {
      'a.com': { '1.5': 1200 },
      'b.com': { '0.75': 400, '1': 100 },
    },
  },
})

describe('lastDays', () => {
  it('ends today and crosses month boundaries', () => {
    expect(lastDays(3, new Date(2026, 2, 1, 9).getTime())).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ])
  })
})

describe('totals', () => {
  it('derives content and saved time from the buckets', () => {
    expect(totalsFor(store, ['2026-01-04', '2026-01-05'])).toEqual({
      real: 2300,
      content: 1200 + 1800 + 300 + 100,
      saved: 3400 - 2300,
    })
  })

  // Watching below 1× costs time, and that is shown rather than floored.
  it('lets a slowed-down site go negative and ranks it last', () => {
    const sites = siteTotals(store, ['2026-01-05'])

    expect(sites.map(site => [site.domain, site.saved])).toEqual([
      ['a.com', 600],
      ['b.com', -100],
    ])
  })

  it('keeps empty days in the daily series', () => {
    expect(
      dailyTotals(store, ['2026-01-03', '2026-01-04']).map(day => day.saved),
    ).toEqual([0, 600])
  })
})

describe('formatDuration', () => {
  it('reads as minutes, then hours and minutes, keeping the sign', () => {
    expect(formatDuration(10)).toBe('0 min')
    expect(formatDuration(-10)).toBe('0 min')
    expect(formatDuration(42 * 60)).toBe('42 min')
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe('3 h 05 min')
    expect(formatDuration(-90 * 60)).toBe('−1 h 30 min')
  })
})
