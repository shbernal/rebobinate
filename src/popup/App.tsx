import { useCallback, useEffect, useRef, useState } from 'react'
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

  /**
   * A floor under the scrolling pane, in pixels, while a pane asks for one.
   *
   * The pane is what the popup's height is: it has a ceiling and no floor, so
   * a list narrowing from twelve rows to three under a filter took 250px out
   * of the window, once per character typed. The Sites pane asks for the floor
   * while its filter box is in use and gives it back when the box is left, so
   * the window settles once rather than on every keystroke. Measured here
   * because this is whose element it is.
   */
  const paneRef = useRef<HTMLDivElement>(null)
  const [paneFloor, setPaneFloor] = useState<number | null>(null)
  const holdPaneHeight = useCallback((hold: boolean) => {
    const height = paneRef.current?.offsetHeight ?? 0

    setPaneFloor(hold && height > 0 ? height : null)
  }, [])

  /**
   * Empty space held at the foot of the pane, in pixels, after a block inside
   * it has collapsed.
   *
   * The floor above is about the popup's height; this is about its scroll
   * position, which is the same class of problem one layer down. Throwing the
   * on-video badge's switch takes some 350px out of the middle of the Settings
   * tab, which drops the pane's scroll range by the same amount — so the
   * browser clamps `scrollTop` to the new maximum and the switch that was just
   * clicked slides down the pane with unrelated rows arriving above it. Slack
   * at the foot keeps the old `scrollTop` valid, so nothing moves.
   *
   * It is not left there. Every scroll event shrinks it to exactly what is
   * still needed to hold the position it is at, so it melts as the user
   * scrolls back up and is gone by the time they reach the top; scrolling down
   * into it cannot grow it, because the same formula caps it at the position
   * reached. A tab change clears it outright.
   */
  const [paneSlack, setPaneSlack] = useState(0)

  const meltPaneSlack = useCallback(() => {
    const pane = paneRef.current

    if (pane === null) {
      return
    }

    setPaneSlack(slack => {
      if (slack === 0) {
        return 0
      }

      const natural = pane.scrollHeight - slack - pane.clientHeight

      return Math.max(0, Math.min(slack, pane.scrollTop - natural))
    })
  }, [])

  /**
   * Told which element is about to stop taking up room, or `null` when one has
   * come back. The pane is this component's element, so what a collapse costs
   * it is worked out here.
   *
   * The slack is the block's whole height rather than the difference, which is
   * always at least what the collapse removes and so is always enough; the
   * melt above gives the rest back on the first scroll.
   *
   * The scroll correction is the sticky header. A block whose header is stuck
   * to the top of the pane has already scrolled past it by however much the
   * header is masking, and once the block is shorter than that it is gone off
   * the top entirely — holding `scrollTop` would keep every other row still
   * and lose the switch that was just pressed. Scrolling back by exactly the
   * masked amount is what puts the header where it already looked like it was.
   */
  const holdPaneSlack = useCallback((block: HTMLElement | null) => {
    const pane = paneRef.current

    if (block === null || pane === null) {
      setPaneSlack(0)
      return
    }

    const masked =
      pane.getBoundingClientRect().top - block.getBoundingClientRect().top

    if (masked > 0) {
      pane.scrollTop -= masked
    }

    setPaneSlack(Math.round(block.offsetHeight))
  }, [])

  const openTab = useCallback((next: TabId) => {
    setTab(next)
    setPaneSlack(0)
  }, [])

  /**
   * Asks the service worker what this tab is doing. It is the only source for
   * either value: the tab's speed lives in the worker's `tabSpeeds`, and the
   * domain takes a `tabs.query` the popup cannot make for itself.
   */
  const readPopupState = useCallback(() => {
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
  }, [])

  useEffect(() => {
    readSettings(setSettings)
    readDomains(setDomains)
    readPopupState()

    const stopSettings = onSettingsChange(setSettings)
    const stopDomains = onDomainsChange(setDomains)

    return () => {
      stopSettings()
      stopDomains()
    }
  }, [readPopupState])

  /**
   * Throwing the master switch off makes the service worker drop the tab's
   * speed — deliberately, so the next keystroke resumes from the video rather
   * than from a parked number — and puts the video back to 1.0×. The number
   * this component is holding survived that, so switching back on used to
   * leave the readout naming the old speed and the preset chip for it still
   * drawn as pressed, over a video at normal rate. Asking again is the only
   * way to find out; the worker answers with the truth either way.
   *
   * The ref is because an effect runs on the first render too, and the mount
   * effect above has already asked.
   */
  const wasEnabled = useRef(settings.enabled)

  useEffect(() => {
    const before = wasEnabled.current

    wasEnabled.current = settings.enabled

    if (settings.enabled && !before) {
      readPopupState()
    }
  }, [settings.enabled, readPopupState])

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

      {/* The one place the panel says what the switch above it did. It is a
          statement of consequence rather than a footnote, so it takes the
          `.rule` tier, and it sits above the tab strip — beside the switch it
          is about, and on screen whichever tab is open. The Sites and Settings
          tabs stay live under it: pausing the extension is very often the step
          before changing the setting that made you pause it, and this line is
          what tells those tabs they are dormant. */}
      {settings.enabled ? null : (
        <p className="rule off-line">
          Off. No video is being sped up and the shortcuts do nothing.
          Everything below is kept.
        </p>
      )}

      <Tabs tabs={TABS} active={tab} onSelect={openTab} />

      <div
        className="pane"
        ref={paneRef}
        style={paneFloor === null ? undefined : { minHeight: paneFloor }}
        onScroll={meltPaneSlack}
        role="tabpanel"
        id={tabPanelId(tab)}
        aria-labelledby={tabId(tab)}
      >
        {tab === 'speed' ? (
          <SpeedPane
            enabled={settings.enabled}
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
            /* Whether there is an entry to be a receipt about, read from the
               same subscribed map the Sites tab follows. It picks the tense
               rather than the figure: while the extension is on, the receipt
               names the readout's speed, so the two cannot disagree across the
               service worker's write debounce. */
            rememberedSpeed={
              domain !== null ? (domains.entries[domain]?.speed ?? null) : null
            }
            /* The receipt's Forget is the Sites row's ✕ under another name:
               same message, same outcome, offered where the write was
               announced rather than a tab away. `remembered` already rules out
               a marker, so the plain forget is the right one of the two
               clears. */
            onForget={() => {
              if (domain !== null) {
                forgetSite(domain)
              }
            }}
            onShowSites={() => openTab('sites')}
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
            onHoldHeight={holdPaneHeight}
          />
        ) : null}

        {tab === 'settings' ? (
          <SettingsPane
            settings={settings}
            save={save}
            speed={speed}
            domains={domains}
            onImport={importBackup}
            onHoldSlack={holdPaneSlack}
          />
        ) : null}

        {/* Last in the pane, and empty. See `paneSlack`. */}
        {paneSlack > 0 ? (
          <div
            className="pane-slack"
            aria-hidden
            style={{ height: paneSlack }}
          />
        ) : null}
      </div>
    </main>
  )
}

export default App
