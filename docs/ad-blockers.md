# Ad Blockers

The badge is an overlay: fixed position, maximum `z-index`, laid over the video.
That is also the shape of a popunder, and filter lists hunt that shape. So the
question "does an ad blocker take the badge away?" has a real answer, it changes
whenever a list is updated, and it is worth being able to ask on demand rather
than waiting for a report.

```sh
pnpm blockers:fetch                        # once, downloads the pinned blockers
pnpm build && pnpm check:filters           # does any shipped filter match us?
pnpm e2e                                   # does the badge survive the mechanism?
pnpm inspect:chrome <url> --blocker        # what is the badge doing on a real site?
pnpm dev:firefox <url> --with-ublock       # the real uBlock Origin, by hand
```

## How A Blocker Hides Something

Element hiding is a CSS selector and nothing more. A blocker collects the
_cosmetic filters_ in scope for the page and injects
`selector { display: none !important }` — at **user origin**.

Two consequences run through everything below.

- **The cascade is unwinnable.** User-origin `!important` outranks every author
  declaration, including an important inline one. There is no styling the badge
  can adopt that survives a selector matching it. The only defence is not
  matching the selector.
- **It leaves no trace in the DOM.** The host stays attached, keeps its own
  rule, and is simply not displayed. Only computed style can see it, which is
  why the probe reads `getComputedStyle` and not the element's attributes.

A filter is scoped to a list of hostnames, or generic and applied everywhere.
Generic filters are the dangerous class: one of those matching the badge takes
it away on every site at once.

## What The Badge Does About It

`src/content/badge.ts` keeps the host boring on purpose:

- **No `style` attribute.** Everything is in a `:host` rule inside the shadow
  root. `[style*="z-index:"]` and `div[style]:not([class])` are live EasyList
  filters, scoped to a long tail of streaming sites — `hurawatch.cc`,
  `putlockers.li`, `gogoanime.co.in` and a dozen more, which is exactly the
  audience for a speed control. Both matched the badge before this change.
- **Every declaration is `!important`.** That is what the inline attribute used
  to buy. A plain `:host` declaration loses to any page rule that reaches the
  host, because normal declarations from the outer tree win; important ones
  reverse the order and the shadow tree wins. `e2e/specs/ad-blockers.spec.ts`
  pins that behaviour.
- **The id says `rebobinate-speed-host`, not `badge`.** "Badge" contains "ad",
  and `div[id*="ad"]` is a filter AdGuard ships. The id is stable and named
  after us on purpose: a list maintainer who wants to allow it can.
- **Nothing is randomised.** Rotating ids and classes to dodge filters is the
  arms race, and it is a good way to be targeted deliberately rather than by
  accident. When a filter is aimed at us, the answer is to ask for an exception.

Two hits are accepted rather than fixed, and `scripts/check-filters.mjs` names
them with the reason: `japscan.*` hides every `div[id]` it does not recognise,
and `hotcleaner.com` hides every empty div. Neither has a shape we could take.

## The Three Tiers

They exist because no single one can answer the whole question. The constraint
that forces the split is that **uBlock Origin cannot run in Chromium at all**:
its Chromium build is still Manifest V2, and Chromium 139 and later refuse to
install one. Loading it unpacked fails silently — the profile simply has no such
extension.

### 1. Static — does a shipped filter match us?

```sh
pnpm build && pnpm check:filters            # cached lists
pnpm check:filters --refresh                # re-download them
pnpm check:filters --refresh --write-fixture
```

Downloads uBlock Origin's default list set, its two annoyances lists, and
AdGuard Base, extracts every cosmetic selector, launches the built extension in a real Chromium, and runs
each selector against the badge host the extension actually rendered — not
against a copy of what the source is believed to build. Exit code 1 means a
filter matches, with the sites and the list named.

It also matches the selectors against four deliberately overlay-shaped decoys.
Those matches — the filters that hide an overlay badge but not _our_ overlay
badge — get vendored into `e2e/fixtures/blocker/filters.json`, which is what
makes the next tier real rather than invented.

This is the tier that catches a list update. Run it before a release, and after
any change to how the badge is built.

### 2. Real uBlock Origin — Gecko only

```sh
pnpm blockers:fetch
pnpm build:firefox
pnpm dev:firefox https://www.youtube.com/ --with-ublock
pnpm dev:zen https://www.youtube.com/ --with-ublock
```

The signed XPI is dropped into the profile's `extensions/` directory, where
Gecko installs it alongside our own temporarily-installed build. It is the only
place the actual blocker runs, with its procedural filters, its generic cosmetic
filtering, and its scriptlets.

It is hand-driven, for the reason
[Testing](./testing.md#why-gecko-is-not-in-the-playwright-suite) gives: nothing
can drive a stock Gecko with an extension loaded. To take the same reading the
Chromium inspector takes, change the speed and paste the probe into the console:

```sh
pnpm inspect:chrome --print-probe
```

### 3. The mechanism, in CI

`pnpm e2e` runs `e2e/specs/ad-blockers.spec.ts` with a fixture blocker —
`e2e/fixtures/blocker/`, an MV3 extension whose whole job is to inject the
vendored selectors as user-origin CSS. It is deterministic, offline, and
faithful to the part that matters, and it includes a test asserting the blocker
is really hiding things, so the suite cannot go green against a blocker that
failed to load.

That tier has two ordering constraints, and both are load-bearing rather than
tidy-up. A blocker filters from a service worker, so it is always behind the
page it is filtering:

- **Its worker has to be running before anything navigates.** The fixture
  filters from `webNavigation.onCommitted`, and the profile is fresh for every
  test, so the worker is still starting while the first page could already be
  loading. An event that arrives before the listener is registered is gone, and
  that page then loads with no filtering on it whatsoever. `waitForBlockerWorker`
  in `e2e/fixtures/extension.ts` is what makes it a wait instead of a coin flip
  — it was one, at roughly one run in five.
- **Its CSS lands after `goto` resolves.** Reacting to a navigation that has
  already committed cannot beat the load being reacted to, in the fixture or in
  a real MV3 blocker. `openBlocked` in the spec waits for the injection to be in
  force before the test reads anything.

Both failures are quiet in the direction that matters: a test reading an
unfiltered page reports that the badge survived cosmetic filtering, when nothing
was ever filtered.

uBO Lite is not used here. It installs fine, but its default mode applies only
the filters of hostnames its lists actually name, so on a fixture origin it does
nothing at all. It is useful against real sites instead:

```sh
pnpm inspect:chrome https://www.youtube.com/watch?v=... --blocker
pnpm inspect:chrome https://example.com/ --blocker --complete
```

`--complete` puts uBOL in complete filtering mode, which is the level that turns
on generic cosmetic filtering. The report's `badge` section says whether the
badge is on screen in each frame and, when it is not, which of the possible
reasons it was: no video to anchor to, hidden by its own rules, or overridden
from outside the page.

## What Has Been Ruled Out

Recorded so the same ground is not covered twice. As of the run that added this
document:

- No **generic** cosmetic filter in any checked list matches the badge host.
- No filter scoped to **youtube.com, tiktok.com or linkedin.com** matches it
  either, before or after the hardening above — the filters those lists carry
  for those sites name the sites' own ad containers.
- The badge is **visible on real YouTube and real TikTok with uBO Lite loaded**,
  per `pnpm inspect:chrome --blocker`, and still visible with `--complete`,
  which is the setting that adds generic cosmetic filtering.
- **Scriptlets cannot reach the badge.** `+js(...)` filters run in the page's
  main world; a content script's DOM operations and its `Element.prototype` are
  in an isolated world, so a patched `setTimeout` or `attachShadow` in the page
  is not ours.
- **A page CSP does not block the badge's stylesheet.** `/strict-csp` in
  `e2e/fixtures/pages.ts` serves `style-src 'none'` and the badge still styles
  itself, because a content script's DOM is attributed to its isolated world.

So a report of the badge disappearing on those three sites is not element hiding
by the default lists, and the next thing to establish is which blocker and which
engine — the answer differs for uBO on Gecko, uBO Lite on Chromium, and AdGuard.
