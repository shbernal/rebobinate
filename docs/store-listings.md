# Store Listings

Listing copy, metadata, and media live in the repository so they stay in step
with the code and stay reviewable in version control.

What both stores publish verbatim lives in `store/`. What only one store has a
shape for lives in that store's directory.

```text
store/
  description.txt              long description, shared by both listings
  screenshots/                 listing screenshots, shared by both listings
chrome-web-store/
  privacy-justifications.md    paste-ready dashboard privacy form answers
  promo-tile-440x280.png       small promo tile (Chrome only)
amo/
  listing.json                 slug, summary, categories, tags, support links
  previews.json                caption and order for store/screenshots/
  previews.lock.json           what was last applied, and what AMO called it
  data-collection.md           data_collection_permissions basis + answers
  source-submission.md         reviewer build instructions + archive procedure
```

Regenerate the screenshots with `node scripts/capture-screenshots.mjs` after
`pnpm build`. It writes all three at 1280×800 with no post-processing, and
scales the popup capture to fit the canvas rather than assuming a fixed zoom, so
adding a control to the popup cannot silently crop it. Replacing a screenshot
means re-reading its caption in `amo/previews.json` by hand:
`tests/amo-previews.test.mjs` checks the manifest's shape and that every file it
names is present and under 4MB, but no test can tell that a caption has stopped
describing the image it points at.

AMO has no promo-tile requirement, so it needs nothing the Chrome listing does
not already have. Do not copy or regenerate the screenshots into `amo/`.
`amo/previews.json` references them in place and stays in `amo/` because it is
AMO-shaped metadata — localized captions and `position` semantics — about images
Chrome consumes without either.

## The Description Is Shared, But Not Applied Alike

The long description is the only listing field both stores publish verbatim, so
there is one copy at `store/description.txt` and no per-store duplicate. It is
plain text with `-` bullets, the format both stores render acceptably: AMO
accepts a limited set of HTML tags in this field and the Chrome Web Store does
not, so the shared file stays at that lowest common denominator. Wanting markup
on the AMO side is the one thing that would justify splitting the file again.

The two stores consume it at different speeds:

- **AMO is automatic.** `scripts/publish-amo.mjs` sends the file on every
  release, so a dashboard edit is overwritten by the next one.
- **Chrome is a manual paste.** `.github/workflows/publish-cws.yml` uploads the
  package and publishes; it never touches the item's listing metadata. A copy
  edit reaches Chrome only when someone pastes it into the Developer Dashboard,
  and a description-only change still puts the item back through Chrome review.

So an edit to this file is effectively a queued AMO change — do not park draft
copy there — and the Chrome listing lags the repository until someone visits the
dashboard. That lag is the reason to check the description during a release
rather than assuming it shipped.

## AMO Listing Metadata Is Applied Through The API

`scripts/publish-amo.mjs` sends `amo/listing.json` with `description` filled in
from `store/description.txt` on every release. `name` comes from the manifest.
The add-on record does not exist until the first version upload, which is why
the metadata travels with the submission rather than being applied ahead of it.

Field constraints worth knowing before editing:

- `summary` is capped at 250 characters and `name` at 50.
- `tags` and `categories` are closed vocabularies, not free text: AMO defines 42
  tags and 15 extension categories and rejects anything else. The live lists are
  `https://addons.mozilla.org/api/v5/addons/tags/` and `.../addons/categories/`,
  and `pnpm publish:amo --dry-run` checks the file against both. Probing with
  `GET /addons/search/?tag=<tag>` does not work: it returns HTTP 200 and
  `count: 0` for a name that is not a tag at all.
- `categories` is a flat array in v5. The published API reference still shows it
  keyed by application; that shape is accepted only for backwards compatibility,
  and the Android categories behind it no longer exist.
- Localized fields are written as `{"en-US": "..."}`. They read back in a richer
  shape than they are written in, so do not round-trip a `GET` response into a
  `PATCH` body.

## The AMO Listing Icon And Screenshots Are Repo-Driven Too

The listing icon and the screenshots are metadata on the add-on, not on a
version, and they do not come from the package. The manifest `icons` key drives
`about:addons`; the AMO page shows a placeholder until something uploads an icon
explicitly. Neither can ride along on the listing `PUT`, because AMO takes both
as multipart form-data only and refuses `icon` at add-on creation. Both are
applied after the version is created, which is also when the add-on record first
exists on a maiden submission.

| Asset    | Endpoint                                   | When                       |
| -------- | ------------------------------------------ | -------------------------- |
| Icon     | `PATCH /addons/addon/{guid}/` (`icon`)     | when the file has changed  |
| Previews | `POST`/`PATCH`/`DELETE .../previews/{id}/` | when the manifest has, too |

The icon is sent only when its bytes have changed since the last apply, or when
AMO is still serving the placeholder — the lock cannot know an upload was
accepted, but a placeholder proves none was. Everything below about the preview
budget applies to it too: it is one call out of ten an hour, spent re-uploading
identical bytes on every release otherwise.

Constraints, which the script checks locally so a bad file fails before anything
is uploaded: PNG or JPEG only, not animated, under 4MB. The icon must also be
square — AMO enforces that server-side. Previews have no minimum dimension; the
1000×750 in AMO's documentation is a resize target, not a rejection threshold,
so the 1280×800 screenshots are accepted as they are.

### Writes Are Throttled Hard

`addon_submission_throttles` in addons-server applies three per-user limits —
3/minute, 10/hour and 24/day — to every unsafe method on the add-on, version and
preview endpoints. Reads are free; all three viewsets share the one budget, so a
release and a preview sync spend from the same ten an hour. Package uploads are
the exception: `/addons/upload/` is a different viewset with its own, larger
scope (`file_upload_throttles`, 20/hour), so it does not compete. A release
itself is two calls — the version `PUT` and the source `PATCH` — plus the icon
`PATCH` on the releases where the icon has actually changed.

Two properties of the server decide how the script behaves.

**A rejected request still costs.** DRF checks every throttle class on every
request, and each one that is not the one rejecting records a hit before another
returns 429. So a call bounced by the 3/minute limit has still spent a slot of
the 10/hour and the 24/day. Retrying into throttles burns budget on requests
that never ran, and enough of it locks the account out for a day — across every
extension published from this account, since the limits key on the authenticated
user and the JWT is account-scoped. `scripts/amo-throttle.mjs` therefore paces
ahead of the call: it tracks what this run has sent, holds until the sliding
window has room, and refuses rather than sleeps when the wait says the daily cap
is gone. The `Retry-After` retry stays as the backstop for budget an earlier run
spent, and a 429 is the only status retried, since every other failure means the
request itself is wrong.

**There is no way to raise the ceiling.** `GranularUserRateThrottle` honors one
bypass, the `API_BYPASS_THROTTLING` permission, and that is a group membership
granted to Mozilla's own release-engineering and QA accounts — not something a
token, key, or scope can obtain. Per-IP limits sit on top, so re-minting
credentials changes nothing. The only lever is making fewer calls.

### Only The Difference Is Sent

The lever is `amo/previews.lock.json`. AMO re-encodes every image on ingest, so
a local file and its published copy never share a hash, and nothing on a preview
records which manifest entry produced it — the pairing exists only if the side
that uploaded writes it down. So the lock records, per entry, the digest of the
bytes that were sent and the id AMO returned, and the same for the icon.

A sync then reconciles three sides: the manifest, the lock, and what AMO's own
(free) response says it holds. An entry is reused only when its recorded id is
still published _and_ its recorded digest still matches the file on disk.
Anything else is re-uploaded, so a screenshot swapped on disk cannot pass as the
one that was uploaded. Deleting the lock file forces a full replace, which is
the escape hatch for drift nothing here can see.

What that costs, for three screenshots:

| Change                     | Calls | Why                                    |
| -------------------------- | ----- | -------------------------------------- |
| Nothing                    | 0     | reconciles against free reads only     |
| One screenshot replaced    | 3     | upload, caption, delete the superseded |
| A caption re-worded        | 1     | `caption` is writable in place         |
| A reorder                  | 1     | per moved image; `position` likewise   |
| No lock, or a deleted lock | 9     | full replace, as before                |

An image cannot be replaced in place: `PreviewSerializer` marks `image`
create-only, so a changed screenshot is always an upload plus a delete. The two
calls per upload are not avoidable either — `caption` is writable at creation,
but `TranslationSerializerField` deserializes a dictionary only outside the
`l10n_flat_input_output` gate, which API v5 does not carry, and multipart cannot
carry a dictionary. Using v4 to get flat captions would cost the `position`
field, which v4 removes.

Because an unchanged listing now costs nothing, this runs on every release
rather than as a step someone has to remember.

### What A Release Will And Will Not Do

A release applies the preview delta it can afford. Before starting, it asks how
much of the hourly budget is left after what it has already spent — the version
`PUT`, the source `PATCH`, and the icon if it changed — and defers if the work
does not fit, printing what it would have done and the command that does it:

```text
previews: 3 uploads, 3 removals needs 9 calls and only 8 are left this hour
— deferred. Run pnpm publish:amo --assets-only --sync-previews
```

In practice that only happens on a full replace, which means the lock does not
account for what is published: a first sync, or a lock that was deleted or never
committed. Everything a normal change produces — a re-worded caption, a
reorder, a swapped screenshot — is a handful of calls and ships with the
release. Only the minute limit is left to the pacer, since sitting out a
twenty-second hold stalls nothing.

`--sync-previews` overrides the deferral and does the whole plan, waiting out
the throttle however long that takes. It is the flag for the standalone
`--assets-only` run, where nothing is waiting on the job.

Order in `amo/previews.json` is the display order. `position` is derived from
the index rather than written out, so reordering the file reorders the listing.

Anything published that the lock does not account for is deleted by a sync,
including a preview uploaded by hand in the dashboard. The manifest is the
listing.

### Repairing A Live Listing

`pnpm publish:amo --assets-only` applies whatever the icon and previews need to
the add-on that already exists, and with `--sync-previews` it does so however
long the throttle makes it wait. It uploads no package and creates no version,
which is what makes it usable between releases, and it is where a full replace
belongs. AMO accepts both while a version sits in review, since they are add-on
metadata rather than version metadata.

## Before A Submission

1. Compare `manifest.config.ts` against
   `chrome-web-store/privacy-justifications.md` and `amo/data-collection.md`.
   Every `permissions`, `host_permissions`, and `content_scripts.matches` entry
   needs a justification, and no justification may survive a removed
   permission.
2. Re-read the content script, service worker, popup, and shared settings before
   repeating any claim about local storage, host access, or data handling.
3. Re-run the `src/` search for network APIs (`fetch`, `XMLHttpRequest`,
   `WebSocket`, `sendBeacon`, `EventSource`, `new Image(`). The "collects
   nothing" answer on both stores rests on it.
4. Review `store/description.txt` against user-visible behavior changes since
   the last release, remembering the same text is the Chrome listing copy.
5. Run `pnpm package:firefox && pnpm package:source && pnpm publish:amo
--dry-run`. It resolves the listing, prints the reviewer notes, resolves and
   size-checks every preview, and validates the tags and categories against AMO.
   Metadata AMO rejects is only rejected on the call that creates the version,
   which happens after the release is already published, so the dry run is the
   last cheap place to catch it.

`<all_urls>` is the broadest thing this extension asks for and the thing a
reviewer will question. The answer is in the single purpose: a video can be on
any site, and a player is frequently in an iframe from a different origin than
the page around it.

## Store Form Copy Is Plaintext

Both dashboards take plain-text inputs, and AMO's "Notes to Reviewer" field is
plain text too, so anything sent there is shown to the reviewer literally. That
applies to `chrome-web-store/privacy-justifications.md`,
`amo/data-collection.md`, and the quoted reviewer block in
`amo/source-submission.md`.

Keep backticks, emphasis, links, and fenced code blocks out of answer text; use
a 4-space indented block for commands, which renders as code in the doc and
arrives as plain indentation. Headings are labels rather than answers, so they
keep their Markdown.

A form field keeps every newline it is given, so an answer that is hard-wrapped
in the source arrives in the field ragged. Answer paragraphs are therefore
written as one unwrapped line each, whatever their length; the prose around them
wraps normally.

## Source Archive (AMO Only)

AMO requires the source of any bundled add-on, and reviewers rebuild it and diff
the result against the submitted package.

```sh
pnpm package:source          # archives HEAD
pnpm package:source v0.2.0   # archives a release tag
```

`scripts/package-source.mjs` wraps `git archive`, so the archive holds exactly
the tracked tree at that ref. Release builds must archive the tag, not `HEAD`.
The full requirement, including the reviewer notes the release sends with the
version, is in [`amo/source-submission.md`](../amo/source-submission.md).
