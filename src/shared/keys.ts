export type SpeedAction = 'increase' | 'decrease' | 'reset'

export type KeyBindings = Record<SpeedAction, string[]>

/**
 * A binding token matches either `KeyboardEvent.key` or `KeyboardEvent.code`.
 *
 * Both are needed. `key` is what the user actually typed, which is the only way
 * to catch `+` on a layout where it needs Shift; `code` is layout-independent
 * and is the only reliable way to catch the numpad keys and to keep working on
 * layouts where `+` is somewhere else entirely.
 */
export type KeyEventLike = {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing?: boolean
}

export const matchesBinding = (
  event: KeyEventLike,
  bindings: string[],
): boolean => {
  return bindings.some(
    binding => binding === event.key || binding === event.code,
  )
}

/**
 * Resolves a keystroke to an action, or `null` when the extension should keep
 * its hands off the event.
 */
export const resolveAction = (
  event: KeyEventLike,
  keys: KeyBindings,
): SpeedAction | null => {
  // A modified keystroke belongs to the browser or the page: Ctrl+`-` is zoom,
  // Cmd+`0` resets zoom, Alt combinations are menu accelerators.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null
  }

  // Mid-composition keystrokes belong to the IME.
  if (event.isComposing) {
    return null
  }

  if (matchesBinding(event, keys.increase)) {
    return 'increase'
  }

  if (matchesBinding(event, keys.decrease)) {
    return 'decrease'
  }

  if (matchesBinding(event, keys.reset)) {
    return 'reset'
  }

  return null
}
