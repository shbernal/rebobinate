export type SpeedAction = 'increase' | 'decrease' | 'reset'

export const SPEED_ACTIONS: SpeedAction[] = ['increase', 'decrease', 'reset']

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

/** Which action already holds a token, so the popup can refuse a duplicate. */
export const bindingOwner = (
  keys: KeyBindings,
  binding: string,
): SpeedAction | null => {
  return SPEED_ACTIONS.find(action => keys[action].includes(binding)) ?? null
}

/**
 * Keys that only ever appear as part of another keystroke. Held on their own
 * they are not a binding, and the popup keeps listening rather than treating
 * them as the answer.
 */
const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'CapsLock',
  'Dead',
])

/**
 * `Escape` closes the capture, and `Tab` is how a keyboard user reaches the
 * rest of the popup — binding it would trap them in the row they are editing.
 */
const RESERVED_KEYS = new Set(['Escape', 'Tab'])

export type BindingCapture =
  | { status: 'bound'; binding: string }
  | { status: 'cancelled' }
  | { status: 'pending' }
  | { status: 'rejected'; reason: 'modified' | 'reserved' }

/**
 * The one token a captured keystroke is stored as.
 *
 * A binding matches `key` or `code`, and which of the two to write down depends
 * on the key. The numpad is only distinguishable by `code` — its `key` is the
 * same `0` as the digit row — so it is stored that way. Everything else is
 * stored as `key`, which is the character the user actually sees on the cap:
 * storing `Semicolon` would bind whatever that physical key types on another
 * layout, which is not what somebody who pressed `;` asked for.
 */
export const bindingToken = (event: KeyEventLike): string => {
  if (event.code.startsWith('Numpad')) {
    return event.code
  }

  if (event.key && event.key !== 'Unidentified') {
    return event.key
  }

  return event.code
}

/**
 * Turns a keystroke pressed into the popup's capture field into an outcome.
 *
 * The rules follow `resolveAction`: a keystroke the matcher would never accept
 * must not be offered as a binding. A modified one is the case that matters —
 * `Ctrl`+`-` is the browser's zoom and the content script deliberately lets it
 * through, so binding it would produce a key that silently never fires.
 */
export const captureBinding = (event: KeyEventLike): BindingCapture => {
  if (MODIFIER_KEYS.has(event.key)) {
    return { status: 'pending' }
  }

  if (event.key === 'Escape') {
    return { status: 'cancelled' }
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return { status: 'rejected', reason: 'modified' }
  }

  if (RESERVED_KEYS.has(event.key)) {
    return { status: 'rejected', reason: 'reserved' }
  }

  return { status: 'bound', binding: bindingToken(event) }
}

const NUMPAD_LABELS: Record<string, string> = {
  Add: '+',
  Subtract: '-',
  Multiply: '*',
  Divide: '/',
  Decimal: '.',
  Enter: '⏎',
}

const BINDING_LABELS: Record<string, string> = {
  ' ': 'Space',
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '⏎',
  Backspace: '⌫',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
}

/**
 * A binding as the popup shows it.
 *
 * The defaults hold both forms of the same key on purpose — `=` catches the
 * character and `Equal` catches the physical key on a layout that puts it
 * elsewhere — and printing both would show the user two chips for one key. They
 * format to the same label, and the popup groups by label.
 */
export const formatBinding = (binding: string): string => {
  const label = BINDING_LABELS[binding]

  if (label) {
    return label
  }

  if (binding.startsWith('Numpad')) {
    const suffix = binding.slice('Numpad'.length)

    return `Num ${NUMPAD_LABELS[suffix] ?? suffix}`
  }

  if (/^Key[A-Z]$/.test(binding)) {
    return binding.slice('Key'.length)
  }

  if (/^Digit\d$/.test(binding)) {
    return binding.slice('Digit'.length)
  }

  return binding
}
