import type { RuntimeMessage } from '@/shared/messages'
import { isRuntimeMessage } from '@/shared/messages'
import type { Settings } from '@/shared/settings'
import { clampToSettings, readSettings } from '@/shared/settings'
import { stepSpeed } from '@/shared/speed'

/**
 * The background owns the speed of each tab.
 *
 * A keystroke only reaches the focused frame, and the popup is not a frame at
 * all, so both funnel their intent through here. The resolved speed is then
 * broadcast to every frame of the tab — which is what makes the controls work
 * on pages whose player lives in an iframe.
 *
 * The map is in-memory on purpose. An evicted service worker losing it is
 * harmless: content frames report their own speed with every intent, so the
 * next keystroke resumes from the truth on the page.
 */
const tabSpeeds = new Map<number, number>()

/**
 * Which frames of a tab currently hold a video. A frame with no video of its
 * own still handles the keyboard as long as some frame in the tab has one —
 * otherwise the controls would be dead on every page whose player is embedded.
 */
const tabFramesWithVideo = new Map<number, Set<number>>()

const tabHasVideo = (tabId: number) => {
  return (tabFramesWithVideo.get(tabId)?.size ?? 0) > 0
}

const setFrameMedia = (
  tabId: number,
  frameId: number,
  hasVideo: boolean,
): boolean => {
  const before = tabHasVideo(tabId)
  const frames = tabFramesWithVideo.get(tabId) ?? new Set<number>()

  if (hasVideo) {
    frames.add(frameId)
  } else {
    frames.delete(frameId)
  }

  tabFramesWithVideo.set(tabId, frames)

  return tabHasVideo(tabId) !== before
}

const resolveSpeed = (
  current: number,
  message: RuntimeMessage,
  settings: Settings,
): number => {
  switch (message.type) {
    case 'rebobinate:intent':
      if (message.action === 'reset') {
        return 1
      }

      return stepSpeed(
        current,
        settings.step,
        message.action === 'increase' ? 1 : -1,
        settings.minSpeed,
        settings.maxSpeed,
      )
    case 'rebobinate:set':
      return clampToSettings(message.speed, settings)
    default:
      return current
  }
}

const broadcast = (tabId: number, message: RuntimeMessage) => {
  // No `frameId`, so this reaches every frame in the tab.
  chrome.tabs.sendMessage(tabId, message, () => {
    // Frames without a content script (or a tab that just navigated) reject
    // the message; that is expected, not an error worth surfacing.
    void chrome.runtime.lastError
  })
}

const broadcastSpeed = (tabId: number, speed: number) => {
  broadcast(tabId, { type: 'rebobinate:state', speed })
}

const EXTENSION_PROTOCOLS = ['chrome-extension://', 'moz-extension://']

const isExtensionUrl = (url: string | undefined) => {
  return EXTENSION_PROTOCOLS.some(protocol => url?.startsWith(protocol))
}

const isExtensionPage = (sender: chrome.runtime.MessageSender) => {
  return isExtensionUrl(sender.url) || isExtensionUrl(sender.tab?.url)
}

const withTargetTab = (
  sender: chrome.runtime.MessageSender,
  callback: (tabId: number) => void,
) => {
  const senderTabId = sender.tab?.id

  // An extension page controls the web page the user is looking at, never
  // itself — which also covers the popup, whose sender carries no tab at all.
  if (typeof senderTabId === 'number' && !isExtensionPage(sender)) {
    callback(senderTabId)
    return
  }

  const isWebTab = (tab: chrome.tabs.Tab) => !isExtensionUrl(tab.url)

  chrome.tabs.query({ active: true, currentWindow: true }, activeTabs => {
    const activeTabId = activeTabs.find(isWebTab)?.id

    if (typeof activeTabId === 'number') {
      callback(activeTabId)
      return
    }

    // The active tab is an extension page in its own tab. Fall back to the web
    // page the user was on before opening it.
    chrome.tabs.query({ currentWindow: true }, tabs => {
      const recent = tabs
        .filter(isWebTab)
        .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]

      if (typeof recent?.id === 'number') {
        callback(recent.id)
      }
    })
  })
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (!isRuntimeMessage(message)) {
      return false
    }

    if (
      message.type === 'rebobinate:state' ||
      message.type === 'rebobinate:tab-media'
    ) {
      return false
    }

    if (message.type === 'rebobinate:media') {
      const tabId = sender.tab?.id

      if (typeof tabId === 'number' && typeof sender.frameId === 'number') {
        if (setFrameMedia(tabId, sender.frameId, message.hasVideo)) {
          broadcast(tabId, {
            type: 'rebobinate:tab-media',
            hasVideo: tabHasVideo(tabId),
          })
        }
      }

      return false
    }

    if (message.type === 'rebobinate:query') {
      withTargetTab(sender, tabId => {
        // A top-frame load means a new page: speed and frame bookkeeping both
        // start over. Sub-frames inherit whatever the tab is currently at.
        if (sender.frameId === 0) {
          tabSpeeds.delete(tabId)
          tabFramesWithVideo.delete(tabId)

          // A sub-frame may have loaded and reported before the top frame did,
          // in which case that report was just discarded. Telling every frame
          // the tab has no video makes the ones that do say so again.
          broadcast(tabId, { type: 'rebobinate:tab-media', hasVideo: false })
        }

        sendResponse({
          speed: tabSpeeds.get(tabId) ?? 1,
          hasVideo: tabHasVideo(tabId),
        })
      })

      return true
    }

    if (message.type === 'rebobinate:popup-state') {
      withTargetTab(sender, tabId => {
        sendResponse({
          speed: tabSpeeds.get(tabId) ?? 1,
          hasVideo: tabHasVideo(tabId),
        })
      })

      return true
    }

    withTargetTab(sender, tabId => {
      readSettings(settings => {
        const known = tabSpeeds.get(tabId)
        const current =
          known ??
          (message.type === 'rebobinate:intent' ? message.currentSpeed : 1)
        const speed = resolveSpeed(current, message, settings)

        tabSpeeds.set(tabId, speed)
        broadcastSpeed(tabId, speed)
        sendResponse({ speed })
      })
    })

    return true
  },
)

chrome.tabs.onRemoved.addListener(tabId => {
  tabSpeeds.delete(tabId)
  tabFramesWithVideo.delete(tabId)
})
