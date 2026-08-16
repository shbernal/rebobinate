import { Fragment, useState } from 'react'
import type { BackupContents } from '@/shared/backup'
import type { DomainStore } from '@/shared/domains'
import type { KeyBindings } from '@/shared/keys'
import type { BadgeCorner, BadgeSettings, Settings } from '@/shared/settings'
import { BADGE_CORNERS, LIMITS, clampStep } from '@/shared/settings'
import { formatSpeedLabel } from '@/shared/speed'
import Backup from './Backup'
import ColorPicker from './ColorPicker'
import KeyEditor from './KeyEditor'
import Toggle from './Toggle'

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

type SettingsPaneProps = {
  settings: Settings
  save: (next: Settings) => void
  /** Only for the badge preview, which shows the speed the tab is at. */
  speed: number
  /** Only for the backup panel, which exports the site list with the rest. */
  domains: DomainStore
  onImport: (contents: BackupContents) => void
}

const SettingsPane = ({
  settings,
  save,
  speed,
  domains,
  onImport,
}: SettingsPaneProps) => {
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

  const saveBadge = (patch: Partial<BadgeSettings>) => {
    save({ ...settings, badge: { ...settings.badge, ...patch } })
  }

  const saveKeys = (keys: KeyBindings) => {
    save({ ...settings, keys })
  }

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

  return (
    <>
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

      <h2 className="pane-heading">Keys</h2>
      <KeyEditor keys={settings.keys} onChange={saveKeys} />

      <hr />

      <section className="field">
        <span>Toolbar badge</span>
        <Toggle
          label="Toolbar badge"
          checked={settings.toolbarBadge}
          onChange={toolbarBadge => save({ ...settings, toolbarBadge })}
        />
      </section>

      <hr />

      {/* Everything the preview previews, in one block, because the preview is
          stuck to the bottom of it: scoped this way it stays on screen while
          the badge is being changed and lets go once the Backup section
          arrives, rather than covering it. */}
      <section className="badge-settings">
        {/* Named for where it is drawn now that there are two badges. */}
        <section className="field">
          <span>On-video badge</span>
          <Toggle
            label="On-video badge"
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

        {/* One row per colour, in the label-left/control-right shape the rest
            of the pane uses: a bare swatch names neither which colour it is
            nor, in the light theme, that it is a control at all. */}
        {COLOR_FIELDS.map(field => (
          <Fragment key={field.key}>
            <section className="field" hidden={!settings.badge.enabled}>
              <span>{field.label}</span>
              <button
                type="button"
                aria-label={field.label}
                aria-expanded={openColor === field.key}
                className={openColor === field.key ? 'swatch active' : 'swatch'}
                style={{ background: settings.badge[field.key] }}
                onClick={() =>
                  setOpenColor(open => (open === field.key ? null : field.key))
                }
              />
            </section>

            {/* One panel at a time, opening under the row it belongs to.
                Mounting it per field is also what stops React reusing the one
                panel across a switch and carrying a half-typed hex with it. */}
            {openColor === field.key && settings.badge.enabled ? (
              <ColorPicker
                label={field.label}
                value={settings.badge[field.key]}
                onChange={hex => saveBadge({ [field.key]: hex })}
              />
            ) : null}
          </Fragment>
        ))}

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
      </section>

      <hr />

      <h2 className="pane-heading">Backup</h2>
      <Backup settings={settings} domains={domains} onImport={onImport} />
    </>
  )
}

export default SettingsPane
