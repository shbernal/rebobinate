import { useState } from 'react'
import { type Hsl, hexToHsl, hslToHex, toHex } from '@/shared/color'

/**
 * The popup renders its own picker instead of `<input type="color">`.
 *
 * On Firefox the action popup is a XUL panel, and the native colour chooser is
 * a separate toplevel window. Opening it takes focus, the panel rolls up, and
 * the popup document — this component and its `onChange` — is destroyed before
 * the user has picked anything, so the choice is silently dropped. See
 * [Build Targets](../../docs/build-targets.md#no-native-pickers-in-the-popup).
 */

/** Neutrals, then hues: the two things a badge colour is usually chosen from. */
export const PRESET_COLORS = [
  '#ffffff',
  '#d4d4d4',
  '#a3a3a3',
  '#737373',
  '#404040',
  '#262626',
  '#0a0a0a',
  '#000000',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const

const HUE_TRACK =
  'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'

const CHANNELS = [
  { key: 'h', label: 'Hue', max: 360 },
  { key: 's', label: 'Saturation', max: 100 },
  { key: 'l', label: 'Lightness', max: 100 },
] as const

const trackFor = (channel: 'h' | 's' | 'l', { h, s, l }: Hsl): string => {
  if (channel === 'h') {
    return HUE_TRACK
  }

  if (channel === 's') {
    return `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`
  }

  return `linear-gradient(to right, #000000, hsl(${h} ${s}% 50%), #ffffff)`
}

type ColorPickerProps = {
  label: string
  value: string
  onChange: (hex: string) => void
  /** The way out that is not "click the swatch you came in by". */
  onClose: () => void
}

const ColorPicker = ({ label, value, onChange, onClose }: ColorPickerProps) => {
  const hex = toHex(value)
  /**
   * The HSL is state rather than a value derived from `hex` on every render.
   * Hex carries eight bits per channel while this carries whole degrees and
   * percents, so the round trip is lossy and re-deriving it would make a
   * dragged slider drift under the cursor. `seed` remembers the hex this
   * component last produced, so a change from anywhere else — a preset, a typed
   * hex, another window writing settings — still re-seeds the sliders.
   */
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(hex))
  const [seed, setSeed] = useState(hex)
  const [hexDraft, setHexDraft] = useState<string | null>(null)

  if (seed !== hex) {
    setSeed(hex)
    setHsl(hexToHsl(hex))
  }

  const applyHex = (next: string) => {
    setSeed(next)
    setHsl(hexToHsl(next))
    onChange(next)
  }

  const applyChannel = (channel: 'h' | 's' | 'l', raw: string) => {
    const next = { ...hsl, [channel]: Number(raw) }
    const nextHex = hslToHex(next)

    setHsl(next)
    setSeed(nextHex)
    onChange(nextHex)
  }

  /**
   * A hex is typed a character at a time and `#ff88` is not a colour, so the
   * raw text is held while the field is being edited — the same shape as the
   * step field above it.
   */
  const editHex = (raw: string) => {
    setHexDraft(raw)

    const candidate = raw.trim().toLowerCase()

    if (/^#[0-9a-f]{6}$/.test(candidate)) {
      applyHex(candidate)
    }
  }

  const commitHex = () => {
    if (hexDraft !== null && /^#[0-9a-f]{3}$/i.test(hexDraft.trim())) {
      applyHex(toHex(hexDraft))
    }

    setHexDraft(null)
  }

  return (
    <div className="color-picker" role="group" aria-label={`${label} picker`}>
      {/* The panel names its own subject. One panel is shared by both colour
          rows and it opens under the pair rather than under the row that
          opened it, so its position says nothing about which of the two it
          edits; without the caption, `label` reached a screen reader through
          `aria-label` and nobody else.

          The caption row carries the way out. Clicking the open swatch again
          closes the panel, but the ring on that swatch reads as "this is the
          one being edited" rather than as "press me again", and the panel is
          about 200px of a 440px pane. Not a "Done": nothing here is pending,
          every change is already saved, and Done would imply an edit that
          could still be cancelled. */}
      <div className="picker-label">
        <span>{label}</span>
        <button
          type="button"
          className="picker-close"
          aria-label={`Close ${label} picker`}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="presets">
        {PRESET_COLORS.map(preset => (
          <button
            key={preset}
            type="button"
            aria-label={preset}
            aria-pressed={preset === hex}
            className={preset === hex ? 'active' : ''}
            style={{ background: preset }}
            onClick={() => applyHex(preset)}
          />
        ))}
      </div>

      {/* Each track is labelled in words as well as to a screen reader. The
          gradients normally describe themselves, and at the default text
          colour they do not: at #ffffff the saturation track runs white to
          white and renders as an empty bar with a dot on it, which is the
          first thing anyone opening this panel sees. */}
      {CHANNELS.map(channel => (
        <div key={channel.key} className="color-row">
          <span className="channel-label">{channel.label}</span>
          <input
            type="range"
            aria-label={channel.label}
            min={0}
            max={channel.max}
            value={hsl[channel.key]}
            style={{ background: trackFor(channel.key, hsl) }}
            onChange={event => applyChannel(channel.key, event.target.value)}
          />
        </div>
      ))}

      {/* The hex, and no sample square beside it. The square painted the
          colour flat with nothing behind it, so at the default #ffffff it was
          a second empty box in a panel that already had one — and it was
          duplicating the swatch on the row above, which the panel deliberately
          keeps on screen. The tracks and the preset grid show the colour
          live. */}
      <div className="color-row">
        <span className="channel-label">Hex</span>
        <input
          type="text"
          aria-label={`${label} hex`}
          spellCheck={false}
          maxLength={7}
          value={hexDraft ?? hex}
          onChange={event => editHex(event.target.value)}
          onBlur={commitHex}
        />
      </div>
    </div>
  )
}

export default ColorPicker
