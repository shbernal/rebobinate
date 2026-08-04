import { LIMITS } from './settings'
import { clampSpeed } from './speed'

/**
 * The speed remembered per site.
 *
 * This lives under its own storage key rather than inside `Settings`, because
 * the two are written by different owners at very different rates: the popup
 * rewrites the whole settings object whenever a control moves, while the
 * service worker writes a domain entry a second after the last keystroke. In
 * one key those writes would clobber each other — the popup would save a
 * settings object it read before the last speed change and drop it.
 *
 * The same rule as `Settings` applies: storage is untrusted input and every
 * read goes through `normalizeDomains`.
 */
export const DOMAINS_STORAGE_KEY = 'rebobinate:domains'

export const DOMAINS_SCHEMA_VERSION = 1

/**
 * `storage.local` is generous but not unbounded, and a map that only ever grows
 * is a slow leak on a browser profile that lives for years. Past this many
 * entries the least recently updated ones are dropped: a site whose speed
 * mattered will be visited again and re-remembered on the next keypress.
 */
export const MAX_REMEMBERED_DOMAINS = 500

export type DomainMemory = {
  speed: number
  /** Epoch milliseconds. Doubles as the eviction order. */
  updatedAt: number
}

export type DomainStore = {
  schemaVersion: number
  entries: Record<string, DomainMemory>
}

export const EMPTY_DOMAIN_STORE: DomainStore = {
  schemaVersion: DOMAINS_SCHEMA_VERSION,
  entries: {},
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Clamped to the range `playbackRate` itself accepts, not to the user's
 * `minSpeed`/`maxSpeed`. Those two are settings the user can widen again later,
 * and a remembered speed should not be permanently flattened by a range that
 * happened to be narrow on the day it was written. The applied speed is clamped
 * to the current settings when it is read back.
 */
const normalizeEntry = (value: unknown): DomainMemory | null => {
  if (!isRecord(value) || typeof value.speed !== 'number') {
    return null
  }

  if (!Number.isFinite(value.speed)) {
    return null
  }

  const updatedAt =
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    value.updatedAt >= 0
      ? value.updatedAt
      : 0

  return {
    speed: clampSpeed(value.speed, LIMITS.speed.min, LIMITS.speed.max),
    updatedAt,
  }
}

/** Keeps the most recently updated entries and drops the rest. */
const cap = (entries: Record<string, DomainMemory>) => {
  const keys = Object.keys(entries)

  if (keys.length <= MAX_REMEMBERED_DOMAINS) {
    return entries
  }

  const kept = keys
    .sort((a, b) => entries[b].updatedAt - entries[a].updatedAt)
    .slice(0, MAX_REMEMBERED_DOMAINS)

  return Object.fromEntries(kept.map(key => [key, entries[key]]))
}

export const normalizeDomains = (value: unknown): DomainStore => {
  const source = isRecord(value) ? value : {}
  const stored = isRecord(source.entries) ? source.entries : {}
  const entries: Record<string, DomainMemory> = {}

  for (const [key, entry] of Object.entries(stored)) {
    const normalized = key === '' ? null : normalizeEntry(entry)

    if (normalized) {
      entries[key] = normalized
    }
  }

  return { schemaVersion: DOMAINS_SCHEMA_VERSION, entries: cap(entries) }
}

export const rememberDomain = (
  store: DomainStore,
  domain: string,
  speed: number,
  now: number,
): DomainStore => {
  return normalizeDomains({
    ...store,
    entries: { ...store.entries, [domain]: { speed, updatedAt: now } },
  })
}

export const forgetDomain = (
  store: DomainStore,
  domain: string,
): DomainStore => {
  if (!(domain in store.entries)) {
    return store
  }

  const entries = { ...store.entries }
  delete entries[domain]

  return { schemaVersion: DOMAINS_SCHEMA_VERSION, entries }
}

export const readDomains = (callback: (store: DomainStore) => void): void => {
  chrome.storage.local.get(DOMAINS_STORAGE_KEY, stored => {
    callback(normalizeDomains(stored?.[DOMAINS_STORAGE_KEY]))
  })
}

export const writeDomains = (
  store: DomainStore,
  callback?: () => void,
): void => {
  chrome.storage.local.set(
    { [DOMAINS_STORAGE_KEY]: normalizeDomains(store) },
    () => {
      callback?.()
    },
  )
}

export const onDomainsChange = (
  listener: (store: DomainStore) => void,
): (() => void) => {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local' || !changes[DOMAINS_STORAGE_KEY]) {
      return
    }

    listener(normalizeDomains(changes[DOMAINS_STORAGE_KEY].newValue))
  }

  chrome.storage.onChanged.addListener(handler)

  return () => {
    chrome.storage.onChanged.removeListener(handler)
  }
}
