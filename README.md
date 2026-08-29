# Rebobinate

Control the playback speed of any video from the keyboard.

- `+` speeds it up
- `-` slows it down
- `0` returns to your default speed

The step is 0.1 and you can change it. The toolbar icon carries the speed of
the tab you are on, and an optional badge shows it on the video itself, in the
corner and style you pick.

Rebobinate works on any site with an HTML5 video, including players embedded in
iframes, and it holds your speed when a site tries to reset it.

It also remembers the speed you chose on a site and applies it on your next
visit. `www.youtube.com` and `m.youtube.com` count as one site. `0` puts a site
back to your default speed and forgets it again. Private windows leave no trace,
and you can switch the memory off in the popup.

## Install

Chromium browsers: install from the
[Chrome Web Store](https://chromewebstore.google.com/detail/rebobinate/konpdajknakndebpaeoaceceimlfajcg).

Firefox: the addons.mozilla.org listing is still in review, so there is no
install link yet. Grab `rebobinate-firefox-<version>.zip` from the
[latest release](https://github.com/shbernal/rebobinate/releases/latest) and
load it from `about:debugging` as a temporary add-on, or build from source.

## Build from source

```sh
pnpm install
pnpm build
```

Load `dist/` as an unpacked extension from `chrome://extensions` with developer
mode on. For Firefox, run `pnpm build:firefox` and load
`dist-firefox/manifest.json` from `about:debugging`.

## Settings

Open the extension popup to change the speed step, set the default speed, turn
the per-site memory on or off, forget the site you are on, toggle the speed on
the toolbar icon, toggle the on-video badge, and set its corner, size, opacity,
colors, and how long it stays on screen. Settings are stored locally in your
browser.

## Privacy

Rebobinate collects nothing, sends nothing, and has no account. Your settings
never leave your device.

## Contributing

AI-generated issues and pull requests are welcome. See
[CONTRIBUTING.md](./CONTRIBUTING.md) to get set up, and [docs/](./docs) for the
architecture, the test suites, the two build targets, and the release flow.

## License

MIT
