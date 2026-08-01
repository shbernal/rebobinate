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

const withRect = (video: HTMLVideoElement) => {
  video.getBoundingClientRect = () =>
    ({
      width: 640,
      height: 360,
      top: 40,
      left: 20,
      right: 660,
      bottom: 400,
      x: 20,
      y: 40,
      toJSON: () => ({}),
    }) as DOMRect

  return video
}

const host = () => document.getElementById('rebobinate-badge-host')

const labelText = () => host()?.shadowRoot?.textContent ?? null

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

  beforeEach(() => {
    vi.useFakeTimers()
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
    vi.useRealTimers()
  })

  it('shows the speed over the video', () => {
    badge.flash(1.25, badgeSettings())

    expect(labelText()).toBe('1.25×')
    expect(host()?.style.left).toBe('20px')
    expect(host()?.style.top).toBe('40px')
    expect(host()?.style.width).toBe('640px')
    expect(host()?.style.display).toBe('flex')
  })

  it('positions itself in the configured corner', () => {
    badge.flash(2, badgeSettings({ corner: 'bottom-right' }))

    expect(host()?.style.alignItems).toBe('flex-end')
    expect(host()?.style.justifyContent).toBe('flex-end')
  })

  it('keeps the page safe from itself', () => {
    badge.flash(2, badgeSettings())

    expect(host()?.style.pointerEvents).toBe('none')
    expect(host()?.style.position).toBe('fixed')
    // A shadow root keeps site CSS from reaching the badge.
    expect(host()?.shadowRoot).not.toBeNull()
  })

  it('fades out after the configured delay', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 1000 }))
    expect(host()?.style.display).toBe('flex')

    vi.advanceTimersByTime(1000)

    expect(host()?.style.display).toBe('none')
  })

  it('stays on screen when auto-hide is off', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 0 }))

    vi.advanceTimersByTime(30000)

    expect(host()?.style.display).toBe('flex')
  })

  it('hides at normal speed when asked to', () => {
    badge.flash(2, badgeSettings({ hideAtNormalSpeed: true }))
    expect(host()?.style.display).toBe('flex')

    badge.flash(1, badgeSettings({ hideAtNormalSpeed: true }))

    expect(host()?.style.display).toBe('none')
  })

  it('never touches the page while the speed is normal', () => {
    badge.render(1, badgeSettings({ hideAtNormalSpeed: true }))

    expect(host()).toBeNull()
  })

  it('shows normal speed when the user wants it always visible', () => {
    badge.flash(1, badgeSettings({ hideAtNormalSpeed: false }))

    expect(labelText()).toBe('1.0×')
    expect(host()?.style.display).toBe('flex')
  })

  it('stays out of the way when disabled', () => {
    badge.flash(2, badgeSettings({ enabled: false }))

    expect(host()?.style.display ?? 'none').toBe('none')
  })

  it('hides when the video has scrolled out of view', () => {
    badge.flash(2, badgeSettings({ autoHideMs: 0 }))

    video.getBoundingClientRect = () =>
      ({
        width: 640,
        height: 360,
        top: 900,
        left: 20,
        right: 660,
        bottom: 1260,
        x: 20,
        y: 900,
        toJSON: () => ({}),
      }) as DOMRect

    window.dispatchEvent(new Event('scroll'))

    expect(host()?.style.display).toBe('none')
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

  it('removes itself from the page on destroy', () => {
    badge.flash(2, badgeSettings())
    badge.destroy()

    expect(host()).toBeNull()
  })
})
