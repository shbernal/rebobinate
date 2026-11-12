import type { StatsDay, StatsStore } from './stats'
import { localDay } from './stats'

/**
 * The numbers the stats surfaces show, derived from the stored buckets.
 *
 * `real` is wall-clock time spent watching. `content` is how much video that
 * covered, `real × speed`. `saved` is the difference, and below 1× it is
 * negative: watching slowed down costs time, and the totals say so rather
 * than flooring it at zero.
 */
export type WatchTotals = {
  real: number
  content: number
  saved: number
}

const EMPTY_TOTALS: WatchTotals = { real: 0, content: 0, saved: 0 }

const add = (totals: WatchTotals, buckets: Record<string, number>) => {
  let { real, content } = totals

  for (const [bucket, seconds] of Object.entries(buckets)) {
    real += seconds
    content += seconds * Number(bucket)
  }

  return { real, content, saved: content - real }
}

/** The local days of the `count`-day window ending today, oldest first. */
export const lastDays = (count: number, now: number): StatsDay[] => {
  const today = new Date(now)

  return Array.from({ length: count }, (_, index) =>
    localDay(
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - (count - 1 - index),
      ).getTime(),
    ),
  )
}

/** Everything watched on the given days, across every site. */
export const totalsFor = (store: StatsStore, days: StatsDay[]): WatchTotals => {
  return days.reduce(
    (totals, day) => Object.values(store.days[day] ?? {}).reduce(add, totals),
    EMPTY_TOTALS,
  )
}

/** One entry per day, in the order given, empty days included. */
export const dailyTotals = (
  store: StatsStore,
  days: StatsDay[],
): (WatchTotals & { day: StatsDay })[] => {
  return days.map(day => ({ day, ...totalsFor(store, [day]) }))
}

/** Every site watched on the given days, most time saved first. */
export const siteTotals = (
  store: StatsStore,
  days: StatsDay[],
): (WatchTotals & { domain: string })[] => {
  const sites = new Map<string, WatchTotals>()

  for (const day of days) {
    for (const [domain, buckets] of Object.entries(store.days[day] ?? {})) {
      sites.set(domain, add(sites.get(domain) ?? EMPTY_TOTALS, buckets))
    }
  }

  return [...sites]
    .map(([domain, totals]) => ({ domain, ...totals }))
    .sort((a, b) => b.saved - a.saved || b.real - a.real)
}

/**
 * A duration as people say it: `0 min`, `42 min`, `3 h 05 min`. Seconds are
 * noise at this scale, and a negative duration keeps its sign.
 */
export const formatDuration = (seconds: number): string => {
  const minutes = Math.round(Math.abs(seconds) / 60)
  const sign = seconds < 0 && minutes > 0 ? '−' : ''

  if (minutes < 60) {
    return `${sign}${minutes} min`
  }

  const hours = Math.floor(minutes / 60)
  const rest = String(minutes % 60).padStart(2, '0')

  return `${sign}${hours} h ${rest} min`
}
