import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const press = (key: string, code: string) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    key,
    code,
  })

  document.body.dispatchEvent(event)

  return event
}

const loadContentScript = async () => {
  vi.resetModules()
  await import('./content-script')
}

describe('content script', () => {
  beforeEach(() => {
    document.body.append(document.createElement('video'))
  })

  // Every import leaves a script on `window`; orphan it so the next test
  // starts with only its own.
  afterEach(() => {
    Object.assign(chrome.runtime, { id: undefined })
    press('0', 'Digit0')
  })

  it('takes a bound key from the page and sends it as an intent', async () => {
    await loadContentScript()

    const event = press('0', 'Digit0')

    expect(event.defaultPrevented).toBe(true)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rebobinate:intent', action: 'reset' }),
      expect.any(Function),
    )
  })

  describe('once the extension context is invalidated', () => {
    it('hands the key back to the page and removes its listeners', async () => {
      await loadContentScript()
      const removeListener = vi.spyOn(window, 'removeEventListener')
      vi.mocked(chrome.runtime.sendMessage).mockClear()

      Object.assign(chrome.runtime, { id: undefined })
      const event = press('0', 'Digit0')

      expect(event.defaultPrevented).toBe(false)
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
      expect(removeListener).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function),
        { capture: true },
      )

      // Even were the runtime to answer again, nothing is listening.
      Object.assign(chrome.runtime, { id: 'rebobinate-test' })
      expect(press('0', 'Digit0').defaultPrevented).toBe(false)
    })

    it('tears down when a send throws instead of letting it escape', async () => {
      await loadContentScript()
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => {
        throw new Error('Extension context invalidated.')
      })

      expect(() => press('0', 'Digit0')).not.toThrow()
      expect(press('0', 'Digit0').defaultPrevented).toBe(false)
    })
  })
})
