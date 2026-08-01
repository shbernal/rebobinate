# Data Collection And Permission Justifications

Use this copy for the addons.mozilla.org submission. Keep every answer aligned
with `manifest.config.ts` and current runtime behavior before submitting a
build. This is the AMO counterpart to
`chrome-web-store/privacy-justifications.md`; the underlying claims are the
same, but AMO asks for them in a different shape.

Last reviewed against `manifest.config.ts` at version 0.1.0.

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
- The entire non-test extension API surface is `storage.local` get/set plus
  `storage.onChanged`, `tabs.query`, `tabs.sendMessage` and `tabs.onRemoved`,
  and `runtime.sendMessage`, `runtime.onMessage`, `runtime.lastError`.
- `src/` contains no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`,
  `EventSource`, `new Image(`, or HTTP client dependency. The only remote URLs
  in the tree are example.com string literals inside tests.
- Settings are written to and read from `chrome.storage.local` only. There is no
  sync storage, no remote endpoint, and no telemetry.
- The tab-level speed the service worker keeps in memory is discarded when the
  tab closes and is never written anywhere.
- The content script touches the page only to find `<video>` elements, set their
  `playbackRate`, and draw the speed badge over them. It does not read, persist,
  or derive anything from page content, and it does not record which pages the
  user visits.

If a future change transmits anything off the device — analytics, sync, crash
reporting, a remote config fetch — `data_collection_permissions` must change
before that ships. It is a user-facing promise, not a formality.

Per-site speed memory and usage statistics are planned. Both stay on the device,
so `none` still holds, but both store more than preferences: re-read this file
when either ships.

## Permission Justifications

Send these as reviewer notes if AMO asks why each permission is needed.

### `storage`

Saves the user's own preferences: the speed increment, the keyboard bindings,
and the appearance of the on-video speed badge. Written to `storage.local`. It
is not used to collect or transmit browsing data.

### Host permission `<all_urls>`

Videos are not confined to a list of sites, and a player is frequently inside an
iframe served from a different origin than the page around it. The content
script therefore runs in every frame, but only to find `<video>` elements, apply
the user's chosen playback rate, and position the speed badge. It reads no page
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
