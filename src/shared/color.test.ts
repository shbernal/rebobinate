import { describe, expect, it } from 'vitest'
import { hexToHsl, hslToHex, toHex } from './color'

describe('toHex', () => {
  it('passes a six-digit hex through, lowercased', () => {
    expect(toHex('#FF8800')).toBe('#ff8800')
  })

  it('expands a three-digit hex', () => {
    expect(toHex('#f80')).toBe('#ff8800')
  })

  it('reads the rgb() and rgba() forms storage still accepts', () => {
    expect(toHex('rgb(255, 136, 0)')).toBe('#ff8800')
    expect(toHex('rgba(255, 136, 0, 0.5)')).toBe('#ff8800')
  })

  it('reads percentage channels', () => {
    expect(toHex('rgb(100%, 0%, 0%)')).toBe('#ff0000')
  })

  it('falls back on anything it cannot read', () => {
    expect(toHex('rebeccapurple')).toBe('#000000')
    expect(toHex('#gggggg')).toBe('#000000')
    expect(toHex(undefined)).toBe('#000000')
    expect(toHex('', '#ffffff')).toBe('#ffffff')
  })
})

describe('hexToHsl', () => {
  it('reports a grey as unsaturated', () => {
    expect(hexToHsl('#808080')).toEqual({ h: 0, s: 0, l: 50 })
  })

  it('puts the primaries on their hue', () => {
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 100, l: 50 })
    expect(hexToHsl('#00ff00')).toEqual({ h: 120, s: 100, l: 50 })
    expect(hexToHsl('#0000ff')).toEqual({ h: 240, s: 100, l: 50 })
  })

  it('keeps the hue positive across the red wrap', () => {
    expect(hexToHsl('#ff0080').h).toBe(330)
  })
})

describe('hslToHex', () => {
  it('renders each sixth of the wheel', () => {
    expect(hslToHex({ h: 0, s: 100, l: 50 })).toBe('#ff0000')
    expect(hslToHex({ h: 60, s: 100, l: 50 })).toBe('#ffff00')
    expect(hslToHex({ h: 120, s: 100, l: 50 })).toBe('#00ff00')
    expect(hslToHex({ h: 180, s: 100, l: 50 })).toBe('#00ffff')
    expect(hslToHex({ h: 240, s: 100, l: 50 })).toBe('#0000ff')
    expect(hslToHex({ h: 300, s: 100, l: 50 })).toBe('#ff00ff')
    expect(hslToHex({ h: 360, s: 100, l: 50 })).toBe('#ff0000')
  })

  it('clamps and wraps out-of-range input', () => {
    expect(hslToHex({ h: -60, s: 999, l: 50 })).toBe('#ff00ff')
    expect(hslToHex({ h: 0, s: 100, l: -10 })).toBe('#000000')
    expect(hslToHex({ h: 0, s: 100, l: 110 })).toBe('#ffffff')
  })

  it('round-trips the picker presets to within a channel step', () => {
    for (const hex of ['#ffffff', '#000000', '#3b82f6', '#22c55e', '#eab308']) {
      const channels = (value: string) =>
        [1, 3, 5].map(at => Number.parseInt(value.slice(at, at + 2), 16))
      const before = channels(hex)
      const after = channels(hslToHex(hexToHsl(hex)))

      after.forEach((channel, index) => {
        expect(Math.abs(channel - before[index])).toBeLessThanOrEqual(3)
      })
    }
  })
})
