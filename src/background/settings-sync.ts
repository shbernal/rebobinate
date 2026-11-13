import {
  SETTINGS_STORAGE_KEY,
  normalizeSettings,
  writeSettings,
} from '@/shared/settings'

/**
 * Carries `Settings` between the user's browsers through `storage.sync`.
 *
 * `storage.local` stays the copy every surface reads and writes. Sync is a
 * replica the service worker keeps in step with it, in both directions:
 *
 * - a local change is copied to sync a second after the last one;
 * - a sync change, which is another browser's edit arriving, is copied into
 *   local, and every surface hears it there as an ordinary settings change.
 *
 * Writing sync directly from the popup would be simpler and does not survive
 * contact with its quota. Chrome allows about 120 sync writes a minute, the
 * popup writes on every input event, and dragging the hue slider for two
 * seconds is more than that: the write fails, the popup re-reads, and the
 * slider jumps back under the cursor. The debounce turns a drag into one
 * write, and it has to live here because the popup document, and any timer it
 * started, is gone the moment the panel closes.
 *
 * The domain map and the stats stay local: the map would need chunking under
 * the per-item quota, and watch time belongs to the device it was watched on.
 */

const SYNC_DEBOUNCE_MS = 1000

const isSame = (a: unknown, b: unknown) =>
  JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b))

const readArea = (
  area: chrome.storage.StorageArea,
  callback: (value: unknown) => void,
) => {
  area.get(SETTINGS_STORAGE_KEY, stored => {
    callback(stored?.[SETTINGS_STORAGE_KEY])
  })
}

/**
 * Copies what local holds now, not what it held when the copy was scheduled:
 * a sync change applied in between has already made local what sync is, and
 * the copy then finds nothing to write.
 */
const pushToSync = () => {
  readArea(chrome.storage.local, local => {
    if (local === undefined) {
      return
    }

    readArea(chrome.storage.sync, synced => {
      if (synced !== undefined && isSame(synced, local)) {
        return
      }

      chrome.storage.sync.set(
        { [SETTINGS_STORAGE_KEY]: normalizeSettings(local) },
        () => {
          // A refused sync write leaves this browser's settings intact in
          // local, and the next change tries again. Nobody is waiting on it.
          void chrome.runtime.lastError
        },
      )
    })
  })
}

const pullFromSync = (synced: unknown) => {
  readArea(chrome.storage.local, local => {
    if (local === undefined || !isSame(synced, local)) {
      writeSettings(normalizeSettings(synced))
    }
  })
}

export const startSettingsSync = () => {
  let pending: ReturnType<typeof setTimeout> | undefined

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const change = changes[SETTINGS_STORAGE_KEY]

    if (!change) {
      return
    }

    if (areaName === 'sync') {
      // Cleared from elsewhere is not a setting to apply; local keeps its own.
      if (change.newValue !== undefined) {
        pullFromSync(change.newValue)
      }

      return
    }

    if (areaName === 'local') {
      clearTimeout(pending)
      pending = setTimeout(pushToSync, SYNC_DEBOUNCE_MS)
    }
  })

  // At start-up a synced copy wins: it is how a second browser, or a
  // reinstall, picks up settings made elsewhere. With nothing synced yet, an
  // existing install seeds sync from what it already has, so upgrading
  // changes nothing for the user.
  readArea(chrome.storage.sync, synced => {
    if (synced !== undefined) {
      pullFromSync(synced)
      return
    }

    pushToSync()
  })
}
