import { describe, expect, it } from 'vitest'
import type { KeyEventLike } from './keys'
import { resolveAction } from './keys'
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
