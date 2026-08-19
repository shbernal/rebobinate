import { useState } from 'react'
import type { DomainMemory, DomainStore } from '@/shared/domains'
import type { Settings } from '@/shared/settings'
import { formatSpeedLabel } from '@/shared/speed'
import { speedOptions } from './speeds'
import Toggle from './Toggle'

/**
 * The map holds up to 500 sites and this is a 320px popup. Past this many rows
 * the list is cut and says so — a silent truncation would read as "that is
 * everything" — and the filter is how the rest is reached.
 */
const MAX_ROWS = 40
const FILTER_FROM = 8

type RowProps = {
  domain: string
  entry: DomainMemory | undefined
  /** What an unset row offers, so the user's own default is in its list. */
  defaultSpeed: number
  onSetSpeed: (domain: string, speed: number) => void
  onSetNever: (domain: string, never: boolean) => void
  onForget: (domain: string) => void
}

const SiteRow = ({
  domain,
  entry,
  defaultSpeed,
  onSetSpeed,
  onSetNever,
  onForget,
}: RowProps) => {
  const never = entry?.never === true

  /**
   * "No speed" and "no entry" are the same state, so the blank option is routed
   * where the ✕ goes rather than being given a meaning of its own. It is the
   * already-selected option of an unset row, so in practice the ✕ is the way
   * back; this is what keeps the two from drifting apart if that changes.
   */
  const chooseSpeed = (value: string) => {
    if (value === '') {
      onForget(domain)
      return
    }

    onSetSpeed(domain, Number(value))
  }

  return (
    <li className="site">
      <span className="site-name" title={domain}>
        {domain}
      </span>

      {never ? (
        // No speed to show, and no second "Never": the caption on the switch
        // below already says what this row is.
        <span className="site-speed">—</span>
      ) : (
        // Offered even with nothing remembered yet, so deciding what a site
        // starts at does not first require going and changing a video's speed.
        <select
          className="site-speed-select"
          aria-label={`Speed for ${domain}`}
          value={entry ? entry.speed : ''}
          onChange={event => chooseSpeed(event.target.value)}
        >
          {entry ? null : <option value="">—</option>}
          {speedOptions(entry ? entry.speed : defaultSpeed).map(speed => (
            <option key={speed} value={speed}>
              {formatSpeedLabel(speed)}
            </option>
          ))}
        </select>
      )}

      {/* The switch is named in the row rather than only in its `aria-label`:
          an unlabelled track is read as "off" without saying off what. */}
      <span className="site-never">Never</span>
      <Toggle
        label={`Never remember ${domain}`}
        checked={never}
        onChange={value => onSetNever(domain, value)}
      />

      <button
        type="button"
        className="forget"
        aria-label={`Forget ${domain}`}
        title={`Forget the speed remembered for ${domain}`}
        disabled={!entry || never}
        onClick={() => onForget(domain)}
      >
        ✕
      </button>
    </li>
  )
}

type SitesPaneProps = {
  settings: Settings
  save: (next: Settings) => void
  /** The domain the active tab counts as, resolved by the service worker. */
  domain: string | null
  domains: DomainStore
  onSetSpeed: (domain: string, speed: number) => void
  onSetNever: (domain: string, never: boolean) => void
  onForget: (domain: string) => void
}

const SitesPane = ({
  settings,
  save,
  domain,
  domains,
  onSetSpeed,
  onSetNever,
  onForget,
}: SitesPaneProps) => {
  const [filter, setFilter] = useState('')

  // The most recently touched first: on a profile with hundreds of sites, the
  // one the user is looking for is almost always one they used recently.
  const others = Object.entries(domains.entries)
    .filter(([key]) => key !== domain)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)

  const query = filter.trim().toLowerCase()
  const matching = query
    ? others.filter(([key]) => key.includes(query))
    : others
  const shown = matching.slice(0, MAX_ROWS)
  const hidden = matching.length - shown.length

  const rowProps = {
    defaultSpeed: settings.defaultSpeed,
    onSetSpeed,
    onSetNever,
    onForget,
  }

  return (
    <>
      <section className="field">
        <label htmlFor="default-speed">Default speed</label>
        <select
          id="default-speed"
          value={settings.defaultSpeed}
          onChange={event =>
            save({ ...settings, defaultSpeed: Number(event.target.value) })
          }
        >
          {speedOptions(settings.defaultSpeed).map(speed => (
            <option key={speed} value={speed}>
              {formatSpeedLabel(speed)}
            </option>
          ))}
        </select>
      </section>

      <section className="field">
        <span>Remember per site</span>
        <Toggle
          label="Remember per site"
          checked={settings.rememberPerDomain}
          onChange={rememberPerDomain =>
            save({ ...settings, rememberPerDomain })
          }
        />
      </section>

      {settings.rememberPerDomain ? (
        <>
          <hr />

          <h2 className="pane-heading">This tab</h2>
          {/* Under the first switch the user meets, rather than under the
              heading below it, and naming the control it describes. */}
          <p className="note">
            Never: this site is left out of the memory and always starts at the
            default speed.
          </p>
          {domain ? (
            <ul className="sites">
              <SiteRow
                domain={domain}
                entry={domains.entries[domain]}
                {...rowProps}
              />
            </ul>
          ) : (
            <p className="note">
              This page is not one a speed can be remembered for.
            </p>
          )}

          <hr />

          <h2 className="pane-heading">
            Remembered sites{others.length > 0 ? ` (${others.length})` : ''}
          </h2>

          {others.length >= FILTER_FROM ? (
            <section className="field">
              <label htmlFor="site-filter">Filter</label>
              <input
                id="site-filter"
                type="search"
                value={filter}
                placeholder="domain"
                onChange={event => setFilter(event.target.value)}
              />
            </section>
          ) : null}

          {shown.length > 0 ? (
            <ul className="sites">
              {shown.map(([key, entry]) => (
                <SiteRow key={key} domain={key} entry={entry} {...rowProps} />
              ))}
            </ul>
          ) : (
            <p className="note">
              {others.length > 0
                ? 'No site matches that filter.'
                : 'No other site is remembered yet.'}
            </p>
          )}

          {hidden > 0 ? (
            <p className="note">
              {hidden} more not shown — filter to narrow the list.
            </p>
          ) : null}
        </>
      ) : (
        <p className="note">
          Every site starts at the default speed while this is off, and nothing
          is written down.
        </p>
      )}
    </>
  )
}

export default SitesPane
