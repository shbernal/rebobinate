import { vi } from 'vitest'

type Listener<TArgs extends unknown[], TResult = void> = (
  ...args: TArgs
) => TResult

const createChromeEvent = <TArgs extends unknown[], TResult = void>() => {
  const listeners = new Set<Listener<TArgs, TResult>>()

  return {
    addListener: vi.fn((listener: Listener<TArgs, TResult>) => {
      listeners.add(listener)
    }),
    removeListener: vi.fn((listener: Listener<TArgs, TResult>) => {
      listeners.delete(listener)
    }),
    hasListener: vi.fn((listener: Listener<TArgs, TResult>) => {
      return listeners.has(listener)
    }),
    emit: (...args: TArgs) => {
      return Array.from(listeners, listener => listener(...args))
    },
    listeners: () => Array.from(listeners),
  }
}

type StorageValues = Record<string, unknown>
type StorageKeys = string | string[] | StorageValues | null | undefined
type StorageChange = chrome.storage.StorageChange
type StorageChanges = Record<string, StorageChange>
type StorageChangedArgs = [StorageChanges, chrome.storage.AreaName]
type RuntimeMessageArgs = [
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
]
type TabRemovedArgs = [tabId: number, removeInfo: chrome.tabs.OnRemovedInfo]
type TabUpdatedArgs = [
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo,
  tab: chrome.tabs.Tab,
]

/** The global badge, which every tab without an override of its own shows. */
const GLOBAL = 'global'

const pickStorageValues = (values: StorageValues, keys: StorageKeys) => {
  if (keys === null || keys === undefined) {
    return { ...values }
  }

  if (typeof keys === 'string') {
    return { [keys]: values[keys] }
  }

  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map(key => [key, values[key]]))
  }

  return Object.fromEntries(
    Object.entries(keys).map(([key, fallback]) => [
      key,
      Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : fallback,
    ]),
  )
}

export const createChromeMock = () => {
  const values: StorageValues = {}
  let openTabs: chrome.tabs.Tab[] = [{ id: 1, active: true } as chrome.tabs.Tab]
  const storageChanged = createChromeEvent<StorageChangedArgs>()
  const runtimeMessage = createChromeEvent<RuntimeMessageArgs, boolean>()
  const tabRemoved = createChromeEvent<TabRemovedArgs>()
  const tabUpdated = createChromeEvent<TabUpdatedArgs>()

  // Keyed by tab id, with the global badge under its own key, because that is
  // the distinction the real API draws: a tab without an entry renders the
  // global text, and clearing one is not the same as clearing the other.
  const badgeText = new Map<number | typeof GLOBAL, string>()
  const badgeTitle = new Map<number | typeof GLOBAL, string>()

  const recordAction = <Details extends { tabId?: number }>(
    store: Map<number | typeof GLOBAL, string>,
    details: Details,
    value: string,
  ) => {
    store.set(details.tabId ?? GLOBAL, value)
  }

  const local = {
    get: vi.fn(
      (keys: StorageKeys, callback: (items: StorageValues) => void) => {
        callback(pickStorageValues(values, keys))
      },
    ),
    set: vi.fn((items: StorageValues, callback?: () => void) => {
      const changes = Object.fromEntries(
        Object.entries(items).map(([key, newValue]) => [
          key,
          {
            oldValue: values[key],
            newValue,
          },
        ]),
      )

      Object.assign(values, items)

      if (Object.keys(changes).length > 0) {
        storageChanged.emit(changes, 'local')
      }

      callback?.()
    }),
    seed: (items: StorageValues) => {
      Object.assign(values, items)
    },
    snapshot: () => ({ ...values }),
  }

  return {
    runtime: {
      lastError: undefined,
      id: 'rebobinate-test',
      onMessage: runtimeMessage,
      sendMessage: vi.fn(
        (_message: unknown, callback?: (response?: unknown) => void) => {
          callback?.()
        },
      ),
    },
    storage: {
      local,
      onChanged: storageChanged,
    },
    action: {
      setBadgeText: vi.fn(
        (details: chrome.action.BadgeTextDetails, callback?: () => void) => {
          recordAction(badgeText, details, details.text ?? '')
          callback?.()
        },
      ),
      setTitle: vi.fn(
        (details: chrome.action.TitleDetails, callback?: () => void) => {
          recordAction(badgeTitle, details, details.title)
          callback?.()
        },
      ),
      setBadgeBackgroundColor: vi.fn(
        (_details: chrome.action.BadgeColorDetails, callback?: () => void) => {
          callback?.()
        },
      ),
      setBadgeTextColor: vi.fn(
        (_details: chrome.action.BadgeColorDetails, callback?: () => void) => {
          callback?.()
        },
      ),
      /** The text a tab renders: its own override, or the global one. */
      badgeText: (tabId?: number) => {
        if (tabId === undefined) {
          return badgeText.get(GLOBAL)
        }

        return badgeText.has(tabId)
          ? badgeText.get(tabId)
          : badgeText.get(GLOBAL)
      },
      badgeTitle: (tabId?: number) => {
        if (tabId === undefined) {
          return badgeTitle.get(GLOBAL)
        }

        return badgeTitle.has(tabId)
          ? badgeTitle.get(tabId)
          : badgeTitle.get(GLOBAL)
      },
    },
    tabs: {
      onRemoved: tabRemoved,
      onUpdated: tabUpdated,
      // The tabs a query answers with. Seeded rather than fixed because the
      // service worker now reads the tab's URL and its private-window flag, not
      // just its id. A seeded tab with no `url` is the shape Chromium returns
      // for one the extension has no access to — the key is absent, not empty.
      seed: (next: Partial<chrome.tabs.Tab>[]) => {
        openTabs = next as chrome.tabs.Tab[]
      },
      query: vi.fn(
        (
          queryInfo: chrome.tabs.QueryInfo,
          callback: (tabs: chrome.tabs.Tab[]) => void,
        ) => {
          // `active` is honoured because the service worker asks twice, once
          // narrowed to the active tab and once not, and the second query only
          // means something if it can answer with more than the first.
          callback(
            queryInfo.active === undefined
              ? openTabs
              : openTabs.filter(tab => tab.active === queryInfo.active),
          )
        },
      ),
      sendMessage: vi.fn(
        (
          _tabId: number,
          _message: unknown,
          callback?: (response?: unknown) => void,
        ) => {
          callback?.()
        },
      ),
    },
  }
}

export type ChromeMock = ReturnType<typeof createChromeMock>

let currentChromeMock: ChromeMock | null = null

export const installChromeMock = () => {
  currentChromeMock = createChromeMock()
  vi.stubGlobal('chrome', currentChromeMock)
  return currentChromeMock
}

export const getChromeMock = () => {
  if (!currentChromeMock) {
    throw new Error('Chrome mock has not been installed')
  }

  return currentChromeMock
}
