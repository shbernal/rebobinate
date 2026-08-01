import type { BadgeCorner, BadgeSettings } from '@/shared/settings'
import { formatSpeedLabel } from '@/shared/speed'

/**
 * The on-video speed counter.
 *
 * It is a fixed-position overlay laid over the video's bounding box rather than
 * an element inserted into the player. Re-parenting site DOM is what makes
 * overlays break layouts, and players routinely wipe children they do not own.
 * The trade-off is that the position has to be kept in sync by hand.
 */

const HOST_ID = 'rebobinate-badge-host'
const REPOSITION_BURST_MS = 600
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

const HOST_STYLE = [
  'position:fixed',
  'margin:0',
  'padding:0',
  'border:0',
  'pointer-events:none',
  'z-index:2147483647',
  'display:flex',
  'contain:layout style',
].join(';')

export type BadgeOptions = {
  document: Document
  /** The video the badge should sit on, or null when there is nothing to mark. */
  anchor: () => HTMLVideoElement | null
}

export const createBadge = ({ document: doc, anchor }: BadgeOptions): Badge => {
  let host: HTMLDivElement | null = null
  let label: HTMLDivElement | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
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
    host.setAttribute('style', HOST_STYLE)

    const shadow = host.attachShadow({ mode: 'open' })
    label = doc.createElement('div')
    shadow.append(label)

    // The badge lives on `documentElement`, not `body`: at `document_start`
    // there is no body yet, and some sites replace it wholesale.
    doc.documentElement.append(host)

    return host
  }

  const styleLabel = (settings: BadgeSettings) => {
    if (!label) {
      return
    }

    label.setAttribute(
      'style',
      [
        `font:600 ${settings.fontSize}px/1 system-ui,-apple-system,"Segoe UI",sans-serif`,
        `color:${settings.textColor}`,
        `background:${settings.backgroundColor}`,
        `opacity:${settings.opacity}`,
        `padding:${Math.round(settings.fontSize * 0.35)}px ${Math.round(settings.fontSize * 0.6)}px`,
        `border-radius:${Math.round(settings.fontSize * 0.35)}px`,
        'font-variant-numeric:tabular-nums',
        'white-space:nowrap',
        'transition:opacity 120ms ease-out',
      ].join(';'),
    )
  }

  const hide = () => {
    visible = false

    if (host) {
      host.style.display = 'none'
    }
  }

  const position = () => {
    const video = anchor()

    if (!host || !video || !currentSettings) {
      hide()
      return
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
      host.style.display = 'none'
      return
    }

    const { alignItems, justifyContent } = cornerAlignment(
      currentSettings.corner,
    )

    host.style.display = 'flex'
    host.style.left = `${rect.left}px`
    host.style.top = `${rect.top}px`
    host.style.width = `${rect.width}px`
    host.style.height = `${rect.height}px`
    host.style.alignItems = alignItems
    host.style.justifyContent = justifyContent
    host.style.padding = `${INSET_PX}px`
    host.style.boxSizing = 'border-box'
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

    resizeObserver = resizeObserver ?? new ResizeObserver(() => position())
    resizeObserver.observe(video)
  }

  const handleViewportChange = () => {
    if (visible) {
      position()
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
    burstUntil = Date.now() + REPOSITION_BURST_MS
    scheduleFrame()

    if (settings.autoHideMs > 0) {
      hideTimer = setTimeout(hide, settings.autoHideMs)
    }
  }

  const destroy = () => {
    clearHideTimer()
    resizeObserver?.disconnect()
    resizeObserver = null
    window.removeEventListener('scroll', handleViewportChange, {
      capture: true,
    })
    window.removeEventListener('resize', handleViewportChange)
    doc.removeEventListener('fullscreenchange', handleFullscreenChange)
    doc.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    host?.remove()
    host = null
    label = null
  }

  return { render, flash, destroy }
}
