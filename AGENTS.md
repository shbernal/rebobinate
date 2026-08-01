# Repository Instructions

## Pre-Release Project Guidance

This project has no GitHub release yet.

- Treat the project as pre-release and free to change.
- Do not preserve backwards compatibility unless Santiago explicitly asks for it.
- Do not defer to the prior architecture when it conflicts with the current goal.
- Existing code, docs, and plans are context, not constraints.
- Prefer the simplest coherent architecture for the current project direction.

Once the project has a GitHub release, compatibility and migration concerns
become real project constraints and must be evaluated before breaking changes.

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
- `src/background/service-worker.ts` owns the speed of each tab and relays it to
  every frame.
- `src/popup/App.tsx` is the popup UI.
- `src/shared/` holds the settings contract, speed arithmetic, key matching, and
  the message types shared by all three surfaces.
- `src/test/` contains the Vitest helpers, including the Chrome API mock.
- `tests/` contains source-convention guards run by the same Vitest command.
- `e2e/` drives the built extension in a real Chromium.
- `docs/` contains contributor-facing documentation.
- `public/icons/` contains the icons copied into builds.
- `chrome-web-store/` and `amo/` contain store listing copy and metadata.
- `scripts/` contains the packaging and publishing scripts run by CI.
- `dist/`, `dist-firefox/`, and `release/` are generated and git-ignored.

## Commands

Use `pnpm`.

- `pnpm build` — TypeScript build plus the Chrome package in `dist/`.
- `pnpm build:firefox` — the Firefox package in `dist-firefox/`.
- `pnpm lint:firefox` — build the Firefox target and check it with `web-ext
lint`. Zero errors is the bar; a few warnings are expected.
- `pnpm typecheck` — TypeScript only.
- `pnpm test` — the Vitest suite once.
- `pnpm e2e` — build, then run the Playwright suite against a real Chromium.
- `pnpm format` — Prettier check.

For code changes run at least `pnpm typecheck` and `pnpm test`. Run `pnpm build`
and `pnpm e2e` when touching the manifest, content script, service worker,
popup, shared settings, icons, or packaging. Also run `pnpm lint:firefox` when
touching the manifest or packaging — Gecko rejects manifest keys Chrome accepts.

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
- Every storage read goes through `normalizeSettings` in
  `src/shared/settings.ts`. Storage is untrusted input.
- Keep speed arithmetic in `src/shared/speed.ts` so it stays testable without a
  DOM, and keep values on the step grid — off-grid rates are how a speed control
  starts feeling wrong.
- The content script must never steal a keystroke it does not need: no video in
  the tab, an editable target anywhere in the composed path, or a modifier held
  all mean hands off.
- Keep the badge out of the page's own DOM tree. It is a fixed-position host
  with a shadow root; re-parenting site nodes is what breaks layouts.
- Keep the popup compact. It is fixed at 320px wide.

## Generated And Release Files

- Do not hand-edit `dist/` or `dist-firefox/`; change the source and rebuild.
- Do not create or replace files in `release/` outside explicit release
  packaging.
- Do not change `browser_specific_settings.gecko.id`. AMO binds the listing and
  every installed user's update path to it, so a new id is a new add-on.
- `amo/description.txt` and `chrome-web-store/description.txt` describe the same
  product; change them together.
- Do not bump the `package.json` version unless explicitly requested.

## Documentation Guidelines

- Document contributor-facing behavior in `docs/`, and keep it tied to the code
  as it is today.
- When behavior, the settings contract, Chrome API usage, or packaging changes,
  update the affected docs in the same change.
