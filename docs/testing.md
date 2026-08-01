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
