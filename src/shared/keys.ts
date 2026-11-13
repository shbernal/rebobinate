/** The actions that change the tab-wide speed, resolved by the service worker. */
export type SpeedAction = 'increase' | 'decrease' | 'reset'

/** The actions that move the video by `seekSeconds`. */
export type SeekAction = 'seekBack' | 'seekForward'

export type Action = SpeedAction | SeekAction

/** Every bindable action, in the order the popup lists them. */
export const ACTIONS: Action[] = [
  'increase',
  'decrease',
  'reset',
  'seekBack',
  'seekForward',
]

export const isSeekAction = (action: Action): action is SeekAction =>
  action === 'seekBack' || action === 'seekForward'

export type KeyBindings = Record<Action, string[]>

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

const matchesBinding = (event: KeyEventLike, bindings: string[]): boolean => {
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
): Action | null => {
  // A modified keystroke belongs to the browser or the page: Ctrl+`-` is zoom,
  // Cmd+`0` resets zoom, Alt combinations are menu accelerators.
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return null
  }

  // Mid-composition keystrokes belong to the IME.
  if (event.isComposing) {
    return null
  }

  return ACTIONS.find(action => matchesBinding(event, keys[action])) ?? null
}

/** Which action already holds a token, so the popup can refuse a duplicate. */
export const bindingOwner = (
  keys: KeyBindings,
  binding: string,
): Action | null => {
  return ACTIONS.find(action => keys[action].includes(binding)) ?? null
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
 * `Escape` closes the capture and swallows the keystroke. `Tab` closes it and
 * leaves the keystroke to the browser: it is how a keyboard user reaches the
 * rest of the popup, so binding or refusing it would trap them in the row.
 */
export type BindingCapture =
  | { status: 'bound'; binding: string }
  | { status: 'cancelled' }
  | { status: 'released' }
  | { status: 'pending' }
  | { status: 'rejected'; reason: 'modified' }

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
const bindingToken = (event: KeyEventLike): string => {
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

  if (event.key === 'Tab') {
    return { status: 'released' }
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return { status: 'rejected', reason: 'modified' }
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
