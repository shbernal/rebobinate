import { useRef, useState, type CSSProperties } from 'react'
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

/**
 * When the badge is on screen, in a sentence.
 *
 * The preview cannot act this out: it is pinned so that it stays visible while
 * the controls below it move, and honouring "hide at normal speed" would blank
 * it for most users at rest, since the popup previews the tab's current speed.
 * So the rules are stated instead, and stating them is also what answers
 * whether the two settings interact — the sentence has to carry both.
 *
 * It is rendered last in the block, under the two controls it reads. Under the
 * sample it was the first thing to pass beneath the pinned header, so by the
 * time "Hide after" and "Show at 1.0×" were on screen the sentence describing
 * what they had just done was not — and feedback out of reach at the moment it
 * is needed cannot be told apart from no feedback at all.
 */
const visibilityNote = (badge: BadgeSettings): string => {
  const seconds = badge.autoHideMs / 1000
  const shown =
    badge.autoHideMs > 0
      ? `Shown for ${seconds} second${seconds === 1 ? '' : 's'} after a speed change`
      : 'Always shown while a video is playing'

  return badge.hideAtNormalSpeed
    ? `${shown}, and hidden at ${formatSpeedLabel(1)}.`
    : `${shown}, including at ${formatSpeedLabel(1)}.`
}

type SettingsPaneProps = {
  settings: Settings
  save: (next: Settings) => void
  /** Only for the badge preview, which shows the speed the tab is at. */
  speed: number
  /** Only for the backup panel, which exports the site list with the rest. */
  domains: DomainStore
  onImport: (contents: BackupContents) => void
  /**
   * Hands the shell the block that is about to stop taking up room, or `null`
   * when one is about to come back. The pane is the shell's element and the
   * scroll position is its property, so what a collapse costs is worked out
   * there; this pane only knows when one is coming.
   */
  onHoldSlack: (block: HTMLElement | null) => void
}

const SettingsPane = ({
  settings,
  save,
  speed,
  domains,
  onImport,
  onHoldSlack,
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
  const openField = COLOR_FIELDS.find(field => field.key === openColor)

  /**
   * The block the master switch below collapses, so that the collapse can be
   * paid for before it happens.
   *
   * Turning the badge off hides eight of the block's nine children at once,
   * which takes the pane's scroll range down with it and leaves the browser to
   * clamp `scrollTop` — the switch the user just pressed slides down the pane
   * and rows from further up the tab arrive above it. Handed over on the click
   * and before the state changes, because this is the only moment the block is
   * still the size it is about to stop being; the shell holds that much slack
   * at the foot of the pane and melts it away on the next scroll.
   */
  const blockRef = useRef<HTMLElement>(null)

  const saveBadge = (patch: Partial<BadgeSettings>) => {
    save({ ...settings, badge: { ...settings.badge, ...patch } })
  }

  const setBadgeEnabled = (enabled: boolean) => {
    onHoldSlack(enabled ? null : blockRef.current)
    saveBadge({ enabled })
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
        <label htmlFor="step">Speed step</label>
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
      {/* The buttons and the keys this governs are on another tab, so the
          field is the only place that can say what it moves. The unit is not
          appended inside the input: it is a numeric field with a draft state,
          and a suffix would fight both. */}
      <p className="note">How far + and − move the speed.</p>

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

      {/* Everything the preview previews, in one block, because the block's
          header is stuck to the top of it: scoped this way the header stays on
          screen for the whole run of badge controls and lets go once the Backup
          section arrives, rather than covering it. The header leads the block
          for the same reason — a top-stuck element covers what has already
          scrolled past it, never a control being scrolled toward. */}
      <section className="badge-settings" ref={blockRef}>
        {/* The switch that governs the block travels with the sample rather
            than scrolling away under the tab strip: a master switch that is
            off screen while its block is being edited leaves no way to turn
            the block off, and half of one under the pane's scroll cue reads as
            a rendering fault. With the badge off everything the block governs
            is `hidden`, so this collapses to the switch and the line under
            it. */}
        <div className="badge-header">
          {/* Named for where it is drawn now that there are two badges. */}
          <section className="field">
            <span>On-video badge</span>
            <Toggle
              label="On-video badge"
              checked={settings.badge.enabled}
              onChange={setBadgeEnabled}
            />
          </section>

          {/* What the collapse does not say for itself. Turning the badge off
              takes the sample, the corner grid, both sliders, both colour
              rows, the dropdown, the second switch and the sentence off screen
              at once, and nothing that is left says where any of it went. The
              quiet tier rather than `.rule`: this is reassurance about stored
              state, not a statement of what the badge will do. */}
          <p className="note" hidden={settings.badge.enabled}>
            Size, colours and timing are kept.
          </p>

          {/* The sample's own size reaches the stylesheet, which sizes the box
              around it: the corner buttons only mean anything while the box is
              taller than what sits in it. The cast is what a custom property
              costs in a typed style object. */}
          <section
            className="preview"
            hidden={!settings.badge.enabled}
            style={
              {
                '--sample-size': `${settings.badge.fontSize}px`,
              } as CSSProperties
            }
          >
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
        </div>

        {/* The buttons are in a box of their own rather than being laid out by
            the fieldset: a fieldset lays its rendered legend out itself, above
            the box its `display` applies to, so a grid fieldset puts "Corner"
            on a line of its own above the corners rather than beside them. The
            legend is floated back out of that path in App.css. */}
        <fieldset
          className="corners"
          hidden={!settings.badge.enabled}
          disabled={!settings.badge.enabled}
        >
          <legend>Corner</legend>
          <div className="corner-grid">
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
          </div>
        </fieldset>

        <section className="field" hidden={!settings.badge.enabled}>
          <label htmlFor="badge-size">Size</label>
          {/* The thumb position is not a value anybody can write down, copy to
              a second machine, or come back to after experimenting. */}
          <output htmlFor="badge-size">{settings.badge.fontSize}px</output>
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
          <output htmlFor="badge-opacity">
            {Math.round(settings.badge.opacity * 100)}%
          </output>
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
          <section
            key={field.key}
            className="field"
            hidden={!settings.badge.enabled}
          >
            <span>{field.label}</span>
            {/* The value in words, the way Size and Opacity state theirs. A
                swatch alone states nothing: the default text colour is white
                on a Canvas pane, so the control that is meant to be showing a
                colour renders as an empty box the same shape as a text input.
                The hex is what makes it legible as a colour, and it survives
                the row being half-clipped by the pinned header above. */}
            <span className="field-value">{settings.badge[field.key]}</span>
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
        ))}

        {/* Under the pair rather than under the row it belongs to. A badge's
            legibility is the contrast between its two colours, so both swatches
            have to stay on screen while either is being picked; opening the
            first one used to push the second off the bottom. Which row it is
            for is said three ways, because none of them is the panel's
            position: the panel captions itself with the field's name, the open
            swatch wears an accent ring, and `aria-expanded` carries the same
            thing to a screen reader. The ring is a ring rather than a fill
            because the swatch paints the chosen colour inline, and an inline
            background beats any fill a stylesheet can set. `key` still
            remounts on a switch so a half-typed hex cannot travel between the
            two. */}
        {openField !== undefined && settings.badge.enabled ? (
          <ColorPicker
            key={openField.key}
            label={openField.label}
            value={settings.badge[openField.key]}
            onChange={hex => saveBadge({ [openField.key]: hex })}
            onClose={() => setOpenColor(null)}
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

        {/* Asked the way every other switch on this pane is asked — on means
            more visible — while the stored key stays `hideAtNormalSpeed`,
            which installed copies hold and the content script reads. */}
        <section className="field" hidden={!settings.badge.enabled}>
          <span>Show at {formatSpeedLabel(1)}</span>
          <Toggle
            label={`Show at ${formatSpeedLabel(1)}`}
            checked={!settings.badge.hideAtNormalSpeed}
            onChange={show => saveBadge({ hideAtNormalSpeed: !show })}
          />
        </section>

        {/* Last in the block, so it sits under both of the controls it reads
            rather than above them under the pinned header. */}
        <p className="rule" hidden={!settings.badge.enabled}>
          {visibilityNote(settings.badge)}
        </p>
      </section>

      <hr />

      <h2 className="pane-heading">Backup</h2>
      <Backup settings={settings} domains={domains} onImport={onImport} />
    </>
  )
}

export default SettingsPane
