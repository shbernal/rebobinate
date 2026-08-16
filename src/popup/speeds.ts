// The handful of speeds the popup offers directly, apart from the step grid the
// buttons and the keyboard walk. Two panes need the same list, so it lives here
// rather than in whichever one grew it first.

/**
 * The speeds a site can be set to from the Sites pane, and the same list the
 * default speed uses. It is a short list rather than a typed field for the
 * reason the step field shows: a free-form number needs a draft state, because
 * its halfway values are not valid settings, and a starting speed has only a
 * handful of useful answers. A `<select>` also keeps the popup compact.
 */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

/**
 * A speed set from the keyboard lands anywhere on the step grid, so the stored
 * value is usually not one of the presets. It is added rather than rounded away:
 * opening the list must not silently change what a site is remembered at.
 */
export const speedOptions = (current: number) => {
  return SPEEDS.includes(current)
    ? SPEEDS
    : [...SPEEDS, current].sort((a, b) => a - b)
}

/**
 * The chips on the Speed pane, which are a shortcut past the grid rather than a
 * replacement for it: at the default 0.05 step, 1.0× to 2.0× is twenty presses.
 *
 * `SPEEDS` without 0.75, which is the one entry near enough to 1.0× that the
 * buttons already reach it cheaply, and dropping it is what leaves six chips
 * comfortable across a 320px popup. Note that with a non-default step a chip can
 * land off the step grid; that is fine, `stepSpeed` snaps back to the grid on
 * the next press.
 */
export const SPEED_PRESETS = [0.5, 1, 1.25, 1.5, 1.75, 2]
