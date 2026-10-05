import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { BadgeSettings } from '@/shared/settings'
import { cornerAlignment, createBadge } from './badge'

const badgeSettings = (
  overrides: Partial<BadgeSettings> = {},
): BadgeSettings => ({
  ...DEFAULT_SETTINGS.badge,
  ...overrides,
})

const setRect = (
  video: HTMLVideoElement,
  {
    left,
    top,
    width = 640,
    height = 360,
  }: { left: number; top: number; width?: number; height?: number },
) => {
  video.getBoundingClientRect = () =>
    ({
      width,
      height,
      top,
      left,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect

  return video
}

const withRect = (video: HTMLVideoElement) =>
  setRect(video, { left: 20, top: 40 })

const host = () => document.getElementById('rebobinate-speed-host')

/**
 * The badge's root is closed, so `host.shadowRoot` is null by design. The test
 * keeps its own reference by watching `attachShadow`, the way only the
 * extension holds one in a real page.
 */
const roots = new WeakMap<Element, ShadowRoot>()

beforeEach(() => {
  const attachShadow = Element.prototype.attachShadow

  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = attachShadow.call(this, init)
    roots.set(this, root)
    return root
  })
})

const shadow = () => {
  const node = host()
  return node ? (roots.get(node) ?? null) : null
}

const labelElement = () => shadow()?.querySelector('div') ?? null

const labelText = () => labelElement()?.textContent ?? null

const labelStyle = () => labelElement()?.getAttribute('style') ?? ''

/**
 * The host is styled from a `:host` rule inside its own shadow root rather than
 * from a `style` attribute, so this is where its geometry has to be read from.
 */
const hostCss = () => shadow()?.querySelector('style')?.textContent ?? ''

const hostDeclaration = (property: string) =>
  new RegExp(`[{;]${property}:([^;!}]+)`).exec(hostCss())?.[1] ?? null

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion: reduce') && reduce,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}

describe('cornerAlignment', () => {
  it('maps each corner to flex alignment', () => {
    expect(cornerAlignment('top-left')).toEqual({
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
    })
    expect(cornerAlignment('bottom-right')).toEqual({
      alignItems: 'flex-end',
      justifyContent: 'flex-end',
    })
    expect(cornerAlignment('top-right').justifyContent).toBe('flex-end')
    expect(cornerAlignment('bottom-left').alignItems).toBe('flex-end')
  })
})

describe('createBadge', () => {
  let video: HTMLVideoElement
  let badge: ReturnType<typeof createBadge>
  const realMatchMedia = window.matchMedia

  beforeEach(() => {
    vi.useFakeTimers()
    setReducedMotion(false)
    window.innerWidth = 1000
    window.innerHeight = 800
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 1000,
      configurable: true,
    })
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    })
    video = withRect(document.createElement('video'))
    document.body.append(video)
    badge = createBadge({ document, anchor: () => video })
  })

  afterEach(() => {
    badge.destroy()
    window.matchMedia = realMatchMedia
    vi.useRealTimers()
  })

  it('shows the speed over the video', () => {
    badge.flash(1.25, badgeSettings())

    expect(labelText()).toBe('1.25×')
    expect(hostDeclaration('left')).toBe('20px')
    expect(hostDeclaration('top')).toBe('40px')
    expect(hostDeclaration('width')).toBe('640px')
    expect(hostDeclaration('display')).toBe('flex')
  })

  it('positions itself in the configured corner', () => {
    badge.flash(2, badgeSettings({ corner: 'bottom-right' }))

    expect(hostDeclaration('align-items')).toBe('flex-end')
    expect(hostDeclaration('justify-content')).toBe('flex-end')
  })

  it('keeps the page safe from itself', () => {
    badge.flash(2, badgeSettings())

    expect(hostDeclaration('pointer-events')).toBe('none')
    expect(hostDeclaration('position')).toBe('fixed')
    // A shadow root keeps site CSS from reaching the badge, and a closed one
    // keeps site scripts from reading or rewriting it.
    expect(shadow()).not.toBeNull()
    expect(host()?.shadowRoot).toBeNull()
  })

  it('leaves no inline style attribute for a filter list to match', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 0 }))

    // `[style*="z-index:"]` and `div[style]:not([class])` are live EasyList
    // filters. Neither can match an element with no style attribute at all.
    expect(host()?.hasAttribute('style')).toBe(false)
    expect(host()?.outerHTML).not.toContain('z-index')
  })

  it('marks its own declarations important so page CSS cannot undo them', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 0 }))

    // Without this a bare `div { display: none }` on the page would win: for
    // normal declarations the document tree outranks a `:host` rule.
    expect(hostCss()).toContain('position:fixed!important')
    expect(hostCss()).toContain('display:flex!important')
  })

  it('fades out after the configured delay', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 1000 }))
    expect(hostDeclaration('display')).toBe('flex')

    vi.advanceTimersByTime(1000)

    expect(hostDeclaration('display')).toBe('none')
  })

  it('stays on screen when auto-hide is off', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 0 }))

    vi.advanceTimersByTime(30000)

    expect(hostDeclaration('display')).toBe('flex')
  })

  it('hides at normal speed when asked to', () => {
    badge.flash(2, badgeSettings({ hideAtNormalSpeed: true }))
    expect(hostDeclaration('display')).toBe('flex')

    badge.flash(1, badgeSettings({ hideAtNormalSpeed: true }))

    expect(hostDeclaration('display')).toBe('none')
  })

  // The same tolerance as every other "is this normal speed" in the
  // extension: a rate that lands a hair off 1.0 still counts.
  it('treats a speed within rounding of 1.0 as normal', () => {
    badge.flash(1.05, badgeSettings({ hideAtNormalSpeed: true }))
    expect(hostDeclaration('display')).toBe('flex')

    badge.flash(1.0004, badgeSettings({ hideAtNormalSpeed: true }))
    expect(hostDeclaration('display')).toBe('none')
  })

  it('follows the video again after being torn down and reused', () => {
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(target: Element) {
          observed.push(target)
        }
        disconnect() {}
      },
    )

    badge.flash(2, badgeSettings())
    badge.destroy()
    badge.flash(2, badgeSettings())

    expect(observed).toHaveLength(2)
    expect(observed[1]).toBe(observed[0])
    vi.unstubAllGlobals()
  })

  it('never touches the page while the speed is normal', () => {
    badge.render(1, badgeSettings({ hideAtNormalSpeed: true }))

    expect(host()).toBeNull()
  })

  it('shows normal speed when the user wants it always visible', () => {
    badge.flash(1, badgeSettings({ hideAtNormalSpeed: false }))

    expect(labelText()).toBe('1.0×')
    expect(hostDeclaration('display')).toBe('flex')
  })

  it('stays out of the way when disabled', () => {
    badge.flash(2, badgeSettings({ enabled: false }))

    expect(host()).toBeNull()
  })

  it('hides when the video has scrolled out of view', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 0 }))

    setRect(video, { left: 20, top: 900 })

    window.dispatchEvent(new Event('scroll'))

    expect(hostDeclaration('display')).toBe('none')
  })

  it('follows a video that moves with no event to announce it', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 0 }))
    // Past the burst a speed change starts, so only the idle watch is left to
    // notice anything.
    vi.advanceTimersByTime(1000)
    expect(hostDeclaration('left')).toBe('20px')

    // What opening a comment panel does: the video is pushed sideways by a
    // relayout, at the same size, with no resize and no scroll to hear about.
    setRect(video, { left: 320, top: 40 })
    vi.advanceTimersByTime(300)

    expect(hostDeclaration('left')).toBe('320px')
  })

  it('keeps tracking after the event that moved the video', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 0 }))
    vi.advanceTimersByTime(1000)

    // A window resize the page reacts to over a transition: the box the badge
    // can measure inside the event is not where the video ends up. Well under
    // the idle watch's tick, so the burst is the only thing that can catch it.
    window.dispatchEvent(new Event('resize'))
    setRect(video, { left: 120, top: 40 })
    vi.advanceTimersByTime(100)

    expect(hostDeclaration('left')).toBe('120px')
  })

  it('stops tracking once it has faded out', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 1000 }))
    vi.advanceTimersByTime(1000)
    expect(hostDeclaration('display')).toBe('none')

    setRect(video, { left: 320, top: 40 })
    vi.advanceTimersByTime(2000)

    expect(hostDeclaration('display')).toBe('none')
  })

  it('moves into the fullscreen element so it stays painted', () => {
    const wrapper = document.createElement('div')
    wrapper.append(video)
    document.body.append(wrapper)

    badge.flash(2, badgeSettings({ autoHideMs: 0 }))
    Object.defineProperty(document, 'fullscreenElement', {
      value: wrapper,
      configurable: true,
    })
    document.dispatchEvent(new Event('fullscreenchange'))

    expect(wrapper.contains(host())).toBe(true)

    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
    })
    document.dispatchEvent(new Event('fullscreenchange'))

    expect(host()?.parentNode).toBe(document.documentElement)
  })

  it('strikes the speed through once the site has overridden it', () => {
    badge.flash(2, badgeSettings(), true)

    expect(labelText()).toBe('2.0×')
    expect(labelStyle()).toContain('text-decoration:line-through')

    badge.flash(2, badgeSettings())

    expect(labelStyle()).not.toContain('line-through')
  })

  it('fades between opacities by default', () => {
    badge.flash(2, badgeSettings())

    expect(labelStyle()).toContain('transition:opacity 120ms ease-out')
  })

  it('drops the fade when the user asks for reduced motion', () => {
    setReducedMotion(true)

    badge.flash(2, badgeSettings())

    expect(labelStyle()).not.toContain('transition')
  })

  it('picks up a reduced-motion change on the next speed change', () => {
    badge.flash(2, badgeSettings())
    setReducedMotion(true)

    badge.flash(2.5, badgeSettings())

    expect(labelStyle()).not.toContain('transition')
  })

  it('removes itself from the page on destroy', () => {
    badge.flash(2, badgeSettings())
    badge.destroy()

    expect(host()).toBeNull()
  })
})
