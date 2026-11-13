import { useEffect, useState } from 'react'
import type { StatsStore } from '@/shared/stats'
import { normalizeStats, onStatsChange, readStats } from '@/shared/stats'
import { formatDuration, lastDays, totalsFor } from '@/shared/stats-summary'

const PERIODS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
] as const

/**
 * The headline numbers and the way to the full page. The stats store is read
 * here rather than by the shell: nothing else in the popup needs it, and it
 * is the one store that can be large.
 */
const StatsPane = ({ recording }: { recording: boolean }) => {
  const [store, setStore] = useState<StatsStore>(() => normalizeStats({}))
  // Read off the clock with each store, not on every render, so the window
  // only moves when there is something new to place in it.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const update = (next: StatsStore) => {
      setStore(next)
      setNow(Date.now())
    }

    readStats(update)

    return onStatsChange(update)
  }, [])

  return (
    <>
      {PERIODS.map(period => {
        const totals = totalsFor(store, lastDays(period.days, now))

        return (
          <section key={period.days} className="stats-period">
            <h2 className="pane-heading">{period.label}</h2>
            <dl className="stats-figures">
              <div>
                <dt>Saved</dt>
                <dd>{formatDuration(totals.saved)}</dd>
              </div>
              <div>
                <dt>Watched</dt>
                <dd>{formatDuration(totals.real)}</dd>
              </div>
            </dl>
          </section>
        )
      })}

      <p className="note">
        {recording
          ? 'Kept on this device only.'
          : 'Recording is off in Settings, so nothing new is added.'}
      </p>

      <button
        type="button"
        className="open-stats"
        onClick={() => {
          // Opening a tab closes the popup, so nothing waits on the answer.
          chrome.tabs.create({
            url: chrome.runtime.getURL('src/stats/stats-page.html'),
          })
        }}
      >
        Open full stats
      </button>
    </>
  )
}

export default StatsPane
