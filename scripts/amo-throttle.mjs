// AMO's rate limits, as the server actually applies them. Split from
// `amo-previews.mjs` because the same budget covers the version PUT and the
// source PATCH of a release, not only the listing assets.
//
// `olympia/api/throttling.py` puts three per-user limits on every unsafe method
// of the add-on, version and preview endpoints, and DRF checks all of them on
// every request. That last part is the reason this module exists: a request
// rejected by the 3/minute burst limit still records a hit against the hourly
// and daily ones, because each throttle decides independently and the ones that
// are not at their cap count the request before another rejects it. Retrying
// into a 429 therefore spends budget on requests that never ran, and enough of
// them lock the account out for a day. Pacing so the burst limit is never
// tripped is what avoids that.
//
// The limits key on the authenticated user, and the JWT is account-scoped, so
// what is spent here is spent for every extension published from this account.

// Package uploads are a separate scope with its own, larger allowance
// (`file_upload_throttles`), so they do not draw on the submission budget.
export const SCOPE_LIMITS = {
  submission: [
    { calls: 3, windowMs: 60_000, label: '3/minute' },
    { calls: 10, windowMs: 3_600_000, label: '10/hour' },
    { calls: 24, windowMs: 86_400_000, label: '24/day' },
  ],
  upload: [
    { calls: 6, windowMs: 60_000, label: '6/minute' },
    { calls: 20, windowMs: 3_600_000, label: '20/hour' },
    { calls: 48, windowMs: 86_400_000, label: '48/day' },
  ],
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Reads are free: every AMO throttle on these endpoints carries
// `ThrottleOnlyUnsafeMethodsMixin`.
export const throttleScope = (method, endpoint) => {
  if (SAFE_METHODS.has(method)) {
    return null
  }

  return endpoint.startsWith('/addons/upload') ? 'upload' : 'submission'
}

// A window is sliding, so the wait is until the call that fills it ages out.
// The extra second covers the clock skew between when we stamp a call and when
// AMO does, which would otherwise turn a wait into a 429 by a few milliseconds.
export const PACE_MARGIN_MS = 1_000

// Above this, waiting is pointless: an hourly window can legitimately ask for
// most of an hour, but anything longer means the daily cap is spent and the run
// should say so rather than sleep until tomorrow.
export const MAX_PACE_WAIT_MS = 3_700_000

// Only the long windows count as budget: a burst hold is seconds, and sitting
// one out stalls nothing. What this answers is how much work can start now
// without the run going to sleep for the rest of the hour.
const SLOW_WINDOW_MS = 3_600_000

export const budgetLeft = (history, now, limits) =>
  Math.max(
    0,
    Math.min(
      ...limits
        .filter(rule => rule.windowMs >= SLOW_WINDOW_MS)
        .map(
          rule =>
            rule.calls - history.filter(at => at > now - rule.windowMs).length,
        ),
    ),
  )

// `history` is the ascending list of times this process sent an unsafe call in
// the given scope, including ones AMO rejected — those counted too.
export const paceDelay = (history, now, limits) => {
  let waitMs = 0
  let limit = null

  for (const rule of limits) {
    const inWindow = history.filter(at => at > now - rule.windowMs)

    if (inWindow.length < rule.calls) {
      continue
    }

    const expiring = inWindow[inWindow.length - rule.calls]
    const wait = expiring + rule.windowMs - now + PACE_MARGIN_MS

    if (wait > waitMs) {
      waitMs = wait
      limit = rule.label
    }
  }

  return { waitMs, limit }
}

// DRF sets `Retry-After` on every throttled response, so the wait is read
// rather than guessed; the fallback only matters if it ever goes missing. The
// extra second keeps a rounded-down header from retrying a moment early and
// burning an attempt.
export const FALLBACK_THROTTLE_WAIT_MS = 60_000

export const throttleWaitMs = retryAfter => {
  const seconds = Number(retryAfter)

  return seconds > 0 && Number.isFinite(seconds)
    ? seconds * 1000 + PACE_MARGIN_MS
    : FALLBACK_THROTTLE_WAIT_MS
}
