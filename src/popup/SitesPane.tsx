import { useState } from 'react'
import type { DomainMemory, DomainStore } from '@/shared/domains'
import type { Settings } from '@/shared/settings'
import { formatSpeedLabel } from '@/shared/speed'
import Toggle from './Toggle'

/**
 * The speeds a site can be set to from this pane, and the same list the default
 * speed uses. It is a short list rather than a typed field for the reason the
 * step field shows: a free-form number needs a draft state, because its halfway
 * values are not valid settings, and a starting speed has only a handful of
 * useful answers. A `<select>` also keeps the popup compact.
 */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

/**
 * A speed set from the keyboard lands anywhere on the step grid, so the stored
 * value is usually not one of the presets. It is added rather than rounded away:
 * opening the list must not silently change what a site is remembered at.
 */
const speedOptions = (current: number) => {
  return SPEEDS.includes(current)
    ? SPEEDS
    : [...SPEEDS, current].sort((a, b) => a - b)
}

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
  onSetSpeed: (domain: string, speed: number) => void
  onSetNever: (domain: string, never: boolean) => void
  onForget: (domain: string) => void
}

const SiteRow = ({
  domain,
  entry,
  onSetSpeed,
  onSetNever,
  onForget,
}: RowProps) => {
  const never = entry?.never === true

  return (
    <li className="site">
      <span className="site-name" title={domain}>
        {domain}
      </span>

      {never ? (
        <span className="site-speed">Never</span>
      ) : entry ? (
        <select
          className="site-speed-select"
          aria-label={`Speed for ${domain}`}
          value={entry.speed}
          onChange={event => onSetSpeed(domain, Number(event.target.value))}
        >
          {speedOptions(entry.speed).map(speed => (
            <option key={speed} value={speed}>
              {formatSpeedLabel(speed)}
            </option>
          ))}
        </select>
      ) : (
        <span className="site-speed">—</span>
      )}

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

  const rowProps = { onSetSpeed, onSetNever, onForget }

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
          <p className="note">
            The switch leaves a site out of the memory altogether.
          </p>

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
