# Build Targets

One source tree, two packages.

```sh
pnpm build            # Chrome  -> dist/
pnpm build:firefox    # Firefox -> dist-firefox/
pnpm lint:firefox     # build the Firefox target, then web-ext lint
pnpm package:firefox  # build and zip it into release/
```

`EXT_TARGET=firefox` selects the Firefox target; any other value, including
unset, builds the Chrome package. Both `manifest.config.ts` and `vite.config.ts`
read it.

## What differs between the two

Only manifest keys:

- Chrome uses `background.service_worker` with `type: module`; Gecko has no
  extension service workers and uses `background.scripts`.
- The Firefox build adds `browser_specific_settings.gecko`:
  - `id: rebobinate@shbernal.github.io` — **permanent**. AMO binds the listing
    and every installed user's update path to it, so changing it creates a new
    add-on.
  - `strict_min_version: '140.0'` — the floor at which Firefox understands
    `data_collection_permissions`. Below it the key is ignored and the
    no-data-collection disclosure never reaches the user.
  - `data_collection_permissions: { required: ['none'] }` — see
    [Store Listings](./store-listings.md).

## Never `await` a `chrome.*` call in `src/`

Gecko exposes `chrome.*` as callback-only and puts the promise-returning
variants on `browser.*`. An awaited `chrome.*` call therefore resolves to
`undefined` on Firefox while every Chrome test still passes — a silent,
target-specific break. All extension API calls stay callback-based;
`tests/browser-api-compat.test.ts` enforces it.

## Entry basenames must be distinct

crxjs names its output chunks after the entry file's basename. A content script
and a service worker both named `main.ts` produce colliding chunks, and the
generated `service-worker-loader.js` ends up importing the **content script**.

The failure is silent and easy to misread: the extension loads, the content
script works, the service worker starts — and it simply never registers its
listeners, so every message from the page goes unanswered. Verify after a build:

```sh
cat dist/service-worker-loader.js   # must import the service-worker chunk
```

This is why the entries are `src/background/service-worker.ts` and
`src/content/content-script.ts`.

## Firefox lint

`pnpm lint:firefox` must report zero errors. A few warnings are expected and
acceptable:

- two `UNSAFE_VAR_ASSIGNMENT` warnings for `innerHTML` inside the bundled React
  runtime;
- one warning that `browser_specific_settings.gecko.data_collection_permissions`
  is not supported on Firefox for Android at the declared minimum version.

Run it whenever the manifest or packaging changes: Gecko rejects manifest keys
Chrome accepts, so the second target can break on a change that leaves the
Chrome build healthy.

## Manual validation

`pnpm dev:chrome` builds and opens Chromium with `dist/` loaded.
`pnpm dev:firefox` and `pnpm dev:zen` do the same for `dist-firefox/` on Gecko.
See
[Testing](./testing.md#manual-validation-on-real-sites). Check:

- a plain HTML5 video page, a YouTube watch page, an embedded player on a
  third-party page;
- SPA navigation between videos — the speed must survive it;
- fullscreen, where the badge must remain visible and correctly placed;
- typing in a site's search box must never change the speed;
- the four badge corners, at normal speed and above.

Run the list on both targets. Gecko is where the background script, not a
service worker, and the callback-only `chrome.*` surface can diverge.
