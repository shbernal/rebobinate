import { formatSpeedLabel, formatToolbarSpeed } from '@/shared/speed'

/**
 * The speed on the toolbar icon.
 *
 * Everything the extension does to `chrome.action` lives here, so the service
 * worker keeps owning speeds and this module keeps owning how they are drawn.
 *
 * There are two layers to the badge, and both are needed for "every tab shows a
 * number" to be true. The global text is what an untouched tab renders — a
 * `chrome://` page, the Web Store, a PDF, anywhere the content script cannot
 * run and so never reports in. A per-tab override sits on top of it for every
 * tab the extension has actually resolved a speed for.
 */

/**
 * Near-black rather than anything drawn from the icon: the icon is a deep
 * indigo square, and an indigo badge painted over its corner disappears into
 * it. White on this reads against the icon and under either browser theme.
 */
const BACKGROUND_COLOR = '#111827'
const TEXT_COLOR = '#ffffff'

/** Matches `action.default_title` in the manifest. */
const EXTENSION_TITLE = 'Rebobinate'

const titleFor = (speed: number) => {
  return `${EXTENSION_TITLE} — ${formatSpeedLabel(speed)}`
}

/**
 * Colours are global and survive every later text change, so they are set once
 * per service-worker start and never again.
 */
export const initToolbarBadge = (): void => {
  chrome.action.setBadgeBackgroundColor({ color: BACKGROUND_COLOR }, () => {
    void chrome.runtime.lastError
  })

  // Gecko picks a contrasting text colour on its own and Chromium does not, so
  // this is what keeps the two looking the same.
  chrome.action.setBadgeTextColor({ color: TEXT_COLOR }, () => {
    void chrome.runtime.lastError
  })
}

/** The number one tab shows, and the tooltip that spells it out in full. */
export const applyToolbarSpeed = (tabId: number, speed: number): void => {
  chrome.action.setBadgeText({ tabId, text: formatToolbarSpeed(speed) }, () => {
    // A tab that closed between the speed resolving and this call rejects both
    // of these. Expected, not an error worth surfacing.
    void chrome.runtime.lastError
  })

  chrome.action.setTitle({ tabId, title: titleFor(speed) }, () => {
    void chrome.runtime.lastError
  })
}

/** What a tab shows before the extension has heard anything about it. */
export const applyToolbarDefault = (speed: number): void => {
  chrome.action.setBadgeText({ text: formatToolbarSpeed(speed) }, () => {
    void chrome.runtime.lastError
  })

  chrome.action.setTitle({ title: titleFor(speed) }, () => {
    void chrome.runtime.lastError
  })
}

/**
 * Takes the speed off the icon everywhere.
 *
 * Clearing the global text is not enough: a per-tab override outlives the
 * service worker that wrote it, so a profile with tabs badged by an earlier
 * instance would keep showing numbers after the setting was switched off.
 * Walking every open tab is what makes the answer complete. `tabs.query`
 * reports ids without the `tabs` permission, which is all this needs.
 */
export const clearToolbarBadge = (): void => {
  chrome.action.setBadgeText({ text: '' }, () => {
    void chrome.runtime.lastError
  })

  chrome.action.setTitle({ title: EXTENSION_TITLE }, () => {
    void chrome.runtime.lastError
  })

  chrome.tabs.query({}, tabs => {
    void chrome.runtime.lastError

    tabs.forEach(tab => {
      if (typeof tab.id !== 'number') {
        return
      }

      chrome.action.setBadgeText({ tabId: tab.id, text: '' }, () => {
        void chrome.runtime.lastError
      })

      chrome.action.setTitle({ tabId: tab.id, title: EXTENSION_TITLE }, () => {
        void chrome.runtime.lastError
      })
    })
  })
}
