import type { DomainStore } from './domains'
import { normalizeDomains } from './domains'
import type { Settings } from './settings'
import { normalizeSettings } from './settings'

/**
 * The envelope a backup is wrapped in, and the reason a backup is not simply
 * the settings object.
 *
 * `normalizeSettings` turns anything at all into a complete `Settings`, which
 * is exactly what makes it unsafe to point at pasted text: `{}` would restore
 * cleanly and silently replace everything the user had with the defaults. The
 * marker is what lets an import refuse text that was never a backup, so the
 * normalizers only ever run on something that claims to be one.
 */
export const BACKUP_FORMAT = 'rebobinate-backup'

/**
 * The envelope's own version, not either store's `schemaVersion` — those travel
 * inside and keep being repaired by their normalizers. This one changes only if
 * the wrapper's shape does, and its job is the refusal below: a backup written
 * by a later version may hold a settings shape this one would normalize away,
 * so restoring it would be a silent reset rather than a restore.
 */
export const BACKUP_VERSION = 1

export type Backup = {
  format: typeof BACKUP_FORMAT
  version: number
  settings: Settings
  domains: DomainStore
}

/**
 * What a parsed backup turned out to carry. Both are optional because a backup
 * restores what it contains and leaves the rest alone: a hand-written file with
 * only a `settings` key must not wipe the site list to make its point.
 */
export type BackupContents = {
  settings?: Settings
  domains?: DomainStore
}

/**
 * What the paste turned out to be carrying, in the terms the panel says it in.
 *
 * Derived rather than counted at the call site because it is read twice — once
 * to preview what a restore would bring in, once to report what it brought —
 * and a preview that counts one way and a receipt that counts another is worse
 * than neither.
 */
export type BackupSummary = {
  /** How many sites it would restore. `0` when it carries a list and the list is empty. */
  siteCount: number
  /** Whether it carries a settings object at all: a backup restores only what it holds. */
  hasSettings: boolean
}

export type ParseResult =
  ({ ok: true } & BackupContents & BackupSummary) | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Indented on purpose: the text is read and edited in a textarea, and a single
 * line of JSON is not something anyone can check before pasting it back.
 */
export const serializeBackup = (
  settings: Settings,
  domains: DomainStore,
): string => {
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    settings,
    domains,
  }

  return JSON.stringify(backup, null, 2)
}

/**
 * Turns pasted text into what should be written, or into the sentence the popup
 * shows instead. Every error is one a user can act on, because a restore that
 * fails silently is worse than one that never ran.
 */
export const parseBackup = (text: string): ParseResult => {
  if (text.trim() === '') {
    return { ok: false, error: 'Paste a backup first.' }
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That is not valid JSON.' }
  }

  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'That is not a Rebobinate backup.' }
  }

  if (typeof parsed.version === 'number' && parsed.version > BACKUP_VERSION) {
    return {
      ok: false,
      error: 'That backup was written by a newer version of Rebobinate.',
    }
  }

  const contents: BackupContents = {}

  // A key that is present but not an object is treated as absent rather than as
  // an empty store, for the reason the format marker exists: normalizing it
  // would replace a real settings object or a real site list with defaults.
  if (isRecord(parsed.settings)) {
    contents.settings = normalizeSettings(parsed.settings)
  }

  if (isRecord(parsed.domains)) {
    contents.domains = normalizeDomains(parsed.domains)
  }

  if (!contents.settings && !contents.domains) {
    return { ok: false, error: 'That backup has nothing in it.' }
  }

  return {
    ok: true,
    ...contents,
    hasSettings: contents.settings !== undefined,
    siteCount: contents.domains
      ? Object.keys(contents.domains.entries).length
      : 0,
  }
}
