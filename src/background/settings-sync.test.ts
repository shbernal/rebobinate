import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import type { Settings } from '@/shared/settings'
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '@/shared/settings'
import { startSettingsSync } from './settings-sync'

const inArea = (area: 'local' | 'sync') =>
  getChromeMock().storage[area].snapshot()[SETTINGS_STORAGE_KEY] as
    | Settings
    | undefined

const settings = (patch: Partial<Settings>): Settings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('settings sync', () => {
  it('seeds sync from an existing install', () => {
    getChromeMock().storage.local.seed({
      [SETTINGS_STORAGE_KEY]: { step: 0.25 },
    })

    startSettingsSync()

    expect(inArea('sync')?.step).toBe(0.25)
    expect(inArea('local')).toEqual({ step: 0.25 })
  })

  it('leaves sync empty on a fresh install', () => {
    startSettingsSync()

    expect(inArea('sync')).toBeUndefined()
  })

  // A second browser, or a reinstall, picks up what was set elsewhere.
  it('lets a synced copy win over local at start-up', () => {
    getChromeMock().storage.local.seed({
      [SETTINGS_STORAGE_KEY]: settings({ step: 0.25 }),
    })
    getChromeMock().storage.sync.seed({
      [SETTINGS_STORAGE_KEY]: settings({ step: 0.5 }),
    })

    startSettingsSync()

    expect(inArea('local')?.step).toBe(0.5)
  })

  it('applies a change arriving from another browser to local', () => {
    startSettingsSync()

    getChromeMock().storage.sync.set({
      [SETTINGS_STORAGE_KEY]: settings({ seekSeconds: 30 }),
    })

    expect(inArea('local')?.seekSeconds).toBe(30)
  })

  it('copies a burst of local changes to sync once', () => {
    startSettingsSync()
    const sync = getChromeMock().storage.sync

    for (const fontSize of [10, 11, 12, 13]) {
      getChromeMock().storage.local.set({
        [SETTINGS_STORAGE_KEY]: settings({
          badge: { ...DEFAULT_SETTINGS.badge, fontSize },
        }),
      })
    }

    expect(sync.set).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)

    expect(sync.set).toHaveBeenCalledTimes(1)
    expect(inArea('sync')?.badge.fontSize).toBe(13)
  })

  it('does not echo a pulled change back to sync', () => {
    startSettingsSync()
    const sync = getChromeMock().storage.sync

    sync.set({ [SETTINGS_STORAGE_KEY]: settings({ step: 0.5 }) })
    vi.advanceTimersByTime(1000)

    expect(sync.set).toHaveBeenCalledTimes(1)
  })

  // A refused sync write must not touch the copy every surface reads.
  it('keeps local when sync refuses a write', () => {
    startSettingsSync()
    getChromeMock().storage.sync.failWrites(
      'QUOTA_BYTES_PER_ITEM quota exceeded',
    )

    getChromeMock().storage.local.set({
      [SETTINGS_STORAGE_KEY]: settings({ step: 0.3 }),
    })
    vi.advanceTimersByTime(1000)

    expect(inArea('local')?.step).toBe(0.3)
    expect(inArea('sync')).toBeUndefined()
  })
})
