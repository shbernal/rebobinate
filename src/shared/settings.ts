import type { KeyBindings } from './keys'
import { clampSpeed, roundSpeed } from './speed'

export const SETTINGS_STORAGE_KEY = 'rebobinate:settings'

/**
 * Bumped whenever the stored shape changes in a way `normalizeSettings` cannot
 * repair on its own. Present from the first release so later features (per-site
 * speeds, statistics) have a migration hook instead of a guess.
 */
export const SCHEMA_VERSION = 1

export const BADGE_CORNERS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const

export type BadgeCorner = (typeof BADGE_CORNERS)[number]

export type BadgeSettings = {
  enabled: boolean
  corner: BadgeCorner
  fontSize: number
  opacity: number
  textColor: string
  backgroundColor: string
  hideAtNormalSpeed: boolean
  /** 0 keeps the badge on screen for as long as the speed is not normal. */
  autoHideMs: number
}

export type Settings = {
  schemaVersion: number
  enabled: boolean
  step: number
  minSpeed: number
  maxSpeed: number
  badge: BadgeSettings
  keys: KeyBindings
}

export const LIMITS = {
  step: { min: 0.01, max: 1 },
  // Chrome accepts roughly 0.0625–16 on `playbackRate`; staying inside that
  // range avoids a thrown assignment on an otherwise valid setting.
  speed: { min: 0.1, max: 16 },
  fontSize: { min: 8, max: 48 },
  opacity: { min: 0.1, max: 1 },
  autoHideMs: { min: 0, max: 30000 },
} as const

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  step: 0.05,
  minSpeed: LIMITS.speed.min,
  maxSpeed: LIMITS.speed.max,
  badge: {
    enabled: true,
    corner: 'top-left',
    fontSize: 14,
    opacity: 0.75,
    textColor: '#ffffff',
    backgroundColor: '#000000',
    hideAtNormalSpeed: true,
    autoHideMs: 2000,
  },
  keys: {
    increase: ['+', '=', 'Equal', 'NumpadAdd'],
    decrease: ['-', 'Minus', 'NumpadSubtract'],
    reset: ['0', 'Digit0', 'Numpad0'],
  },
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const normalizeNumber = (
  value: unknown,
  fallback: number,
  { min, max }: { min: number; max: number },
  round: (input: number) => number = input => input,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return round(Math.min(max, Math.max(min, value)))
}

const normalizeBoolean = (value: unknown, fallback: boolean): boolean => {
  return typeof value === 'boolean' ? value : fallback
}

const COLOR_PATTERN = /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^rgba?\([\d.,\s%]+\)$/i

const normalizeColor = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value.trim())) {
    return fallback
  }

  return value.trim()
}

const normalizeBindings = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) {
    return [...fallback]
  }

  const tokens = value.filter(
    (token): token is string => typeof token === 'string' && token.length > 0,
  )

  return tokens.length > 0 ? Array.from(new Set(tokens)) : [...fallback]
}

const normalizeBadge = (value: unknown): BadgeSettings => {
  const defaults = DEFAULT_SETTINGS.badge
  const source = isRecord(value) ? value : {}
  const corner = BADGE_CORNERS.includes(source.corner as BadgeCorner)
    ? (source.corner as BadgeCorner)
    : defaults.corner

  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    corner,
    fontSize: normalizeNumber(
      source.fontSize,
      defaults.fontSize,
      LIMITS.fontSize,
      Math.round,
    ),
    opacity: normalizeNumber(
      source.opacity,
      defaults.opacity,
      LIMITS.opacity,
      value => Math.round(value * 100) / 100,
    ),
    textColor: normalizeColor(source.textColor, defaults.textColor),
    backgroundColor: normalizeColor(
      source.backgroundColor,
      defaults.backgroundColor,
    ),
    hideAtNormalSpeed: normalizeBoolean(
      source.hideAtNormalSpeed,
      defaults.hideAtNormalSpeed,
    ),
    autoHideMs: normalizeNumber(
      source.autoHideMs,
      defaults.autoHideMs,
      LIMITS.autoHideMs,
      Math.round,
    ),
  }
}

/**
 * Storage is untrusted input: it can hold a half-written object from an
 * interrupted write, or a shape from an older version. Every read goes through
 * here so the rest of the extension only ever sees a complete `Settings`.
 */
export const normalizeSettings = (value: unknown): Settings => {
  const source = isRecord(value) ? value : {}
  const keys = isRecord(source.keys) ? source.keys : {}
  const minSpeed = normalizeNumber(
    source.minSpeed,
    DEFAULT_SETTINGS.minSpeed,
    LIMITS.speed,
    roundSpeed,
  )
  const maxSpeed = normalizeNumber(
    source.maxSpeed,
    DEFAULT_SETTINGS.maxSpeed,
    LIMITS.speed,
    roundSpeed,
  )

  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: normalizeBoolean(source.enabled, DEFAULT_SETTINGS.enabled),
    step: normalizeNumber(
      source.step,
      DEFAULT_SETTINGS.step,
      LIMITS.step,
      value => Math.round(value * 100) / 100,
    ),
    minSpeed: Math.min(minSpeed, maxSpeed),
    maxSpeed: Math.max(minSpeed, maxSpeed),
    badge: normalizeBadge(source.badge),
    keys: {
      increase: normalizeBindings(
        keys.increase,
        DEFAULT_SETTINGS.keys.increase,
      ),
      decrease: normalizeBindings(
        keys.decrease,
        DEFAULT_SETTINGS.keys.decrease,
      ),
      reset: normalizeBindings(keys.reset, DEFAULT_SETTINGS.keys.reset),
    },
  }
}

export const clampToSettings = (speed: number, settings: Settings): number => {
  return clampSpeed(speed, settings.minSpeed, settings.maxSpeed)
}

export const readSettings = (callback: (settings: Settings) => void): void => {
  chrome.storage.local.get(SETTINGS_STORAGE_KEY, stored => {
    callback(normalizeSettings(stored?.[SETTINGS_STORAGE_KEY]))
  })
}

export const writeSettings = (
  settings: Settings,
  callback?: () => void,
): void => {
  chrome.storage.local.set(
    { [SETTINGS_STORAGE_KEY]: normalizeSettings(settings) },
    () => {
      callback?.()
    },
  )
}

export const onSettingsChange = (
  listener: (settings: Settings) => void,
): (() => void) => {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) {
      return
    }

    listener(normalizeSettings(changes[SETTINGS_STORAGE_KEY].newValue))
  }

  chrome.storage.onChanged.addListener(handler)

  return () => {
    chrome.storage.onChanged.removeListener(handler)
  }
}
