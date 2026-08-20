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

/**
 * The two states a row can be in that are not a speed. They are options of the
 * same select as the speeds are, so the whole row is one value the user reads
 * and sets in one place; the string values cannot collide with a speed's.
 */
const NEVER = 'never'
const DEFAULT = 'default'

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
   * Leaving the row with no entry at all, which takes two different messages.
   * `forgetDomain` deliberately leaves a marker standing — `0` on a site that
   * is switched off means "back to normal here", not "start remembering me
   * again" — so the marker is cleared by switching it off instead.
   */
  const clear = () => {
    if (never) {
      onSetNever(domain, false)
      return
    }

    onForget(domain)
  }

  /**
   * "Nothing remembered" is an entry being absent, so the option that says so
   * goes where the ✕ goes rather than being given a write of its own. A marker
   * carries a placeholder speed, so a never row lists the default's neighbours
   * rather than that placeholder.
   */
  const chooseState = (value: string) => {
    if (value === NEVER) {
      onSetNever(domain, true)
      return
    }

    if (value === DEFAULT) {
      clear()
      return
    }

    onSetSpeed(domain, Number(value))
  }

  const current = never ? NEVER : entry ? String(entry.speed) : DEFAULT
  const listed = entry && !never ? entry.speed : defaultSpeed

  return (
    <li className="site">
      <span className="site-name" title={domain}>
        {domain}
      </span>

      {/* Offered even with nothing remembered yet, so deciding what a site
          starts at does not first require going and changing a video's
          speed. */}
      <select
        className="site-speed-select"
        aria-label={`Speed for ${domain}`}
        value={current}
        onChange={event => chooseState(event.target.value)}
      >
        <option value={NEVER}>Never remember</option>
        <option value={DEFAULT}>
          Use default ({formatSpeedLabel(defaultSpeed)})
        </option>
        {speedOptions(listed).map(speed => (
          <option key={speed} value={speed}>
            {formatSpeedLabel(speed)}
          </option>
        ))}
      </select>

      {/* The one-click version of the select's `Use default`, which calls the
          same `clear` — so it is named for the same outcome rather than for a
          second vocabulary. A marker is still a stored entry, so the ✕ clears
          that too: otherwise a site switched off has no way back except the
          select that put it there. `disabled` says the button is about what is
          stored, which the select's option cannot. */}
      <button
        type="button"
        className="forget"
        aria-label={`Back to the default speed for ${domain}`}
        title={`Back to the default speed for ${domain}`}
        disabled={!entry}
        onClick={clear}
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

  /**
   * "Other" is a claim about this tab's site, so it is only sayable when that
   * site really is remembered. On a profile with nothing stored at all the word
   * implies a first entry that does not exist.
   */
  const emptyNote =
    others.length > 0
      ? 'No site matches that filter.'
      : domain !== null && domains.entries[domain] !== undefined
        ? 'No other site is remembered yet.'
        : 'No sites are remembered yet.'

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
            <p className="note">{emptyNote}</p>
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
