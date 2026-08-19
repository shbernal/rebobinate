import type { KeyBindings, SpeedAction } from '@/shared/keys'
import { formatBinding } from '@/shared/keys'
import { formatSpeedLabel, speedsEqual } from '@/shared/speed'
import { SPEED_PRESETS } from './speeds'

type SpeedPaneProps = {
  speed: number
  /** What reset goes back to, which is not always 1.0×. */
  defaultSpeed: number
  keys: KeyBindings
  onAction: (action: SpeedAction) => void
  /** A preset chip, which goes straight to a speed rather than stepping. */
  onSetSpeed: (speed: number) => void
}

/**
 * The hint follows the bindings rather than spelling out `+`/`−`/`0`, which
 * stops being true the moment somebody rebinds a key in the Settings tab. Only
 * the first binding of each action is shown; the full set is on that tab.
 */
const firstBinding = (bindings: string[]) => {
  return bindings.length > 0 ? formatBinding(bindings[0]) : '—'
}

const SpeedPane = ({
  speed,
  defaultSpeed,
  keys,
  onAction,
  onSetSpeed,
}: SpeedPaneProps) => (
  <>
    <section className="speed">
      <button
        type="button"
        onClick={() => onAction('decrease')}
        aria-label="Slower"
      >
        −
      </button>
      <output className="readout">{formatSpeedLabel(speed)}</output>
      <button
        type="button"
        onClick={() => onAction('increase')}
        aria-label="Faster"
      >
        +
      </button>
    </section>

    {/* Out of the stepper row, which it made asymmetric: with a fourth column
        the readout no longer sat on the panel's centre. And named for what it
        goes back to — the service worker resets to the default speed, not to
        1.0×, so "Reset" is actively wrong once that default has been moved. */}
    <section className="speed-reset">
      <button
        type="button"
        className="reset"
        title={`Back to ${formatSpeedLabel(defaultSpeed)}`}
        onClick={() => onAction('reset')}
      >
        {speedsEqual(defaultSpeed, 1) ? 'Reset' : 'Default'}
      </button>
    </section>

    {/* A shortcut past the grid, not a replacement for it: at the default 0.05
        step, walking from 1.0× to 2.0× on the buttons is twenty presses. */}
    <section className="speed-presets">
      {SPEED_PRESETS.map(preset => (
        <button
          key={preset}
          type="button"
          aria-pressed={speedsEqual(speed, preset)}
          onClick={() => onSetSpeed(preset)}
        >
          {formatSpeedLabel(preset)}
        </button>
      ))}
    </section>

    <p className="hint">
      <kbd>{firstBinding(keys.increase)}</kbd> faster ·{' '}
      <kbd>{firstBinding(keys.decrease)}</kbd> slower ·{' '}
      <kbd>{firstBinding(keys.reset)}</kbd> reset
    </p>
  </>
)

export default SpeedPane
