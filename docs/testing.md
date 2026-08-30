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
  state. `tabs.seed()` sets what a query answers with, which matters now that
  the service worker reads a tab's URL and its private-window flag and not only
  its id. A query narrowed to `active` is honoured, because the service worker
  asks twice — once for the active tab, once for all of them — and the second
  ask only means something if it can answer with more than the first. Leaving
  `url` off a seeded tab models one the extension has no access to: Chromium
  omits the key rather than sending an empty string.
- The service worker is a module with top-level side effects, so its tests
  `vi.resetModules()` and re-import it to get a clean instance, then drive it
  through `chrome.runtime.onMessage.emit(message, sender, sendResponse)`. The
  sender is where a test says which site the tab is on: `sender.tab.url` is the
  top frame's URL, and `sender.url` the sending frame's, which is how the
  embedded-player cases are set up.

`tests/` holds what is not a unit test of `src/`.

Two are convention guards. Both encode a Gecko rule that no Chromium test can
catch, and both are explained in [Build Targets](./build-targets.md):

- `browser-api-compat.test.ts` fails if any file in `src/` awaits a `chrome.*`
  call.
- `popup-native-dialogs.test.ts` fails if an `<input>` that opens a native
  chooser (`type="color"`, `type="file"`) appears under `src/popup/`. It strips
  comments before scanning, since the doc comments are where the rule is
  written down.

The third covers the publishing side, in two files. `amo-previews.test.mjs`
unit-tests `scripts/amo-previews.mjs` — the pure decision logic behind the AMO
listing-asset sync, kept out of `publish-amo.mjs` so it can be exercised without
an HTTP layer or a credential. Most of it is the reconcile: what a sync does
given the manifest, the lock file, and what AMO says it holds.
`amo-throttle.test.mjs` covers `scripts/amo-throttle.mjs`, which decides how long
to hold before an unsafe call so AMO never has to reject one.

`amo-previews.test.mjs` also parses the checked-in `amo/previews.json` and
asserts every file it names is present and within AMO's 4MB limit, so a moved or
oversized screenshot fails here rather than partway through a release, and that
`amo/previews.lock.json` still parses — a lock that has stopped being readable
would silently turn every sync back into a full replace. Both files are `.mjs`
because the modules under test are: the publish scripts are plain ESM run by
node, not part of a TypeScript project reference. See
[Store Listings](./store-listings.md#writes-are-throttled-hard).

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
- `e2e/fixtures/extension.ts` exposes the `openFixture`, `openPopup`,
  `seedSettings`, and `rememberedSites` fixtures. Seeded settings are partial —
  the extension normalizes them. `rememberedSites()` reads the per-site speed
  map back out of the extension's storage, which is what lets
  `e2e/specs/site-memory.spec.ts` wait for the debounced write instead of
  sleeping a fixed amount.
- `e2e/fixtures/blocker/` is a stand-in content blocker: an MV3 extension that
  injects cosmetic filter selectors as user-origin CSS, which is what a real
  blocker does. `test.use({ blockers: [blockerPath] })` loads it alongside the
  build, and `e2e/specs/ad-blockers.spec.ts` is the only spec that does.
  [Ad Blockers](./ad-blockers.md) explains why the real uBlock Origin cannot be
  used here.
- `e2e/fixtures/controls.ts` provides `pressSpeedKey`, which presses and retries
  until the rate moves. crxjs loads the content script through an asynchronous
  loader, so for a short moment after a navigation the page is live but the
  extension is not listening yet; a single press in that window is simply lost.
  Retrying is also what a user does.

Fixture pages cover a plain player, a player plus a search box, a scrolling
page, a page with no video, a player inside a web component, a page whose only
player is a cross-origin iframe, a player a panel slides sideways without
resizing it, and a player with real media behind it.

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

Which site the popup shows under **This tab** survives that, but only because
`withTargetTab` in `src/background/service-worker.ts` falls back to the most
recently used tab whose URL it can read. The mechanism behind the fallback is
worth knowing, because it is not what the code reads like: Chromium omits `url`
from a `tabs.query` result for any tab the extension has no access to, and
`<all_urls>` does not cover `chrome-extension://` — so the popup document's own
tab comes back with **no URL at all** rather than with a `chrome-extension://`
one. Recognizing an extension page by its URL prefix therefore does not
recognize that tab; treating a _missing_ URL as unknown is what does. The same
applies to `chrome://` pages, and to every page if host access is ever withheld
— which is the case with no readable tab left, where the popup is answered for
the active tab with no site rather than not answered at all.

Two specs in `e2e/specs/popup.spec.ts` hold that down from both sides:
`openPopupOver` hands the page back the front and reloads the popup, and
'shows the site with the popup document itself in front' deliberately does not.
Note what the second one has to do to be a real test: the popup asks once, on
mount, so it is brought to the front and _then_ reloaded — raising it after it
has already asked proves nothing. It also addresses the row through the **This
tab** heading rather than as the first `.sites` list, because when there is no
row that list is the remembered-sites one below, which names the same site and
would answer for it.

`pnpm inspect:chrome` reports the whole picture: it asks
`rebobinate:popup-state` twice, once with the page in front and once with the
popup document in front, and lists every tab with a `urlReadable` flag. Reach
for it before reasoning about which tab the service worker picked.

The popup's own on/off switches are a transparent, zero-sized checkbox behind a
styled `<span>`, which Playwright rightly considers invisible. Click the
`.switch` label around it, as a user does.

Since the popup is tabbed, anything outside the Speed pane needs its tab
selected first, and a reload puts the popup back on Speed.

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

- Anything about an ad blocker taking the badge away: [Ad
  Blockers](./ad-blockers.md). The filter lists move on their own, so that check
  is a script (`pnpm check:filters`) rather than a test with a pinned answer,
  and the e2e tier replays what the script found.

## Manual validation on real sites

Everything above runs against local fixture pages, so the sites the extension
actually has to survive get checked by hand. One command per target builds and
opens a browser with the extension already installed:

```sh
pnpm dev:chrome                          # dist/ in Chromium
pnpm dev:firefox                         # dist-firefox/ in Firefox
pnpm dev:zen                             # dist-firefox/ in Zen
pnpm dev:chrome https://www.tiktok.com/  # any of them takes a start URL
```

All three default to YouTube, keep their own profile under `node_modules/.tmp/`
that is reused between runs so a site logged into once stays logged in, and stay
open until the window is closed. Loading the build by hand —
`chrome://extensions`, or `about:debugging` on Gecko — does the same thing; the
scripts only save the trip.

`pnpm dev:firefox --with-ublock` and `pnpm dev:zen --with-ublock` add the real
uBlock Origin to the profile. Gecko is the only place it can run — see [Ad
Blockers](./ad-blockers.md).

`scripts/open-chromium.mjs` launches the same persistent Chromium the Playwright
fixture does — a system Chromium if there is one, `channel: 'chromium'`
otherwise — with `--load-extension=dist`. It prints the extension id and the
popup URL, which is the only way to reach the popup document directly.
`REBOBINATE_PROFILE_DIR` moves the profile, and `REBOBINATE_HEADLESS=1` runs new
headless mode for driving over CDP.

### Inspecting a running extension

Manual validation shows what a browser does; it does not show why. `pnpm
inspect:chrome [url]` loads `dist/` into a headless Chromium, drives it, and
prints a JSON snapshot:

- the extension id and how Chromium loaded it;
- the permissions Chromium actually **granted**, read back out of
  `<profile>/Default/Preferences` rather than out of the manifest —
  `granted_permissions`, `active_permissions`, and whether host access is
  withheld, which is the only place "Site access: on click" is visible;
- every tab the service worker can see, each with a `urlReadable` flag;
- the `rebobinate:popup-state` reply with the page in front and with the popup
  document in front;
- the extension's stored settings and per-site speed map.

`--profile-only` skips the launch and reads just the granted permissions off
disk, which is what to use while `pnpm dev:chrome` still has the profile open:

```sh
REBOBINATE_PROFILE_DIR=node_modules/.tmp/dev-profile \
  pnpm inspect:chrome --profile-only
```

It keeps its own profile at `node_modules/.tmp/inspect-profile` so it never
fights the one `pnpm dev:chrome` is holding, and deletes that profile before
every run: Chromium serves an already-installed extension out of a persistent
profile, so a reused one will happily report on the build before the last one.
A directory passed as `REBOBINATE_PROFILE_DIR` is someone else's and is reused
as it is. There is no Gecko equivalent:
web-ext installs a temporary add-on whose internal UUID changes every run.

`scripts/open-gecko.mjs` takes the browser as its first argument and is a
wrapper over `web-ext`, the tool `pnpm lint:firefox` already uses, which
installs `dist-firefox/` as a temporary add-on. web-ext resolves Firefox itself
on every platform it supports; Zen it has never heard of, so the script looks in
the usual places for that one. `FIREFOX_BINARY` and `ZEN_BINARY` override the
lookup and accept web-ext's `flatpak:org.mozilla.firefox` form.
`REBOBINATE_FIREFOX_PROFILE_DIR` and `REBOBINATE_ZEN_PROFILE_DIR` move the
profiles, which are separate so the two browsers do not share add-on state.
Temporary add-ons are gone on restart and their internal UUID changes each run,
so reach the extension from the toolbar or from
`about:debugging#/runtime/this-firefox` rather than by URL.

Zen is a Firefox fork and runs the same Gecko build of the extension, so the two
are one target, not two. `pnpm dev:firefox` is the one that matches what AMO
users get; `pnpm dev:zen` is there because a fork can still diverge in its
chrome — toolbar, popup sizing, keyboard handling — and that is where it would
show.

### Why Gecko is not in the Playwright suite

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
