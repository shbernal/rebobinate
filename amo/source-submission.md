# Source Code Submission

AMO requires source code for any add-on whose submitted package is produced by a
bundler or minifier. This extension is built with Vite, so every version upload
must be accompanied by a source archive, and a reviewer must be able to rebuild
the submitted package from it with no differences.

## Producing The Archive

```sh
pnpm package:source            # archives HEAD
pnpm package:source v1.2.1     # archives a release tag
```

`scripts/package-source.mjs` wraps `git archive`, writing
`release/rebobinate-source-<version>.zip`. Release builds must archive
the tag, not `HEAD`; the script warns when it archives `HEAD` with a dirty
working tree.

`git archive` emits exactly the tracked tree at that ref, so `node_modules/`,
`dist/`, `dist-firefox/`, `release/`, and untracked scratch files are excluded
by construction rather than by an exclude list that has to be maintained. The
archive includes `pnpm-lock.yaml`, which the reviewer build depends on.

`tests/` and `e2e/` are in the archive but are not needed to build.

## Reviewer Build Instructions

`scripts/publish-amo.mjs` lifts the quoted block below into the version's "Notes
to Reviewer" field, so it reaches the reviewer without anyone opening the
archive. That field is plain text: the block carries no Markdown, because
backticks and asterisks would arrive as themselves.

> Build environment: Debian 12 container, Node.js 24.18.1, pnpm 11.3.0. The same
> build on Arch Linux under Node.js 26.4.0 produced byte-identical output, so
> the Node.js minor version is not significant.
>
> This project uses pnpm, not npm. Do not run "npm install" — there is no
> package-lock.json, and the dependency tree is pinned by pnpm-lock.yaml. The
> required pnpm version is declared in package.json as
> "packageManager": "pnpm@11.3.0", and Corepack (bundled with Node.js 24)
> installs and pins that exact version for you.
>
> From the root of the extracted source archive:
>
>     corepack enable
>     pnpm install --frozen-lockfile
>     EXT_TARGET=firefox pnpm build
>
> The Firefox package is written to dist-firefox/. Its contents are what was
> submitted as the add-on package.
>
> EXT_TARGET selects the build target. EXT_TARGET=firefox produces the Firefox
> package in dist-firefox/; any other value, including unset, produces the
> Chrome Web Store package in dist/. The two differ only in the manifest: the
> Firefox build uses background.scripts rather than background.service_worker,
> and adds browser_specific_settings.gecko.

## Reproducibility

Verified for 0.1.0. `release/rebobinate-source-0.1.0.zip` was extracted into a
fresh directory and built with the instructions above; the resulting
`dist-firefox/` matched `release/rebobinate-firefox-0.1.0.zip` on all 13 files,
by name and SHA-256, with nothing extra or missing on either side.

The build was run twice, on deliberately different environments:

- Arch Linux, Node.js 26.4.0, pnpm 11.3.0.
- `node:24-bookworm` container, Node.js 24.18.1, pnpm 11.3.0 via Corepack —
  the same Node major CI uses.

Both produced the same 13 hashes, so the output does not depend on the host or
the Node.js version, only on the lockfile.

Re-run that check before any release that changes dependencies, the Vite config,
or the manifest config:

```sh
pnpm package:firefox
pnpm package:source
# then, in a scratch directory:
#   unzip release/rebobinate-source-<version>.zip
#   pnpm install --frozen-lockfile && EXT_TARGET=firefox pnpm build
#   compare dist-firefox/ against the unzipped package with sha256sum
```

## Note On The pnpm Version

`package.json` pins `pnpm@11.3.0` via `packageManager`. A newer pnpm may be
installed globally on a given machine; both Corepack and pnpm's own version
management honor the pin and switch to 11.3.0 inside this repository, so the
lockfile is never resolved by a different version than it was written with. Do
not write build instructions that name a pnpm version other than the one in
`packageManager`.
