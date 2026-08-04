import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import type { DomainMemory } from '@/shared/domains'
import { DOMAINS_SCHEMA_VERSION, DOMAINS_STORAGE_KEY } from '@/shared/domains'
import type { Settings } from '@/shared/settings'
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '@/shared/settings'

type Sender = chrome.runtime.MessageSender

const TAB: Sender = { tab: { id: 7 } as chrome.tabs.Tab, frameId: 0 }
const SUBFRAME: Sender = { tab: { id: 7 } as chrome.tabs.Tab, frameId: 3 }
const POPUP: Sender = {}

const WATCH_URL = 'https://www.youtube.com/watch?v=1'

/** A frame of a tab that is actually on a site, with a URL to key on. */
const onSite = ({
  url = WATCH_URL,
  frameId = 0,
  incognito = false,
  frameUrl,
}: {
  url?: string
  frameId?: number
  incognito?: boolean
  /** The frame's own URL, when it is not the tab's — an embedded player. */
  frameUrl?: string
} = {}): Sender =>
  ({
    tab: { id: 7, url, incognito } as chrome.tabs.Tab,
    frameId,
    url: frameUrl ?? url,
  }) as Sender

const seedSettings = (patch: Partial<Settings> = {}) => {
  getChromeMock().storage.local.seed({
    [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, ...patch },
  })
}

/**
 * Seeded as it would be found in storage, which is why the entries are partial:
 * every read goes through `normalizeDomains`, and a marker carries no speed.
 */
const seedDomains = (
  entries: Record<
    string,
    { speed?: number; updatedAt: number; never?: boolean }
  >,
) => {
  getChromeMock().storage.local.seed({
    [DOMAINS_STORAGE_KEY]: { schemaVersion: DOMAINS_SCHEMA_VERSION, entries },
  })
}

const storedDomains = (): Record<string, DomainMemory> => {
  const stored = getChromeMock().storage.local.snapshot()[DOMAINS_STORAGE_KEY]

  return (stored as { entries?: Record<string, DomainMemory> })?.entries ?? {}
}

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
    expect(response).toHaveBeenCalledWith({
      speed: 1,
      hasVideo: false,
      domain: null,
    })
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

  it('starts the frame bookkeeping over when the top frame navigates', async () => {
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

describe('the speed a page starts at', () => {
  beforeEach(() => {
    seedSettings()
  })

  it('is the speed remembered for the tab domain', async () => {
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    const { send } = await loadBackground()

    const response = send({ type: 'rebobinate:query' }, onSite())

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 1.5 }),
    )
  })

  it('is shared between the subdomains of one site', async () => {
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    const { send } = await loadBackground()

    const response = send(
      { type: 'rebobinate:query' },
      onSite({ url: 'https://m.youtube.com/watch?v=2' }),
    )

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 1.5 }),
    )
  })

  it('follows the top frame for an embedded player', async () => {
    // A YouTube embed on a blog takes the blog's setting: the domain a page
    // counts as is the one in the address bar, not the one in the iframe.
    seedDomains({
      'blog.example': { speed: 1.75, updatedAt: 1 },
      'youtube.com': { speed: 3, updatedAt: 1 },
    })
    const { send } = await loadBackground()

    const response = send(
      { type: 'rebobinate:query' },
      onSite({
        url: 'https://blog.example/post',
        frameId: 3,
        frameUrl: 'https://www.youtube.com/embed/abc',
      }),
    )

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 1.75 }),
    )
  })

  it('is the chosen default for a domain never seen before', async () => {
    seedSettings({ defaultSpeed: 1.25 })
    const { send } = await loadBackground()

    const response = send({ type: 'rebobinate:query' }, onSite())

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 1.25 }),
    )
  })

  it('ignores what is remembered while the toggle is off', async () => {
    seedSettings({ rememberPerDomain: false })
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    const { send } = await loadBackground()

    const response = send({ type: 'rebobinate:query' }, onSite())

    expect(response).toHaveBeenCalledWith(expect.objectContaining({ speed: 1 }))
  })

  it('stays inside the user range', async () => {
    seedSettings({ maxSpeed: 1.2 })
    seedDomains({ 'youtube.com': { speed: 4, updatedAt: 1 } })
    const { send } = await loadBackground()

    const response = send({ type: 'rebobinate:query' }, onSite())

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 1.2 }),
    )
  })
})

describe('remembering the speed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    seedSettings({ step: 0.5 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes once after a ramp, not once per keystroke', async () => {
    const { send, chromeMock } = await loadBackground()

    for (let press = 0; press < 4; press += 1) {
      send(
        { type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 },
        onSite(),
      )
    }

    // Nothing yet: the user may not have stopped pressing.
    expect(storedDomains()['youtube.com']).toBeUndefined()

    vi.advanceTimersByTime(1000)

    expect(storedDomains()['youtube.com'].speed).toBe(3)
    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1)
  })

  it('records a speed set straight from the popup', async () => {
    getChromeMock().tabs.seed([{ id: 1, url: WATCH_URL, incognito: false }])
    const { send } = await loadBackground()

    send({ type: 'rebobinate:set', speed: 2 }, POPUP)
    vi.advanceTimersByTime(1000)

    expect(storedDomains()['youtube.com'].speed).toBe(2)
  })

  it('records a sub-frame keystroke against the tab domain', async () => {
    const { send } = await loadBackground()

    send(
      { type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 },
      onSite({
        url: 'https://blog.example/post',
        frameId: 3,
        frameUrl: 'https://www.youtube.com/embed/abc',
      }),
    )
    vi.advanceTimersByTime(1000)

    expect(Object.keys(storedDomains())).toEqual(['blog.example'])
  })

  it('forgets the site when the speed is reset', async () => {
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    const { send } = await loadBackground()

    // `0` is the "make this site normal again" gesture, so it drops the entry
    // rather than storing the default under it.
    const response = send(
      { type: 'rebobinate:intent', action: 'reset', currentSpeed: 1.5 },
      onSite(),
    )

    expect(storedDomains()['youtube.com']).toBeUndefined()
    expect(response).toHaveBeenCalledWith({ speed: 1 })
  })

  it('resets to the chosen default rather than to 1.0', async () => {
    seedSettings({ defaultSpeed: 1.5 })
    const { send } = await loadBackground()

    const response = send(
      { type: 'rebobinate:intent', action: 'reset', currentSpeed: 2 },
      onSite(),
    )

    expect(response).toHaveBeenCalledWith({ speed: 1.5 })
  })

  it('leaves no trace of a private window', async () => {
    const { send } = await loadBackground()

    send(
      { type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 },
      onSite({ incognito: true }),
    )
    vi.advanceTimersByTime(1000)

    expect(storedDomains()).toEqual({})
  })

  it('writes nothing while the toggle is off', async () => {
    seedSettings({ rememberPerDomain: false })
    const { send } = await loadBackground()

    send(
      { type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 },
      onSite(),
    )
    vi.advanceTimersByTime(1000)

    expect(storedDomains()).toEqual({})
  })

  it('writes nothing for a page that is not a site', async () => {
    const { send } = await loadBackground()

    send(
      { type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 },
      onSite({ url: 'file:///home/user/clip.mp4' }),
    )
    vi.advanceTimersByTime(1000)

    expect(storedDomains()).toEqual({})
  })
})

describe('forgetting a site from the popup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    seedSettings({ step: 0.5 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops the entry', async () => {
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    const { send } = await loadBackground()

    send({ type: 'rebobinate:forget-domain', domain: 'youtube.com' }, POPUP)

    expect(storedDomains()['youtube.com']).toBeUndefined()
  })

  it('cancels a write that was still in its debounce', async () => {
    const { send } = await loadBackground()

    send(
      { type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 },
      onSite(),
    )
    send({ type: 'rebobinate:forget-domain', domain: 'youtube.com' }, POPUP)
    vi.advanceTimersByTime(1000)

    // Without the cancel, the pending write puts the entry straight back.
    expect(storedDomains()['youtube.com']).toBeUndefined()
  })
})

describe('editing a site from the popup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    seedSettings({ step: 0.5 })
    getChromeMock().tabs.seed([{ id: 1, url: WATCH_URL, incognito: false }])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes the speed set for a domain straight away', async () => {
    const { send } = await loadBackground()

    send(
      { type: 'rebobinate:set-domain-speed', domain: 'vimeo.com', speed: 1.5 },
      POPUP,
    )

    expect(storedDomains()['vimeo.com'].speed).toBe(1.5)
  })

  // Editing the row for the site being watched and seeing nothing happen on
  // the page would read as broken.
  it('applies a speed set for the active tab domain to that tab', async () => {
    const { send, broadcasts } = await loadBackground()

    send(
      {
        type: 'rebobinate:set-domain-speed',
        domain: 'youtube.com',
        speed: 1.5,
      },
      POPUP,
    )

    expect(broadcasts()).toEqual([{ type: 'rebobinate:state', speed: 1.5 }])
  })

  it('leaves the tab alone for any other site in the list', async () => {
    const { send, broadcasts } = await loadBackground()

    send(
      { type: 'rebobinate:set-domain-speed', domain: 'vimeo.com', speed: 1.5 },
      POPUP,
    )

    expect(broadcasts()).toEqual([])
  })

  it('cancels a pending write for the domain it edits', async () => {
    const { send } = await loadBackground()

    send(
      { type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 },
      onSite(),
    )
    send(
      {
        type: 'rebobinate:set-domain-speed',
        domain: 'youtube.com',
        speed: 1.5,
      },
      POPUP,
    )
    vi.advanceTimersByTime(1000)

    expect(storedDomains()['youtube.com'].speed).toBe(1.5)
  })

  it('drops the remembered speed when a site is switched off', async () => {
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    const { send } = await loadBackground()

    send(
      {
        type: 'rebobinate:set-domain-never',
        domain: 'youtube.com',
        never: true,
      },
      POPUP,
    )

    expect(storedDomains()['youtube.com'].never).toBe(true)
    expect(storedDomains()['youtube.com'].speed).toBe(1)
  })

  it('removes the entry when a site is let back in', async () => {
    seedDomains({ 'youtube.com': { updatedAt: 1, never: true } })
    const { send } = await loadBackground()

    send(
      {
        type: 'rebobinate:set-domain-never',
        domain: 'youtube.com',
        never: false,
      },
      POPUP,
    )

    expect(storedDomains()['youtube.com']).toBeUndefined()
  })
})

describe('a site switched out of the memory', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    seedSettings({ step: 0.5, defaultSpeed: 1.25 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts at the default like a site never seen', async () => {
    seedDomains({ 'youtube.com': { speed: 2, updatedAt: 1, never: true } })
    const { send } = await loadBackground()

    const response = send({ type: 'rebobinate:query' }, onSite())

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 1.25 }),
    )
  })

  it('is not re-remembered by a keystroke on it', async () => {
    seedDomains({ 'youtube.com': { updatedAt: 1, never: true } })
    const { send } = await loadBackground()

    send(
      { type: 'rebobinate:intent', action: 'increase', currentSpeed: 1 },
      onSite(),
    )
    vi.advanceTimersByTime(1000)

    expect(storedDomains()['youtube.com'].never).toBe(true)
  })

  it('keeps its marker through a reset', async () => {
    seedDomains({ 'youtube.com': { updatedAt: 1, never: true } })
    const { send } = await loadBackground()

    send(
      { type: 'rebobinate:intent', action: 'reset', currentSpeed: 2 },
      onSite(),
    )

    expect(storedDomains()['youtube.com'].never).toBe(true)
  })
})

describe('the domain the popup shows', () => {
  beforeEach(() => {
    seedSettings()
  })

  it('is the registrable domain of the active tab', async () => {
    getChromeMock().tabs.seed([
      { id: 1, url: 'https://news.bbc.co.uk/video', incognito: false },
    ])
    const { send } = await loadBackground()

    const response = send({ type: 'rebobinate:popup-state' }, POPUP)

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'bbc.co.uk' }),
    )
  })

  it('is null on a page nothing can be remembered against', async () => {
    getChromeMock().tabs.seed([{ id: 1, url: 'about:blank', incognito: false }])
    const { send } = await loadBackground()

    const response = send({ type: 'rebobinate:popup-state' }, POPUP)

    expect(response).toHaveBeenCalledWith(
      expect.objectContaining({ domain: null }),
    )
  })
})
