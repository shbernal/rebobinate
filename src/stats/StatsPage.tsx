import { useEffect, useState } from 'react'
import type { Settings, StatsRetentionDays } from '@/shared/settings'
import {
  DEFAULT_SETTINGS,
  STATS_RETENTION_DAYS,
  onSettingsChange,
  readSettings,
  writeSettings,
} from '@/shared/settings'
import type { StatsStore } from '@/shared/stats'
import { normalizeStats, onStatsChange, readStats } from '@/shared/stats'
import {
  dailyTotals,
  formatDuration,
  lastDays,
  siteTotals,
  totalsFor,
} from '@/shared/stats-summary'
import SavedChart from './SavedChart'

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
] as const

const RETENTION_LABELS: Record<StatsRetentionDays, string> = {
  90: '90 days',
  365: '1 year',
  0: 'Forever',
}

/**
 * The full stats page, opened in a tab from the popup's Stats tab.
 *
 * Like the popup it renders defaults at once and lets storage arrive
 * underneath, and it follows both stores, so a video playing in another tab
 * fills the numbers in while the page is open.
 */
const StatsPage = () => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [store, setStore] = useState<StatsStore>(() => normalizeStats({}))
  const [range, setRange] = useState<7 | 30>(7)
  const [confirming, setConfirming] = useState(false)
  // The window is today and the days before it, so it is read off the clock
  // with each store rather than pinned at mount: a page left open over
  // midnight moves on with the next write.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const update = (next: StatsStore) => {
      setStore(next)
      setNow(Date.now())
    }

    readSettings(setSettings)
    readStats(update)

    const stopSettings = onSettingsChange(setSettings)
    const stopStats = onStatsChange(update)

    return () => {
      stopSettings()
      stopStats()
    }
  }, [])

  const days = lastDays(range, now)
  const totals = totalsFor(store, days)
  const daily = dailyTotals(store, days)
  const sites = siteTotals(store, days)
  const recordedDays = Object.keys(store.days).length

  const clear = () => {
    chrome.runtime.sendMessage({ type: 'rebobinate:clear-stats' }, () => {
      void chrome.runtime.lastError
    })
    setConfirming(false)
  }

  return (
    <main className="stats">
      <header className="stats-header">
        <h1>Watch time</h1>
        <div className="segmented" role="group" aria-label="Period">
          {RANGES.map(option => (
            <button
              key={option.days}
              type="button"
              aria-pressed={range === option.days}
              onClick={() => setRange(option.days)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <p className="stats-privacy">
        Recorded per day, site and speed, and stored on this device only.
        Nothing is ever sent anywhere.
      </p>

      {settings.rememberStats ? null : (
        <p className="rule">
          Recording is off, so nothing new is added. Turn it back on under
          Settings in the popup.
        </p>
      )}

      <section className="tiles" aria-label="Totals">
        <div className="tile">
          <span className="tile-label">Time saved</span>
          <span className="tile-value">{formatDuration(totals.saved)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Time watched</span>
          <span className="tile-value">{formatDuration(totals.real)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Video covered</span>
          <span className="tile-value">{formatDuration(totals.content)}</span>
        </div>
      </section>

      <section className="stats-section">
        <h2>Time saved per day</h2>
        {totals.real > 0 ? (
          <SavedChart days={daily} />
        ) : (
          <p className="note">
            Nothing watched in this period yet. Time is counted while a video
            plays in a visible tab.
          </p>
        )}
      </section>

      <section className="stats-section">
        <h2>By site</h2>
        {sites.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Time saved</th>
                <th scope="col">Watched</th>
              </tr>
            </thead>
            <tbody>
              {sites.map(site => (
                <tr key={site.domain}>
                  <th scope="row">{site.domain}</th>
                  <td>{formatDuration(site.saved)}</td>
                  <td>{formatDuration(site.real)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="note">No site in this period.</p>
        )}
      </section>

      <section className="stats-section">
        <h2>Keeping</h2>
        <div className="field">
          <label htmlFor="retention">Keep stats for</label>
          <select
            id="retention"
            value={settings.statsRetentionDays}
            onChange={event =>
              writeSettings({
                ...settings,
                statsRetentionDays: Number(
                  event.target.value,
                ) as StatsRetentionDays,
              })
            }
          >
            {STATS_RETENTION_DAYS.map(days => (
              <option key={days} value={days}>
                {RETENTION_LABELS[days]}
              </option>
            ))}
          </select>
        </div>
        <p className="note">
          Older days are dropped the next time something is recorded.
        </p>

        {/* An inline second step rather than `confirm()`: a native dialog
            from an extension page is a separate window on some platforms and
            is blocked outright on others. */}
        {confirming ? (
          <div className="confirm" role="group" aria-label="Clear all stats">
            <p>
              Clear {recordedDays} {recordedDays === 1 ? 'day' : 'days'} of
              stats? This cannot be undone.
            </p>
            <button type="button" className="danger" onClick={clear}>
              Clear
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={recordedDays === 0}
            onClick={() => setConfirming(true)}
          >
            Clear all stats
          </button>
        )}
      </section>
    </main>
  )
}

export default StatsPage
