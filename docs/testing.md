# Testing

Two suites: Vitest for units and conventions, Playwright for the built
extension in a real Chromium.

```sh
pnpm test            # Vitest, once
pnpm test:watch      # Vitest, watch mode
pnpm test:coverage   # Vitest with V8 coverage
pnpm e2e             # build, then Playwright
pnpm e2e:headed      # the same, with a visible browser
```

## Vitest

- jsdom environment, configured in `vitest.config.ts`.
- `src/test/setup.ts` installs a fresh Chrome API mock before each test and
  cleans the DOM afterwards.
- `src/test/chrome.ts` is that mock: `storage.local` with change events,
  `runtime.onMessage` and `sendMessage`, `tabs.query`, `tabs.sendMessage`, and
  `tabs.onRemoved`. Its events expose `emit()` so a test can drive a listener
  directly, and `storage.local.seed()`/`snapshot()` for arranging and asserting
  state.
- The service worker is a module with top-level side effects, so its tests
  `vi.resetModules()` and re-import it to get a clean instance, then drive it
  through `chrome.runtime.onMessage.emit(message, sender, sendResponse)`.

`tests/browser-api-compat.test.ts` is a convention guard, not a unit test: it
fails if any file in `src/` awaits a `chrome.*` call. See
[Build Targets](./build-targets.md) for why that matters.

## Playwright

`e2e/` loads the built `dist/` into a persistent Chromium context.

- `e2e/fixtures/extensionRuntime.ts` launches the browser with
  `--load-extension`, finds the extension's service worker, and reads and writes
  its storage. It prefers a system Chromium (`/usr/bin/chromium`, Chrome, …) and
  otherwise falls back to Playwright's `channel: 'chromium'` — the default
  headless binary is the headless _shell_, which cannot load extensions at all.
- `e2e/fixtures/pages.ts` serves the fixture pages by intercepting requests to
  two invented origins (`https://player.test`, `https://embed.test`). Content
  scripts inject on those navigations; `file://` URLs would need an extra Chrome
  permission.
- `e2e/fixtures/extension.ts` exposes the `openFixture`, `openPopup`, and
  `seedSettings` fixtures. Seeded settings are partial — the extension
  normalizes them.
- `e2e/fixtures/controls.ts` provides `pressSpeedKey`, which presses and retries
  until the rate moves. crxjs loads the content script through an asynchronous
  loader, so for a short moment after a navigation the page is live but the
  extension is not listening yet; a single press in that window is simply lost.
  Retrying is also what a user does.

Fixture pages cover a plain player, a player plus a search box, a scrolling
page, a page with no video, a player inside a web component, and a page whose
only player is a cross-origin iframe.

### The popup is not a tab

A real extension popup is an overlay: the web page underneath stays the active
tab. Playwright can only open the popup document as a tab, which makes it the
active one, so `e2e/specs/popup.spec.ts` brings the page back to the front and
drives the popup buttons with `dispatchEvent('click')` instead of `click()`.
Without that, the extension resolves the popup's own tab as the target and there
is nothing to control.

## Where to add coverage

- Speed arithmetic, key matching, settings normalization: unit tests, no DOM
  needed.
- Video discovery, rate enforcement, badge geometry: unit tests against jsdom.
- Anything that depends on real frames, real focus, or the real extension
  messaging path: Playwright. That includes iframes, fullscreen, and the popup.

Real sites are deliberately not in CI. When a site misbehaves, reproduce it in a
fixture page first; if it cannot be reproduced there, it belongs in the manual
validation list, not in the automated suite.

## Manual validation on real sites

Everything above runs against local fixture pages, so the sites the extension
actually has to survive get checked by hand.

```sh
pnpm dev:chrome                          # build, then open YouTube with dist/ loaded
pnpm dev:chrome https://www.tiktok.com/  # or any other start URL
```

`scripts/open-chromium.mjs` launches the same persistent Chromium the Playwright
fixture does — a system Chromium if there is one, `channel: 'chromium'`
otherwise — with `--load-extension=dist`, and stays open until the window is
closed. It prints the extension id and the popup URL, which is the only way to
reach the popup document directly.

The profile lives in `node_modules/.tmp/dev-profile` and is reused between runs,
so a site logged into once stays logged in. `REBOBINATE_PROFILE_DIR` moves it,
and `REBOBINATE_HEADLESS=1` runs new headless mode for driving over CDP. Loading
`dist/` as an unpacked extension in your own browser works too; the script only
saves the trip through `chrome://extensions`.

Then walk the list below.

Both sites were last walked on 2026-08-01 against `dist/` in Chromium.

### YouTube

| Check                                                 | Result |
| ----------------------------------------------------- | ------ |
| `+` / `-` move the rate on the step grid              | passes |
| badge renders over the player, correct corner         | passes |
| `0` resets to 1× **without** YouTube seeking to start | passes |
| the rate survives the page forcing `playbackRate = 1` | passes |
| `+ - 0 =` typed into the search box are not stolen    | passes |
| the keys work again once the search box loses focus   | passes |
| still controllable after navigating to another video  | passes |

`0` is the one worth re-checking after any key-handling change: YouTube binds it
to seek-to-start on the document, so a regression there is silent — the speed
still resets and the video also jumps to 0:00.

### TikTok

| Check                                         | Result |
| --------------------------------------------- | ------ |
| `+` raises the rate on the Explore grid       | passes |
| badge renders on the playing tile             | passes |
| the rate holds while the video plays          | passes |
| the rate survives a forced `playbackRate = 1` | passes |
| the speed carries over to the next post       | passes |

TikTok really does reset `playbackRate`, and it is not subtle. With the
extension switched off (`enabled: false`) and the rate set to 1.5 by hand, all
30 samples over 15s read back 1 — the site pulls it down inside half a second,
and every post scrolled into view starts at 1×. With the extension on, the rate
held for all 20 samples over 10s. This is what `src/content/enforcer.ts` exists
for, and TikTok is the site that proves it works.

Measuring this needs the extension disabled: with it enabled you cannot tell
"the site never reset" apart from "the enforcer won", because both look like a
flat line.

### Still to walk

Twitch and Netflix. Netflix in particular uses a Media Source player and its own
speed control, so it is the most likely to need a fixture of its own.
