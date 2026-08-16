import type { KeyBindings, SpeedAction } from '@/shared/keys'
import { formatBinding } from '@/shared/keys'
import { formatSpeedLabel, speedsEqual } from '@/shared/speed'
import { SPEED_PRESETS } from './speeds'

type SpeedPaneProps = {
  speed: number
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

const SpeedPane = ({ speed, keys, onAction, onSetSpeed }: SpeedPaneProps) => (
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
      <button type="button" className="reset" onClick={() => onAction('reset')}>
        Reset
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
