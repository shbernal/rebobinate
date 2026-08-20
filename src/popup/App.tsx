import { useCallback, useEffect, useState } from 'react'
import type { BackupContents } from '@/shared/backup'
import type { RuntimeMessage, SpeedResponse } from '@/shared/messages'
import type { SpeedAction } from '@/shared/keys'
import type { DomainStore } from '@/shared/domains'
import {
  EMPTY_DOMAIN_STORE,
  onDomainsChange,
  readDomains,
} from '@/shared/domains'
import type { Settings } from '@/shared/settings'
import {
  DEFAULT_SETTINGS,
  onSettingsChange,
  readSettings,
  writeSettings,
} from '@/shared/settings'
import SettingsPane from './SettingsPane'
import SitesPane from './SitesPane'
import SpeedPane from './SpeedPane'
import Tabs, { tabId, tabPanelId } from './Tabs'
import type { Tab } from './Tabs'
import Toggle from './Toggle'
import './App.css'

type TabId = 'speed' | 'sites' | 'settings'

/**
 * The Stats tab the plan calls for is not here yet: there is nothing to put in
 * it until the metrics feature exists, and a tab that opens onto a placeholder
 * is worse than one that is not there. Adding it is one entry in this list.
 */
const TABS: Tab<TabId>[] = [
  { id: 'speed', label: 'Speed' },
  { id: 'sites', label: 'Sites' },
  { id: 'settings', label: 'Settings' },
]

const sendMessage = (
  message: RuntimeMessage,
  onResponse?: (speed: number) => void,
) => {
  chrome.runtime.sendMessage(message, (response?: { speed?: number }) => {
    void chrome.runtime.lastError

    if (typeof response?.speed === 'number') {
      onResponse?.(response.speed)
    }
  })
}

/**
 * The popup shell: it owns everything the panes read and renders one of them.
 *
 * Nothing here waits on storage. Both reads answer on a callback a tick or two
 * later, and gating the first paint on them is how a popup ends up flashing an
 * empty box every time it is opened — so the defaults render immediately and
 * the real values arrive underneath.
 */
const App = () => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [speed, setSpeed] = useState(1)
  const [tab, setTab] = useState<TabId>('speed')
  /**
   * The domain the active tab counts as. The service worker resolves it, not
   * the popup: the popup is its own document with no handle on the tab it was
   * opened over, so working out which tab that even is takes a `tabs.query`
   * only the background can usefully make.
   */
  const [domain, setDomain] = useState<string | null>(null)
  const [domains, setDomains] = useState<DomainStore>(EMPTY_DOMAIN_STORE)

  useEffect(() => {
    readSettings(setSettings)
    readDomains(setDomains)

    chrome.runtime.sendMessage(
      { type: 'rebobinate:popup-state' } satisfies RuntimeMessage,
      (response?: SpeedResponse) => {
        void chrome.runtime.lastError

        if (typeof response?.speed === 'number') {
          setSpeed(response.speed)
        }

        setDomain(response?.domain ?? null)
      },
    )

    const stopSettings = onSettingsChange(setSettings)
    const stopDomains = onDomainsChange(setDomains)

    return () => {
      stopSettings()
      stopDomains()
    }
  }, [])

  const save = useCallback((next: Settings) => {
    setSettings(next)
    writeSettings(next)
  }, [])

  const act = (action: SpeedAction) => {
    sendMessage(
      { type: 'rebobinate:intent', action, currentSpeed: speed },
      setSpeed,
    )
  }

  /** The preset chips. `resolveSpeed` clamps it, as it does any other set. */
  const jumpTo = (next: number) => {
    sendMessage({ type: 'rebobinate:set', speed: next }, setSpeed)
  }

  /**
   * Every edit to the map is routed through the service worker rather than
   * written here: a speed change on that domain may still be sitting in its
   * debounce, and only the service worker can cancel it. The stored map is what
   * the list follows, so the write is the answer.
   */
  const forgetSite = useCallback((target: string) => {
    sendMessage({ type: 'rebobinate:forget-domain', domain: target })
  }, [])

  const setSiteSpeed = useCallback((target: string, next: number) => {
    sendMessage({
      type: 'rebobinate:set-domain-speed',
      domain: target,
      speed: next,
    })
  }, [])

  const setSiteNever = useCallback((target: string, never: boolean) => {
    sendMessage({ type: 'rebobinate:set-domain-never', domain: target, never })
  }, [])

  /**
   * A restore writes the two stores the way each is written anywhere else: the
   * popup owns the settings object, and the service worker owns the domain map.
   * Neither is set in state here — both reads are subscribed to the storage
   * they came from, so the write is what puts the restored values on screen.
   */
  const importBackup = useCallback(
    (contents: BackupContents) => {
      if (contents.settings) {
        save(contents.settings)
      }

      if (contents.domains) {
        sendMessage({
          type: 'rebobinate:import-domains',
          store: contents.domains,
        })
      }
    },
    [save],
  )

  return (
    <main className="popup">
      <header className="header">
        <h1>Rebobinate</h1>
        {/* The switch says what it is on screen and not only to a screen
            reader. Its scope is left to where it sits: above the tab strip,
            where nothing per-site or per-tab lives. */}
        <span className="header-toggle">
          <span>Enabled</span>
          <Toggle
            label="Enabled"
            size="large"
            checked={settings.enabled}
            onChange={enabled => save({ ...settings, enabled })}
          />
        </span>
      </header>

      <Tabs tabs={TABS} active={tab} onSelect={setTab} />

      <div
        className="pane"
        role="tabpanel"
        id={tabPanelId(tab)}
        aria-labelledby={tabId(tab)}
      >
        {tab === 'speed' ? (
          <SpeedPane
            speed={speed}
            defaultSpeed={settings.defaultSpeed}
            keys={settings.keys}
            onAction={act}
            onSetSpeed={jumpTo}
            domain={domain}
            /* The three things that have to hold for a speed set here to
               survive the tab: the feature is on, there is a domain to hang
               it on, and this one is not marked never. Whether anything is
               stored for it yet is a separate question — it is what the pane
               says in the present tense rather than the future. */
            remembered={
              settings.rememberPerDomain &&
              domain !== null &&
              domains.entries[domain]?.never !== true
            }
            hasEntry={domain !== null && domains.entries[domain] !== undefined}
          />
        ) : null}

        {tab === 'sites' ? (
          <SitesPane
            settings={settings}
            save={save}
            domain={domain}
            domains={domains}
            onSetSpeed={setSiteSpeed}
            onSetNever={setSiteNever}
            onForget={forgetSite}
          />
        ) : null}

        {tab === 'settings' ? (
          <SettingsPane
            settings={settings}
            save={save}
            speed={speed}
            domains={domains}
            onImport={importBackup}
          />
        ) : null}
      </div>
    </main>
  )
}

export default App
