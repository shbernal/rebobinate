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

## No native pickers in the popup

`<input type="color">` and `<input type="file">` are unusable in the action
popup on Gecko. The popup renders its own colour picker
(`src/popup/ColorPicker.tsx`, on the maths in `src/shared/color.ts`) instead, and
`tests/popup-native-dialogs.test.ts` fails if either input reappears under
`src/popup/`.

`type="file"` has one caller that would otherwise want it: importing a backup.
It takes pasted JSON in a textarea instead (`src/popup/Backup.tsx`), and export
answers with a textarea and a Copy button rather than a download, which keeps
the pair symmetrical and needs no permission the extension does not already
hold.

### What happens

On Firefox the action popup is a **XUL panel**, not a tab, and a XUL panel
autohides when it loses focus. A native picker is a separate toplevel window of
the same process, so opening one destroys the document that asked for it:

1. clicking the toolbar icon opens `src/popup/index.html` as a panel;
2. clicking the input makes Gecko call `gtk_color_chooser_dialog_new` — a real
   GTK toplevel, confirmed as a linked symbol in `libxul.so`;
3. the window manager maps and focuses that window, which is ordinary
   behaviour;
4. the panel loses focus and the popup manager rolls it up, **tearing down the
   popup document** — the React tree, the input, and its `onChange` with it;
5. the user picks a colour into a dialog whose opener no longer exists. No
   `change` event has anywhere to fire, so nothing is written to storage.

Traced on Hyprland with Zen 1.21.9b (Gecko 153.0) by reading the compositor's
event socket. Under Wayland the panel is an `xdg_popup` subsurface and never
appears as a window at all; forcing XWayland makes it a real window and shows
the ordering directly:

```
openwindow>>…,firefox,Firefox            # the popup panel
openwindow>>…,firefox,Choose a color     # the GTK dialog maps
activewindow>>firefox,Choose a color     # …and takes focus
closewindow>>…                           # the panel is destroyed, before
closewindow>>…                           # …the colour is chosen
```

### Whose bug it is

Gecko's. It is not compositor-specific and not a Zen patch: it reproduces in
stock Firefox under XWayland, with no Wayland toplevel involved, and Mozilla's
one attempt at a fix was backed out over a **Windows** regression.

- [bug 1292701](https://bugzilla.mozilla.org/show_bug.cgi?id=1292701) —
  "Autoclose popups shouldn't close when they open a modal dialog (e.g., file
  picker)". Core :: XUL, NEW since 2016-08-05, unassigned. The tracking bug.
- [bug 1713107](https://bugzilla.mozilla.org/show_bug.cgi?id=1713107) — "The
  native colorpicker from an input element with type='color' closes the
  extension popup window". Duplicate of 1292701, and exactly this case.
- [bug 1378527](https://bugzilla.mozilla.org/show_bug.cgi?id=1378527) — "popups
  opened from a panel cause the panel to close". The general form, NEW for nine
  years.

Nothing was filed upstream for this: 1713107 already describes it and is one of
five duplicates on 1292701, so a sixth adds no information.

### Why the picker rather than an options page

Moving the colours to an `options_ui` page is the workaround Mozilla suggests on
1378527, and it does work — an options page is a tab, where a native dialog is
harmless. It was rejected because it splits the settings across two surfaces for
the sake of two controls, and it fixes nothing for any picker the popup might
want later. Rendering the control in the popup document keeps every setting in
one place and behaves identically on both targets.

`ui.popup.disable_autohide` in `about:config` keeps the panel alive, but it is a
devtools debugging pref: it applies to every panel in the browser, and it is not
something a user can be asked to set.

## The content script is bundled outside crxjs

crxjs ships a content script as a loader that `import()`s the real chunk, which
only works if the chunk and its imports are `web_accessible_resources` for
`<all_urls>`, at a stable URL. With the Web Store id public, any page could fetch
one to learn Rebobinate is installed, and which build.

So `vite build` hands crxjs the manifest without `content_scripts`, and the
`rebobinate:content-scripts` plugin in `vite.config.ts` bundles each one after
the main build as a single self-contained IIFE, then writes it into the emitted
manifest. Neither package has a `web_accessible_resources` key, and
`e2e/specs/fingerprint.spec.ts` fetches every shipped file from a page to keep
it that way. `pnpm dev` still goes through crxjs, for its hot reload, so the
probe is open there.

A content script that imports CSS or an asset would need that handled in the
plugin too; today it imports only TypeScript.

## Entry basenames must be distinct

crxjs names its output chunks after the entry file's basename, and the content
script bundle is named the same way. Two entries sharing a basename (`main.ts`)
produce colliding chunks, and the generated `service-worker-loader.js` can end
up importing the wrong one. The extension still loads and the service worker
still starts, but it never registers its listeners, so every message goes
unanswered. Verify after a build:

```sh
cat dist/service-worker-loader.js   # must import the service-worker chunk
```

This is why the entries are `src/background/service-worker.ts` and
`src/content/content-script.ts`, and why the stats page is the build input
`stats-page` rather than `stats`: `stats` is also the chunk
`src/shared/stats.ts` lands in.

The stats page is an input in `vite.config.ts` because crxjs only builds the
pages the manifest names, and no manifest key names it: the popup opens it with
`tabs.create`. It ships in both packages at `src/stats/stats-page.html`.

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
