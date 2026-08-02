# CI And Release Flow

## Validation

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:
format check, typecheck, Vitest, Chrome build, then the Firefox build with
`web-ext lint`. The Firefox lint step is there because Gecko rejects manifest
keys Chrome accepts.

The Playwright suite is not in CI yet. It needs a Chromium that can load
extensions; run it locally with `pnpm e2e` before packaging.

## Releasing

Publishing a GitHub Release with a `v*` tag triggers the AMO workflow, which
verifies that the tag matches `package.json`'s version before doing anything.
The Chrome workflow is dispatched by hand; see below.

### Chrome Web Store — `.github/workflows/publish-cws.yml`

Not wired up yet. The workflow is complete but runs on `workflow_dispatch` with
a tag input rather than on a published release, because the Chrome Web Store
item id and the GCP workload identity federation do not exist yet and a release
must not fail on a store this repository cannot reach. 0.1.0 was submitted to
the Chrome Web Store by hand.

Once it runs, it does so in the `chrome-web-store` GitHub environment and
authenticates through GCP workload identity federation, so there is no stored
credential. It zips `dist/`, uploads it, polls until the upload finishes
processing, submits a publish request, and attaches the zip to the release.

Required environment variables (`vars`, not secrets):

- `CWS_EXTENSION_ID` — the item id, available once the Chrome Web Store item
  exists;
- `CWS_PUBLISHER_ID`;
- `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`.

To hand the Chrome release back to CI, set those five variables on the
environment and restore the trigger to:

```yaml
on:
  release:
    types: [published]
```

The steps that read `inputs.tag` — the checkout, the version check, and the
release upload — go back to `github.event.release.tag_name` and
`GITHUB_REF_NAME` at the same time.

### addons.mozilla.org — `.github/workflows/publish-amo.yml`

Runs in the `addons-mozilla-org` GitHub environment. It archives the source
_before_ building (so the archive cannot pick up build output), builds and zips
the Firefox package, lints it, then runs `scripts/publish-amo.mjs`, which
uploads the package, waits for AMO validation, creates the version with the
reviewer notes from `amo/source-submission.md`, re-applies `amo/listing.json`,
and attaches the source archive.

Required secrets: `MOZILLA_ADDON_JWT_ISSUER`, `MOZILLA_ADDON_JWT_SECRET`. They
are account-scoped, so they are the same values used by the other extensions
published from this account.

A listed AMO version is queued for human review: the workflow succeeds on
"awaiting review". Submitted is not live.

## Local credentials

`.env` (git-ignored, loaded by direnv through `.envrc`) holds the same names as
`.env.example`. Those are the local names shared with the other extensions in
this account (`CHROME_EXTENSION_ID`, `GCLOUD_PROJECT_ID`,
`SERVICE_ACCOUNT_EMAIL`); the GitHub environments use the `CWS_`/`GCP_` names
listed above, and only the Mozilla pair is spelled the same in both places. The
Mozilla JWT pair and the GCP project and service account are account-scoped and
carry over from the other extensions; `CHROME_EXTENSION_ID` is item-scoped.

Only `MOZILLA_ADDON_JWT_ISSUER` and `MOZILLA_ADDON_JWT_SECRET` are read by
anything in this repository — `scripts/publish-amo.mjs`. The Chrome names are
carried for symmetry with the other extensions; nothing here reads them.

## First release

Done. 0.1.0 is in review at both stores.

- The Chrome Web Store item was created and submitted by hand.
  `CWS_EXTENSION_ID` is still unrecorded, which is why the Chrome workflow is
  dispatch-only.
- The `addons-mozilla-org` environment holds the Mozilla JWT pair, and
  publishing the `v0.1.0` release created the AMO add-on. No listing had to
  exist first: `scripts/publish-amo.mjs` `PUT`s on the add-on id, which creates
  the add-on the first time and a new version every time after. That first
  release is what claimed `rebobinate@shbernal.github.io`, and the id can never
  change now.
- The reviewer build is verified reproducible; the result is in
  `amo/source-submission.md`.

The first attempt at the release failed, and it is worth knowing why before the
next one. `amo/listing.json` carried tags AMO does not define, and AMO only
rejects them on the call that creates the version — after the package has
uploaded and validated, and after the release that triggered it is published.
There is nothing to re-run at that point: the tag has to move. Run
`pnpm publish:amo --dry-run` before tagging; it now validates the listing
against AMO's tag and category vocabularies.
