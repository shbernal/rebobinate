import type { RuntimeMessage } from '@/shared/messages'
import { isRuntimeMessage } from '@/shared/messages'
import type { SpeedAction } from '@/shared/keys'
import type { Settings } from '@/shared/settings'
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
    },
    onMediaEvent: (video, eventName) => {
      reportMedia()

      if (eventName === 'ratechange') {
        enforcer.reconcile(video)
        badge.render(enforcer.getSpeed(), settings.badge)
        return
      }

      enforcer.apply(video)
    },
  })

  const badge = createBadge({
    document,
    anchor: () => registry.primary(),
  })

  // Whether any frame of the tab holds a video. On a page whose player sits in
  // an iframe, the focused frame has none of its own, but the keystroke is
  // still meant for us.
  let tabHasVideo = false
  let reportedHasVideo = false

  const keyHandler = createKeyHandler({
    target: window,
    bindings: () => settings.keys,
    canHandle: () =>
      settings.enabled && (registry.videos().length > 0 || tabHasVideo),
    onAction: action => sendIntent(action),
  })

  function reportMedia() {
    const hasVideo = registry.videos().length > 0

    if (hasVideo === reportedHasVideo) {
      return
    }

    reportedHasVideo = hasVideo
    tabHasVideo = tabHasVideo || hasVideo

    chrome.runtime.sendMessage(
      { type: 'rebobinate:media', hasVideo } satisfies RuntimeMessage,
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  function sendIntent(action: SpeedAction) {
    chrome.runtime.sendMessage(
      {
        type: 'rebobinate:intent',
        action,
        currentSpeed: enforcer.getSpeed(),
      } satisfies RuntimeMessage,
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
      badge.flash(speed, settings.badge)
      return
    }

    enforcer.setSpeed(speed)
    badge.flash(speed, settings.badge)
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
    badge.render(enforcer.getSpeed(), settings.badge)
  })

  onSettingsChange(next => {
    const wasEnabled = settings.enabled
    settings = next

    if (wasEnabled && !next.enabled) {
      enforcer.setSpeed(1)
    }

    badge.render(enforcer.getSpeed(), settings.badge)
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
        badge.render(response.speed, settings.badge)
      }
    },
  )
}
