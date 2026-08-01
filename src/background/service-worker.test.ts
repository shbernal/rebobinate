import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import { SETTINGS_STORAGE_KEY } from '@/shared/settings'

type Sender = chrome.runtime.MessageSender

const TAB: Sender = { tab: { id: 7 } as chrome.tabs.Tab, frameId: 0 }
const SUBFRAME: Sender = { tab: { id: 7 } as chrome.tabs.Tab, frameId: 3 }
const POPUP: Sender = {}

const loadBackground = async () => {
  vi.resetModules()
  await import('./service-worker')

  const chromeMock = getChromeMock()

  return {
    chromeMock,
    send: (message: unknown, sender: Sender = TAB) => {
      const response = vi.fn()
      chromeMock.runtime.onMessage.emit(message, sender, response)
      return response
    },
    broadcasts: () =>
      chromeMock.tabs.sendMessage.mock.calls.map(call => call[1]),
  }
}

describe('background speed relay', () => {
  beforeEach(() => {
    getChromeMock().storage.local.seed({
      [SETTINGS_STORAGE_KEY]: { step: 0.05 },
    })
  })

  it('steps up from normal speed and tells every frame', async () => {
    const { send, broadcasts } = await loadBackground()

    const response = send({
      type: 'rebobinate:intent',
      action: 'increase',
      currentSpeed: 1,
    })

    expect(response).toHaveBeenCalledWith({ speed: 1.05 })
    expect(broadcasts()).toEqual([{ type: 'rebobinate:state', speed: 1.05 }])
  })

  it('accumulates across keystrokes from different frames of the same tab', async () => {
    const { send } = await loadBackground()

    send({ type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 })
    const response = send(
      { type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 },
      SUBFRAME,
    )

    expect(response).toHaveBeenCalledWith({ speed: 1.1 })
  })

  it('resumes from the sender when the service worker lost its state', async () => {
    const { send } = await loadBackground()

    // No prior intent for this tab: the frame's own speed is the only truth.
    const response = send({
      type: 'rebobinate:intent',
      action: 'increase',
      currentSpeed: 2,
    })

    expect(response).toHaveBeenCalledWith({ speed: 2.05 })
  })

  it('resets to normal speed', async () => {
    const { send } = await loadBackground()

    send({ type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 })
    const response = send({
      type: 'rebobinate:intent',
      action: 'reset',
      currentSpeed: 1.05,
    })

    expect(response).toHaveBeenCalledWith({ speed: 1 })
  })

  it('honours a custom step', async () => {
    getChromeMock().storage.local.seed({
      [SETTINGS_STORAGE_KEY]: { step: 0.25 },
    })
    const { send } = await loadBackground()

    const response = send({
      type: 'rebobinate:intent',
      action: 'increase',
      currentSpeed: 1,
    })

    expect(response).toHaveBeenCalledWith({ speed: 1.25 })
  })

  it('clamps a speed set directly', async () => {
    const { send } = await loadBackground()

    const response = send({ type: 'rebobinate:set', speed: 99 })

    expect(response).toHaveBeenCalledWith({ speed: 16 })
  })

  it('hands a new sub-frame the speed the tab is already at', async () => {
    const { send } = await loadBackground()

    send({ type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 })
    const response = send({ type: 'rebobinate:query' }, SUBFRAME)

    expect(response).toHaveBeenCalledWith({ speed: 1.05, hasVideo: false })
  })

  it('starts over when the top frame navigates', async () => {
    const { send } = await loadBackground()

    send({ type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 })
    const response = send({ type: 'rebobinate:query' }, TAB)

    expect(response).toHaveBeenCalledWith({ speed: 1, hasVideo: false })
  })

  it('answers the popup for the active tab', async () => {
    const { send, chromeMock } = await loadBackground()

    send({ type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 })
    // The mock resolves the active tab to id 1, not the tab used above.
    const response = send({ type: 'rebobinate:popup-state' }, POPUP)

    expect(chromeMock.tabs.query).toHaveBeenCalled()
    expect(response).toHaveBeenCalledWith({ speed: 1, hasVideo: false })
  })

  it('ignores messages that are not ours', async () => {
    const { send, broadcasts } = await loadBackground()

    send({ type: 'something-else' })

    expect(broadcasts()).toEqual([])
  })

  it('forgets a tab when it closes', async () => {
    const { send, chromeMock } = await loadBackground()

    send({ type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 })
    chromeMock.tabs.onRemoved.emit(7, {} as chrome.tabs.OnRemovedInfo)

    const response = send({ type: 'rebobinate:query' }, SUBFRAME)

    expect(response).toHaveBeenCalledWith({ speed: 1, hasVideo: false })
  })
})

describe('tab media tracking', () => {
  it('tells every frame once the tab has a video somewhere', async () => {
    const { send, broadcasts } = await loadBackground()

    send({ type: 'rebobinate:media', hasVideo: true }, SUBFRAME)

    expect(broadcasts()).toEqual([
      { type: 'rebobinate:tab-media', hasVideo: true },
    ])
  })

  it('only announces the transitions, not every report', async () => {
    const { send, broadcasts } = await loadBackground()

    send({ type: 'rebobinate:media', hasVideo: true }, SUBFRAME)
    send({ type: 'rebobinate:media', hasVideo: true }, TAB)

    expect(broadcasts()).toHaveLength(1)
  })

  it('announces the tab losing its last video', async () => {
    const { send, broadcasts } = await loadBackground()

    send({ type: 'rebobinate:media', hasVideo: true }, SUBFRAME)
    send({ type: 'rebobinate:media', hasVideo: false }, SUBFRAME)

    expect(broadcasts()).toEqual([
      { type: 'rebobinate:tab-media', hasVideo: true },
      { type: 'rebobinate:tab-media', hasVideo: false },
    ])
  })

  it('keeps the tab flagged while another frame still has a video', async () => {
    const { send, broadcasts } = await loadBackground()

    send({ type: 'rebobinate:media', hasVideo: true }, SUBFRAME)
    send({ type: 'rebobinate:media', hasVideo: true }, TAB)
    send({ type: 'rebobinate:media', hasVideo: false }, SUBFRAME)

    expect(broadcasts()).toHaveLength(1)
  })

  it('reports the tab state to a frame that arrives late', async () => {
    const { send } = await loadBackground()

    send({ type: 'rebobinate:media', hasVideo: true }, TAB)
    const response = send({ type: 'rebobinate:query' }, SUBFRAME)

    expect(response).toHaveBeenCalledWith({ speed: 1, hasVideo: true })
  })

  it('starts the bookkeeping over when the top frame navigates', async () => {
    const { send } = await loadBackground()

    send({ type: 'rebobinate:media', hasVideo: true }, SUBFRAME)
    send({ type: 'rebobinate:query' }, TAB)
    const response = send({ type: 'rebobinate:query' }, SUBFRAME)

    expect(response).toHaveBeenCalledWith({ speed: 1, hasVideo: false })
  })

  it('asks frames to report again after that reset', async () => {
    const { send, broadcasts } = await loadBackground()

    send({ type: 'rebobinate:media', hasVideo: true }, SUBFRAME)
    send({ type: 'rebobinate:query' }, TAB)

    // A sub-frame that loaded before the top frame had its report discarded,
    // so the reset has to invite it to say so again.
    const last = broadcasts()[broadcasts().length - 1]

    expect(last).toEqual({
      type: 'rebobinate:tab-media',
      hasVideo: false,
    })
  })
})
