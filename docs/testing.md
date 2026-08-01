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
page, a page with no video, a player inside a web component, a page whose only
player is a cross-origin iframe, and a player with real media behind it.

### The one fixture with real media

Every fixture video except `/playing` is a source-less `<video>`. That is enough
to set `playbackRate` on, but it never decodes anything, so those specs can only
assert the property the extension just wrote — the plumbing, not the outcome.

`/playing` points at `e2e/fixtures/media/clip.mp4`, four seconds of animation
committed alongside a WebM transcode of the same footage (~50 KB together, see
that directory's README for provenance and the ffmpeg flags). They are served by
the same route interception as the pages, whole and without range support, which
Chromium is happy with at this size.

`e2e/specs/playback.spec.ts` is what they exist for:

- **Doubling the rate doubles playback.** Measures media seconds consumed per
  wall-clock second at 1x and at 2x and compares the two. It is the only test
  that proves a speed change reaches decoded output rather than just landing on
  a property. Locally the two measurements come out at exactly 1.000 and 2.000;
  the assertion is a ratio rather than a fixed target so a decode-starved CI
  machine does not turn it flaky.
- **The speed survives a source reload.** Chromium really does drop
  `playbackRate` back to `defaultPlaybackRate` when a player reassigns `src`,
  which is the quality-switch and next-item path on real sites.

That second one is deliberately redundant. Three mechanisms defend it —
`defaultPlaybackRate` in `src/content/enforcer.ts`, the
`loadstart`/`loadedmetadata` re-apply in `src/content/content-script.ts`, and
the `ratechange` reconcile — and removing any single one still passes. Only
removing all three fails it. It is an outcome test, not a guard on one line;
`src/content/enforcer.test.ts` covers `defaultPlaybackRate` directly.

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
- Anything that depends on a video actually decoding — playback progress, source
  reloads, buffering: `e2e/specs/playback.spec.ts`, against `/playing`. A
  source-less fixture cannot show any of it.

Real sites are deliberately not in CI. When a site misbehaves, reproduce it in a
fixture page first; if it cannot be reproduced there, it belongs in the manual
validation list, not in the automated suite.

## Manual validation on real sites

Everything above runs against local fixture pages, so the sites the extension
actually has to survive get checked by hand. One command per target builds and
opens a browser with the extension already installed:

```sh
pnpm dev:chrome                          # dist/ in Chromium
pnpm dev:zen                             # dist-firefox/ in Zen
pnpm dev:chrome https://www.tiktok.com/  # either one takes a start URL
```

Both default to YouTube, keep a profile under `node_modules/.tmp/` that is
reused between runs so a site logged into once stays logged in, and stay open
until the window is closed. Loading the build by hand — `chrome://extensions`,
or `about:debugging` on Gecko — does the same thing; the scripts only save the
trip.

`scripts/open-chromium.mjs` launches the same persistent Chromium the Playwright
fixture does — a system Chromium if there is one, `channel: 'chromium'`
otherwise — with `--load-extension=dist`. It prints the extension id and the
popup URL, which is the only way to reach the popup document directly.
`REBOBINATE_PROFILE_DIR` moves the profile, and `REBOBINATE_HEADLESS=1` runs new
headless mode for driving over CDP.

`scripts/open-zen.mjs` is a wrapper over `web-ext`, the tool `pnpm lint:firefox`
already uses, which installs `dist-firefox/` as a temporary add-on. It looks for
Zen in the usual places; `ZEN_BINARY` overrides that and accepts web-ext's
`flatpak:app.zen_browser.zen` form. `REBOBINATE_ZEN_PROFILE_DIR` moves the
profile. Temporary add-ons are gone on restart and their internal UUID changes
each run, so reach the extension from the toolbar or from
`about:debugging#/runtime/this-firefox` rather than by URL.

### Why Zen is not in the Playwright suite

The automated suite is Chromium-only and has to stay that way for now. Playwright
drives Firefox through Juggler, a patch carried in its own Firefox build, so
pointing `executablePath` at a stock Gecko binary launches the process and then
hangs waiting for a protocol that is not there. Playwright 1.62 also ships no
WebDriver BiDi channel for stock Firefox, and no Gecko equivalent of
`--load-extension`. Automating the Gecko build means a separate WebDriver stack —
geckodriver plus its `installAddon` command — not another Playwright project.

So Gecko coverage is: unit tests, the `tests/browser-api-compat.test.ts`
convention guard, `pnpm lint:firefox`, and the manual list below. The guard
matters more than it looks, because the divergence it catches — an awaited
`chrome.*` call resolving to `undefined` — is invisible to every Chromium test.

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
