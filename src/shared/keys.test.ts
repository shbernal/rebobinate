import { describe, expect, it } from 'vitest'
import type { KeyEventLike } from './keys'
import {
  bindingOwner,
  captureBinding,
  formatBinding,
  resolveAction,
} from './keys'
import { DEFAULT_SETTINGS } from './settings'

const keys = DEFAULT_SETTINGS.keys

const event = (overrides: Partial<KeyEventLike>): KeyEventLike => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...overrides,
})

describe('resolveAction', () => {
  it('increases on every way of typing plus', () => {
    expect(resolveAction(event({ key: '+', code: 'Equal' }), keys)).toBe(
      'increase',
    )
    expect(resolveAction(event({ key: '=', code: 'Equal' }), keys)).toBe(
      'increase',
    )
    expect(resolveAction(event({ key: '+', code: 'NumpadAdd' }), keys)).toBe(
      'increase',
    )
    // AZERTY: `+` is Shift+`=` on a different physical key, so only `key`
    // matches here.
    expect(resolveAction(event({ key: '+', code: 'BracketRight' }), keys)).toBe(
      'increase',
    )
  })

  it('decreases on minus, including the numpad', () => {
    expect(resolveAction(event({ key: '-', code: 'Minus' }), keys)).toBe(
      'decrease',
    )
    expect(
      resolveAction(event({ key: '-', code: 'NumpadSubtract' }), keys),
    ).toBe('decrease')
  })

  it('resets on zero', () => {
    expect(resolveAction(event({ key: '0', code: 'Digit0' }), keys)).toBe(
      'reset',
    )
    expect(resolveAction(event({ key: '0', code: 'Numpad0' }), keys)).toBe(
      'reset',
    )
  })

  it('ignores unrelated keys', () => {
    expect(resolveAction(event({ key: 'k', code: 'KeyK' }), keys)).toBeNull()
    expect(resolveAction(event({ key: '1', code: 'Digit1' }), keys)).toBeNull()
  })

  it('leaves modified keystrokes to the browser', () => {
    expect(
      resolveAction(event({ key: '0', code: 'Digit0', ctrlKey: true }), keys),
    ).toBeNull()
    expect(
      resolveAction(event({ key: '-', code: 'Minus', metaKey: true }), keys),
    ).toBeNull()
    expect(
      resolveAction(event({ key: '+', code: 'Equal', altKey: true }), keys),
    ).toBeNull()
  })

  it('leaves IME composition alone', () => {
    expect(
      resolveAction(
        event({ key: '0', code: 'Digit0', isComposing: true }),
        keys,
      ),
    ).toBeNull()
  })

  it('follows custom bindings', () => {
    const custom = { increase: ['>'], decrease: ['<'], reset: ['r'] }

    expect(resolveAction(event({ key: '>', code: 'Period' }), custom)).toBe(
      'increase',
    )
    expect(resolveAction(event({ key: '+', code: 'Equal' }), custom)).toBeNull()
  })
})

describe('bindingOwner', () => {
  it('finds the action a key is already bound to', () => {
    expect(bindingOwner(keys, 'Numpad0')).toBe('reset')
    expect(bindingOwner(keys, 'k')).toBeNull()
  })
})

describe('captureBinding', () => {
  it('stores what the user sees on the key cap', () => {
    expect(captureBinding(event({ key: ']', code: 'BracketRight' }))).toEqual({
      status: 'bound',
      binding: ']',
    })
  })

  // The numpad is the one place `key` cannot answer: its `0` is the same `0`
  // as the digit row's, so binding one would bind both.
  it('stores the numpad by its code', () => {
    expect(captureBinding(event({ key: '0', code: 'Numpad0' }))).toEqual({
      status: 'bound',
      binding: 'Numpad0',
    })
  })

  it('keeps listening while only a modifier is held', () => {
    expect(captureBinding(event({ key: 'Shift', code: 'ShiftLeft' }))).toEqual({
      status: 'pending',
    })
  })

  // `resolveAction` hands modified keystrokes back to the browser, so binding
  // one would produce a key that silently never fires.
  it('refuses a modified keystroke', () => {
    expect(
      captureBinding(event({ key: 'k', code: 'KeyK', ctrlKey: true })),
    ).toEqual({ status: 'rejected', reason: 'modified' })
  })

  it('cancels on Escape and refuses Tab', () => {
    expect(captureBinding(event({ key: 'Escape', code: 'Escape' }))).toEqual({
      status: 'cancelled',
    })
    expect(captureBinding(event({ key: 'Tab', code: 'Tab' }))).toEqual({
      status: 'rejected',
      reason: 'reserved',
    })
  })
})

describe('formatBinding', () => {
  // The defaults hold both forms of one key on purpose, and the popup groups
  // the chips by label — so the two forms have to format the same.
  it('gives the two forms of a key the same label', () => {
    expect(formatBinding('=')).toBe(formatBinding('Equal'))
    expect(formatBinding('-')).toBe(formatBinding('Minus'))
    expect(formatBinding('0')).toBe(formatBinding('Digit0'))
  })

  it('marks the numpad apart from the key it shares a character with', () => {
    expect(formatBinding('NumpadAdd')).toBe('Num +')
    expect(formatBinding('Numpad0')).toBe('Num 0')
  })

  it('spells out the keys that have no printable form', () => {
    expect(formatBinding(' ')).toBe('Space')
    expect(formatBinding('ArrowUp')).toBe('↑')
  })

  it('passes an unknown token through unchanged', () => {
    expect(formatBinding('F7')).toBe('F7')
  })
})
