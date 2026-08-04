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

/**
 * `2` added the `never` marker. Like the settings `1` → `2` step it needs no
 * migration code: an entry written by version `1` carries no `never` field, so
 * it normalizes to `false` like any other missing key and keeps the speed it
 * already held.
 */
export const DOMAINS_SCHEMA_VERSION = 2

/**
 * `storage.local` is generous but not unbounded, and a map that only ever grows
 * is a slow leak on a browser profile that lives for years. Past this many
 * entries the least recently updated ones are dropped: a site whose speed
 * mattered will be visited again and re-remembered on the next keypress.
 *
 * The two kinds of entry are counted separately, so a profile with a full 500
 * remembered speeds cannot quietly evict a site the user switched off by hand
 * and start remembering it again. A marker is only ever created from the popup,
 * so its own cap is there to bound a corrupted store rather than to trim a real
 * one.
 */
export const MAX_REMEMBERED_DOMAINS = 500

export type DomainMemory = {
  /**
   * Not applied while `never` is set. A marker has no speed to remember, so it
   * carries a placeholder rather than making every reader handle a null.
   */
  speed: number
  /** Epoch milliseconds. Doubles as the eviction order. */
  updatedAt: number
  /**
   * The site is left out of the memory: its speed is neither applied on load nor
   * written on a keystroke. It is the per-site form of turning
   * `rememberPerDomain` off, and it lives in this map rather than in `Settings`
   * because it is keyed by domain like everything else here.
   */
  never: boolean
}

/** What a marker's unused `speed` holds. */
const PLACEHOLDER_SPEED = 1

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
 *
 * An entry is either a remembered speed or a marker. One that is neither — a
 * half-written object, or a `never: false` entry whose speed did not survive —
 * is not an entry at all.
 */
const normalizeEntry = (value: unknown): DomainMemory | null => {
  if (!isRecord(value)) {
    return null
  }

  const never = value.never === true
  const hasSpeed =
    typeof value.speed === 'number' && Number.isFinite(value.speed)

  if (!hasSpeed && !never) {
    return null
  }

  const updatedAt =
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    value.updatedAt >= 0
      ? value.updatedAt
      : 0

  return {
    speed: hasSpeed
      ? clampSpeed(value.speed as number, LIMITS.speed.min, LIMITS.speed.max)
      : PLACEHOLDER_SPEED,
    updatedAt,
    never,
  }
}

/** Keeps the most recently updated entries of one kind and drops the rest. */
const capKind = (
  entries: Record<string, DomainMemory>,
  never: boolean,
): string[] => {
  return Object.keys(entries)
    .filter(key => entries[key].never === never)
    .sort((a, b) => entries[b].updatedAt - entries[a].updatedAt)
    .slice(0, MAX_REMEMBERED_DOMAINS)
}

const cap = (entries: Record<string, DomainMemory>) => {
  if (Object.keys(entries).length <= MAX_REMEMBERED_DOMAINS) {
    return entries
  }

  const kept = [...capKind(entries, false), ...capKind(entries, true)]

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

const withoutDomain = (store: DomainStore, domain: string): DomainStore => {
  if (!(domain in store.entries)) {
    return store
  }

  const entries = { ...store.entries }
  delete entries[domain]

  return { schemaVersion: DOMAINS_SCHEMA_VERSION, entries }
}

/**
 * Records a speed under a domain, unless the user has switched that site off.
 * The guard lives here rather than at the call sites so a keystroke, a popup
 * edit, and anything added later all get it.
 */
export const rememberDomain = (
  store: DomainStore,
  domain: string,
  speed: number,
  now: number,
): DomainStore => {
  if (store.entries[domain]?.never) {
    return store
  }

  return normalizeDomains({
    ...store,
    entries: {
      ...store.entries,
      [domain]: { speed, updatedAt: now, never: false },
    },
  })
}

/**
 * Drops the speed remembered for a domain.
 *
 * A marker survives: `0` on a site the user has switched off means "back to
 * normal here", not "start remembering me again".
 */
export const forgetDomain = (
  store: DomainStore,
  domain: string,
): DomainStore => {
  if (store.entries[domain]?.never) {
    return store
  }

  return withoutDomain(store, domain)
}

/**
 * Switches a site out of the memory, or back into it.
 *
 * Switching it off drops whatever speed was remembered — the point of the
 * marker is that nothing about the site is kept — and switching it back on
 * removes the entry entirely, since a marker holds no speed to fall back to.
 */
export const setDomainNever = (
  store: DomainStore,
  domain: string,
  never: boolean,
  now: number,
): DomainStore => {
  if (!never) {
    return withoutDomain(store, domain)
  }

  return normalizeDomains({
    ...store,
    entries: {
      ...store.entries,
      [domain]: { speed: PLACEHOLDER_SPEED, updatedAt: now, never: true },
    },
  })
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
