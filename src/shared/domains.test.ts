import { describe, expect, it, vi } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import type { DomainStore } from './domains'
import {
  DOMAINS_SCHEMA_VERSION,
  DOMAINS_STORAGE_KEY,
  EMPTY_DOMAIN_STORE,
  MAX_REMEMBERED_DOMAINS,
  forgetDomain,
  normalizeDomains,
  onDomainsChange,
  readDomains,
  rememberDomain,
  setDomainNever,
  writeDomains,
} from './domains'

const storeOf = (
  entries: Record<
    string,
    { speed: number; updatedAt: number; never?: boolean }
  >,
): DomainStore => ({
  schemaVersion: DOMAINS_SCHEMA_VERSION,
  entries: Object.fromEntries(
    Object.entries(entries).map(([domain, entry]) => [
      domain,
      { never: false, ...entry },
    ]),
  ),
})

describe('normalizeDomains', () => {
  it('returns an empty store for anything unusable', () => {
    expect(normalizeDomains(undefined)).toEqual(EMPTY_DOMAIN_STORE)
    expect(normalizeDomains(null)).toEqual(EMPTY_DOMAIN_STORE)
    expect(normalizeDomains('nonsense')).toEqual(EMPTY_DOMAIN_STORE)
    expect(normalizeDomains({ entries: 'nope' })).toEqual(EMPTY_DOMAIN_STORE)
  })

  it('drops entries that are not a remembered speed', () => {
    const { entries } = normalizeDomains({
      entries: {
        'a.com': { speed: 1.5, updatedAt: 10 },
        'b.com': { speed: 'fast' },
        'c.com': null,
        'd.com': { speed: Number.NaN, updatedAt: 10 },
        '': { speed: 2, updatedAt: 10 },
      },
    })

    expect(Object.keys(entries)).toEqual(['a.com'])
  })

  it('clamps a speed the player would refuse', () => {
    const { entries } = normalizeDomains({
      entries: { 'a.com': { speed: 900, updatedAt: 1 } },
    })

    expect(entries['a.com'].speed).toBe(16)
  })

  it('treats a missing timestamp as the oldest', () => {
    const { entries } = normalizeDomains({
      entries: { 'a.com': { speed: 1.5 } },
    })

    expect(entries['a.com'].updatedAt).toBe(0)
  })
})

describe('rememberDomain', () => {
  it('records the speed and when it was chosen', () => {
    const store = rememberDomain(EMPTY_DOMAIN_STORE, 'vimeo.com', 1.25, 500)

    expect(store.entries['vimeo.com']).toEqual({
      speed: 1.25,
      updatedAt: 500,
      never: false,
    })
  })

  it('replaces what the domain was remembered at', () => {
    const first = rememberDomain(EMPTY_DOMAIN_STORE, 'vimeo.com', 1.25, 500)
    const second = rememberDomain(first, 'vimeo.com', 2, 900)

    expect(second.entries['vimeo.com']).toEqual({
      speed: 2,
      updatedAt: 900,
      never: false,
    })
    expect(Object.keys(second.entries)).toHaveLength(1)
  })

  it('drops the least recently updated once the map is full', () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_REMEMBERED_DOMAINS }, (_, index) => [
        `site-${index}.com`,
        { speed: 1.5, updatedAt: index + 1 },
      ]),
    )

    const store = rememberDomain(storeOf(full), 'fresh.com', 2, 10_000)

    expect(Object.keys(store.entries)).toHaveLength(MAX_REMEMBERED_DOMAINS)
    expect(store.entries['fresh.com']).toBeDefined()
    // `site-0.com` had the oldest timestamp, so it is the one that goes.
    expect(store.entries['site-0.com']).toBeUndefined()
    expect(store.entries['site-1.com']).toBeDefined()
  })
})

describe('forgetDomain', () => {
  it('removes the entry and leaves the rest alone', () => {
    const store = forgetDomain(
      storeOf({
        'a.com': { speed: 1.5, updatedAt: 1 },
        'b.com': { speed: 2, updatedAt: 2 },
      }),
      'a.com',
    )

    expect(store.entries['a.com']).toBeUndefined()
    expect(store.entries['b.com']).toBeDefined()
  })

  it('is a no-op for a domain that was never remembered', () => {
    const before = storeOf({ 'a.com': { speed: 1.5, updatedAt: 1 } })

    expect(forgetDomain(before, 'b.com')).toBe(before)
  })
})

describe('sites switched out of the memory', () => {
  it('keeps a marker written by the popup', () => {
    const store = setDomainNever(EMPTY_DOMAIN_STORE, 'news.com', true, 700)

    expect(store.entries['news.com']).toEqual({
      speed: 1,
      updatedAt: 700,
      never: true,
    })
  })

  it('drops the speed that had been remembered', () => {
    const remembered = rememberDomain(EMPTY_DOMAIN_STORE, 'news.com', 2, 100)
    const store = setDomainNever(remembered, 'news.com', true, 700)

    expect(store.entries['news.com'].never).toBe(true)
    expect(store.entries['news.com'].speed).toBe(1)
  })

  it('removes the entry when the site is let back in', () => {
    const off = setDomainNever(EMPTY_DOMAIN_STORE, 'news.com', true, 700)
    const store = setDomainNever(off, 'news.com', false, 900)

    expect(store.entries['news.com']).toBeUndefined()
  })

  // The whole point of the marker: a keystroke on the site must not undo it.
  it('is not overwritten by a speed chosen on the site', () => {
    const off = setDomainNever(EMPTY_DOMAIN_STORE, 'news.com', true, 700)
    const store = rememberDomain(off, 'news.com', 2, 900)

    expect(store).toBe(off)
  })

  // `0` on such a site means "back to normal here", not "start watching me".
  it('survives a reset on the site', () => {
    const off = setDomainNever(EMPTY_DOMAIN_STORE, 'news.com', true, 700)

    expect(forgetDomain(off, 'news.com')).toBe(off)
  })

  it('is kept even when the remembered speeds fill the map', () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_REMEMBERED_DOMAINS }, (_, index) => [
        `site-${index}.com`,
        { speed: 1.5, updatedAt: index + 100 },
      ]),
    )

    const store = normalizeDomains(
      storeOf({ ...full, 'news.com': { speed: 1, updatedAt: 1, never: true } }),
    )

    // The oldest timestamp in the map by a long way, and still there: the two
    // kinds of entry are capped separately.
    expect(store.entries['news.com'].never).toBe(true)
    expect(Object.keys(store.entries)).toHaveLength(MAX_REMEMBERED_DOMAINS + 1)
  })

  it('reads a stored marker that carries no speed', () => {
    const { entries } = normalizeDomains({
      entries: { 'news.com': { never: true, updatedAt: 5 } },
    })

    expect(entries['news.com']).toEqual({ speed: 1, updatedAt: 5, never: true })
  })

  it('leaves an entry that is neither a speed nor a marker out', () => {
    const { entries } = normalizeDomains({
      entries: { 'news.com': { never: false, updatedAt: 5 } },
    })

    expect(entries['news.com']).toBeUndefined()
  })
})

describe('storage helpers', () => {
  it('reads a normalized store', () => {
    getChromeMock().storage.local.seed({
      [DOMAINS_STORAGE_KEY]: { entries: { 'a.com': { speed: 99 } } },
    })

    const received = vi.fn()
    readDomains(received)

    expect(received.mock.calls[0][0].entries['a.com']).toEqual({
      speed: 16,
      updatedAt: 0,
      never: false,
    })
  })

  it('normalizes before writing so storage never holds a bad value', () => {
    writeDomains(storeOf({ 'a.com': { speed: 900, updatedAt: 1 } }))

    const stored = getChromeMock().storage.local.snapshot()[
      DOMAINS_STORAGE_KEY
    ] as { entries: Record<string, { speed: number }> }

    expect(stored.entries['a.com'].speed).toBe(16)
  })

  it('notifies subscribers on change and stops after unsubscribing', () => {
    const listener = vi.fn()
    const unsubscribe = onDomainsChange(listener)

    writeDomains(storeOf({ 'a.com': { speed: 1.5, updatedAt: 1 } }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].entries['a.com'].speed).toBe(1.5)

    unsubscribe()
    writeDomains(storeOf({ 'b.com': { speed: 2, updatedAt: 2 } }))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores a change to another key', () => {
    const listener = vi.fn()
    onDomainsChange(listener)

    getChromeMock().storage.local.set({ 'rebobinate:settings': { step: 0.1 } })

    expect(listener).not.toHaveBeenCalled()
  })
})
