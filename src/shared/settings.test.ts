import { describe, expect, it, vi } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  clampToSettings,
  normalizeSettings,
  onSettingsChange,
  readSettings,
  writeSettings,
} from './settings'

describe('normalizeSettings', () => {
  it('returns the defaults for anything unusable', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS)
  })

  it('repairs a partially written object', () => {
    const settings = normalizeSettings({ step: 0.25 })

    expect(settings.step).toBe(0.25)
    expect(settings.badge).toEqual(DEFAULT_SETTINGS.badge)
    expect(settings.keys).toEqual(DEFAULT_SETTINGS.keys)
  })

  it('clamps every numeric setting into range', () => {
    const settings = normalizeSettings({
      step: 99,
      minSpeed: -4,
      maxSpeed: 500,
      badge: { fontSize: 900, opacity: 4, autoHideMs: -10 },
    })

    expect(settings.step).toBe(1)
    expect(settings.minSpeed).toBe(0.1)
    expect(settings.maxSpeed).toBe(16)
    expect(settings.badge.fontSize).toBe(48)
    expect(settings.badge.opacity).toBe(1)
    expect(settings.badge.autoHideMs).toBe(0)
  })

  it('keeps min below max even when stored the wrong way round', () => {
    const settings = normalizeSettings({ minSpeed: 4, maxSpeed: 2 })

    expect(settings.minSpeed).toBe(2)
    expect(settings.maxSpeed).toBe(4)
  })

  it('rejects a corner it does not know', () => {
    expect(
      normalizeSettings({ badge: { corner: 'middle' } }).badge.corner,
    ).toBe(DEFAULT_SETTINGS.badge.corner)
  })

  it('rejects colors that are not colors', () => {
    const badge = normalizeSettings({
      badge: { textColor: 'url(evil)', backgroundColor: '#abc' },
    }).badge

    expect(badge.textColor).toBe(DEFAULT_SETTINGS.badge.textColor)
    expect(badge.backgroundColor).toBe('#abc')
  })

  it('falls back to the default bindings when a list is empty or wrong', () => {
    const keys = normalizeSettings({
      keys: { increase: [], decrease: 'nope', reset: ['r', 'r'] },
    }).keys

    expect(keys.increase).toEqual(DEFAULT_SETTINGS.keys.increase)
    expect(keys.decrease).toEqual(DEFAULT_SETTINGS.keys.decrease)
    expect(keys.reset).toEqual(['r'])
  })

  it('gives a stored object without seek keys the default ones', () => {
    // What a copy installed before the seek actions holds.
    const keys = normalizeSettings({
      keys: { increase: ['+'], decrease: ['-'], reset: ['0'] },
    }).keys

    expect(keys.seekBack).toEqual(DEFAULT_SETTINGS.keys.seekBack)
    expect(keys.seekForward).toEqual(DEFAULT_SETTINGS.keys.seekForward)
    expect(keys.reset).toEqual(['0'])
  })

  it('clamps the seek distance to whole seconds in range', () => {
    expect(normalizeSettings({}).seekSeconds).toBe(10)
    expect(normalizeSettings({ seekSeconds: 0 }).seekSeconds).toBe(1)
    expect(normalizeSettings({ seekSeconds: 900 }).seekSeconds).toBe(120)
    expect(normalizeSettings({ seekSeconds: 4.6 }).seekSeconds).toBe(5)
    expect(normalizeSettings({ seekSeconds: 'x' }).seekSeconds).toBe(10)
  })

  // A stored `4` object has neither key, and gains the defaults.
  it('fills the stats settings and refuses an unknown retention', () => {
    expect(normalizeSettings({}).rememberStats).toBe(true)
    expect(normalizeSettings({}).statsRetentionDays).toBe(365)
    expect(
      normalizeSettings({ statsRetentionDays: 0 }).statsRetentionDays,
    ).toBe(0)
    expect(
      normalizeSettings({ statsRetentionDays: 30 }).statsRetentionDays,
    ).toBe(365)
  })

  it('always stamps the current schema version', () => {
    expect(normalizeSettings({ schemaVersion: 0 }).schemaVersion).toBe(
      DEFAULT_SETTINGS.schemaVersion,
    )
  })

  // An installed copy holds a schema 1 object. The v2 keys are additions, so it
  // upgrades by filling them in and nothing the user had is reset.
  it('fills the per-domain keys into an object written before them', () => {
    const settings = normalizeSettings({
      schemaVersion: 1,
      step: 0.25,
      badge: { corner: 'bottom-right' },
    })

    expect(settings.step).toBe(0.25)
    expect(settings.badge.corner).toBe('bottom-right')
    expect(settings.defaultSpeed).toBe(1)
    expect(settings.rememberPerDomain).toBe(true)
  })

  // Same again for the v3 addition: an installed copy gains the toolbar badge
  // without losing anything it was already holding.
  it('fills the toolbar badge into an object written before it', () => {
    const settings = normalizeSettings({
      schemaVersion: 2,
      step: 0.25,
      rememberPerDomain: false,
    })

    expect(settings.step).toBe(0.25)
    expect(settings.rememberPerDomain).toBe(false)
    expect(settings.toolbarBadge).toBe(true)
  })

  it('keeps a toolbar badge the user switched off', () => {
    expect(normalizeSettings({ toolbarBadge: false }).toolbarBadge).toBe(false)
    expect(normalizeSettings({ toolbarBadge: 'no' }).toolbarBadge).toBe(true)
  })

  it('clamps the default speed to what a player accepts', () => {
    expect(normalizeSettings({ defaultSpeed: 99 }).defaultSpeed).toBe(16)
    expect(normalizeSettings({ defaultSpeed: 0 }).defaultSpeed).toBe(0.1)
    expect(normalizeSettings({ defaultSpeed: 'fast' }).defaultSpeed).toBe(1)
  })

  // Narrowing the range is not a reason to rewrite the chosen default; the
  // range is applied where the speed is used.
  it('leaves a default speed outside a narrowed range alone', () => {
    const settings = normalizeSettings({ defaultSpeed: 2, maxSpeed: 1.5 })

    expect(settings.defaultSpeed).toBe(2)
    expect(clampToSettings(settings.defaultSpeed, settings)).toBe(1.5)
  })
})

describe('storage helpers', () => {
  it('reads normalized settings', () => {
    const chromeMock = getChromeMock()
    chromeMock.storage.local.seed({
      [SETTINGS_STORAGE_KEY]: { step: 0.5, badge: { corner: 'bottom-right' } },
    })

    const received = vi.fn()
    readSettings(received)

    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({ step: 0.5 }),
    )
    expect(received.mock.calls[0][0].badge.corner).toBe('bottom-right')
  })

  it('normalizes before writing so storage never holds a bad value', () => {
    writeSettings({ ...DEFAULT_SETTINGS, step: 42 })

    const stored = getChromeMock().storage.local.snapshot()[
      SETTINGS_STORAGE_KEY
    ] as { step: number }

    expect(stored.step).toBe(1)
  })

  it('calls back with the reason a write did not land', () => {
    const chromeMock = getChromeMock()
    chromeMock.storage.local.failWrites('QUOTA_BYTES quota exceeded')
    const listener = vi.fn()
    const written = vi.fn()
    onSettingsChange(listener)

    writeSettings({ ...DEFAULT_SETTINGS, step: 0.1 }, written)

    expect(written).toHaveBeenCalledWith('QUOTA_BYTES quota exceeded')
    expect(listener).not.toHaveBeenCalled()
  })

  it('calls back with nothing when the write landed', () => {
    const written = vi.fn()

    writeSettings({ ...DEFAULT_SETTINGS, step: 0.1 }, written)

    expect(written).toHaveBeenCalledWith(undefined)
  })

  it('notifies subscribers on change and stops after unsubscribing', () => {
    const listener = vi.fn()
    const unsubscribe = onSettingsChange(listener)

    writeSettings({ ...DEFAULT_SETTINGS, step: 0.1 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].step).toBe(0.1)

    unsubscribe()
    writeSettings({ ...DEFAULT_SETTINGS, step: 0.2 })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
