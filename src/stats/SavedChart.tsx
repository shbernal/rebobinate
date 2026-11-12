import { useEffect, useRef, useState } from 'react'
import type { WatchTotals } from '@/shared/stats-summary'
import { formatDuration } from '@/shared/stats-summary'

type Day = WatchTotals & { day: string }

/** Until the plot has been measured. */
const DEFAULT_WIDTH = 640
const HEIGHT = 200
const PADDING = { top: 16, right: 8, bottom: 24, left: 8 }
const MAX_BAR = 24
/** The surface gap between neighbouring bars. */
const GAP = 2
const RADIUS = 4

const shortDate = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)

  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Centred over its column, except near either edge, where it is anchored to
 * the column instead so it never runs off a narrow window.
 */
const tooltipPosition = (fraction: number) => ({
  left: `${fraction * 100}%`,
  transform:
    fraction < 0.2
      ? 'translateX(-12px)'
      : fraction > 0.8
        ? 'translateX(calc(-100% + 12px))'
        : 'translateX(-50%)',
})

/**
 * A bar with its data end rounded and its baseline end square, growing up for
 * time saved and down for time lost below 1×.
 */
const barPath = (x: number, width: number, base: number, end: number) => {
  const up = end < base
  const height = Math.abs(end - base)
  const r = Math.min(RADIUS, width / 2, height)

  if (up) {
    return `M${x},${base}V${end + r}Q${x},${end} ${x + r},${end}H${x + width - r}Q${x + width},${end} ${x + width},${end + r}V${base}Z`
  }

  return `M${x},${base}V${end - r}Q${x},${end} ${x + r},${end}H${x + width - r}Q${x + width},${end} ${x + width},${end - r}V${base}Z`
}

/**
 * Daily time saved as columns from one zero baseline, one series in the
 * accent colour, so the title names it and there is no legend. A day spent
 * below 1× is a column down, in the muted ink, rather than a column floored
 * at zero. Every value is in the table under it, which is also what a screen
 * reader is pointed at: the SVG itself is a picture.
 */
const SavedChart = ({ days }: { days: Day[] }) => {
  const [hovered, setHovered] = useState<number | null>(null)
  /**
   * Drawn in pixels at the plot's measured width rather than scaled through a
   * `viewBox`: scaled, the axis text shrank with the chart and was 6px on a
   * phone-width window.
   */
  const plotRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)

  useEffect(() => {
    const plot = plotRef.current

    if (!plot || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(1, Math.round(entry.contentRect.width)))
    })

    observer.observe(plot)

    return () => observer.disconnect()
  }, [])

  const top = Math.max(0, ...days.map(day => day.saved))
  const bottom = Math.min(0, ...days.map(day => day.saved))
  const span = top - bottom || 1
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom
  const y = (value: number) => PADDING.top + ((top - value) / span) * plotHeight
  const slot = (width - PADDING.left - PADDING.right) / days.length
  const barWidth = Math.min(MAX_BAR, slot - GAP)
  const baseline = y(0)

  // First, middle and last: enough to place any column in time without a
  // label under every one of thirty.
  const labelled = new Set([
    0,
    Math.floor((days.length - 1) / 2),
    days.length - 1,
  ])
  const active = hovered === null ? null : days[hovered]

  return (
    <figure className="chart">
      <div
        className="chart-plot"
        ref={plotRef}
        onMouseLeave={() => setHovered(null)}
      >
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label="Time saved per day. The same numbers are in the table below."
        >
          <line
            className="chart-baseline"
            x1={PADDING.left}
            x2={width - PADDING.right}
            y1={baseline}
            y2={baseline}
          />
          {days.map((day, index) => {
            const x = PADDING.left + index * slot + (slot - barWidth) / 2

            return (
              <g key={day.day}>
                {day.saved === 0 ? null : (
                  <path
                    className={
                      day.saved < 0 ? 'chart-bar chart-bar-lost' : 'chart-bar'
                    }
                    data-active={hovered === index || undefined}
                    d={barPath(x, barWidth, baseline, y(day.saved))}
                  />
                )}
                {/* The hit target is the whole slot, top to bottom: a short
                    column is still easy to point at. */}
                <rect
                  className="chart-hit"
                  x={PADDING.left + index * slot}
                  y={0}
                  width={slot}
                  height={HEIGHT}
                  onMouseEnter={() => setHovered(index)}
                />
                {labelled.has(index) ? (
                  // The two ends are anchored to the plot's edges, so a date
                  // under the first or last column is not cut in half.
                  <text
                    className="chart-axis"
                    x={
                      index === 0
                        ? PADDING.left
                        : index === days.length - 1
                          ? width - PADDING.right
                          : x + barWidth / 2
                    }
                    y={HEIGHT - 6}
                    textAnchor={
                      index === 0
                        ? 'start'
                        : index === days.length - 1
                          ? 'end'
                          : 'middle'
                    }
                  >
                    {shortDate(day.day)}
                  </text>
                ) : null}
              </g>
            )
          })}
          <text className="chart-axis" x={PADDING.left} y={PADDING.top - 4}>
            {formatDuration(top)}
          </text>
        </svg>

        {active && hovered !== null ? (
          <div
            className="chart-tooltip"
            style={tooltipPosition(
              (PADDING.left + (hovered + 0.5) * slot) / width,
            )}
          >
            <strong>{shortDate(active.day)}</strong>
            <span>Saved {formatDuration(active.saved)}</span>
            <span>Watched {formatDuration(active.real)}</span>
          </div>
        ) : null}
      </div>

      <details className="chart-table">
        <summary>Show as a table</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Time saved</th>
              <th scope="col">Watched</th>
            </tr>
          </thead>
          <tbody>
            {days.map(day => (
              <tr key={day.day}>
                <th scope="row">{shortDate(day.day)}</th>
                <td>{formatDuration(day.saved)}</td>
                <td>{formatDuration(day.real)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

export default SavedChart
