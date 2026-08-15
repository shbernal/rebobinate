// A stand-in for a content blocker, for the ad-blocker e2e tier.
//
// It exists because the real thing cannot be loaded: uBlock Origin's Chromium
// build is still Manifest V2 and modern Chromium refuses to install it at all.
// uBO Lite installs, but its default mode applies only the per-hostname filters
// of sites that are actually in the lists, so it does nothing on a fixture
// origin. Neither can answer "does the badge survive cosmetic filtering?" in
// CI.
//
// What matters for that question is the mechanism, and the mechanism is small:
// a blocker injects its element-hiding CSS at **user** origin. That is the part
// no page can beat — a user-origin `!important` declaration outranks every
// author declaration, including an important inline one — so a badge that
// survives this survives the real thing for the same selectors.
//
// The selectors come from `filters.json`, which `pnpm check:filters` writes
// from the live filter lists: every cosmetic filter that hides an element
// shaped like an overlay badge. See `docs/ad-blockers.md`.

const cssFor = selectors =>
  `${selectors.join(',\n')} { display: none !important; }`

let injecting = null

const readCss = () => {
  if (!injecting) {
    injecting = fetch(chrome.runtime.getURL('filters.json'))
      .then(response => response.json())
      .then(filters => cssFor(filters.selectors))
  }

  return injecting
}

const inject = async details => {
  // Sub-frames get their own injection; `allFrames` on the top-level commit
  // would race the frames that do not exist yet.
  const css = await readCss()

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: details.tabId, frameIds: [details.frameId] },
      css,
      origin: 'USER',
    })
  } catch {
    // Frames that navigated away again, and pages no extension may touch.
  }
}

chrome.webNavigation.onCommitted.addListener(inject)
