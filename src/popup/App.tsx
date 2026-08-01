import { useCallback, useEffect, useState } from 'react'
import type { RuntimeMessage } from '@/shared/messages'
import type { SpeedAction } from '@/shared/keys'
import type { BadgeCorner, BadgeSettings, Settings } from '@/shared/settings'
import {
  BADGE_CORNERS,
  DEFAULT_SETTINGS,
  LIMITS,
  onSettingsChange,
  readSettings,
  writeSettings,
} from '@/shared/settings'
import { formatSpeedLabel } from '@/shared/speed'
import './App.css'

const CORNER_LABELS: Record<BadgeCorner, string> = {
  'top-left': '↖',
  'top-right': '↗',
  'bottom-left': '↙',
  'bottom-right': '↘',
}

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
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={event =>
              save({ ...settings, enabled: event.target.checked })
            }
          />
          <span>{settings.enabled ? 'On' : 'Off'}</span>
        </label>
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
          value={settings.step}
          onChange={event =>
            save({ ...settings, step: Number(event.target.value) })
          }
        />
      </section>

      <hr />

      <section className="field">
        <label htmlFor="badge-enabled">Speed badge</label>
        <input
          id="badge-enabled"
          type="checkbox"
          checked={settings.badge.enabled}
          onChange={event => saveBadge({ enabled: event.target.checked })}
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
        <label htmlFor="badge-text">Colors</label>
        <span className="colors">
          <input
            id="badge-text"
            type="color"
            aria-label="Text color"
            value={settings.badge.textColor}
            onChange={event => saveBadge({ textColor: event.target.value })}
          />
          <input
            type="color"
            aria-label="Background color"
            value={settings.badge.backgroundColor}
            onChange={event =>
              saveBadge({ backgroundColor: event.target.value })
            }
          />
        </span>
      </section>

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
        <label htmlFor="badge-hide-normal">Hide at 1.0×</label>
        <input
          id="badge-hide-normal"
          type="checkbox"
          checked={settings.badge.hideAtNormalSpeed}
          onChange={event =>
            saveBadge({ hideAtNormalSpeed: event.target.checked })
          }
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
