import { useEffect, useState } from 'react'
import type { KeyBindings, SpeedAction } from '@/shared/keys'
import {
  SPEED_ACTIONS,
  bindingOwner,
  captureBinding,
  formatBinding,
} from '@/shared/keys'
import { DEFAULT_SETTINGS } from '@/shared/settings'

const ACTION_LABELS: Record<SpeedAction, string> = {
  increase: 'Faster',
  decrease: 'Slower',
  reset: 'Reset',
}

const REJECTIONS = {
  modified: 'Ctrl, Alt and ⌘ combinations are left to the browser.',
  reserved: 'Esc closes the capture and Tab has to keep moving the focus.',
} as const

type Chip = {
  label: string
  bindings: string[]
}

/**
 * The stored bindings hold both forms of the same key on purpose — `=` catches
 * the character and `Equal` catches the physical key on a layout that puts it
 * elsewhere — so showing one chip per stored token would show two chips for one
 * key. They share a label, and removing the chip removes the whole group: the
 * user is saying "not this key", not "not this one of the two ways I might have
 * pressed it".
 */
const toChips = (bindings: string[]): Chip[] => {
  const groups = new Map<string, string[]>()

  for (const binding of bindings) {
    const label = formatBinding(binding)

    groups.set(label, [...(groups.get(label) ?? []), binding])
  }

  return Array.from(groups, ([label, grouped]) => ({
    label,
    bindings: grouped,
  }))
}

type KeyEditorProps = {
  keys: KeyBindings
  onChange: (keys: KeyBindings) => void
}

const KeyEditor = ({ keys, onChange }: KeyEditorProps) => {
  const [capturing, setCapturing] = useState<SpeedAction | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!capturing) {
      return
    }

    const stop = () => {
      setCapturing(null)
      setMessage(null)
    }

    const handleKeydown = (event: KeyboardEvent) => {
      const result = captureBinding(event)

      // A modifier held on its own is the first half of a keystroke, so the
      // capture stays open and the event stays the browser's.
      if (result.status === 'pending') {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (result.status === 'cancelled') {
        stop()
        return
      }

      if (result.status === 'rejected') {
        setMessage(REJECTIONS[result.reason])
        return
      }

      const owner = bindingOwner(keys, result.binding)

      if (owner === capturing) {
        stop()
        return
      }

      // A key cannot mean two things at once, and the content script resolves
      // the actions in a fixed order, so a duplicate would silently belong to
      // whichever action is checked first.
      if (owner) {
        setMessage(
          `${formatBinding(result.binding)} is already ${ACTION_LABELS[
            owner
          ].toLowerCase()}.`,
        )
        return
      }

      onChange({ ...keys, [capturing]: [...keys[capturing], result.binding] })
      stop()
    }

    // Capture phase, so the keystroke is read before the focused button turns
    // Space or Enter into another click.
    window.addEventListener('keydown', handleKeydown, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKeydown, { capture: true })
    }
  }, [capturing, keys, onChange])

  const removeChip = (action: SpeedAction, chip: Chip) => {
    onChange({
      ...keys,
      [action]: keys[action].filter(
        binding => !chip.bindings.includes(binding),
      ),
    })
  }

  return (
    <section className="keys">
      {SPEED_ACTIONS.map(action => {
        const chips = toChips(keys[action])
        const isCapturing = capturing === action

        return (
          <div className="key-row" key={action}>
            <span className="key-action">{ACTION_LABELS[action]}</span>

            <span className="key-chips">
              {chips.map(chip => (
                <span className="chip" key={chip.label}>
                  <kbd>{chip.label}</kbd>
                  <button
                    type="button"
                    // An action with no bindings cannot be stored:
                    // `normalizeSettings` reads an empty list as a missing one
                    // and fills it from the defaults, so the key would come
                    // straight back.
                    disabled={chips.length < 2}
                    title={
                      chips.length < 2
                        ? `${ACTION_LABELS[action]} needs at least one key`
                        : `Remove ${chip.label}`
                    }
                    aria-label={`Remove ${chip.label} from ${ACTION_LABELS[action]}`}
                    onClick={() => removeChip(action, chip)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </span>

            <button
              type="button"
              className="capture"
              aria-label={`Add a key for ${ACTION_LABELS[action]}`}
              aria-pressed={isCapturing}
              onClick={() => {
                setMessage(null)
                setCapturing(current => (current === action ? null : action))
              }}
            >
              {isCapturing ? 'Press a key…' : 'Add'}
            </button>
          </div>
        )
      })}

      <p className="note" role="status">
        {message ??
          (capturing ? 'Press the key to bind, or Esc to cancel.' : '')}
      </p>

      <button
        type="button"
        className="restore"
        onClick={() => {
          setCapturing(null)
          setMessage(null)
          // Copied, not handed over: `DEFAULT_SETTINGS` is a module-level
          // object every surface reads from.
          onChange({
            increase: [...DEFAULT_SETTINGS.keys.increase],
            decrease: [...DEFAULT_SETTINGS.keys.decrease],
            reset: [...DEFAULT_SETTINGS.keys.reset],
          })
        }}
      >
        Restore default keys
      </button>
    </section>
  )
}

export default KeyEditor
