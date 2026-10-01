import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMediaRegistry } from './media'

const stubRect = (
  video: HTMLVideoElement,
  rect: { width: number; height: number; top?: number; left?: number },
) => {
  const top = rect.top ?? 0
  const left = rect.left ?? 0

  video.getBoundingClientRect = () =>
    ({
      width: rect.width,
      height: rect.height,
      top,
      left,
      right: left + rect.width,
      bottom: top + rect.height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect
}

describe('createMediaRegistry', () => {
  let registry: ReturnType<typeof createMediaRegistry> | null = null
  let added: HTMLVideoElement[] = []
  let events: string[] = []

  const start = () => {
    added = []
    events = []
    registry = createMediaRegistry({
      document,
      onAdd: video => added.push(video),
      onMediaEvent: (_video, eventName) => events.push(eventName),
    })
    registry.start()

    return registry
  }

  beforeEach(() => {
    vi.useFakeTimers()
    window.innerWidth = 1000
    window.innerHeight = 800
  })

  afterEach(() => {
    registry?.stop()
    registry = null
    vi.useRealTimers()
  })

  it('finds videos already in the document', () => {
    const video = document.createElement('video')
    document.body.append(video)

    const media = start()

    expect(media.videos()).toEqual([video])
    expect(added).toEqual([video])
  })

  it('finds videos added later', async () => {
    const media = start()
    const video = document.createElement('video')
    document.body.append(video)

    await vi.waitFor(() => expect(media.videos()).toEqual([video]))
  })

  it('finds a video added inside a subtree', async () => {
    const media = start()
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<section><video></video></section>'
    document.body.append(wrapper)

    await vi.waitFor(() => expect(media.videos()).toHaveLength(1))
  })

  it('finds a video inside an open shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const video = document.createElement('video')
    shadow.append(video)

    const media = start()

    expect(media.videos()).toEqual([video])
  })

  it('reports media events on registered videos', () => {
    const video = document.createElement('video')
    document.body.append(video)
    start()

    video.dispatchEvent(new Event('ratechange'))

    expect(events).toContain('ratechange')
  })

  it('registers a video from its media event before the observer runs', () => {
    const media = start()
    const video = document.createElement('video')
    document.body.append(video)

    // Mutation records are delivered in a microtask, so a player that starts
    // playing in the same tick is known through its event first.
    video.dispatchEvent(new Event('play'))

    expect(added).toEqual([video])
    expect(media.videos()).toEqual([video])
  })

  it('drops videos once they leave the page', () => {
    const video = document.createElement('video')
    document.body.append(video)
    const media = start()

    expect(media.videos()).toHaveLength(1)

    video.remove()

    expect(media.videos()).toHaveLength(0)
  })

  it('picks the largest visible video as the primary one', () => {
    const small = document.createElement('video')
    const large = document.createElement('video')
    document.body.append(small, large)
    stubRect(small, { width: 100, height: 100 })
    stubRect(large, { width: 600, height: 400 })

    const media = start()

    expect(media.primary()).toBe(large)
  })

  it('prefers a playing video over a bigger paused one', () => {
    const playing = document.createElement('video')
    const paused = document.createElement('video')
    document.body.append(playing, paused)
    stubRect(playing, { width: 400, height: 300 })
    stubRect(paused, { width: 500, height: 400 })
    Object.defineProperty(playing, 'paused', { value: false })

    const media = start()

    expect(media.primary()).toBe(playing)
  })

  it('has no primary video when the page has none', () => {
    expect(start().primary()).toBeNull()
  })

  it('finds a video in a shadow root that arrives with its host', async () => {
    const media = start()
    const host = document.createElement('div')
    const video = document.createElement('video')
    host.attachShadow({ mode: 'open' }).append(video)
    document.body.append(host)

    await vi.advanceTimersByTimeAsync(250)

    expect(media.videos()).toEqual([video])
  })

  // No mutation of the light DOM reports a root attached to an element that is
  // already in the page; only the full walk can find it.
  it('finds a shadow root attached later, on the next full walk', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const media = start()
    const video = document.createElement('video')
    host.attachShadow({ mode: 'open' }).append(video)

    // Something on the page keeps changing, which is what wakes the walk.
    for (let elapsed = 0; elapsed <= 5000; elapsed += 250) {
      document.body.append(document.createElement('span'))
      await vi.advanceTimersByTimeAsync(250)
    }

    expect(media.videos()).toEqual([video])
  })

  it('walks the whole frame at most every few seconds on a busy page', async () => {
    document.body.innerHTML = '<div><p></p></div>'.repeat(200)
    start()
    const walk = vi.spyOn(document, 'querySelectorAll')

    for (let elapsed = 0; elapsed < 10_000; elapsed += 50) {
      document.body.append(document.createElement('span'))
      await vi.advanceTimersByTimeAsync(50)
    }

    const fullWalks = walk.mock.calls.filter(([selector]) => selector === '*')
    expect(fullWalks.length).toBeLessThanOrEqual(2)
  })

  it('lets go of a shadow root once its host has left the page', async () => {
    const host = document.createElement('div')
    host.attachShadow({ mode: 'open' })
    document.body.append(host)
    const observe = vi.spyOn(MutationObserver.prototype, 'observe')
    start()
    expect(observe.mock.calls.map(([target]) => target)).toContain(
      host.shadowRoot,
    )

    host.remove()
    observe.mockClear()
    for (let elapsed = 0; elapsed <= 5000; elapsed += 250) {
      document.body.append(document.createElement('span'))
      await vi.advanceTimersByTimeAsync(250)
    }

    const observed = observe.mock.calls.map(([target]) => target)
    expect(observed).toContain(document)
    expect(observed).not.toContain(host.shadowRoot)
  })

  // jsdom reports `complete`, so the `document_start` branch only runs when
  // stubbed. An extension reload can land before parsing finishes.
  it('does not rescan on DOMContentLoaded after it was stopped', () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const media = start()
    media.stop()
    document.body.append(document.createElement('video'))

    document.dispatchEvent(new Event('DOMContentLoaded'))

    expect(added).toEqual([])
    expect(media.videos()).toEqual([])
  })
})
