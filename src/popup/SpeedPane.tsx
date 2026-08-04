import type { KeyBindings, SpeedAction } from '@/shared/keys'
import { formatBinding } from '@/shared/keys'
import { formatSpeedLabel } from '@/shared/speed'

type SpeedPaneProps = {
  speed: number
  keys: KeyBindings
  onAction: (action: SpeedAction) => void
}

/**
 * The hint follows the bindings rather than spelling out `+`/`−`/`0`, which
 * stops being true the moment somebody rebinds a key in the Settings tab. Only
 * the first binding of each action is shown; the full set is on that tab.
 */
const firstBinding = (bindings: string[]) => {
  return bindings.length > 0 ? formatBinding(bindings[0]) : '—'
}

const SpeedPane = ({ speed, keys, onAction }: SpeedPaneProps) => (
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

    <p className="hint">
      <kbd>{firstBinding(keys.increase)}</kbd> faster ·{' '}
      <kbd>{firstBinding(keys.decrease)}</kbd> slower ·{' '}
      <kbd>{firstBinding(keys.reset)}</kbd> reset
    </p>
  </>
)

export default SpeedPane
