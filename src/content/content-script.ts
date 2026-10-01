import type { RuntimeMessage } from '@/shared/messages'
import { isRuntimeMessage } from '@/shared/messages'
import type { SpeedAction } from '@/shared/keys'
import type { BadgeSettings, Settings } from '@/shared/settings'
import {
  DEFAULT_SETTINGS,
  onSettingsChange,
  readSettings,
} from '@/shared/settings'
import { speedsEqual } from '@/shared/speed'
import { createBadge } from './badge'
import { createEnforcer } from './enforcer'
import { createKeyHandler } from './keys'
import { createMediaRegistry } from './media'

// The content script matches `<all_urls>`, which includes documents that are
// not HTML at all (XML, plain text, images). Nothing to control there.
const isControllableDocument = () => {
  return (
    Boolean(document.documentElement) && document.contentType !== 'text/xml'
  )
}

if (isControllableDocument()) {
  let settings: Settings = DEFAULT_SETTINGS

  const enforcer = createEnforcer({ videos: () => registry.videos() })

  const registry = createMediaRegistry({
    document,
    onAdd: video => {
      // A newly discovered video starts at the frame's current speed, which is
      // what makes the setting survive a site swapping its player element.
      enforcer.apply(video)
      reportMedia()
      announceSpeed()
    },
    onMediaEvent: (video, eventName) => {
      reportMedia()

      if (eventName === 'ratechange') {
        enforcer.reconcile(video)
        badge.render(enforcer.getSpeed(), badgeSettings())
        return
      }

      enforcer.apply(video)
    },
  })

  const badge = createBadge({
    document,
    anchor: () => registry.primary(),
  })

  /**
   * The badge block's own switch, with the master one folded in.
   *
   * `shouldShow` only ever consulted `badge.enabled`, so a speed arriving while
   * the extension was switched off still drew the marker — a promise about a
   * video nothing is speeding up. Reported off rather than short-circuited at
   * each call site, because `render` and `flash` already do the right thing
   * with a disabled block: they take whatever is on screen down.
   */
  const badgeSettings = (): BadgeSettings =>
    settings.enabled ? settings.badge : { ...settings.badge, enabled: false }

  // Whether any frame of the tab holds a video. On a page whose player sits in
  // an iframe, the focused frame has none of its own, but the keystroke is
  // still meant for us.
  let tabHasVideo = false
  let reportedHasVideo = false

  /**
   * A speed the user did not just ask for still owes them an explanation. A
   * speed remembered for the site is applied at `document_start`, before there
   * is a video for the badge to sit on, so the announcement waits for the first
   * one to appear. Once per frame: a feed that recycles its player would
   * otherwise flash on every item.
   */
  let announced = false

  function announceSpeed() {
    if (announced || speedsEqual(enforcer.getSpeed(), 1)) {
      return
    }

    announced = true
    badge.flash(enforcer.getSpeed(), badgeSettings())
  }

  const keyHandler = createKeyHandler({
    target: window,
    bindings: () => settings.keys,
    // Checked before the handler takes the key from the page, so an orphaned
    // script hands it back rather than swallowing it.
    canHandle: () =>
      alive() &&
      settings.enabled &&
      (registry.videos().length > 0 || tabHasVideo),
    onAction: action => sendIntent(action),
  })

  let stopSettingsWatch = () => {}
  let tornDown = false

  /**
   * An extension update, reload or disable leaves this script running in the
   * open tab with its `chrome.runtime` gone: every listener it installed still
   * fires, and every message it sends throws. `runtime.id` is what goes
   * `undefined` when that happens. The first caller to see it removes
   * everything the script put on the page.
   */
  function alive() {
    if (tornDown) {
      return false
    }

    if (chrome.runtime?.id !== undefined) {
      return true
    }

    teardown()
    return false
  }

  function teardown() {
    tornDown = true
    keyHandler.stop()
    registry.stop()
    badge.destroy()

    try {
      stopSettingsWatch()
    } catch {
      // The storage API is as gone as the runtime; nothing left to detach.
    }
  }

  /** Sends to the service worker, or tears down if the context died mid-way. */
  function send(message: RuntimeMessage, onResponse: () => void) {
    if (!alive()) {
      return
    }

    try {
      chrome.runtime.sendMessage(message, onResponse)
    } catch {
      teardown()
    }
  }

  function reportMedia() {
    const hasVideo = registry.videos().length > 0

    if (hasVideo === reportedHasVideo) {
      return
    }

    reportedHasVideo = hasVideo
    tabHasVideo = tabHasVideo || hasVideo

    send({ type: 'rebobinate:media', hasVideo }, () => {
      void chrome.runtime.lastError
    })
  }

  function sendIntent(action: SpeedAction) {
    send(
      {
        type: 'rebobinate:intent',
        action,
        currentSpeed: enforcer.getSpeed(),
      },
      () => {
        // The resolved speed arrives as a broadcast to every frame of the tab,
        // so there is nothing to do with the direct response. Reading
        // `lastError` keeps Chrome from logging an unchecked-error warning when
        // the service worker is still starting.
        void chrome.runtime.lastError
      },
    )
  }

  const applySpeed = (speed: number) => {
    if (speedsEqual(speed, enforcer.getSpeed())) {
      // Still flash: the user pressed a key and deserves feedback even when the
      // speed is already at the limit.
      badge.flash(speed, badgeSettings())
      return
    }

    enforcer.setSpeed(speed)
    badge.flash(speed, badgeSettings())
  }

  chrome.runtime.onMessage.addListener(message => {
    if (!isRuntimeMessage(message)) {
      return
    }

    if (message.type === 'rebobinate:tab-media') {
      tabHasVideo = message.hasVideo

      // The tab-level answer contradicts what this frame is holding, which
      // means our report was lost or discarded. Say it again.
      if (!message.hasVideo && registry.videos().length > 0) {
        reportedHasVideo = false
        reportMedia()
      }

      return
    }

    if (message.type === 'rebobinate:state') {
      applySpeed(message.speed)
    }
  })

  readSettings(initial => {
    settings = initial
    badge.render(enforcer.getSpeed(), badgeSettings())
  })

  stopSettingsWatch = onSettingsChange(next => {
    const wasEnabled = settings.enabled
    settings = next

    if (wasEnabled && !next.enabled) {
      enforcer.setSpeed(1)
    }

    badge.render(enforcer.getSpeed(), badgeSettings())
  })

  registry.start()
  keyHandler.start()
  reportMedia()

  // Pick up a speed that was set before this frame existed — an iframe added
  // after the user already changed the speed, for instance.
  chrome.runtime.sendMessage(
    { type: 'rebobinate:query' } satisfies RuntimeMessage,
    (response?: { speed?: number; hasVideo?: boolean }) => {
      void chrome.runtime.lastError

      if (response?.hasVideo) {
        tabHasVideo = true
      }

      if (typeof response?.speed === 'number') {
        enforcer.setSpeed(response.speed)
        badge.render(response.speed, badgeSettings())
        announceSpeed()
      }
    },
  )
}
