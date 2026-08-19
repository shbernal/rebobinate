# Contributing

Issues and pull requests are welcome.

## AI disclosure

This project is written with AI, so AI-generated issues and pull requests are
welcome too. Fully generated ones are fine. The one requirement is that you say
so: name the harness and the model in the issue or pull request body, for
example "Claude Code, Opus 5" or "Codex CLI, GPT-5". That is all. There is no
review penalty for it.

## Getting set up

```sh
pnpm install
pnpm build
```

The pnpm version comes from the `packageManager` field in `package.json`, so run
`corepack enable` once and let it pick the right one.

`pnpm build` writes the Chrome package to `dist/`; `pnpm build:firefox` writes
the Firefox one to `dist-firefox/`. Load either as described in the
[README](./README.md).

## Checks

Run this on any change:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm format
```

Then, depending on what you touched:

| Change                                                                             | Also run             |
| ---------------------------------------------------------------------------------- | -------------------- |
| manifest, content script, service worker, popup, shared settings, icons, packaging | `pnpm e2e`           |
| manifest or packaging                                                              | `pnpm lint:firefox`  |
| how the badge is built or styled                                                   | `pnpm check:filters` |

`pnpm e2e` drives the built extension in a real Chromium. `pnpm lint:firefox`
runs `web-ext lint` over the Gecko build, which rejects manifest keys Chrome
accepts. `pnpm check:filters` matches every cosmetic filter uBlock Origin and
AdGuard ship against the badge the build renders, and exits 1 when one of them
hides it.

CI runs the formatting check, lint, typecheck, tests, and both builds on every
pull request. It does not run `pnpm e2e` or `pnpm check:filters`, so those two
are on you.

## Seeing it run

`pnpm dev:chrome`, `pnpm dev:firefox`, and `pnpm dev:zen` build and open a
browser with the extension already loaded, each in its own throwaway profile.
They take a start URL and default to YouTube.

When something misbehaves at runtime, `pnpm inspect:chrome [url]` prints a JSON
snapshot of the running extension: the permissions Chromium granted, every tab
the service worker sees, the popup state, and what is in storage. Read that
before reasoning from the source.

## Where things are written down

[docs/index.md](./docs/index.md) is the map. Start with
[code-overview.md](./docs/code-overview.md) for how the pieces fit together, and
[testing.md](./docs/testing.md) for where a new test belongs.
[AGENTS.md](./AGENTS.md) holds the repository conventions and the short list of
things that are frozen.

Update the affected doc in the same pull request as the behavior it describes.

## What not to put in a pull request

- A `package.json` version bump. Releases are cut separately.
- Edits to `dist/`, `dist-firefox/`, or `release/`. They are generated.
- Edits to `store/`, `amo/`, or `chrome-web-store/`. That copy is live on the
  stores and ships on the next release.
- A change to `browser_specific_settings.gecko.id`. A new id is a new add-on for
  everyone who already installed this one.
- A stored-state change that resets what installed copies hold. `Settings` and
  the per-site speed map have to keep normalizing older shapes.

## License

Contributions are MIT licensed, like the rest of the project.
