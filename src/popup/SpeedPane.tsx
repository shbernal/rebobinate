import type { KeyBindings, SpeedAction } from '@/shared/keys'
import { formatBinding } from '@/shared/keys'
import { formatSpeedLabel, speedsEqual } from '@/shared/speed'
import { SPEED_PRESETS } from './speeds'

type SpeedPaneProps = {
  /**
   * The master switch. With it off the service worker refuses every intent, so
   * the controls that send one are dead rather than quietly ignored, and the
   * readout has no speed to report: the tab's speed is forgotten when the
   * switch is thrown and the video is back at normal.
   */
  enabled: boolean
  speed: number
  /** What reset goes back to, which is not always 1.0×. */
  defaultSpeed: number
  keys: KeyBindings
  onAction: (action: SpeedAction) => void
  /** A preset chip, which goes straight to a speed rather than stepping. */
  onSetSpeed: (speed: number) => void
  /** The domain the active tab counts as, or null when there is not one. */
  domain: string | null
  /**
   * Whether a speed set here is being written down against that domain. False
   * while per-site memory is off and on a site that is marked never.
   */
  remembered: boolean
  /**
   * The speed written down for it already, or null while nothing is — the
   * difference between what will happen and what has. It picks the tense, and
   * it is the figure the receipt names while the master switch is off, when
   * `speed` is a number this panel is not holding.
   */
  rememberedSpeed: number | null
  /** Drops the entry this pane has just said it wrote. */
  onForget: () => void
  /** Where the rule can be changed for every site, not only this one. */
  onShowSites: () => void
}

/**
 * The hint follows the bindings rather than spelling out `+`/`−`/`0`, which
 * stops being true the moment somebody rebinds a key in the Settings tab. Only
 * the first binding of each action is shown; the full set is on that tab.
 */
const firstBinding = (bindings: string[]) => {
  return bindings.length > 0 ? formatBinding(bindings[0]) : '—'
}

/** What the readout says when there is no speed being held. */
const NO_SPEED = '—'

const SpeedPane = ({
  enabled,
  speed,
  defaultSpeed,
  keys,
  onAction,
  onSetSpeed,
  domain,
  remembered,
  rememberedSpeed,
  onForget,
  onShowSites,
}: SpeedPaneProps) => (
  <>
    <section className="speed">
      <button
        type="button"
        disabled={!enabled}
        onClick={() => onAction('decrease')}
        aria-label="Slower"
      >
        −
      </button>
      <output className="readout">
        {enabled ? formatSpeedLabel(speed) : NO_SPEED}
      </output>
      <button
        type="button"
        disabled={!enabled}
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
        disabled={!enabled}
        title={
          remembered && domain !== null
            ? `Back to ${formatSpeedLabel(defaultSpeed)}, and stops remembering a speed for ${domain}`
            : `Back to ${formatSpeedLabel(defaultSpeed)}`
        }
        onClick={() => onAction('reset')}
      >
        {speedsEqual(defaultSpeed, 1) ? 'Reset' : 'Default'}
      </button>
    </section>

    {/* A shortcut past the grid, not a replacement for it: at the default 0.05
        step, walking from 1.0× to 2.0× on the buttons is twenty presses.

        The chip that lands on the default speed is Reset under another name,
        so it sends what Reset sends. As an ordinary set it wrote an entry at
        the default speed while the button four pixels above it dropped that
        entry — two controls arriving at the same number and leaving opposite
        stored state, with nothing on screen to tell them apart. A map full of
        entries repeating the default is also the waste `remember` in the
        service worker exists to avoid. */}
    <section className="speed-presets">
      {SPEED_PRESETS.map(preset => (
        <button
          key={preset}
          type="button"
          disabled={!enabled}
          aria-pressed={enabled && speedsEqual(speed, preset)}
          onClick={() =>
            speedsEqual(preset, defaultSpeed)
              ? onAction('reset')
              : onSetSpeed(preset)
          }
        >
          {formatSpeedLabel(preset)}
        </button>
      ))}
    </section>

    {/* Where the speed goes, in the tense it is actually in: a promise while
        the site has nothing stored, a receipt once it has. Per-site memory is
        on out of the box, so the two are one step apart on a fresh profile and
        printing the receipt for both is the extension's only claim about a
        user's speed being false.

        Neither tense is only a sentence. Stepping the speed here writes a rule
        that applies on every later visit, this is the only screen that says so
        at the moment it happens, and passive text is no way to say it: the
        receipt carries the Forget that undoes the write where it was
        announced, and the promise is the button that leads to the tab where
        the rule is set for every site. A control appearing is also a louder
        change of state than a verb changing.

        The receipt names a speed rather than only the site, and while the
        extension is on that speed is the readout's. The two used to be
        different numbers: the service worker debounces the write by a second
        and this line read the stored map, so for that second the panel printed
        one speed above and another below it, on the one screen whose job is to
        say what speed this site plays at. The write is the service worker's
        timer and lands whether or not the popup survives it, so naming the
        live speed is accurate a second early rather than wrong a second late.
        What still waits for the write is the tense: the promise becomes a
        receipt once there is a stored fact to report, which is what makes the
        delay legible.

        With the switch off the readout has no number to agree with and the
        panel is holding a speed nothing is at, so the stored figure is the
        only true one and the receipt goes back to naming it. Nothing is
        pending down there either: the service worker refuses every intent
        while the switch is off. */}
    {remembered && domain !== null ? (
      rememberedSpeed !== null ? (
        <section className="memory">
          <p className="rule">{`${formatSpeedLabel(enabled ? speed : rememberedSpeed)} remembered for ${domain}`}</p>
          <button
            type="button"
            className="forget"
            title={`Back to the default speed for ${domain}`}
            onClick={onForget}
          >
            Forget
          </button>
        </section>
      ) : (
        <section className="memory">
          <button
            type="button"
            className="rule memory-link"
            title="Change this on the Sites tab"
            onClick={onShowSites}
          >
            {`Speeds set here are kept for ${domain}`}
          </button>
        </section>
      )
    ) : null}

    <p className="hint">
      <kbd>{firstBinding(keys.increase)}</kbd> faster ·{' '}
      <kbd>{firstBinding(keys.decrease)}</kbd> slower ·{' '}
      <kbd>{firstBinding(keys.reset)}</kbd> reset
    </p>
  </>
)

export default SpeedPane
