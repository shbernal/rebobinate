import { useEffect, useRef, useState } from 'react'
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
  /**
   * Told what was cleared, and what it held. Only the rows in the list below
   * get this: clearing the `This tab` row leaves the row standing on the
   * default, so there is nothing there to put back.
   */
  onDropped?: (domain: string, entry: DomainMemory) => void
}

const SiteRow = ({
  domain,
  entry,
  defaultSpeed,
  onSetSpeed,
  onSetNever,
  onForget,
  onDropped,
}: RowProps) => {
  const never = entry?.never === true

  /**
   * Leaving the row with no entry at all, which takes two different messages.
   * `forgetDomain` deliberately leaves a marker standing — `0` on a site that
   * is switched off means "back to normal here", not "start remembering me
   * again" — so the marker is cleared by switching it off instead.
   */
  const clear = () => {
    if (entry) {
      onDropped?.(domain, entry)
    }

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
  const dropLabel = never
    ? `Start remembering ${domain} again`
    : `Stop remembering ${domain}`

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
          same `clear`. It is named for what it drops rather than for the speed
          the site lands on: in the list below, what the user sees the click do
          is a row leave, and "Back to the default speed for X" named an effect
          that disappearance does not carry. A marker is a stored entry too, so
          the ✕ clears that as well — the opposite outcome, and the opposite
          sentence. `disabled` says the button is about what is stored, which
          the select's option cannot. */}
      <button
        type="button"
        className="forget"
        aria-label={dropLabel}
        title={dropLabel}
        disabled={!entry}
        onClick={clear}
      >
        ✕
      </button>
    </li>
  )
}

/**
 * What is left where a dropped row was, until the pane is left.
 *
 * A popup closes the moment the user clicks anything outside it, so a timed
 * undo would be a window the panel cannot promise. This one is a place instead
 * of a period: it holds the row's slot in the list, and it is spent when the
 * next row is dropped, when the filter is retyped, or when the tab is left. At
 * `.note`'s weight, because it is a line about a site rather than a site.
 */
const DroppedRow = ({
  domain,
  onUndo,
}: {
  domain: string
  onUndo: () => void
}) => (
  <li className="site site-dropped">
    <span className="site-name" title={domain}>
      {domain}
    </span>
    <button
      type="button"
      className="undo"
      aria-label={`Undo dropping ${domain}`}
      onClick={onUndo}
    >
      Undo
    </button>
  </li>
)

type SitesPaneProps = {
  settings: Settings
  save: (next: Settings) => void
  /** The domain the active tab counts as, resolved by the service worker. */
  domain: string | null
  domains: DomainStore
  onSetSpeed: (domain: string, speed: number) => void
  onSetNever: (domain: string, never: boolean) => void
  onForget: (domain: string) => void
  /**
   * Asks the shell to hold the scrolling pane at the height it has now, or to
   * let it go. The pane is the shell's element and its height is the popup's,
   * so the measuring belongs there; this pane only knows when the filter box
   * is in use.
   */
  onHoldHeight: (hold: boolean) => void
}

/** The one row that has been dropped and can still be put back. */
type Dropped = { domain: string; entry: DomainMemory }

const SitesPane = ({
  settings,
  save,
  domain,
  domains,
  onSetSpeed,
  onSetNever,
  onForget,
  onHoldHeight,
}: SitesPaneProps) => {
  const [filter, setFilter] = useState('')
  const [dropped, setDropped] = useState<Dropped | null>(null)

  /**
   * The order the rows are in, held for as long as the pane is mounted.
   *
   * The store's own order is most recently touched first, which is the right
   * order to arrive in and the right order to evict by, and the wrong thing to
   * do to a list somebody has their hand on: setting a speed writes the entry,
   * which moved that row to the top under the pointer that had just set it. So
   * the sort below decides where a row goes when it first appears, and this
   * decides where it stays. Leaving the tab unmounts the pane, so the next
   * visit sorts afresh — which is the whole of the reset logic.
   */
  const order = useRef<string[]>([])

  // The most recently touched first: on a profile with hundreds of sites, the
  // one the user is looking for is almost always one they used recently.
  const others = Object.entries(domains.entries)
    .filter(([key]) => key !== domain)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)

  /**
   * Today's sort merged into the order already on screen: a key that is already
   * placed keeps its place, a key that is new goes on the front, and a key that
   * is no longer stored falls out — unless it is the dropped one, which keeps
   * its slot so the undo can put the row back where the row was.
   */
  const stored = new Set(others.map(([key]) => key))
  /*
   * Read and written during render on purpose. The order has to be settled
   * before the rows are painted, so an effect is a render too late, and the
   * merge is idempotent: a second pass over the same store finds every key
   * already placed and writes back the list it just read, which is what makes
   * this safe under a double render.
   */
  // oxlint-disable react/refs
  const kept = order.current.filter(
    key => stored.has(key) || key === dropped?.domain,
  )
  const placed = new Set(kept)
  const arrived = others.map(([key]) => key).filter(key => !placed.has(key))
  const rows = [...arrived, ...kept]
  order.current = rows
  // oxlint-enable react/refs

  const query = filter.trim().toLowerCase()
  const matching = query ? rows.filter(key => key.includes(query)) : rows
  const shown = matching.slice(0, MAX_ROWS)
  const hidden = matching.length - shown.length

  /**
   * What the heading counts is what is stored, so the dropped row's line is
   * listed and not counted: the entry really is gone, and the count saying so
   * before the undo is taken is the honest half of offering one.
   */
  const found = query
    ? matching.filter(key => stored.has(key)).length
    : others.length

  const search = (value: string) => {
    setFilter(value)
    // A different question is being asked of the list, so the answer to the
    // last one goes.
    setDropped(null)
    // Measured at the moment the box goes from empty to holding a query, which
    // is the last moment the pane is at its full height with the box in use.
    onHoldHeight(value.trim() !== '')
  }

  const undo = () => {
    if (dropped === null) {
      return
    }

    // The write that recreates what was there, not a special restore path: a
    // marker and a speed are made the same way here as anywhere else.
    if (dropped.entry.never) {
      onSetNever(dropped.domain, true)
    } else {
      onSetSpeed(dropped.domain, dropped.entry.speed)
    }

    setDropped(null)
  }

  // The floor is this pane's while it is on screen and nobody else's.
  useEffect(() => () => onHoldHeight(false), [onHoldHeight])

  /**
   * "Other" is a claim about this tab's site, so it is only sayable when that
   * site really is remembered. On a profile with nothing stored at all the word
   * implies a first entry that does not exist — and a marker is not a memory,
   * so choosing "Never remember" for this tab used to flip the message into
   * claiming the site was remembered at the moment the user asked for the
   * opposite.
   */
  const current = domain !== null ? domains.entries[domain] : undefined
  const emptyNote =
    others.length > 0
      ? 'No site matches that filter.'
      : current !== undefined && !current.never
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

          {/* Counted and named for what is listed, which is every site with a
              stored decision — a speed, or a "never" that leaves the site out.
              The markers are listed because the list is how an exclusion is
              undone, and "Remembered sites (3)" over three rows two of which
              say "Never remember" counted them as memories.

              Under a filter it says both numbers. The stored count is still
              the one that matters, but it was the only number on this pane a
              filter could put at odds with the rows underneath it — "(12)"
              over three of them — and the pane already prints the other in
              "N more not shown". */}
          <h2 className="pane-heading">
            Other sites
            {others.length === 0
              ? ''
              : found === others.length
                ? ` (${others.length})`
                : ` (${found} of ${others.length})`}
          </h2>

          {others.length >= FILTER_FROM ? (
            <section className="field">
              <label htmlFor="site-filter">Filter</label>
              <input
                id="site-filter"
                type="search"
                value={filter}
                placeholder="domain"
                onChange={event => search(event.target.value)}
                onFocus={() => onHoldHeight(true)}
                onBlur={() => onHoldHeight(false)}
              />
            </section>
          ) : null}

          {shown.length > 0 ? (
            <ul className="sites">
              {shown.map(key => {
                const entry = domains.entries[key]

                // The slot outlives its row only until something is stored
                // under that name again, which an undo does and a visit to the
                // site does too.
                return entry === undefined && key === dropped?.domain ? (
                  <DroppedRow key={key} domain={key} onUndo={undo} />
                ) : (
                  <SiteRow
                    key={key}
                    domain={key}
                    entry={entry}
                    {...rowProps}
                    onDropped={(target, held) =>
                      setDropped({ domain: target, entry: held })
                    }
                  />
                )
              })}
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
