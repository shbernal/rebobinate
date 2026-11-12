import { LIMITS } from './settings'

/**
 * Watch time, kept on the device as daily totals and nothing else.
 *
 * The shape is the privacy answer: `days[day][domain][bucket]` holds seconds,
 * so the store can say how long a site was watched at roughly what speed on
 * which day, and never which page, which video, or when in the day. There is
 * no event log to trim and no URL to leak.
 *
 * Its own key, for the reason the domain map has one: the service worker
 * writes it on a timer while the popup rewrites `Settings` whenever a control
 * moves, and one key would have each drop the other's writes.
 */
export const STATS_STORAGE_KEY = 'rebobinate:stats'

export const STATS_SCHEMA_VERSION = 1

/** A local calendar date, `YYYY-MM-DD`: the user's day, not UTC's. */
export type StatsDay = string

/** Seconds watched, keyed by speed bucket (`"1.25"`). */
type BucketSeconds = Record<string, number>

export type StatsStore = {
  schemaVersion: number
  days: Record<StatsDay, Record<string, BucketSeconds>>
}

/** One frame's watch time for a day and speed bucket, before the domain is known. */
export type StatsSample = {
  day: StatsDay
  bucket: string
  seconds: number
}

const BUCKET_SIZE = 0.25

const MIN_BUCKET = BUCKET_SIZE

const MAX_BUCKET = Math.round(LIMITS.speed.max / BUCKET_SIZE) * BUCKET_SIZE

/**
 * The bucket a speed is counted under: the nearest multiple of 0.25×, never
 * below 0.25× so the slowest speeds still have somewhere to go. Fine enough to
 * tell 1.25× from 1.5×, coarse enough that a ramp through 1.1, 1.2, 1.3 does
 * not leave a key per tenth.
 */
export const speedBucket = (speed: number): string => {
  const rounded = Math.round(speed / BUCKET_SIZE) * BUCKET_SIZE

  return String(Math.min(MAX_BUCKET, Math.max(MIN_BUCKET, rounded)))
}

const pad = (value: number) => String(value).padStart(2, '0')

/** The local date an epoch-millisecond timestamp falls on. */
export const localDay = (timestamp: number): StatsDay => {
  const date = new Date(timestamp)

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Midnight of a stored day, local time, or `null` for a key that is no date. */
const dayStart = (day: string): number | null => {
  const match = DAY_PATTERN.exec(day)

  if (!match) {
    return null
  }

  const [year, month, date] = match.slice(1).map(Number)
  const parsed = new Date(year, month - 1, date)

  // `new Date` rolls `2025-02-31` over into March rather than refusing it.
  if (parsed.getMonth() !== month - 1 || parsed.getDate() !== date) {
    return null
  }

  return parsed.getTime()
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A key is a bucket only if it is exactly what `speedBucket` would write. */
const isBucket = (key: string): boolean =>
  Number.isFinite(Number(key)) && speedBucket(Number(key)) === key

const normalizeBuckets = (value: unknown): BucketSeconds | null => {
  if (!isRecord(value)) {
    return null
  }

  const buckets: BucketSeconds = {}

  for (const [key, seconds] of Object.entries(value)) {
    if (
      isBucket(key) &&
      typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      seconds > 0
    ) {
      buckets[key] = seconds
    }
  }

  return Object.keys(buckets).length > 0 ? buckets : null
}

/**
 * Storage is untrusted input, as everywhere else. A day, site or bucket that
 * is malformed is dropped on its own and the rest survives; nothing here
 * throws. A day left with no sites, or a site with no buckets, goes too, so an
 * empty object never stands in for a record.
 */
export const normalizeStats = (value: unknown): StatsStore => {
  const source = isRecord(value) ? value : {}
  const stored = isRecord(source.days) ? source.days : {}
  const days: StatsStore['days'] = {}

  for (const [day, sites] of Object.entries(stored)) {
    if (dayStart(day) === null || !isRecord(sites)) {
      continue
    }

    const kept: Record<string, BucketSeconds> = {}

    for (const [domain, buckets] of Object.entries(sites)) {
      const normalized = domain === '' ? null : normalizeBuckets(buckets)

      if (normalized) {
        kept[domain] = normalized
      }
    }

    if (Object.keys(kept).length > 0) {
      days[day] = kept
    }
  }

  return { schemaVersion: STATS_SCHEMA_VERSION, days }
}

/** Adds a domain's samples into the store. */
export const mergeStats = (
  store: StatsStore,
  domain: string,
  samples: StatsSample[],
): StatsStore => {
  const days = { ...store.days }

  for (const { day, bucket, seconds } of samples) {
    const sites = { ...days[day] }
    const buckets = { ...sites[domain] }

    buckets[bucket] = (buckets[bucket] ?? 0) + seconds
    sites[domain] = buckets
    days[day] = sites
  }

  return normalizeStats({ schemaVersion: STATS_SCHEMA_VERSION, days })
}

/**
 * Drops every day older than the retention window, today counting as one of
 * its days. `0` keeps everything.
 */
export const pruneStats = (
  store: StatsStore,
  retentionDays: number,
  now: number,
): StatsStore => {
  if (retentionDays === 0) {
    return store
  }

  const today = new Date(now)
  const cutoff = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - (retentionDays - 1),
  ).getTime()

  const days = Object.fromEntries(
    Object.entries(store.days).filter(
      ([day]) => (dayStart(day) ?? -Infinity) >= cutoff,
    ),
  )

  return { schemaVersion: STATS_SCHEMA_VERSION, days }
}

export const readStats = (callback: (store: StatsStore) => void): void => {
  chrome.storage.local.get(STATS_STORAGE_KEY, stored => {
    callback(normalizeStats(stored?.[STATS_STORAGE_KEY]))
  })
}

export const writeStats = (store: StatsStore, callback?: () => void): void => {
  chrome.storage.local.set(
    { [STATS_STORAGE_KEY]: normalizeStats(store) },
    () => {
      // A failed write loses a few seconds of watch time; nobody is waiting on
      // it, so it is read only to keep it from being unchecked.
      void chrome.runtime.lastError
      callback?.()
    },
  )
}
