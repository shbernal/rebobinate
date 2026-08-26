import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  parseBackup,
  serializeBackup,
} from './backup'
import type { DomainStore } from './domains'
import { DOMAINS_SCHEMA_VERSION } from './domains'
import { DEFAULT_SETTINGS } from './settings'

const DOMAINS: DomainStore = {
  schemaVersion: DOMAINS_SCHEMA_VERSION,
  entries: {
    'youtube.com': { speed: 2, updatedAt: 1000, never: false },
    'netflix.com': { speed: 1, updatedAt: 2000, never: true },
  },
}

const SETTINGS = { ...DEFAULT_SETTINGS, step: 0.25, defaultSpeed: 1.5 }

const backupText = (patch: Record<string, unknown>) => {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    ...patch,
  })
}

describe('serializeBackup', () => {
  it('round-trips the settings and the site list', () => {
    const result = parseBackup(serializeBackup(SETTINGS, DOMAINS))

    expect(result).toEqual({
      ok: true,
      settings: SETTINGS,
      domains: DOMAINS,
      hasSettings: true,
      siteCount: 2,
    })
  })

  it('writes it as something a person can read in a textarea', () => {
    const text = serializeBackup(SETTINGS, DOMAINS)

    expect(text.split('\n').length).toBeGreaterThan(10)
    expect(JSON.parse(text).format).toBe(BACKUP_FORMAT)
  })
})

describe('parseBackup', () => {
  it('refuses anything that is not a backup', () => {
    // The point of the format marker: `normalizeSettings` would happily turn
    // every one of these into a complete settings object and replace what the
    // user had with the defaults.
    for (const text of ['{}', '[]', '"nope"', '{"settings":{"step":0.5}}']) {
      expect(parseBackup(text)).toEqual({
        ok: false,
        error: 'That is not a Rebobinate backup.',
      })
    }
  })

  it('names the two ways pasted text is unusable', () => {
    expect(parseBackup('   ')).toEqual({
      ok: false,
      error: 'Paste a backup first.',
    })
    expect(parseBackup('{ half of a bac')).toEqual({
      ok: false,
      error: 'That is not valid JSON.',
    })
  })

  it('refuses an envelope from a later version', () => {
    const result = parseBackup(
      backupText({ version: BACKUP_VERSION + 1, settings: SETTINGS }),
    )

    expect(result).toEqual({
      ok: false,
      error: 'That backup was written by a newer version of Rebobinate.',
    })
  })

  it('accepts one written by an earlier version', () => {
    const result = parseBackup(backupText({ version: 1, settings: SETTINGS }))

    expect(result).toEqual({
      ok: true,
      settings: SETTINGS,
      hasSettings: true,
      siteCount: 0,
    })
  })

  it('restores only what the backup carries', () => {
    expect(parseBackup(backupText({ domains: DOMAINS }))).toEqual({
      ok: true,
      domains: DOMAINS,
      hasSettings: false,
      siteCount: 2,
    })
    expect(parseBackup(backupText({ settings: SETTINGS }))).toEqual({
      ok: true,
      settings: SETTINGS,
      hasSettings: true,
      siteCount: 0,
    })
  })

  it('refuses an envelope with neither store in it', () => {
    for (const text of [
      backupText({}),
      backupText({ settings: 'gone', domains: null }),
    ]) {
      expect(parseBackup(text)).toEqual({
        ok: false,
        error: 'That backup has nothing in it.',
      })
    }
  })

  it('repairs what it does carry', () => {
    const result = parseBackup(
      backupText({
        settings: { step: 99, keys: { increase: [] } },
        domains: { entries: { 'a.test': { speed: 999, updatedAt: 5 } } },
      }),
    )

    expect(result).toEqual({
      ok: true,
      settings: {
        ...DEFAULT_SETTINGS,
        step: 1,
        keys: DEFAULT_SETTINGS.keys,
      },
      domains: {
        schemaVersion: DOMAINS_SCHEMA_VERSION,
        entries: { 'a.test': { speed: 16, updatedAt: 5, never: false } },
      },
      hasSettings: true,
      siteCount: 1,
    })
  })

  /**
   * The popup names what the paste holds before it is pressed and again after,
   * and "settings only" is the case that changes what the warning above the
   * button means. Counting it at the call site would let the two sentences
   * disagree, so the parse answers it once.
   */
  it('says what it is carrying, not only that it parsed', () => {
    const settingsOnly = parseBackup(backupText({ settings: SETTINGS }))
    const emptyList = parseBackup(
      backupText({ settings: SETTINGS, domains: { entries: {} } }),
    )

    expect(settingsOnly).toMatchObject({ hasSettings: true, siteCount: 0 })
    // A list that is present and empty is not a backup with no list: restoring
    // it empties the map, and the popup has to be able to tell them apart.
    expect(settingsOnly).not.toHaveProperty('domains')
    expect(emptyList).toMatchObject({
      hasSettings: true,
      siteCount: 0,
      domains: { entries: {} },
    })
  })
})
