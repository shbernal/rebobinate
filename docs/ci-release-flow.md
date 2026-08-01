# CI And Release Flow

## Validation

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:
format check, typecheck, Vitest, Chrome build, then the Firefox build with
`web-ext lint`. The Firefox lint step is there because Gecko rejects manifest
keys Chrome accepts.

The Playwright suite is not in CI yet. It needs a Chromium that can load
extensions; run it locally with `pnpm e2e` before packaging.

## Releasing

Publishing a GitHub Release with a `v*` tag triggers both store workflows. Both
verify that the tag matches `package.json`'s version before doing anything.

### Chrome Web Store — `.github/workflows/publish-cws.yml`

Runs in the `chrome-web-store` GitHub environment and authenticates through GCP
workload identity federation, so there is no stored credential. It zips `dist/`,
uploads it, polls until the upload finishes processing, submits a publish
request, and attaches the zip to the release.

Required environment variables (`vars`, not secrets):

- `CWS_EXTENSION_ID` — the item id, available once the Chrome Web Store item
  exists;
- `CWS_PUBLISHER_ID`;
- `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`.

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
`.env.example`. The Mozilla JWT pair and the GCP project and service account are
account-scoped and carry over from the other extensions; `CHROME_EXTENSION_ID`
is item-scoped and stays empty until the Chrome Web Store item exists.

## First release checklist

Neither store item exists yet. Before the first release:

1. Create the GitHub repository and push.
2. Create the Chrome Web Store item, record `CWS_EXTENSION_ID`, and fill the
   privacy form from `chrome-web-store/privacy-justifications.md`.
3. Create the AMO listing with the add-on id
   `rebobinate@shbernal.github.io` — it can never change afterwards.
4. Configure the two GitHub environments with the variables and secrets above.
5. Verify the reviewer build is reproducible and record the result in
   `amo/source-submission.md`.
