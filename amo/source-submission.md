# Source Code Submission

AMO requires source code for any add-on whose submitted package is produced by a
bundler or minifier. This extension is built with Vite, so every version upload
must be accompanied by a source archive, and a reviewer must be able to rebuild
the submitted package from it with no differences.

## Producing The Archive

```sh
pnpm package:source            # archives HEAD
pnpm package:source v0.2.0     # archives a release tag
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

> Build environment: Debian 12 container, Node.js 24.18.1. The same build on
> Debian 13 under Node.js 26.8.1, and on Arch Linux under Node.js 24.19.0,
> produced byte-identical output, so neither the host nor the Node.js version
> is significant.
>
> This project uses pnpm, not npm. Do not run "npm install". There is no
> package-lock.json, and the dependency tree is pinned by pnpm-lock.yaml. The
> required pnpm version is declared in the packageManager field of
> package.json, and Corepack (bundled with Node.js 24) reads that field and
> installs and pins that exact version for you.
>
> From the root of the extracted source archive:
>
>     corepack enable
>     pnpm install --frozen-lockfile
>     EXT_TARGET=firefox pnpm build
>
> Node.js 26 no longer bundles Corepack. On it, skip the first command and
> install pnpm globally at the version named in the packageManager field of
> package.json, then run the other two.
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

Verified for 0.2.0. `release/rebobinate-source-0.2.0.zip` was extracted into a
fresh directory and built with the instructions above; the resulting
`dist-firefox/` matched `release/rebobinate-firefox-0.2.0.zip` on all 15 files,
by name and SHA-256, with nothing extra or missing on either side.

The build was run three times, on deliberately different environments:

- Arch Linux, Node.js 24.19.0, pnpm 11.22.0.
- `node:24-bookworm` container, Debian 12, Node.js 24.18.1, pnpm 11.22.0 via
  Corepack. That is the Node major CI uses.
- `node:26-trixie` container, Debian 13, Node.js 26.8.1, pnpm 11.22.0. That
  image no longer bundles Corepack, so pnpm was installed at the pinned version
  by hand.

All three produced the same 15 hashes, so the output does not depend on the host
or the Node.js version, only on the lockfile.

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

`packageManager` in `package.json` is the only place the pnpm version is
pinned, and everything else derives from it. A newer pnpm may be installed
globally on a given machine; both Corepack and pnpm's own version management
honor the pin and switch to the pinned version inside this repository, so the
lockfile is never resolved by a different version than it was written with.
CI does not repeat the number either — `pnpm/action-setup` reads
`packageManager` when given no `version` input.

Do not write build instructions that name a literal pnpm version. Point at
`packageManager` instead, so a bump stays a one-line change and no second copy
can go stale. The versions recorded under
[Reproducibility](#reproducibility) are the exception: those are a log of what
a past verification actually ran, not instructions, so they stay as they are.
