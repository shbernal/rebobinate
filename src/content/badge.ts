import type { BadgeCorner, BadgeSettings } from '@/shared/settings'
import { formatSpeedLabel } from '@/shared/speed'

/**
 * The on-video speed counter.
 *
 * It is a fixed-position overlay laid over the video's bounding box rather than
 * an element inserted into the player. Re-parenting site DOM is what makes
 * overlays break layouts, and players routinely wipe children they do not own.
 * The trade-off is that the position has to be kept in sync by hand: see
 * `startBurst` and `watch` for how, and why one measurement per event is not
 * enough.
 *
 * The host carries no `style` attribute: every declaration that would sit there
 * is written into a `:host` rule inside the shadow root instead. An inline
 * style attribute is what ad-blocker filter lists reach for — EasyList hides
 * `[style*="z-index:"]` and `div[style]:not([class])` on a long tail of
 * streaming sites to kill popunder overlays, and a badge styled inline is
 * collateral damage. `docs/ad-blockers.md` has the trace, and
 * `pnpm check:filters` is what keeps it true against the current lists.
 */

/**
 * Deliberately not the word "badge": it contains "ad", and `div[id*="ad"]` is a
 * filter AdGuard already ships for a handful of sites. The id stays stable and
 * says who it belongs to, so a list maintainer who wants to allow it can.
 */
const HOST_ID = 'rebobinate-speed-host'

/**
 * How long the badge keeps re-measuring the video after something disturbs the
 * layout. A single measurement taken inside the event is not enough: the page's
 * own handlers run after ours and the box often lands where a CSS transition
 * takes it rather than where it was when the event fired.
 */
const REPOSITION_BURST_MS = 600

/**
 * How often the badge re-measures while nothing is known to be moving. Not
 * every layout change announces itself — a site that reflows around a panel it
 * just opened fires no resize, no scroll, and no `ResizeObserver` entry when
 * the video keeps its size and only moves. This is the backstop that turns
 * "wrong until the next speed change" into "wrong for a quarter second".
 */
const IDLE_WATCH_MS = 250
const INSET_PX = 10

export type BadgeGeometry = {
  alignItems: string
  justifyContent: string
}

export const cornerAlignment = (corner: BadgeCorner): BadgeGeometry => {
  const [vertical, horizontal] = corner.split('-')

  return {
    alignItems: vertical === 'top' ? 'flex-start' : 'flex-end',
    justifyContent: horizontal === 'left' ? 'flex-start' : 'flex-end',
  }
}

export type Badge = {
  render: (speed: number, settings: BadgeSettings) => void
  /** Shows the badge and restarts the auto-hide countdown. */
  flash: (speed: number, settings: BadgeSettings) => void
  destroy: () => void
}

/** Where the badge sits, once it knows which box it is covering. */
type HostPlacement = {
  left: number
  top: number
  width: number
  height: number
  alignItems: string
  justifyContent: string
}

const STATIC_HOST_DECLARATIONS = [
  'position:fixed',
  'margin:0',
  'border:0',
  'pointer-events:none',
  'z-index:2147483647',
  'contain:layout style',
  'box-sizing:border-box',
  `padding:${INSET_PX}px`,
]

/**
 * Every declaration is `!important`, which is what an inline style attribute
 * used to buy. A normal `:host` declaration loses to any page rule that reaches
 * the host — `div { display: none }` would be enough — because for normal
 * declarations the outer tree wins. Marking them important reverses that order
 * and puts the shadow tree back on top. It does not, and is not meant to,
 * outrank an ad blocker: those inject at user origin, which beats every author
 * declaration including an important inline one.
 */
const hostRule = (placement: HostPlacement | null) => {
  const declarations = placement
    ? [
        ...STATIC_HOST_DECLARATIONS,
        'display:flex',
        `left:${placement.left}px`,
        `top:${placement.top}px`,
        `width:${placement.width}px`,
        `height:${placement.height}px`,
        `align-items:${placement.alignItems}`,
        `justify-content:${placement.justifyContent}`,
      ]
    : [...STATIC_HOST_DECLARATIONS, 'display:none']

  return `:host{${declarations.map(entry => `${entry}!important`).join(';')}}`
}

/**
 * Read at style time rather than cached: the label is restyled on every show,
 * so a preference change takes effect on the next speed change with no listener
 * to keep alive. `matchMedia` is guarded because the badge also runs under
 * jsdom.
 */
const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export type BadgeOptions = {
  document: Document
  /** The video the badge should sit on, or null when there is nothing to mark. */
  anchor: () => HTMLVideoElement | null
}

export const createBadge = ({ document: doc, anchor }: BadgeOptions): Badge => {
  let host: HTMLDivElement | null = null
  let hostStyle: HTMLStyleElement | null = null
  let label: HTMLDivElement | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let watchTimer: ReturnType<typeof setTimeout> | null = null
  let burstUntil = 0
  let frame = 0
  let visible = false
  let currentSettings: BadgeSettings | null = null
  let resizeObserver: ResizeObserver | null = null
  let observedVideo: HTMLVideoElement | null = null

  const ensureHost = (): HTMLDivElement => {
    if (host?.isConnected) {
      return host
    }

    host = doc.createElement('div')
    host.id = HOST_ID

    const shadow = host.attachShadow({ mode: 'open' })
    hostStyle = doc.createElement('style')
    hostStyle.textContent = hostRule(null)
    label = doc.createElement('div')
    shadow.append(hostStyle, label)

    // The badge lives on `documentElement`, not `body`: at `document_start`
    // there is no body yet, and some sites replace it wholesale.
    doc.documentElement.append(host)

    return host
  }

  /**
   * Rewriting the sheet costs a parse, so identical placements are dropped —
   * `position` runs once per frame during a burst and on every scroll event.
   * Returns whether the badge actually moved, which is what the idle watch
   * reads to decide that something is going on and a burst is worth starting.
   */
  const placeHost = (placement: HostPlacement | null): boolean => {
    if (!hostStyle) {
      return false
    }

    const rule = hostRule(placement)

    if (hostStyle.textContent === rule) {
      return false
    }

    hostStyle.textContent = rule

    return true
  }

  const styleLabel = (settings: BadgeSettings) => {
    if (!label) {
      return
    }

    const declarations = [
      `font:600 ${settings.fontSize}px/1 system-ui,-apple-system,"Segoe UI",sans-serif`,
      `color:${settings.textColor}`,
      `background:${settings.backgroundColor}`,
      `opacity:${settings.opacity}`,
      `padding:${Math.round(settings.fontSize * 0.35)}px ${Math.round(settings.fontSize * 0.6)}px`,
      `border-radius:${Math.round(settings.fontSize * 0.35)}px`,
      'font-variant-numeric:tabular-nums',
      'white-space:nowrap',
    ]

    if (!prefersReducedMotion()) {
      declarations.push('transition:opacity 120ms ease-out')
    }

    label.setAttribute('style', declarations.join(';'))
  }

  const hide = () => {
    visible = false
    stopWatch()
    placeHost(null)
  }

  /** Returns whether the placement changed. */
  const position = (): boolean => {
    const video = anchor()

    if (!host || !video || !currentSettings) {
      hide()
      return false
    }

    const rect = video.getBoundingClientRect()
    const viewportWidth = doc.documentElement.clientWidth || window.innerWidth
    const viewportHeight =
      doc.documentElement.clientHeight || window.innerHeight
    const offscreen =
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= viewportHeight ||
      rect.left >= viewportWidth

    if (offscreen) {
      return placeHost(null)
    }

    const { alignItems, justifyContent } = cornerAlignment(
      currentSettings.corner,
    )

    return placeHost({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      alignItems,
      justifyContent,
    })
  }

  const tick = () => {
    frame = 0

    if (!visible) {
      return
    }

    position()

    if (Date.now() < burstUntil) {
      scheduleFrame()
    }
  }

  const scheduleFrame = () => {
    if (frame !== 0 || typeof requestAnimationFrame !== 'function') {
      return
    }

    frame = requestAnimationFrame(tick)
  }

  /**
   * The one way the badge is told to move. Everything that can disturb the
   * layout goes through here rather than placing the badge once: the immediate
   * measurement keeps a scroll responsive, and the burst that follows it covers
   * the transition, the site's own relayout, and the tail of a window drag.
   */
  const startBurst = () => {
    burstUntil = Date.now() + REPOSITION_BURST_MS
    position()
    scheduleFrame()
  }

  const stopWatch = () => {
    if (watchTimer !== null) {
      clearTimeout(watchTimer)
      watchTimer = null
    }
  }

  /**
   * Re-measures on a slow tick for as long as the badge is on screen. A move it
   * finds is treated as the start of an animation rather than the whole of it,
   * so it hands over to a burst.
   */
  const watch = () => {
    watchTimer = null

    if (!visible) {
      return
    }

    if (position()) {
      startBurst()
    }

    watchTimer = setTimeout(watch, IDLE_WATCH_MS)
  }

  const startWatch = () => {
    if (watchTimer === null) {
      watchTimer = setTimeout(watch, IDLE_WATCH_MS)
    }
  }

  /**
   * A `position: fixed` element is not painted while another element is
   * fullscreen, so the host has to move into the fullscreen subtree and back.
   */
  const syncFullscreenParent = () => {
    if (!host) {
      return
    }

    const fullscreenElement = doc.fullscreenElement

    if (fullscreenElement && !fullscreenElement.contains(host)) {
      fullscreenElement.append(host)
      return
    }

    if (!fullscreenElement && host.parentNode !== doc.documentElement) {
      doc.documentElement.append(host)
    }
  }

  const observeAnchor = () => {
    const video = anchor()

    if (video === observedVideo) {
      return
    }

    resizeObserver?.disconnect()
    observedVideo = video

    if (!video || typeof ResizeObserver === 'undefined') {
      return
    }

    resizeObserver = resizeObserver ?? new ResizeObserver(() => startBurst())
    resizeObserver.observe(video)
  }

  const handleViewportChange = () => {
    if (visible) {
      startBurst()
    }
  }

  const handleFullscreenChange = () => {
    syncFullscreenParent()
    handleViewportChange()
  }

  window.addEventListener('scroll', handleViewportChange, {
    capture: true,
    passive: true,
  })
  window.addEventListener('resize', handleViewportChange, { passive: true })
  doc.addEventListener('fullscreenchange', handleFullscreenChange)
  doc.addEventListener('webkitfullscreenchange', handleFullscreenChange)

  /**
   * Pinch-zoom and the browser's own retracting UI move the layout viewport
   * without a `resize` on `window`. Absent under jsdom, and on Gecko before the
   * property shipped, so it is optional rather than assumed.
   */
  const viewport = window.visualViewport ?? null

  viewport?.addEventListener('resize', handleViewportChange)
  viewport?.addEventListener('scroll', handleViewportChange)

  const show = (speed: number, settings: BadgeSettings) => {
    ensureHost()
    styleLabel(settings)

    if (label) {
      label.textContent = formatSpeedLabel(speed)
    }

    visible = true
    syncFullscreenParent()
    observeAnchor()
    position()
    startWatch()
  }

  const clearHideTimer = () => {
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  const shouldShow = (speed: number, settings: BadgeSettings) => {
    if (!settings.enabled || !anchor()) {
      return false
    }

    return !(settings.hideAtNormalSpeed && Math.abs(speed - 1) < 0.0005)
  }

  const render = (speed: number, settings: BadgeSettings) => {
    currentSettings = settings

    if (!shouldShow(speed, settings)) {
      clearHideTimer()
      hide()
      return
    }

    if (settings.autoHideMs > 0 && !visible) {
      // Nothing changed and the badge already faded out; leave it hidden.
      return
    }

    show(speed, settings)
  }

  const flash = (speed: number, settings: BadgeSettings) => {
    currentSettings = settings
    clearHideTimer()

    if (!shouldShow(speed, settings)) {
      hide()
      return
    }

    show(speed, settings)

    // Track the video for a moment: a speed change often coincides with the
    // player showing its controls, which moves the video box.
    startBurst()

    if (settings.autoHideMs > 0) {
      hideTimer = setTimeout(hide, settings.autoHideMs)
    }
  }

  const destroy = () => {
    clearHideTimer()
    stopWatch()

    if (frame !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame)
      frame = 0
    }

    resizeObserver?.disconnect()
    resizeObserver = null
    window.removeEventListener('scroll', handleViewportChange, {
      capture: true,
    })
    window.removeEventListener('resize', handleViewportChange)
    viewport?.removeEventListener('resize', handleViewportChange)
    viewport?.removeEventListener('scroll', handleViewportChange)
    doc.removeEventListener('fullscreenchange', handleFullscreenChange)
    doc.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    host?.remove()
    host = null
    hostStyle = null
    label = null
  }

  return { render, flash, destroy }
}
