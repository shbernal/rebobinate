// Downloads the real content blockers the ad-blocker checks can use.
//
// They are pinned, cached under node_modules/.tmp/blockers, and git-ignored:
// nothing here belongs in the repository, and a version that moves under us
// would turn "the badge disappeared" into a question about which build of the
// blocker was running.
//
// Which blocker is usable depends on the engine, and the split is the whole
// reason `docs/ad-blockers.md` has three tiers:
//
//   uBlock Origin   Manifest V2. Chromium 139 and later refuse to install it,
//                   so it is the Gecko targets or nothing.
//   uBO Lite        Manifest V3, installs anywhere, but filters only the
//                   hostnames its lists name — useful against real sites, not
//                   against a fixture origin.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { printHelpAndExit } from './help.mjs'

const BLOCKERS = {
  ubol: {
    version: '2026.812.1211',
    url: 'https://github.com/uBlockOrigin/uBOL-home/releases/download/2026.812.1211/uBOLite_2026.812.1211.chromium.zip',
    kind: 'unpacked',
  },
  ublock: {
    version: '1.73.0',
    url: 'https://github.com/gorhill/uBlock/releases/download/1.73.0/uBlock0_1.73.0.firefox.signed.xpi',
    // Gecko finds an add-on in a profile by file name, so the XPI has to be
    // named after the id in its own manifest.
    kind: 'xpi',
    fileName: 'uBlock0@raymondhill.net.xpi',
  },
}

export const blockersDir = path.resolve(
  process.cwd(),
  'node_modules/.tmp/blockers',
)

export const blockerPath = name =>
  BLOCKERS[name].kind === 'xpi'
    ? path.join(blockersDir, BLOCKERS[name].fileName)
    : path.join(blockersDir, name)

/** Where the blocker is, or null when it has not been fetched. */
export const installedBlocker = name => {
  const target = blockerPath(name)

  return fs.existsSync(target) ? target : null
}

const download = async (url, destination) => {
  const response = await fetch(url, { redirect: 'follow' })

  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`)
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()))
}

const fetchBlocker = async (name, force) => {
  const blocker = BLOCKERS[name]
  const target = blockerPath(name)

  if (!force && fs.existsSync(target)) {
    console.log(`${name} ${blocker.version} already at ${target}`)
    return
  }

  if (blocker.kind === 'xpi') {
    await download(blocker.url, target)
    console.log(`${name} ${blocker.version} -> ${target}`)
    return
  }

  const archive = path.join(blockersDir, `${name}.zip`)
  await download(blocker.url, archive)
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })

  try {
    execFileSync('unzip', ['-q', '-o', archive, '-d', target])
  } catch (error) {
    throw new Error(
      `could not unpack ${archive} — is \`unzip\` installed? (${error.message})`,
    )
  }

  fs.rmSync(archive, { force: true })

  // Some builds unpack into a single directory, some straight into the target.
  const entries = fs.readdirSync(target)

  if (entries.length === 1 && !entries.includes('manifest.json')) {
    const nested = path.join(target, entries[0])

    for (const entry of fs.readdirSync(nested)) {
      fs.renameSync(path.join(nested, entry), path.join(target, entry))
    }

    fs.rmdirSync(nested)
  }

  console.log(`${name} ${blocker.version} -> ${target}`)
}

// Imported by the scripts that use the blockers; only run as an entry point.
if (import.meta.url === `file://${process.argv[1]}`) {
  // Inside the entry-point guard: the other scripts import this module for
  // `installedBlocker`, and their own --help must not be answered by this one.
  printHelpAndExit(`
Usage: pnpm blockers:fetch [--force] [--help]

Downloads the pinned content blockers into node_modules/.tmp/blockers.

  --force   re-download even when the cached copy is already there

Fetched
  ubol      uBlock Origin Lite, unpacked, for Chromium
            (pnpm inspect:chrome --blocker, and by hand)
  ublock    uBlock Origin, the signed XPI, for the Gecko profiles
            (pnpm dev:firefox --with-ublock)
`)

  const force = process.argv.slice(2).includes('--force')

  for (const name of Object.keys(BLOCKERS)) {
    await fetchBlocker(name, force)
  }
}
