# Data Collection And Permission Justifications

Use this copy for the addons.mozilla.org submission. Keep every answer aligned
with `manifest.config.ts` and current runtime behavior before submitting a
build. This is the AMO counterpart to
`chrome-web-store/privacy-justifications.md`; the underlying claims are the
same, but AMO asks for them in a different shape.

Last reviewed against `manifest.config.ts` at version 0.2.0.

## Declared Data Collection

The Firefox manifest declares:

```json
"data_collection_permissions": { "required": ["none"] }
```

Firefox shows this to the user at install time as a statement that the add-on
collects no data. The key is only understood from Firefox 140, which is why
`strict_min_version` is `140.0` — below that floor the key is ignored and the
disclosure would never reach the user.

`none` is the strongest answer available and it may not be combined with any
other value. It is only correct while every one of the following holds.

## Basis For The `none` Answer

- The manifest requests `storage` and the host permission `<all_urls>`. Nothing
  else.
- The entire non-test extension API surface is `storage.local` and
  `storage.sync` get/set plus `storage.onChanged`; `tabs.query`,
  `tabs.sendMessage`, `tabs.create` (the extension's own stats page), `tabs.onUpdated` and `tabs.onRemoved`;
  `runtime.sendMessage`, `runtime.onMessage`, `runtime.getURL`,
  `runtime.lastError`; and the `action` badge calls that put the tab's speed on
  the toolbar icon.
- `src/` contains no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`,
  `EventSource`, `new Image(`, or HTTP client dependency. The only remote URLs
  in the tree are example.com string literals inside tests.
- Settings are kept in `storage.local` and replicated to `storage.sync`, so
  Firefox Sync carries them between the user's own browsers when the user has
  it turned on; without an account sync storage stays on the device. They are
  preferences only: speed step, key bindings, badge appearance, switches. The
  per-site speed map and the watch-time stats are written to and read from
  `storage.local` only. There is no remote endpoint of the extension's own and
  no telemetry.
- The tab-level speed the service worker keeps in memory is discarded when the
  tab closes and is never written anywhere.
- The content script touches the page only to find `<video>` elements, set their
  `playbackRate`, and draw the speed badge over them. It does not read, persist,
  or derive anything from page content, and it does not record which pages the
  user visits. The only thing it measures is how long its videos play, which it
  hands to the service worker as daily totals.

Settings sync is the one path off the device, and `none` is kept for it on a
reading of AMO's definition rather than an explicit ruling: the extension
transmits nothing itself. It writes `storage.sync`, and Firefox Sync, the
browser's own end-to-end encrypted service under the user's own account,
carries it between that user's browsers when they have turned it on. Mozilla's
built-in data consent documentation does not mention `storage.sync`; if it
comes to classify it as transmission, the declaration changes before the next
release. That change is not a one-word swap: the matching category,
`technicalAndInteraction` ("extension usage and settings data"), may only be
declared optional, so the Firefox build would have to sync only while the user
has granted it, or not sync at all.

If a future change transmits anything else off the device — analytics, crash
reporting, a remote config fetch, syncing the site map or the stats —
`data_collection_permissions` must change before that ships. It is a
user-facing promise, not a formality.

The per-site speed memory stores more than preferences. It holds a speed against
each domain the user changed the speed on, so `none` rests on the same fact the
rest of this file does: that map is written to `storage.local` and read back
from it, and nothing sends it anywhere.

The watch-time stats rest on the same fact. They hold, per local day, how long
videos played on each domain at each speed, as totals in seconds: no URLs, no
times of day, no event log. They are written to `storage.local` only, kept for
90 days, a year or forever as the user chooses, switchable off in the popup, and
clearable from the stats page. They are not in the backup export, and nothing
sends them anywhere. Because they stay on the device, they are not data
collection in AMO's sense and `none` still holds; the listing says they exist.

## Permission Justifications

Send these as reviewer notes if AMO asks why each permission is needed. The body
text under each heading is pasted verbatim into a plain-text field, so it stays
free of Markdown; the headings are labels and may keep their markup.

### `storage`

Saves the user's own preferences: the speed increment, the keyboard bindings, and the appearance of the on-video speed badge. These preferences are also written to storage.sync, so Firefox Sync carries them to the user's other browsers when the user has turned it on; nothing else is synced. It also saves the speed the user chose on a site, keyed by domain, so the same speed applies on the next visit, and the user can switch that off or clear it from the popup. It also keeps usage statistics stored locally, never transmitted: daily totals of how long videos played on each site and at what speed, which the extension's stats page shows and which the user can switch off or clear. Everything except the preferences stays in storage.local. It is not used to collect or transmit browsing data.

### Host permission `<all_urls>`

Videos are not confined to a list of sites, and a player is frequently inside an
iframe served from a different origin than the page around it. The content
script therefore runs in every frame, but only to find video elements, apply the
user's chosen playback rate, and position the speed badge. It reads no page
content and contacts no server.

## Review Process

Before submitting a version:

1. Compare `manifest.config.ts` against this file.
2. Check that every `permissions`, `host_permissions`, and
   `content_scripts.matches` entry has a justification here, and that no
   justification survives for a permission that has been removed.
3. Re-read the popup, service worker, content script, and shared settings code
   before repeating the claims about local storage, host access, and data
   handling.
4. Re-run the `src/` search for the network APIs listed above. The `none`
   declaration rests on it.
