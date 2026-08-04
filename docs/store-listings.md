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

| Asset    | Endpoint                               | When                        |
| -------- | -------------------------------------- | --------------------------- |
| Icon     | `PATCH /addons/addon/{guid}/` (`icon`) | every release               |
| Previews | `POST`/`DELETE .../previews/{id}/`     | only with `--sync-previews` |

Constraints, which the script checks locally so a bad file fails before anything
is uploaded: PNG or JPEG only, not animated, under 4MB. The icon must also be
square — AMO enforces that server-side. Previews have no minimum dimension; the
1000×750 in AMO's documentation is a resize target, not a rejection threshold,
so the 1280×800 screenshots are accepted as they are.

### Preview Writes Are Throttled Hard

Every call on the previews endpoint is an unsafe method, so all of them count
against AMO's add-on submission throttles: 3/minute, 10/hour and 24/day per
user. Reads are free. Syncing three screenshots costs three uploads, three
caption patches and a delete per superseded image — close to a whole hour's
budget, and enough to trip the limit partway through.

The script waits out the `Retry-After` header and retries, so a sync works but
spends most of its wall-clock idle; it prints the call count up front so a slow
run is not mistaken for a hung one. The decisions here — what to upload, what to
delete, how long to wait — are in `scripts/amo-previews.mjs`, split out from
`publish-amo.mjs` so they can be tested without an HTTP layer or a credential;
`publish-amo.mjs` keeps the calls. A 429 is the only status it retries, since
every other failure means the request itself is wrong. Waits are not short: a
sync that crosses the hourly boundary can be handed a `Retry-After` of most of
an hour and has to sit out the full window.

The throttle is not specific to previews. `AddonViewSet` carries the same
classes, so the listing `PUT` and the icon `PATCH` draw on one shared budget — a
release already spends about four calls of the ten. **Do not run a preview sync
in the same hour as a release**: eight plus four exceeds the cap, and the sync is
what will stall. This is the other reason `--assets-only` is a separate command
rather than a flag on the release path.

There is no way to raise the ceiling. `GranularUserRateThrottle` honors one
bypass, the `API_BYPASS_THROTTLING` permission, and that is a group membership
granted to Mozilla's own release-engineering and QA accounts — not something a
token, key, or scope can obtain. The throttle keys on the authenticated user
with independent per-IP limits on top, so re-minting credentials changes
nothing. The only lever is making fewer calls.

The two calls per image are not avoidable either. `caption` is writable when a
preview is created, but `TranslationSerializerField` deserializes a dictionary
only — a bare string needs the `l10n_flat_input_output` gate — and multipart
cannot carry one, so the localized caption has to follow as JSON.

### Why Previews Are Opt-In

A sync replaces: it uploads every entry in `amo/previews.json` and deletes what
was published before. It cannot do less. AMO re-encodes images on ingest, so a
local file and its published copy never share a hash, and nothing on a preview
records which manifest entry produced it. Any attempt to reuse a published
preview would amount to assuming its bytes are still the ones on disk — and a
swapped screenshot that silently never uploads is the failure worth avoiding.

Replacing on every release would churn the public listing for description-only
changes, so `--sync-previews` is off by default. To keep that from going quiet,
every release without the flag prints how many previews the manifest holds
versus how many AMO has. Equal counts are reported as equal counts, not as a
match — the images themselves are not comparable from here.

Order in `amo/previews.json` is the display order. `position` is derived from
the index rather than written out, so reordering the file reorders the listing.

### Repairing A Live Listing

`pnpm publish:amo --assets-only` applies the icon, and with `--sync-previews`
the previews, to the add-on that already exists. It uploads no package and
creates no version, which is what makes it usable between releases. AMO accepts
both while a version sits in review, since they are add-on metadata rather than
version metadata.

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

## Source Archive (AMO Only)

AMO requires the source of any bundled add-on, and reviewers rebuild it and diff
the result against the submitted package.

```sh
pnpm package:source          # archives HEAD
pnpm package:source v0.1.1   # archives a release tag
```

`scripts/package-source.mjs` wraps `git archive`, so the archive holds exactly
the tracked tree at that ref. Release builds must archive the tag, not `HEAD`.
The full requirement, including the reviewer notes the release sends with the
version, is in [`amo/source-submission.md`](../amo/source-submission.md).
