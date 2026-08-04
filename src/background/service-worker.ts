import type { RuntimeMessage } from '@/shared/messages'
import { isRuntimeMessage } from '@/shared/messages'
import { domainKeyFromUrl } from '@/shared/domain'
import type { DomainStore } from '@/shared/domains'
import {
  forgetDomain,
  readDomains,
  rememberDomain,
  writeDomains,
} from '@/shared/domains'
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
 *
 * It is also where per-domain memory belongs, for the same reason: the domain a
 * tab counts as is a property of the tab, not of the frame that happened to
 * receive the keystroke.
 */
const tabSpeeds = new Map<number, number>()

/**
 * Which frames of a tab currently hold a video. A frame with no video of its
 * own still handles the keyboard as long as some frame in the tab has one —
 * otherwise the controls would be dead on every page whose player is embedded.
 */
const tabFramesWithVideo = new Map<number, Set<number>>()

/**
 * Writing on every keystroke would put twenty entries through storage for one
 * ramp from 1.0 to 2.0, so a domain's write waits for the user to stop and only
 * the last speed survives. The window is short on purpose: a pending timer dies
 * with the service worker, and eviction takes thirty seconds of idle, so a
 * second is comfortably inside the margin.
 */
const WRITE_DEBOUNCE_MS = 1000
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * The tab a message is about. The URL is the *top* frame's, which is what makes
 * a YouTube embed on a blog follow the blog's setting rather than YouTube's:
 * the domain a page counts as is the one in the address bar.
 */
type TabContext = {
  id: number
  url: string | undefined
  incognito: boolean
}

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
        return clampToSettings(settings.defaultSpeed, settings)
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

/**
 * The speed a freshly loaded tab starts at: what this domain is remembered at,
 * or the user's default. Two storage reads, so it answers on a callback.
 */
const resolveStartSpeed = (
  tab: TabContext,
  callback: (speed: number) => void,
) => {
  readSettings(settings => {
    const domain = settings.rememberPerDomain ? domainKeyFromUrl(tab.url) : null

    if (!domain) {
      callback(clampToSettings(settings.defaultSpeed, settings))
      return
    }

    readDomains(store => {
      const remembered = store.entries[domain]?.speed

      callback(clampToSettings(remembered ?? settings.defaultSpeed, settings))
    })
  })
}

const cancelPendingWrite = (domain: string) => {
  const timer = pendingWrites.get(domain)

  if (timer !== undefined) {
    clearTimeout(timer)
    pendingWrites.delete(domain)
  }
}

const updateDomains = (change: (store: DomainStore) => DomainStore) => {
  readDomains(store => {
    writeDomains(change(store))
  })
}

const forget = (domain: string) => {
  cancelPendingWrite(domain)
  updateDomains(store => forgetDomain(store, domain))
}

/**
 * Records the speed the user just chose for the tab's domain.
 *
 * `reset` drops the entry instead of storing the default under it. `0` is the
 * "make this site normal again" gesture, and a map full of entries that only
 * repeat the default would spend the eviction budget on nothing.
 */
const remember = (
  tab: TabContext,
  settings: Settings,
  speed: number,
  isReset: boolean,
) => {
  // A private window is not a place to leave a record of what was watched.
  if (!settings.rememberPerDomain || tab.incognito) {
    return
  }

  const domain = domainKeyFromUrl(tab.url)

  if (!domain) {
    return
  }

  cancelPendingWrite(domain)

  if (isReset) {
    updateDomains(store => forgetDomain(store, domain))
    return
  }

  pendingWrites.set(
    domain,
    setTimeout(() => {
      pendingWrites.delete(domain)
      updateDomains(store => rememberDomain(store, domain, speed, Date.now()))
    }, WRITE_DEBOUNCE_MS),
  )
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

const toContext = (tab: chrome.tabs.Tab, id: number): TabContext => ({
  id,
  url: tab.url,
  incognito: tab.incognito === true,
})

const withTargetTab = (
  sender: chrome.runtime.MessageSender,
  callback: (tab: TabContext) => void,
) => {
  const senderTab = sender.tab
  const senderTabId = senderTab?.id

  // An extension page controls the web page the user is looking at, never
  // itself — which also covers the popup, whose sender carries no tab at all.
  if (
    senderTab &&
    typeof senderTabId === 'number' &&
    !isExtensionPage(sender)
  ) {
    callback(toContext(senderTab, senderTabId))
    return
  }

  const isWebTab = (tab: chrome.tabs.Tab) => !isExtensionUrl(tab.url)

  chrome.tabs.query({ active: true, currentWindow: true }, activeTabs => {
    const active = activeTabs.find(isWebTab)

    if (typeof active?.id === 'number') {
      callback(toContext(active, active.id))
      return
    }

    // The active tab is an extension page in its own tab. Fall back to the web
    // page the user was on before opening it.
    chrome.tabs.query({ currentWindow: true }, tabs => {
      const recent = tabs
        .filter(isWebTab)
        .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]

      if (typeof recent?.id === 'number') {
        callback(toContext(recent, recent.id))
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

    if (message.type === 'rebobinate:forget-domain') {
      forget(message.domain)

      // The popup follows the stored map, so the write itself is the answer.
      return false
    }

    if (message.type === 'rebobinate:query') {
      withTargetTab(sender, tab => {
        // A top-frame load means a new page: speed and frame bookkeeping both
        // start over, and the speed comes back from what this domain is
        // remembered at.
        if (sender.frameId === 0) {
          tabSpeeds.delete(tab.id)
          tabFramesWithVideo.delete(tab.id)

          // A sub-frame may have loaded and reported before the top frame did,
          // in which case that report was just discarded. Telling every frame
          // the tab has no video makes the ones that do say so again.
          broadcast(tab.id, { type: 'rebobinate:tab-media', hasVideo: false })

          resolveStartSpeed(tab, speed => {
            tabSpeeds.set(tab.id, speed)
            sendResponse({ speed, hasVideo: tabHasVideo(tab.id) })
          })

          return
        }

        const known = tabSpeeds.get(tab.id)

        if (known !== undefined) {
          sendResponse({ speed: known, hasVideo: tabHasVideo(tab.id) })
          return
        }

        // A sub-frame that loaded before the top frame asked. Resolving from
        // the tab's own domain gives it the answer the top frame is about to
        // get, instead of a second of 1.0 before the broadcast corrects it.
        resolveStartSpeed(tab, speed => {
          sendResponse({ speed, hasVideo: tabHasVideo(tab.id) })
        })
      })

      return true
    }

    if (message.type === 'rebobinate:popup-state') {
      withTargetTab(sender, tab => {
        sendResponse({
          speed: tabSpeeds.get(tab.id) ?? 1,
          hasVideo: tabHasVideo(tab.id),
          domain: domainKeyFromUrl(tab.url),
        })
      })

      return true
    }

    withTargetTab(sender, tab => {
      readSettings(settings => {
        const known = tabSpeeds.get(tab.id)
        const current =
          known ??
          (message.type === 'rebobinate:intent' ? message.currentSpeed : 1)
        const isReset =
          message.type === 'rebobinate:intent' && message.action === 'reset'
        const speed = resolveSpeed(current, message, settings)

        tabSpeeds.set(tab.id, speed)
        broadcastSpeed(tab.id, speed)
        remember(tab, settings, speed, isReset)
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
