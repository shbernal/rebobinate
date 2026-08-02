/**
 * Colour arithmetic for the popup's own picker.
 *
 * It lives here rather than in the popup for the same reason the speed
 * arithmetic does: it has to be testable without a DOM. The popup cannot fall
 * back on `<input type="color">` — see
 * [Build Targets](../../docs/build-targets.md#no-native-pickers-in-the-popup) —
 * so these conversions are the picker, not a convenience around one.
 */

export type Hsl = {
  /** Degrees, 0–360. */
  h: number
  /** Percent, 0–100. */
  s: number
  /** Percent, 0–100. */
  l: number
}

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const LONG_HEX = /^#([0-9a-f]{6})$/i
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value))
}

const toChannel = (token: string): number | null => {
  const trimmed = token.trim()
  const percent = trimmed.endsWith('%')
  const parsed = Number(percent ? trimmed.slice(0, -1) : trimmed)

  if (trimmed === '' || !Number.isFinite(parsed)) {
    return null
  }

  return clamp(percent ? (parsed * 255) / 100 : parsed, 0, 255)
}

const hexPair = (value: number): string => {
  return Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, '0')
}

/**
 * Anything `normalizeSettings` accepts as a colour, reduced to `#rrggbb`.
 *
 * Storage predates this picker and `normalizeSettings` still admits `rgb()` and
 * `rgba()`, so a stored value is not guaranteed to be hex. Alpha is dropped on
 * purpose: the badge carries its own opacity setting, and honouring both would
 * multiply them.
 */
export const toHex = (value: unknown, fallback = '#000000'): string => {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmed = value.trim().toLowerCase()
  const long = LONG_HEX.exec(trimmed)

  if (long) {
    return `#${long[1]}`
  }

  const short = SHORT_HEX.exec(trimmed)

  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  }

  const rgb = RGB_FUNCTION.exec(trimmed)

  if (rgb) {
    const channels = rgb[1]
      .split(/[,/\s]+/)
      .filter(token => token !== '')
      .slice(0, 3)
      .map(toChannel)

    if (channels.length === 3 && channels.every(channel => channel !== null)) {
      return `#${channels.map(channel => hexPair(channel)).join('')}`
    }
  }

  return fallback
}

export const hexToHsl = (value: string): Hsl => {
  const hex = toHex(value)
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const span = max - min
  const l = (max + min) / 2

  if (span === 0) {
    return { h: 0, s: 0, l: Math.round(l * 100) }
  }

  const s = span / (1 - Math.abs(2 * l - 1))
  const h =
    max === r
      ? ((g - b) / span) % 6
      : max === g
        ? (b - r) / span + 2
        : (r - g) / span + 4

  return {
    h: Math.round(h * 60 + 360) % 360,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

export const hslToHex = ({ h, s, l }: Hsl): string => {
  const hue = ((h % 360) + 360) % 360
  const saturation = clamp(s, 0, 100) / 100
  const lightness = clamp(l, 0, 100) / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const base = lightness - chroma / 2
  const sector = Math.floor(hue / 60) % 6
  const [r, g, b] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ][sector]

  return `#${[r, g, b].map(channel => hexPair((channel + base) * 255)).join('')}`
}
