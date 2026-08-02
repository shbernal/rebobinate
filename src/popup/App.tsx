import { useCallback, useEffect, useState } from 'react'
import type { RuntimeMessage } from '@/shared/messages'
import type { SpeedAction } from '@/shared/keys'
import type { BadgeCorner, BadgeSettings, Settings } from '@/shared/settings'
import {
  BADGE_CORNERS,
  DEFAULT_SETTINGS,
  LIMITS,
  clampStep,
  onSettingsChange,
  readSettings,
  writeSettings,
} from '@/shared/settings'
import { formatSpeedLabel } from '@/shared/speed'
import ColorPicker from './ColorPicker'
import './App.css'

const CORNER_LABELS: Record<BadgeCorner, string> = {
  'top-left': '↖',
  'top-right': '↗',
  'bottom-left': '↙',
  'bottom-right': '↘',
}

/**
 * One picker panel is shared by both swatches, so the popup grows by one panel
 * at most. Opening a second swatch closes the first.
 */
const COLOR_FIELDS = [
  { key: 'textColor', label: 'Text color' },
  { key: 'backgroundColor', label: 'Background color' },
] as const

type ColorFieldKey = (typeof COLOR_FIELDS)[number]['key']

type ToggleProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  size?: 'large' | 'small'
}

/**
 * An on/off slider. The visible track and knob are the sibling `<span>`; the
 * checkbox itself stays in the DOM, transparent and zero-sized, so the control
 * keeps a real checkbox's keyboard and screen-reader behaviour.
 */
const Toggle = ({ label, checked, onChange, size = 'small' }: ToggleProps) => (
  <label className={size === 'small' ? 'switch switch-small' : 'switch'}>
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={event => onChange(event.target.checked)}
    />
    <span className="slider" />
  </label>
)

const sendMessage = (
  message: RuntimeMessage,
  onResponse?: (speed: number) => void,
) => {
  chrome.runtime.sendMessage(message, (response?: { speed?: number }) => {
    void chrome.runtime.lastError

    if (typeof response?.speed === 'number') {
      onResponse?.(response.speed)
    }
  })
}

const App = () => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [speed, setSpeed] = useState(1)
  /**
   * The step is typed digit by digit, and the halfway states are not valid
   * steps: going from 0.2 to 0.15 passes through '', '0' and '0.'. Clamping
   * every keystroke straight back into the field rewrites it under the cursor
   * and makes those targets unreachable, so the raw text is held here while the
   * field is being edited and only a value that is already a valid step is
   * saved as it is typed.
   */
  const [stepDraft, setStepDraft] = useState<string | null>(null)
  const [openColor, setOpenColor] = useState<ColorFieldKey | null>(null)
  const openColorField = COLOR_FIELDS.find(field => field.key === openColor)

  useEffect(() => {
    readSettings(setSettings)
    sendMessage({ type: 'rebobinate:popup-state' }, setSpeed)

    return onSettingsChange(setSettings)
  }, [])

  const save = useCallback((next: Settings) => {
    setSettings(next)
    writeSettings(next)
  }, [])

  const saveBadge = useCallback(
    (patch: Partial<BadgeSettings>) => {
      save({ ...settings, badge: { ...settings.badge, ...patch } })
    },
    [save, settings],
  )

  const editStep = (raw: string) => {
    setStepDraft(raw)

    const parsed = Number(raw)

    if (raw.trim() !== '' && parsed === clampStep(parsed)) {
      save({ ...settings, step: parsed })
    }
  }

  /** Leaving the field takes the last typed value as far as it can go. */
  const commitStep = () => {
    const parsed = Number(stepDraft)

    if (
      stepDraft !== null &&
      stepDraft.trim() !== '' &&
      !Number.isNaN(parsed)
    ) {
      save({ ...settings, step: clampStep(parsed) })
    }

    setStepDraft(null)
  }

  const act = (action: SpeedAction) => {
    sendMessage(
      { type: 'rebobinate:intent', action, currentSpeed: speed },
      setSpeed,
    )
  }

  return (
    <main className="popup">
      <header className="header">
        <h1>Rebobinate</h1>
        <Toggle
          label="Enabled"
          size="large"
          checked={settings.enabled}
          onChange={enabled => save({ ...settings, enabled })}
        />
      </header>

      <section className="speed">
        <button
          type="button"
          onClick={() => act('decrease')}
          aria-label="Slower"
        >
          −
        </button>
        <output className="readout">{formatSpeedLabel(speed)}</output>
        <button
          type="button"
          onClick={() => act('increase')}
          aria-label="Faster"
        >
          +
        </button>
        <button type="button" className="reset" onClick={() => act('reset')}>
          Reset
        </button>
      </section>

      <section className="field">
        <label htmlFor="step">Step</label>
        <input
          id="step"
          type="number"
          min={LIMITS.step.min}
          max={LIMITS.step.max}
          step={0.01}
          value={stepDraft ?? String(settings.step)}
          onChange={event => editStep(event.target.value)}
          onBlur={commitStep}
        />
      </section>

      <hr />

      <section className="field">
        <span>Speed badge</span>
        <Toggle
          label="Speed badge"
          checked={settings.badge.enabled}
          onChange={enabled => saveBadge({ enabled })}
        />
      </section>

      <fieldset className="corners" disabled={!settings.badge.enabled}>
        <legend>Corner</legend>
        {BADGE_CORNERS.map(corner => (
          <button
            key={corner}
            type="button"
            aria-label={corner}
            aria-pressed={settings.badge.corner === corner}
            className={settings.badge.corner === corner ? 'active' : ''}
            onClick={() => saveBadge({ corner })}
          >
            {CORNER_LABELS[corner]}
          </button>
        ))}
      </fieldset>

      <section className="field" hidden={!settings.badge.enabled}>
        <label htmlFor="badge-size">Size</label>
        <input
          id="badge-size"
          type="range"
          min={LIMITS.fontSize.min}
          max={LIMITS.fontSize.max}
          value={settings.badge.fontSize}
          onChange={event =>
            saveBadge({ fontSize: Number(event.target.value) })
          }
        />
      </section>

      <section className="field" hidden={!settings.badge.enabled}>
        <label htmlFor="badge-opacity">Opacity</label>
        <input
          id="badge-opacity"
          type="range"
          min={LIMITS.opacity.min * 100}
          max={LIMITS.opacity.max * 100}
          value={Math.round(settings.badge.opacity * 100)}
          onChange={event =>
            saveBadge({ opacity: Number(event.target.value) / 100 })
          }
        />
      </section>

      <section className="field" hidden={!settings.badge.enabled}>
        <span>Colors</span>
        <span className="colors">
          {COLOR_FIELDS.map(field => (
            <button
              key={field.key}
              type="button"
              aria-label={field.label}
              aria-expanded={openColor === field.key}
              className={openColor === field.key ? 'swatch active' : 'swatch'}
              style={{ background: settings.badge[field.key] }}
              onClick={() =>
                setOpenColor(open => (open === field.key ? null : field.key))
              }
            />
          ))}
        </span>
      </section>

      {openColorField && settings.badge.enabled ? (
        <ColorPicker
          // Each field gets its own instance: without a key React reuses the
          // one panel across a switch, carrying a half-typed hex with it.
          key={openColorField.key}
          label={openColorField.label}
          value={settings.badge[openColorField.key]}
          onChange={hex => saveBadge({ [openColorField.key]: hex })}
        />
      ) : null}

      <section className="field" hidden={!settings.badge.enabled}>
        <label htmlFor="badge-autohide">Hide after</label>
        <select
          id="badge-autohide"
          value={settings.badge.autoHideMs}
          onChange={event =>
            saveBadge({ autoHideMs: Number(event.target.value) })
          }
        >
          <option value={0}>Never</option>
          <option value={1000}>1s</option>
          <option value={2000}>2s</option>
          <option value={5000}>5s</option>
        </select>
      </section>

      <section className="field" hidden={!settings.badge.enabled}>
        <span>Hide at 1.0×</span>
        <Toggle
          label="Hide at 1.0×"
          checked={settings.badge.hideAtNormalSpeed}
          onChange={hideAtNormalSpeed => saveBadge({ hideAtNormalSpeed })}
        />
      </section>

      <section className="preview" hidden={!settings.badge.enabled}>
        <span
          className="preview-badge"
          data-corner={settings.badge.corner}
          style={{
            fontSize: `${settings.badge.fontSize}px`,
            opacity: settings.badge.opacity,
            color: settings.badge.textColor,
            background: settings.badge.backgroundColor,
          }}
        >
          {formatSpeedLabel(speed)}
        </span>
      </section>

      <footer className="hint">
        <kbd>+</kbd> faster · <kbd>−</kbd> slower · <kbd>0</kbd> reset
      </footer>
    </main>
  )
}

export default App
