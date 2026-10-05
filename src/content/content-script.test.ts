import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import { SETTINGS_STORAGE_KEY } from '@/shared/settings'

// The real badge, with its `flash` recorded: what the script asks the badge to
// say is the contract, and the badge has tests of its own for the drawing.
const flashes = vi.hoisted(() => vi.fn())

vi.mock('./badge', async importOriginal => {
  const actual = await importOriginal<typeof import('./badge')>()

  return {
    ...actual,
    createBadge: (options: Parameters<typeof actual.createBadge>[0]) => {
      const badge = actual.createBadge(options)

      return {
        ...badge,
        flash: (...args: Parameters<typeof badge.flash>) => {
          flashes(...args)
          badge.flash(...args)
        },
      }
    },
  }
})

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

const sentOfType = (type: string) =>
  vi
    .mocked(chrome.runtime.sendMessage)
    .mock.calls.map(([message]) => message as unknown as { type: string })
    .filter(message => message.type === type)

/** Has the service worker answer the start-up query with `speed`. */
const answerQuery = (speed: number) => {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    message: { type: string },
    callback?: (response?: unknown) => void,
  ) => {
    callback?.(message.type === 'rebobinate:query' ? { speed } : undefined)
  }) as typeof chrome.runtime.sendMessage)
}

const fromWorker = (message: unknown) =>
  getChromeMock().runtime.onMessage.emit(
    message,
    {} as chrome.runtime.MessageSender,
    () => {},
  )

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

  beforeEach(() => {
    flashes.mockClear()
  })

  // `<all_urls>` includes documents that are not pages at all.
  it('installs nothing on an XML document', async () => {
    vi.spyOn(document, 'contentType', 'get').mockReturnValue('text/xml')
    await loadContentScript()

    expect(press('0', 'Digit0').defaultPrevented).toBe(false)
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('reports that the frame holds a video once, not on every video', async () => {
    await loadContentScript()
    expect(sentOfType('rebobinate:media')).toEqual([
      { type: 'rebobinate:media', hasVideo: true },
    ])

    document.body.append(document.createElement('video'))
    // The observer answers on a microtask; let it.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(sentOfType('rebobinate:media')).toHaveLength(1)
  })

  // The tab-level answer says no frame has a video while this one holds one,
  // so the earlier report was lost.
  it('reports again when the tab contradicts what the frame holds', async () => {
    await loadContentScript()

    fromWorker({ type: 'rebobinate:tab-media', hasVideo: false })

    expect(sentOfType('rebobinate:media')).toEqual([
      { type: 'rebobinate:media', hasVideo: true },
      { type: 'rebobinate:media', hasVideo: true },
    ])
  })

  it('announces a speed it was not asked for once per frame', async () => {
    answerQuery(1.5)
    await loadContentScript()
    expect(flashes).toHaveBeenCalledTimes(1)
    expect(flashes.mock.calls[0][0]).toBe(1.5)

    const recycled = document.createElement('video')
    document.body.append(recycled)
    await vi.waitFor(() => expect(recycled.playbackRate).toBe(1.5))

    expect(flashes).toHaveBeenCalledTimes(1)
  })

  it('announces nothing at normal speed', async () => {
    answerQuery(1)
    await loadContentScript()

    expect(flashes).not.toHaveBeenCalled()
  })

  // The master switch off means nothing is speeding the video up, so the badge
  // must not draw a promise about it.
  it('reports the badge off while the extension is off', async () => {
    getChromeMock().storage.local.seed({
      [SETTINGS_STORAGE_KEY]: { enabled: false },
    })
    await loadContentScript()

    fromWorker({ type: 'rebobinate:state', speed: 1.5 })

    expect(flashes).toHaveBeenLastCalledWith(
      1.5,
      expect.objectContaining({ enabled: false }),
      false,
    )
  })

  it('flashes even when a key lands on the speed it is already at', async () => {
    await loadContentScript()

    fromWorker({ type: 'rebobinate:state', speed: 1 })

    expect(flashes).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ enabled: true }),
      false,
    )
  })

  it('puts videos back to normal when the extension is switched off', async () => {
    await loadContentScript()
    fromWorker({ type: 'rebobinate:state', speed: 2 })
    const video = document.querySelector('video') as HTMLVideoElement
    expect(video.playbackRate).toBe(2)

    getChromeMock().storage.local.set({
      [SETTINGS_STORAGE_KEY]: { enabled: false },
    })

    expect(video.playbackRate).toBe(1)
  })

  it('says so when the site wins the rate back, until a speed is set', async () => {
    await loadContentScript()
    fromWorker({ type: 'rebobinate:state', speed: 2 })
    const video = document.querySelector('video') as HTMLVideoElement

    // A site rewriting the rate in a loop, faster than the enforcer will chase.
    for (let i = 0; i < 20; i += 1) {
      video.playbackRate = 1
      video.dispatchEvent(new Event('ratechange'))
    }

    expect(flashes).toHaveBeenLastCalledWith(2, expect.anything(), true)

    fromWorker({ type: 'rebobinate:state', speed: 1.5 })

    expect(flashes).toHaveBeenLastCalledWith(1.5, expect.anything(), false)
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
