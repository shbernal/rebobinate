import { describe, expect, it, vi } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import {
  DOMAINS_STORAGE_KEY,
  EMPTY_DOMAIN_STORE,
  MAX_REMEMBERED_DOMAINS,
  forgetDomain,
  normalizeDomains,
  onDomainsChange,
  readDomains,
  rememberDomain,
  writeDomains,
} from './domains'

const storeOf = (
  entries: Record<string, { speed: number; updatedAt: number }>,
) => ({
  schemaVersion: 1,
  entries,
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

    expect(store.entries['vimeo.com']).toEqual({ speed: 1.25, updatedAt: 500 })
  })

  it('replaces what the domain was remembered at', () => {
    const first = rememberDomain(EMPTY_DOMAIN_STORE, 'vimeo.com', 1.25, 500)
    const second = rememberDomain(first, 'vimeo.com', 2, 900)

    expect(second.entries['vimeo.com']).toEqual({ speed: 2, updatedAt: 900 })
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
