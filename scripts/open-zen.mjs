// Opens Zen with the built Firefox package installed as a temporary add-on and
// leaves it open, so the manual validation list in docs/testing.md can be
// walked on Gecko as well as Chromium. Run after `pnpm build:firefox`.
//
//   node scripts/open-zen.mjs [url]
//
// Playwright cannot drive this browser — see docs/testing.md — so unlike
// `scripts/open-chromium.mjs` this is a thin wrapper over web-ext, the same
// tool `pnpm lint:firefox` already uses.
//
// The profile lives under `node_modules/.tmp/` and survives between runs, so a
// site you logged into once stays logged in.
//
//   ZEN_BINARY                  Zen executable (default: the first found below)
//   REBOBINATE_ZEN_PROFILE_DIR  profile directory (default the one above)
//   REBOBINATE_OPEN_URL         start URL when no positional argument is given
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import webExt from 'web-ext'

const defaultProfilePath = 'node_modules/.tmp/zen-dev-profile'
const defaultOpenUrl = 'https://www.youtube.com/'
const sourceDir = path.resolve(process.cwd(), 'dist-firefox')

// Zen ships under a different name on every platform and has no `zen` alias in
// web-ext's own list, so the path has to be resolved here.
const resolveZenExecutable = () => {
  const explicitExecutable = process.env.ZEN_BINARY

  if (explicitExecutable) {
    return explicitExecutable
  }

  return [
    '/usr/bin/zen-browser',
    '/usr/bin/zen',
    '/opt/zen-browser-bin/zen',
    '/opt/zen/zen',
    '/Applications/Zen.app/Contents/MacOS/zen',
    '/Applications/Zen Browser.app/Contents/MacOS/zen',
    path.join(process.env.HOME ?? '', '.local/share/zen/zen'),
  ].find(candidate => fs.existsSync(candidate))
}

if (!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
  console.error('dist-firefox/ is missing — run `pnpm build:firefox` first')
  process.exit(1)
}

const executablePath = resolveZenExecutable()

if (!executablePath) {
  console.error('no Zen executable found — set ZEN_BINARY to its path')
  console.error('a Flatpak install is `ZEN_BINARY=flatpak:app.zen_browser.zen`')
  process.exit(1)
}

const profilePath = path.resolve(
  process.cwd(),
  process.env.REBOBINATE_ZEN_PROFILE_DIR ?? defaultProfilePath,
)
const openUrl =
  process.argv[2] ?? process.env.REBOBINATE_OPEN_URL ?? defaultOpenUrl

console.log(
  JSON.stringify(
    {
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

console.log('Zen is open. Close the browser window to end this command.')
