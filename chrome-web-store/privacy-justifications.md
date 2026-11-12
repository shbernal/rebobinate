# Chrome Web Store Privacy Justifications

Paste-ready answers for the Developer Dashboard privacy form. Every claim here
must match `manifest.config.ts` and current runtime behavior. Re-read the
content script, service worker, popup, and `src/shared/settings.ts` before
submitting.

The body text under each dashboard-field heading below is the answer itself and
goes into a plain-text form field verbatim. Keep it free of Markdown — no
backticks, emphasis, blockquotes, or lists — so nothing reaches the reviewer as
stray punctuation. Headings are labels, not answers, so they may keep their
markup, and anything explaining an answer belongs in a section that is never
pasted. Each answer is one unwrapped line, however long, because a form field
keeps the newlines it is given and a hard-wrapped paragraph arrives ragged.

Last reviewed against `manifest.config.ts` at version 0.2.0.

## Single Purpose

Rebobinate has one purpose: to let the user change the playback speed of videos on web pages, from the keyboard or from the extension popup, and to show the current speed on the video and on the toolbar icon, along with how much time the chosen speeds have saved.

## Permission: `storage`

The extension stores the user's own preferences in extension storage so they persist between sessions: the speed increment, the keyboard bindings, and the appearance of the on-video speed badge. These preferences are also kept in chrome.storage.sync, so Chrome Sync carries them to the user's other browsers when the user has sync turned on; nothing else is synced. It also stores the playback speed the user chose on a site, so the same speed applies on the next visit. That per-site memory is keyed by domain, is written only when the user changes the speed on that site, holds at most 500 entries, and can be switched off or cleared from the popup. It also keeps usage statistics stored locally, never transmitted: daily totals of how long videos played on each site and at what speed, with no URLs and no times of day, shown on the extension's own stats page and switchable off or clearable there and in the popup. No other data is stored, and nothing is written to a remote service.

## Host Permission: `<all_urls>`

Videos are not confined to a list of sites: a user may want to change the playback speed of a video on any page, including players embedded in iframes on third-party sites. The content script runs only to find video elements, set their playbackRate, and draw the optional speed badge over them. It does not read page content, cookies, form fields, or any personal data, and it sends nothing anywhere.

## Remote Code

No. The extension executes no remote code. All scripts are bundled in the package.

## Data Usage Disclosures

Check nothing. The extension collects and transmits no user data:

- no personally identifiable information;
- no health, financial, or authentication information;
- no personal communications;
- no location;
- no web history — the extension does not record which pages the user visits. The per-site speed memory saves a domain only when the user changes the speed on it, and the usage statistics keep daily watch-time totals per domain; both stay in local extension storage and are never transmitted;
- no user activity — the extension does not log clicks or keystrokes, and the watch-time totals it keeps on the device are never transmitted;
- no website content — page content is never read or copied.

Confirm all three certifications:

- data is not sold or transferred to third parties;
- data is not used or transferred for purposes unrelated to the single purpose;
- data is not used or transferred to determine creditworthiness or for lending.

## Before Each Submission

1. Compare the manifest's `permissions`, `host_permissions`, and
   `content_scripts.matches` against the sections above.
2. Remove justifications for permissions the manifest no longer requests, and
   remove manifest permissions that no longer serve the single purpose.
3. The per-site speed memory stores more than preferences, though it never
   leaves the device. Keep its answers above in step with what the popup can
   remember and clear. The usage statistics are held to the same rule: local
   daily totals only, never transmitted.
4. Keep every dashboard answer under the field limit shown in the form.
