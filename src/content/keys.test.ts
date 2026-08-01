import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import { createKeyHandler, isTypingTarget } from './keys'

const press = (
  target: EventTarget,
  init: KeyboardEventInit & { key: string; code: string },
) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  })

  target.dispatchEvent(event)

  return event
}

const mount = (options?: { canHandle?: boolean }) => {
  const onAction = vi.fn()
  const handler = createKeyHandler({
    target: window,
    bindings: () => DEFAULT_SETTINGS.keys,
    canHandle: () => options?.canHandle ?? true,
    onAction,
  })

  handler.start()

  return { onAction, handler }
}

describe('createKeyHandler', () => {
  it('maps the three controls to their actions', () => {
    const { onAction, handler } = mount()

    press(document.body, { key: '+', code: 'Equal' })
    press(document.body, { key: '-', code: 'Minus' })
    press(document.body, { key: '0', code: 'Digit0' })

    expect(onAction.mock.calls.map(call => call[0])).toEqual([
      'increase',
      'decrease',
      'reset',
    ])

    handler.stop()
  })

  it('stops the page from also acting on a key it handled', () => {
    const { handler } = mount()
    const siteHandler = vi.fn()
    document.addEventListener('keydown', siteHandler)

    const event = press(document.body, { key: '0', code: 'Digit0' })

    expect(event.defaultPrevented).toBe(true)
    expect(siteHandler).not.toHaveBeenCalled()

    document.removeEventListener('keydown', siteHandler)
    handler.stop()
  })

  it('leaves keys alone when the frame has no video', () => {
    const { onAction, handler } = mount({ canHandle: false })

    const event = press(document.body, { key: '+', code: 'Equal' })

    expect(onAction).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)

    handler.stop()
  })

  it('never steals a keystroke aimed at a text field', () => {
    const { onAction, handler } = mount()
    const input = document.createElement('input')
    document.body.append(input)

    const event = press(input, { key: '0', code: 'Digit0' })

    expect(onAction).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)

    handler.stop()
  })

  it('stops listening after stop()', () => {
    const { onAction, handler } = mount()
    handler.stop()

    press(document.body, { key: '+', code: 'Equal' })

    expect(onAction).not.toHaveBeenCalled()
  })
})

describe('isTypingTarget', () => {
  const dispatchFrom = (target: EventTarget) => {
    let seen = false
    const listener = (event: Event) => {
      seen = isTypingTarget(event as KeyboardEvent)
    }

    window.addEventListener('keydown', listener, { capture: true })
    press(target, { key: '0', code: 'Digit0' })
    window.removeEventListener('keydown', listener, { capture: true })

    return seen
  }

  it('detects form fields', () => {
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    expect(dispatchFrom(textarea)).toBe(true)
  })

  it('detects contenteditable regions', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    // jsdom does not implement `isContentEditable` from the attribute.
    Object.defineProperty(editor, 'isContentEditable', { value: true })
    document.body.append(editor)

    expect(dispatchFrom(editor)).toBe(true)
  })

  it('detects a widget that only declares a textbox role', () => {
    const combobox = document.createElement('div')
    combobox.setAttribute('role', 'searchbox')
    document.body.append(combobox)

    expect(dispatchFrom(combobox)).toBe(true)
  })

  it('sees an input hidden inside a shadow root, which retargets the event', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    shadow.append(input)

    // `event.target` is the host by the time this reaches the window; only the
    // composed path still shows the real field.
    expect(dispatchFrom(input)).toBe(true)
  })

  it('lets a plain page element through', () => {
    const div = document.createElement('div')
    document.body.append(div)

    expect(dispatchFrom(div)).toBe(false)
  })
})
