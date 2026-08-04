# CI And Release Flow

## Validation

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:
format check, typecheck, Vitest, Chrome build, then the Firefox build with
`web-ext lint`. The Firefox lint step is there because Gecko rejects manifest
keys Chrome accepts.

The Playwright suite is not in CI yet. It needs a Chromium that can load
extensions; run it locally with `pnpm e2e` before packaging.

## Releasing

Publishing a GitHub Release with a `v*` tag publishes to both stores. Each
workflow verifies that the tag matches `package.json`'s version before doing
anything, so a mismatched tag fails before either store is touched.

The two are independent jobs, and one store failing does not roll the other
back: if Chrome fails after AMO succeeded, the AMO version is still submitted.

### Chrome Web Store — `.github/workflows/publish-cws.yml`

Runs in the `chrome-web-store` GitHub environment and authenticates through GCP
workload identity federation, so there is no stored credential. It zips `dist/`,
uploads it, polls until the upload finishes processing, submits a publish
request, and attaches the zip to the release.

Required variables (`vars`, not secrets), set at the repository level:

- `CWS_EXTENSION_ID` — the item id;
- `CWS_PUBLISHER_ID`;
- `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`.

The last three are account-scoped and shared with the other extensions
published from this account. The GCP side is shared too: one workload identity
pool provider whose attribute condition names every repository allowed to use
it, and one service account carrying a `workloadIdentityUser` binding per
repository. A new extension has to be added to both before its first
CI-published release, or the "Authenticate to Google Cloud" step fails.

The workflow is release-only, with no `workflow_dispatch` fallback, because
that attribute condition also requires `assertion.ref` to start with
`refs/tags/`. A dispatched run carries a branch ref and so could never
authenticate. Retry a failed publish by re-running the jobs of the
release-triggered run, which keeps the tag ref.

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
`SERVICE_ACCOUNT_EMAIL`); GitHub uses the `CWS_`/`GCP_` names listed above, and
only the Mozilla pair is spelled the same in both places. The
Mozilla JWT pair and the GCP project and service account are account-scoped and
carry over from the other extensions; `CHROME_EXTENSION_ID` is item-scoped.

Only `MOZILLA_ADDON_JWT_ISSUER` and `MOZILLA_ADDON_JWT_SECRET` are read by
anything in this repository — `scripts/publish-amo.mjs`. The Chrome names are
carried for symmetry with the other extensions; nothing here reads them.

## Before tagging

Run `pnpm publish:amo --dry-run`. This is not optional caution, it is the
lesson of the first release: `amo/listing.json` carried tags AMO does not
define, and AMO only rejects them on the call that creates the version — after
the package has uploaded and validated, and after the release that triggered it
was published. There is nothing to re-run at that point, so the tag has to
move. The dry run now validates the listing against AMO's tag and category
vocabularies before any of that can happen.

Then bump `package.json`, commit, and publish the release with a matching `v*`
tag.

## How the two stores got here

- 0.1.0 shipped to the Chrome Web Store by hand, because the item did not exist
  yet and there was no item id to publish against. The item has since been
  accepted, and `CWS_EXTENSION_ID` is recorded, so 0.1.1 onward goes through
  CI.
- Publishing the `v0.1.0` release created the AMO add-on. No listing had to
  exist first: `scripts/publish-amo.mjs` `PUT`s on the add-on id, which creates
  the add-on the first time and a new version every time after. That first
  release is what claimed `rebobinate@shbernal.github.io`, and the id can never
  change now.
- The reviewer build is verified reproducible; the result is in
  `amo/source-submission.md`.
