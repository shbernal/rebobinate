// Downloads the real content blockers the ad-blocker checks can use.
//
// They are pinned by version and by SHA-256 of the download, since a release
// asset can be replaced under the same URL and what lands here runs as a
// privileged extension. Cached under node_modules/.tmp/blockers, and git-ignored:
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
import { createHash } from 'node:crypto'
import { printHelpAndExit, rejectUnknownArguments } from './help.mjs'

/**
 * @typedef {{ version: string, url: string, sha256: string } & (
 *   { kind: 'unpacked' } | { kind: 'xpi', fileName: string }
 * )} Blocker
 */

/** @type {Record<string, Blocker>} */
const BLOCKERS = {
  ubol: {
    version: '2026.812.1211',
    url: 'https://github.com/uBlockOrigin/uBOL-home/releases/download/2026.812.1211/uBOLite_2026.812.1211.chromium.zip',
    sha256: 'e0daf472f352fd1eeb1d5828f70c1508d28d08bb7550a3a05865b549e49258b9',
    kind: 'unpacked',
  },
  ublock: {
    version: '1.73.0',
    url: 'https://github.com/gorhill/uBlock/releases/download/1.73.0/uBlock0_1.73.0.firefox.signed.xpi',
    sha256: 'bccc51a773150af4af6e1fd62c7bfdeb7238b79ff2381b998fa9f2e38f64786a',
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

/** @param {string} name */
export const blockerPath = name =>
  BLOCKERS[name].kind === 'xpi'
    ? path.join(blockersDir, BLOCKERS[name].fileName)
    : path.join(blockersDir, name)

/**
 * Where the blocker is, or null when it has not been fetched.
 *
 * @param {string} name
 */
export const installedBlocker = name => {
  const target = blockerPath(name)

  return fs.existsSync(target) ? target : null
}

/**
 * Written only once the bytes match the pinned digest, so nothing that is not
 * the reviewed build ever reaches the disk to be loaded.
 *
 * @param {Blocker} blocker
 * @param {string} destination
 */
const download = async (blocker, destination) => {
  const response = await fetch(blocker.url, { redirect: 'follow' })

  if (!response.ok) {
    throw new Error(`${blocker.url}: ${response.status} ${response.statusText}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')

  if (digest !== blocker.sha256) {
    throw new Error(
      `${blocker.url}: sha256 ${digest}, pinned ${blocker.sha256}. Refusing it; a new version needs its digest pinned alongside.`,
    )
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, bytes)
}

/**
 * @param {string} name
 * @param {boolean} force
 */
const fetchBlocker = async (name, force) => {
  const blocker = BLOCKERS[name]
  const target = blockerPath(name)

  if (!force && fs.existsSync(target)) {
    console.log(`${name} ${blocker.version} already at ${target}`)
    return
  }

  if (blocker.kind === 'xpi') {
    await download(blocker, target)
    console.log(`${name} ${blocker.version} -> ${target}`)
    return
  }

  const archive = path.join(blockersDir, `${name}.zip`)
  await download(blocker, archive)
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })

  try {
    execFileSync('unzip', ['-q', '-o', archive, '-d', target])
  } catch (error) {
    throw new Error(
      `could not unpack ${archive} — is \`unzip\` installed? (${/** @type {Error} */ (error).message})`,
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
// `import.meta.filename` rather than the URL: the URL is percent-encoded and
// argv is not, so a checkout path with a space would skip the whole body.
if (import.meta.filename === process.argv[1]) {
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
  rejectUnknownArguments({ flags: ['--force'], positionals: false })

  const force = process.argv.slice(2).includes('--force')

  for (const name of Object.keys(BLOCKERS)) {
    await fetchBlocker(name, force)
  }
}
