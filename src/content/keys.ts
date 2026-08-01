import type { KeyBindings, SpeedAction } from '@/shared/keys'
import { resolveAction } from '@/shared/keys'

export type KeyHandlerOptions = {
  target: EventTarget
  bindings: () => KeyBindings
  /**
   * Whether this frame has anything to control. A page with no video must never
   * lose a keystroke to the extension.
   */
  canHandle: () => boolean
  onAction: (action: SpeedAction) => void
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

const isEditableElement = (node: EventTarget): boolean => {
  if (typeof HTMLElement === 'undefined' || !(node instanceof HTMLElement)) {
    return false
  }

  if (EDITABLE_TAGS.has(node.tagName)) {
    return true
  }

  if (node.isContentEditable) {
    return true
  }

  const role = node.getAttribute('role')

  return role === 'textbox' || role === 'searchbox' || role === 'combobox'
}

/**
 * Uses the composed path rather than `event.target`: a search box inside a web
 * component is retargeted to its host, so checking the target alone would miss
 * it and the extension would eat characters the user is typing.
 */
export const isTypingTarget = (event: KeyboardEvent): boolean => {
  const path =
    typeof event.composedPath === 'function' ? event.composedPath() : []

  if (path.length > 0) {
    return path.some(isEditableElement)
  }

  return event.target !== null && isEditableElement(event.target)
}

export const createKeyHandler = ({
  target,
  bindings,
  canHandle,
  onAction,
}: KeyHandlerOptions) => {
  const handleKeydown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent

    if (isTypingTarget(keyboardEvent)) {
      return
    }

    const action = resolveAction(keyboardEvent, bindings())

    if (!action || !canHandle()) {
      return
    }

    // Both are needed to beat the site: YouTube binds `0` to "seek to start"
    // on the document, and capture-phase alone would still let it run.
    event.preventDefault()
    event.stopPropagation()

    onAction(action)
  }

  return {
    start: () => {
      // Capture phase so the extension sees the key before the page does.
      target.addEventListener('keydown', handleKeydown, {
        capture: true,
        passive: false,
      })
    },
    stop: () => {
      target.removeEventListener('keydown', handleKeydown, { capture: true })
    },
  }
}
