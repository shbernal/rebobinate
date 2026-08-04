# Rebobinate

Control the playback speed of any video from the keyboard.

- `+` — faster
- `-` — slower
- `0` — back to normal speed

The step is `0.05` by default and can be changed. An optional badge shows the
current speed on the video itself, in the corner and style you choose.

Rebobinate works on any site with an HTML5 video, including players embedded in
iframes, and it holds your speed when a site tries to reset it.

## Status

Rebobinate is listed on the
[Chrome Web Store](https://chromewebstore.google.com/detail/rebobinate/konpdajknakndebpaeoaceceimlfajcg).

The addons.mozilla.org listing is still in review, so Firefox has no install
link yet. Build from source, or use the packages attached to the
[latest release](https://github.com/shbernal/rebobinate/releases/latest), in the
meantime.

## Install from source

```sh
pnpm install
pnpm build
```

Then load `dist/` as an unpacked extension from `chrome://extensions` with
developer mode on. For Firefox, run `pnpm build:firefox` and load
`dist-firefox/manifest.json` from `about:debugging`.

## Settings

Open the extension popup to change the speed step, toggle the speed badge, and
set its corner, size, opacity, colors, and how long it stays on screen. Settings
are stored locally in your browser.

## Privacy

Rebobinate collects nothing, sends nothing, and has no account. Your settings
never leave your device.

## Verify

```sh
pnpm typecheck && pnpm test
```

## Contributing

See [AGENTS.md](./AGENTS.md) for repository conventions and [docs/](./docs) for
architecture, testing, build targets, and release notes.

## License

MIT
