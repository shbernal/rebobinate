# Repository Instructions

## Release Status And What It Constrains

This project is released. `v0.1.0` and `v0.1.1` are published GitHub releases
and the extension is on the Chrome Web Store; the README carries the current
per-store status. People have it installed, so three surfaces are now real
constraints and a change to any of them needs a migration path rather than a
rewrite:

- **The stored settings.** An installed copy's `chrome.storage.local` holds a
  `Settings` object written by an earlier version, and — from the per-site speed
  memory onwards — a domain map under a second key. `normalizeSettings` and
  `normalizeDomains` are what make that safe, so both have to keep repairing
  older shapes into the current one. Bumping `schemaVersion` without handling
  what the previous version wrote silently resets a user's settings. The current
  settings schema is `2`; the `1` → `2` step needed no migration code because
  both new keys default cleanly, and that is the bar for the next one too.
- **`browser_specific_settings.gecko.id`.** AMO binds the listing and every
  installed user's update path to it. A new id is a new add-on.
- **The published listing copy and media.** `store/`, `amo/`, and
  `chrome-web-store/` describe what is live or queued; see
  [Generated And Release Files](#generated-and-release-files).

Everything else is still free to change. The internals — module boundaries,
message shapes, the build pipeline, the test layout — sit between the three
surfaces of one extension that ships as a single package, so there is no
external consumer to keep compatible. Prefer the simplest coherent architecture
for the current direction, and do not defer to the prior one when it conflicts.

## Project Shape

Rebobinate is a Manifest V3 browser extension that controls the playback speed
of videos from the keyboard. It is built with Vite, React, TypeScript, and
`@crxjs/vite-plugin`, and the same source tree builds the Chrome Web Store and
addons.mozilla.org packages.

- `manifest.config.ts` defines the manifest, reads the version from
  `package.json`, and selects the target from `EXT_TARGET`. Chrome is the
  default and builds to `dist/`; `EXT_TARGET=firefox` builds to `dist-firefox/`.
  Only manifest keys differ between the two.
- `src/content/content-script.ts` wires the per-frame runtime together.
- `src/content/media.ts` finds and tracks every `<video>` in the frame.
- `src/content/enforcer.ts` applies the desired rate and re-asserts it when a
  site resets it.
- `src/content/keys.ts` owns the capture-phase keyboard handling.
- `src/content/badge.ts` renders the on-video speed badge.
- `src/background/service-worker.ts` owns the speed of each tab, relays it to
  every frame, and owns the per-site speed memory.
- `src/popup/App.tsx` is the popup UI, with the badge colours handled by
  `src/popup/ColorPicker.tsx`.
- `src/shared/` holds the settings contract, speed arithmetic, key matching,
  colour conversion, and the message types shared by all three surfaces.
  `domain.ts` turns a page URL into the registrable domain a speed is remembered
  under; `domains.ts` is that map's own storage contract; `backup.ts` wraps both
  stores into the JSON document the popup exports and imports.
- `src/test/` contains the Vitest helpers, including the Chrome API mock.
- `tests/` holds the checks that are not unit tests of `src/`: two
  source-convention guards and the unit tests for the AMO preview logic in
  `scripts/`. The same Vitest command runs them.
- `e2e/` drives the built extension in a real Chromium.
- `docs/` contains contributor-facing documentation.
- `e2e/fixtures/blocker/` is a stand-in content blocker used by the ad-blocker
  e2e tier. The real uBlock Origin cannot be loaded in Chromium at all — it is
  Manifest V2. `docs/ad-blockers.md` has the whole picture.
- `public/icons/` contains the icons copied into builds. `icon128.png` is also
  the AMO listing icon, which `scripts/publish-amo.mjs` uploads separately.
- `store/` contains the long description and the screenshots both stores
  publish; `chrome-web-store/` and `amo/` contain the metadata only one store
  has a shape for.
- `scripts/` contains the packaging, publishing, and browser entry points — some
  run by CI, some only by hand for screenshots, manual validation, and
  debugging. Each takes `--help`. `inspect-chromium.mjs` is the one that reports
  runtime state; `help.mjs` and `amo-previews.mjs` are shared modules rather
  than entry points.
- `dist/`, `dist-firefox/`, and `release/` are generated and git-ignored.

## Commands

Use `pnpm`.

- `pnpm build` — TypeScript build plus the Chrome package in `dist/`.
- `pnpm build:firefox` — the Firefox package in `dist-firefox/`.
- `pnpm lint` — oxlint over the whole tree; `pnpm lint:fix` applies the safe
  fixes. Zero findings is the bar. It is scoped to what `tsc` cannot see, so it
  stays quiet: the correctness category, the React hooks rules on
  `src/popup/`, and `vitest/valid-expect`. See [Linting](#linting).
- `pnpm lint:firefox` — build the Firefox target and check it with `web-ext
lint`. Zero errors is the bar; a few warnings are expected.
- `pnpm typecheck` — TypeScript only.
- `pnpm test` — the Vitest suite once.
- `pnpm e2e` — build, then run the Playwright suite against a real Chromium.
- `pnpm format` — Prettier check.
- `pnpm dev:chrome`, `pnpm dev:firefox`, `pnpm dev:zen` — build and open a
  browser with the extension loaded, for checking behavior by hand.
- `pnpm inspect:chrome` — a JSON snapshot of the built extension running in a
  headless Chromium, including whether the badge is on screen and why not. See
  [Debugging Reported Behavior](#debugging-reported-behavior).
- `pnpm check:filters` — match every cosmetic filter uBlock Origin and AdGuard
  ship against the badge the build actually renders. Exit 1 means an ad blocker
  hides it somewhere. See [Ad Blockers](./docs/ad-blockers.md).
- `pnpm blockers:fetch` — download the pinned content blockers into
  `node_modules/.tmp/blockers`, for `inspect:chrome --blocker` and
  `dev:firefox --with-ublock`.

Run `pnpm check:filters` when touching the badge's DOM or styling. For other
code changes run at least `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Run
`pnpm build` and `pnpm e2e` when touching the manifest, content script, service
worker, popup, shared settings, icons, or packaging. Also run
`pnpm lint:firefox` when touching the manifest or packaging — Gecko rejects
manifest keys Chrome accepts.

## Linting

`.oxlintrc.json` configures oxlint, and it is deliberately small. `tsc` already
runs `strict` with `noUnusedLocals`, `noUnusedParameters`, and
`noFallthroughCasesInSwitch`, and Prettier owns everything stylistic, so a rule
that only restates one of those is noise. The config carries what neither can
reach, and every entry has a comment saying why it is there. Keep it that way:
prefer leaving a rule off to suppressing it at call sites later.

Two things about the shape of that file are load-bearing:

- **The React hooks rules are scoped to `src/popup/`**, which is the only place
  React lives. They cannot be global. Playwright's fixtures take a `use`
  callback, and `rules-of-hooks` reads every one of them as React's `use` hook
  called outside a component — seven false positives in
  `e2e/fixtures/extension.ts` alone.
- **`plugins` replaces the default set rather than adding to it**, so the base
  list has to keep naming `oxc`, `typescript`, and `unicorn` even though oxlint
  enables those on its own.

The source-convention guards in `tests/` stay Vitest tests and should not be
rewritten as lint rules. They encode reasoning specific to this extension —
which is why they are prose with a regex rather than configuration — and the
comments explaining what Gecko does are worth more than the enforcement.

## Debugging Reported Behavior

**Behavior is checked in a throwaway profile, never a personal one.** Every way
this extension gets run by hand — `pnpm dev:chrome`, `pnpm dev:firefox`,
`pnpm dev:zen`, `pnpm e2e` — loads the freshly built `dist/` or `dist-firefox/`
into a profile under `node_modules/.tmp/`, and the browser is launched by
Playwright or web-ext rather than being the one in the taskbar. So the extension
is **not** installed under `~/.config/chromium`, `~/.config/google-chrome`, or
`~/.mozilla/firefox`, and those profiles say nothing about a reported problem.
`node_modules/.tmp/dev-profile` (Chromium), `firefox-dev-profile`, and
`zen-dev-profile` are where the state actually is.

When a report is about what the extension does at runtime, get the browser's
answer before reasoning from the source:

- `pnpm build && pnpm inspect:chrome [url]` prints the extension id, the
  permissions Chromium granted, every tab the service worker can see with
  whether its URL is readable, the `rebobinate:popup-state` reply, and stored
  state. `--profile-only` reads just the granted permissions off disk, which
  works while `pnpm dev:chrome` still holds the profile open.
- Granted host access is not the manifest. Chromium records what it actually
  gave the extension in `<profile>/Default/Preferences` under
  `extensions.settings.<id>`; `withholding_permissions` and the gap between
  `granted_permissions` and `active_permissions` are what "Site access: on
  click" looks like from here. `inspect:chrome` reports all three.
- **A tab with no `url` is the common trap.** Chromium omits `url` from
  `tabs.query` results for any tab the extension has no access to — every
  `chrome-extension://` and `chrome://` page, and every page when host access is
  withheld. It is not distinguishable from a tab whose URL simply was not read,
  so code that classifies tabs by URL has to treat a missing one as unknown.
- The popup opened as a tab is not the popup. A real popup is an overlay, so the
  page underneath stays active; the popup document in a tab is active itself and
  the service worker resolves it instead. `pnpm dev:chrome` prints a popup URL,
  and that URL is the only way to reach the popup document directly — so this
  divergence is easy to hit by hand. `inspect:chrome` asks both ways and reports
  both. [Testing](./docs/testing.md#the-popup-is-not-a-tab) has the detail.

Gecko has no equivalent inspector: web-ext installs a temporary add-on whose
internal UUID changes every run, so check those targets by hand.

## Coding Guidelines

- Follow the existing TypeScript style: strict types, no semicolons, single
  quotes, 2-space indentation, 80-column Prettier wrapping.
- **Never `await` a `chrome.*` call in `src/`.** This is a Firefox requirement,
  not a preference: Gecko exposes `chrome.*` as callback-only and puts the
  promise-returning variants on `browser.*`, so an awaited call resolves to
  `undefined` there while every Chrome test still passes.
  `tests/browser-api-compat.test.ts` enforces this.
- **Keep the two entry files' basenames distinct.** crxjs names output chunks
  after the entry basename, so a content script and a service worker both called
  `main.ts` produce colliding chunks and the service-worker loader ends up
  importing the content script. That failure is silent: the extension loads, the
  content script works, and the background simply never registers its listeners.
- Every storage read goes through a normalizer — `normalizeSettings` in
  `src/shared/settings.ts` for the settings object, `normalizeDomains` in
  `src/shared/domains.ts` for the per-site speed map. Storage is untrusted
  input. A new storage key needs its own normalizer, not a cast.
- Per-site speeds are keyed by the registrable domain from
  `src/shared/domain.ts`, taken from the **top frame's** URL so an embedded
  player follows the page around it. The key format is baked into what installed
  copies have stored: changing it needs a re-key, not a reset.
- Keep speed arithmetic in `src/shared/speed.ts` so it stays testable without a
  DOM, and keep values on the step grid — off-grid rates are how a speed control
  starts feeling wrong.
- The content script must never steal a keystroke it does not need: no video in
  the tab, an editable target anywhere in the composed path, or a modifier held
  all mean hands off.
- Keep the badge out of the page's own DOM tree. It is a fixed-position host
  with a shadow root; re-parenting site nodes is what breaks layouts.
- **Keep the badge host unremarkable to a filter list.** No `style` attribute,
  no `z-index` or `position` outside the `:host` rule in its shadow root, and no
  `ad`/`banner`/`overlay`/`sponsor` substring in its id or classes. Cosmetic
  filters are CSS selectors injected at user origin, so a match cannot be
  outranked — only avoided. `pnpm check:filters` is the check and
  `docs/ad-blockers.md` is the reasoning; run it after any change to how the
  badge is built.
- **No `<input>` that opens a native chooser under `src/popup/`** — `type="color"`
  and `type="file"`. On Gecko the popup is a XUL panel that autohides when the
  native dialog takes focus, which tears down the popup document before the
  user's choice can be saved. The popup renders its own colour picker instead;
  `tests/popup-native-dialogs.test.ts` enforces this, and
  `docs/build-targets.md` has the trace and the upstream bugs.
- Keep the popup compact. It is fixed at 320px wide.

## Generated And Release Files

- Do not hand-edit `dist/` or `dist-firefox/`; change the source and rebuild.
- Do not create or replace files in `release/` outside explicit release
  packaging.
- Do not change `browser_specific_settings.gecko.id`. AMO binds the listing and
  every installed user's update path to it, so a new id is a new add-on.
- Editing `store/description.txt` is a live change to the AMO listing: the next
  release sends it. It is also the Chrome listing copy, which reaches that store
  only when someone pastes it into the Developer Dashboard. Do not park draft
  copy there.
- Replacing anything in `store/screenshots/` also needs `amo/previews.json`
  checked by hand. `tests/amo-previews.test.mjs` validates the manifest's shape
  and that every file it names is present and under 4MB, but nothing can check
  that a caption still describes the image it points at.
- Do not bump the `package.json` version unless explicitly requested.

## Documentation Guidelines

- Document contributor-facing behavior in `docs/`, and keep it tied to the code
  as it is today.
- When behavior, the settings contract, Chrome API usage, or packaging changes,
  update the affected docs in the same change.
