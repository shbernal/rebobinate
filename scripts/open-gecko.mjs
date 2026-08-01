// Opens a Gecko browser with the built Firefox package installed as a
// temporary add-on and leaves it open, so the manual validation list in
// docs/testing.md can be walked on Gecko as well as Chromium. Run after
// `pnpm build:firefox`.
//
//   node scripts/open-gecko.mjs <firefox|zen> [url]
//
// Playwright cannot drive these browsers — see docs/testing.md — so unlike
// `scripts/open-chromium.mjs` this is a thin wrapper over web-ext, the same
// tool `pnpm lint:firefox` already uses.
//
// Each browser keeps its own profile under `node_modules/.tmp/`, and the
// profiles survive between runs, so a site you logged into once stays logged
// in — and Firefox and Zen do not fight over each other's state.
//
//   FIREFOX_BINARY / ZEN_BINARY   executable (default: resolved as below)
//   REBOBINATE_FIREFOX_PROFILE_DIR / REBOBINATE_ZEN_PROFILE_DIR
//                                 profile directory (default the one above)
//   REBOBINATE_OPEN_URL           start URL when no positional argument is
//                                 given
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import webExt from 'web-ext'

const defaultOpenUrl = 'https://www.youtube.com/'
const sourceDir = path.resolve(process.cwd(), 'dist-firefox')

const findExecutable = candidates =>
  candidates.find(candidate => fs.existsSync(candidate))

const BROWSERS = {
  firefox: {
    label: 'Firefox',
    profileEnv: 'REBOBINATE_FIREFOX_PROFILE_DIR',
    defaultProfile: 'node_modules/.tmp/firefox-dev-profile',
    // web-ext knows where Firefox lives on every platform it supports, so the
    // name is enough and the lookup stays its problem rather than ours.
    resolve: () => process.env.FIREFOX_BINARY ?? 'firefox',
    notFound: [
      'no Firefox executable found — set FIREFOX_BINARY to its path',
      'a Flatpak install is `FIREFOX_BINARY=flatpak:org.mozilla.firefox`',
    ],
  },
  zen: {
    label: 'Zen',
    profileEnv: 'REBOBINATE_ZEN_PROFILE_DIR',
    defaultProfile: 'node_modules/.tmp/zen-dev-profile',
    // Zen ships under a different name on every platform and has no `zen`
    // alias in web-ext's own list, so the path has to be resolved here.
    resolve: () =>
      process.env.ZEN_BINARY ??
      findExecutable([
        '/usr/bin/zen-browser',
        '/usr/bin/zen',
        '/opt/zen-browser-bin/zen',
        '/opt/zen/zen',
        '/Applications/Zen.app/Contents/MacOS/zen',
        '/Applications/Zen Browser.app/Contents/MacOS/zen',
        path.join(process.env.HOME ?? '', '.local/share/zen/zen'),
      ]),
    notFound: [
      'no Zen executable found — set ZEN_BINARY to its path',
      'a Flatpak install is `ZEN_BINARY=flatpak:app.zen_browser.zen`',
    ],
  },
}

const browserName = process.argv[2]
const browser = BROWSERS[browserName]

if (!browser) {
  const names = Object.keys(BROWSERS).join('|')
  console.error(`usage: node scripts/open-gecko.mjs <${names}> [url]`)
  process.exit(1)
}

if (!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
  console.error('dist-firefox/ is missing — run `pnpm build:firefox` first')
  process.exit(1)
}

const executablePath = browser.resolve()

if (!executablePath) {
  for (const line of browser.notFound) {
    console.error(line)
  }
  process.exit(1)
}

const profilePath = path.resolve(
  process.cwd(),
  process.env[browser.profileEnv] ?? browser.defaultProfile,
)
const openUrl =
  process.argv[3] ?? process.env.REBOBINATE_OPEN_URL ?? defaultOpenUrl

console.log(
  JSON.stringify(
    {
      browser: browser.label,
      url: openUrl,
      profile: profilePath,
      executable: executablePath,
      sourceDir,
    },
    null,
    2,
  ),
)

await webExt.cmd.run(
  {
    sourceDir,
    firefox: executablePath,
    firefoxProfile: profilePath,
    profileCreateIfMissing: true,
    // Without this web-ext copies the profile on every run and the logins go
    // with the copy, which is the one thing a manual-validation profile is for.
    keepProfileChanges: true,
    // The build is a bundle, so there are no source files to watch: a reload
    // would only ever fire on a rebuild, which reinstalls anyway.
    noReload: true,
    startUrl: [openUrl],
  },
  { shouldExitProgram: false },
)

console.log(
  `${browser.label} is open. Close the browser window to end this command.`,
)
