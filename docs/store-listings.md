# Store Listings

Listing copy and metadata live in the repository so they stay in step with the
code.

- `chrome-web-store/description.txt` — the long description to paste into the
  Developer Dashboard.
- `chrome-web-store/privacy-justifications.md` — paste-ready single-purpose,
  permission, and data-usage answers for the dashboard privacy form.
- `chrome-web-store/screenshots/` — listing screenshots, three of the five the
  Developer Dashboard allows: the speed badge over a player, the popup, and the
  "contribute on GitHub" card. Regenerate all three with
  `node scripts/capture-screenshots.mjs` after `pnpm build`. The script writes
  them at 1280×800 and needs no post-processing; it scales the popup capture to
  fit the canvas rather than assuming a fixed zoom, so adding a control to the
  popup cannot silently crop it.
- `chrome-web-store/promo-tile-440x280.png` — the small promo tile.
- `amo/description.txt` — the AMO description.
- `amo/listing.json` — slug, summary, categories, tags, and support URLs;
  `scripts/publish-amo.mjs` re-applies it on every release. `tags` and
  `categories` are closed vocabularies, not free text: AMO defines 42 tags and
  15 extension categories and rejects anything else. The live lists are
  `https://addons.mozilla.org/api/v5/addons/tags/` and
  `.../addons/categories/`, and `pnpm publish:amo --dry-run` checks the file
  against both.
- `amo/data-collection.md` — the basis for the `data_collection_permissions`
  answer and the per-permission justifications.
- `amo/source-submission.md` — the reviewer build instructions and the source
  archive requirement.

`amo/description.txt` and `chrome-web-store/description.txt` describe the same
product. Change them together.

## Before a submission

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
4. Review the description against user-visible behavior changes since the last
   release.
5. Run `pnpm package:firefox && pnpm package:source && pnpm publish:amo
--dry-run`. It resolves the listing, prints the reviewer notes, and validates
   the tags and categories against AMO. Metadata AMO rejects is only rejected on
   the call that creates the version, which happens after the release is already
   published, so the dry run is the last cheap place to catch it.

`<all_urls>` is the broadest thing this extension asks for and the thing a
reviewer will question. The answer is in the single purpose: a video can be on
any site, and a player is frequently in an iframe from a different origin than
the page around it.

## Source archive (AMO only)

AMO requires the source of any bundled add-on, and reviewers rebuild it and diff
the result against the submitted package.

```sh
pnpm package:source          # archives HEAD
pnpm package:source v0.1.0   # archives a release tag
```

`scripts/package-source.mjs` wraps `git archive`, so the archive holds exactly
the tracked tree at that ref. Release builds must archive the tag, not `HEAD`.
The full requirement, including the reviewer notes to paste into the version, is
in `amo/source-submission.md`.
