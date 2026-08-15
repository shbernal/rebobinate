// Speed arithmetic lives here, apart from the DOM, so the rules that make the
// controls feel right are testable on their own.

export const SPEED_EPSILON = 0.0005

/** Rounds to three decimals so repeated steps never drift into 1.10000000002. */
export const roundSpeed = (speed: number): number => {
  return Math.round(speed * 1000) / 1000
}

export const clampSpeed = (speed: number, min: number, max: number): number => {
  if (!Number.isFinite(speed)) {
    return 1
  }

  return roundSpeed(Math.min(max, Math.max(min, speed)))
}

export const speedsEqual = (a: number, b: number): boolean => {
  return Math.abs(a - b) < SPEED_EPSILON
}

/**
 * Steps onto the next multiple of `step`, in the requested direction.
 *
 * Snapping to the grid rather than adding blindly keeps the sequence clean when
 * a site has left the video on an off-grid rate: from 1.07 with a 0.05 step,
 * increasing goes to 1.10 and decreasing goes to 1.05, instead of carrying the
 * stray 0.02 forever.
 */
export const stepSpeed = (
  current: number,
  step: number,
  direction: 1 | -1,
  min: number,
  max: number,
): number => {
  const safeStep = step > 0 ? step : 0.05
  const position = current / safeStep
  const next =
    direction > 0
      ? (Math.floor(position + SPEED_EPSILON) + 1) * safeStep
      : (Math.ceil(position - SPEED_EPSILON) - 1) * safeStep

  return clampSpeed(next, min, max)
}

/** `1` renders as `1.0`, `1.05` as `1.05`, `1.1` as `1.1`. */
export const formatSpeed = (speed: number): string => {
  const fixed = speed.toFixed(2)
  const trimmed = fixed.replace(/0$/, '').replace(/\.$/, '.0')

  return trimmed
}

export const formatSpeedLabel = (speed: number): string => {
  return `${formatSpeed(speed)}×`
}

/**
 * The same speed written for the toolbar icon, where about four characters fit
 * before the browser starts squeezing glyphs.
 *
 * That budget is what the two rules buy: no `×`, since the icon already says
 * whose number it is, and a whole number from 10 upwards, where the decimals
 * would not fit and are past caring about anyway. Everything below stays exact
 * — `1.05` is four characters, and so is the widest value a 0.01 step can
 * produce under 10.
 */
export const formatToolbarSpeed = (speed: number): string => {
  if (speed >= 10) {
    return String(Math.round(speed))
  }

  return speed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
