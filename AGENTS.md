# AI project guidelines

`rebobinate`: a Manifest V3 browser extension that controls the playback speed
of any video from the keyboard. One source tree — Vite, React, TypeScript,
`@crxjs/vite-plugin` — builds both the Chrome Web Store and the
addons.mozilla.org package; only manifest keys differ.

- Key commands
  - `pnpm lint && pnpm typecheck && pnpm test` — the gate for every change.
  - `pnpm build`, `pnpm build:firefox` — `dist/` and `dist-firefox/`.
  - `pnpm e2e` — Playwright against a real Chromium. Run it when the manifest,
    content script, service worker, popup, shared settings, or packaging move.
  - `pnpm lint:firefox` — `web-ext lint`. Run it with any manifest or packaging
    change; Gecko rejects keys Chrome accepts.
  - `pnpm check:filters` — run it after any change to how the badge is built or
    styled. Exit 1 means a shipped ad-blocker filter hides it.
  - `pnpm dev:chrome`, `dev:firefox`, `dev:zen` — the build in a throwaway
    profile, never a personal one.
  - `pnpm inspect:chrome [url]` — JSON snapshot of the running extension. Get
    the browser's answer before reasoning from the source about a runtime
    report.
  - `mimic run --target .` — code-blind critique of the popup; see
    `mimic.config.ts`.

- Key documentation
  - [docs/index.md](./docs/index.md) — the map.
  - [docs/code-overview.md](./docs/code-overview.md) — the runtime surfaces and
    the contracts between them.
  - [docs/build-targets.md](./docs/build-targets.md) — the two builds and the
    Gecko rules that constrain `src/`.
  - [docs/testing.md](./docs/testing.md) — the suites, the Chrome API mock, and
    manual validation.
  - [docs/ad-blockers.md](./docs/ad-blockers.md) — why the badge looks the way
    it does.
  - [docs/store-listings.md](./docs/store-listings.md) and
    [docs/ci-release-flow.md](./docs/ci-release-flow.md) — what ships, and how.

- What is actually frozen

  This extension is published and people have it installed. Three surfaces are
  real constraints; everything else — module boundaries, message shapes, the
  build pipeline, the test layout — is free to change, and the prior
  architecture does not get a vote.

  - **Stored state.** An installed copy holds a `Settings` object and a domain
    map written by an older version. Every read goes through `normalizeSettings`
    or `normalizeDomains`; a new storage key needs its own normalizer, not a
    cast. Bumping a `schemaVersion` without handling what the previous one wrote
    silently resets a user.
  - **`browser_specific_settings.gecko.id`.** A new id is a new add-on.
  - **The listings.** `store/`, `amo/`, and `chrome-web-store/` are live copy —
    an edit there ships on the next release, so no draft copy lives in them.

  `dist/`, `dist-firefox/`, and `release/` are generated: change the source and
  rebuild, and leave `release/` to release packaging. Do not bump the
  `package.json` version unless asked.

- Iron Laws
  - Tokens are expensive, state of the art models need minimal guidance, don't repeat yourself, don't babysit, don't be over-specific.
  - AI-native project. All code is AI-generated.
  - Minimal attention when model implements without errors, we document in more detail when model struggles.
  - Do not expect the user to have read each line, don't lose him on the internals, give visibility on a higher-architectural level.
  - No journaling: code comments / documentation describe current state, they don't carry a log of their own edit history.
