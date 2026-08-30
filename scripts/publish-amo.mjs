// Submits a built Firefox package to addons.mozilla.org against the raw API v5.
// `web-ext sign` wraps these same endpoints, but it is opaque about
// listed-channel review state and is known to exit non-zero on submissions that
// actually succeeded, which is not something a release job can be built on.
//
// Run `pnpm publish:amo --help` for the flags and the environment it reads.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import { printHelpAndExit } from './help.mjs'
import {
  EMPTY_LOCK,
  checkImageBytes,
  describePreviewPlan,
  iconNeedsUpload,
  imageContentType,
  isPlanEmpty,
  lockPreviews,
  parseAssetLock,
  parsePreviewManifest,
  planCalls,
  planPreviewSync,
} from './amo-previews.mjs'
import {
  MAX_PACE_WAIT_MS,
  SCOPE_LIMITS,
  paceDelay,
  throttleScope,
  throttleWaitMs,
} from './amo-throttle.mjs'

const API = 'https://addons.mozilla.org/api/v5'
const GUID = 'rebobinate@shbernal.github.io'
const CHANNEL = 'listed'
const LICENSE = 'MIT'

// The listing icon and the previews are add-on metadata, not version metadata:
// they are edited on the add-on record and survive every release untouched
// unless something here rewrites them.
const ICON = 'public/icons/icon128.png'
const PREVIEW_MANIFEST = 'amo/previews.json'

// What was last applied, and what AMO called it. Writes here are throttled hard
// enough that reapplying an unchanged asset is worth avoiding; see
// `amo-previews.mjs` for what the file is trusted for.
const ASSET_LOCK = 'amo/previews.lock.json'

// Firefox only. The manifest declares no Android support, and
// `data_collection_permissions` needs Firefox for Android 142 while the desktop
// floor is 140, so claiming Android here would misreport compatibility.
const COMPATIBILITY = ['firefox']

// Validation is queued server-side and is not instant on a busy day.
const POLL_INTERVAL_MS = 10_000
const POLL_ATTEMPTS = 60

const root = process.cwd()
const dryRun = process.argv.includes('--dry-run')
const checkOnly = process.argv.includes('--check')
const validateOnly = process.argv.includes('--validate-only')
const assetsOnly = process.argv.includes('--assets-only')
const syncPreviews = process.argv.includes('--sync-previews')

const read = file => fs.readFileSync(path.resolve(root, file), 'utf8')
const readJson = file => JSON.parse(read(file))

const { version } = readJson('package.json')

printHelpAndExit(`
Usage: pnpm publish:amo [--dry-run | --check | --validate-only | --assets-only]
                       [--sync-previews] [--help]

Submits the built Firefox package to addons.mozilla.org against API v5: uploads
the package, waits for server-side validation, creates the version, attaches the
source archive, then applies the listing icon if it has changed. A listed
submission is queued for human review, so a successful run ends with the add-on
nominated, not public.

Unsafe calls are paced against AMO's per-account limits (3/minute, 10/hour,
24/day, shared with every other extension published from this account) so a run
never spends budget on a request the server rejects.

Flags
  --dry-run        resolve the listing, approval notes, previews, and file
                   paths and print them, then check the tags and categories
                   against AMO's vocabularies; nothing is uploaded
  --check          verify the API credentials and exit
  --validate-only  upload through AMO's real validator without creating a
                   version; nothing is submitted and the add-on id is not
                   claimed
  --assets-only    apply the listing icon and, with --sync-previews, the
                   previews to the existing add-on; submits no version
  --sync-previews  bring the published previews in line with
                   ${PREVIEW_MANIFEST}. Only what changed is sent, against
                   ${ASSET_LOCK}; an unchanged listing costs
                   nothing. Off by default, so a run without it reports what a
                   sync would do instead of doing it. Delete the lock file to
                   force a full replace
  --help, -h       show this text

Environment
  MOZILLA_ADDON_JWT_ISSUER  AMO API key (required, except for --dry-run)
  MOZILLA_ADDON_JWT_SECRET  AMO API secret (required, except for --dry-run)
  AMO_PACKAGE               package to submit
                            (default: release/rebobinate-firefox-${version}.zip)
  AMO_SOURCE                source archive to attach
                            (default: release/rebobinate-source-${version}.zip)

Both defaults are produced by pnpm package:firefox and pnpm package:source.

See docs/ci-release-flow.md and docs/store-listings.md.
`)

const packagePath = path.resolve(
  root,
  process.env.AMO_PACKAGE ?? `release/rebobinate-firefox-${version}.zip`,
)
const sourcePath = path.resolve(
  root,
  process.env.AMO_SOURCE ?? `release/rebobinate-source-${version}.zip`,
)

const issuer = process.env.MOZILLA_ADDON_JWT_ISSUER
const secret = process.env.MOZILLA_ADDON_JWT_SECRET

// The reviewer notes are the same text as the documented build instructions, so
// they are lifted from the doc rather than restated here. Drift between what a
// reviewer is told and what the repository documents is the failure this avoids.
const REVIEWER_SECTION = '## Reviewer Build Instructions'

const approvalNotes = () => {
  const doc = read('amo/source-submission.md')
  const start = doc.indexOf(REVIEWER_SECTION)

  if (start === -1) {
    throw new Error(
      `amo/source-submission.md has no "${REVIEWER_SECTION}" section`,
    )
  }

  const section = doc.slice(start + REVIEWER_SECTION.length).split('\n## ')[0]
  const quoted = section
    .split('\n')
    .filter(line => line.startsWith('>'))
    .map(line => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim()

  if (quoted === '') {
    throw new Error(
      `amo/source-submission.md "${REVIEWER_SECTION}" has no quoted block`,
    )
  }

  return quoted
}

// The long description is the one listing field both stores publish verbatim,
// so it lives in `store/` rather than `amo/` and the Chrome dashboard paste
// comes from the same file. Everything else here is AMO-shaped and stays in
// `amo/listing.json`.
const listing = () => ({
  ...readJson('amo/listing.json'),
  description: { 'en-US': read('store/description.txt').trim() },
})

const previewManifest = () =>
  parsePreviewManifest(readJson(PREVIEW_MANIFEST), PREVIEW_MANIFEST)

const digestOf = file =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.resolve(root, file)))
    .digest('hex')

// A missing or unreadable lock means nothing is reusable, which is always a
// correct answer: the sync falls back to replacing everything.
const readLock = () => {
  try {
    return parseAssetLock(readJson(ASSET_LOCK))
  } catch {
    return structuredClone(EMPTY_LOCK)
  }
}

const writeLock = lock =>
  fs.writeFileSync(
    path.resolve(root, ASSET_LOCK),
    `${JSON.stringify(lock, null, 2)}\n`,
  )

const base64url = value => Buffer.from(value).toString('base64url')

// AMO caps a token's life at five minutes past `iat`, so every request mints its
// own instead of reusing one across a poll loop that can outlive it.
const mintToken = () => {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      iss: issuer,
      jti: crypto.randomUUID(),
      iat: issuedAt,
      exp: issuedAt + 240,
    }),
  )
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')

  return `${header}.${payload}.${signature}`
}

const parse = text => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// Every unsafe call this process sends, per throttle scope, including the ones
// AMO rejected — those spent budget too. Only what this run did is known, so a
// collision with an earlier run still surfaces as a 429, which is what the
// retry below is for.
const sent = { submission: [], upload: [] }

// Waiting before a call rather than after a rejection is the whole point: a
// 429 costs a slot on every limit that was not the one rejecting it, so the
// cheapest request is the one that is never sent.
const pace = async scope => {
  if (scope === null) {
    return
  }

  const { waitMs, limit } = paceDelay(
    sent[scope],
    Date.now(),
    SCOPE_LIMITS[scope],
  )

  if (waitMs <= 0) {
    return
  }

  if (waitMs > MAX_PACE_WAIT_MS) {
    throw new Error(
      `AMO's ${limit} limit is spent for this account; the next call could ` +
        `not be sent for another ${Math.round(waitMs / 60_000)} minutes. ` +
        'Run this again later: a sync resumes from what the lock records, so ' +
        'nothing already applied is sent twice.',
    )
  }

  console.log(`holding ${Math.round(waitMs / 1000)}s to stay under ${limit}`)
  await sleep(waitMs)
}

// A 429 is the one status worth retrying: it says the same request will work
// shortly, where every other failure says the request is wrong. With pacing in
// front it should only happen when an earlier run has already spent the budget.
// The token is minted inside the loop because a throttle wait is long enough to
// matter against its five-minute life.
const THROTTLE_ATTEMPTS = 5

const request = async (method, endpoint, { json, form } = {}) => {
  const scope = throttleScope(method, endpoint)

  for (let attempt = 1; ; attempt += 1) {
    await pace(scope)

    const headers = { Authorization: `JWT ${mintToken()}` }

    if (json !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    // Omitted rather than passed as undefined: a GET carrying a `body` key is
    // invalid even when its value is nothing.
    const payload = json !== undefined ? JSON.stringify(json) : form

    const response = await fetch(`${API}${endpoint}`, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: payload }),
    })

    if (scope !== null) {
      sent[scope].push(Date.now())
    }

    const body = parse(await response.text())

    if (response.status === 429 && attempt < THROTTLE_ATTEMPTS) {
      const wait = throttleWaitMs(response.headers.get('retry-after'))

      console.log(`throttled; retrying in ${Math.round(wait / 1000)}s`)
      await sleep(wait)
      continue
    }

    if (!response.ok) {
      const detail =
        typeof body === 'string' ? body : JSON.stringify(body, null, 2)
      throw new Error(`${method} ${endpoint} → ${response.status}\n${detail}`)
    }

    return body
  }
}

// Tags and categories are closed vocabularies. AMO rejects anything outside
// them on the PUT that creates the version, which is after the package has been
// uploaded and validated and after the release that triggered it is already
// published — so the whole release fails on a metadata typo. Both lists are
// public and unauthenticated, so checking up front costs nothing and turns that
// into a failed dry run.
const publicList = async endpoint => {
  const response = await fetch(`${API}${endpoint}`)

  if (!response.ok) {
    throw new Error(`GET ${endpoint} → ${response.status}`)
  }

  return response.json()
}

const verifyListing = async () => {
  const { tags = [], categories = [] } = listing()
  const [validTags, allCategories] = await Promise.all([
    publicList('/addons/tags/'),
    publicList('/addons/categories/'),
  ])

  const validCategories = allCategories
    .filter(category => category.type === 'extension')
    .map(category => category.slug)

  const problems = [
    ['tags', tags, validTags],
    ['categories', categories, validCategories],
  ]
    .map(([field, values, valid]) => [
      field,
      values.filter(value => !valid.includes(value)),
      valid,
    ])
    .filter(([, unknown]) => unknown.length > 0)
    .map(
      ([field, unknown, valid]) =>
        `amo/listing.json ${field} AMO does not define: ${unknown.join(', ')}\n` +
        `  valid ${field}: ${valid.join(', ')}`,
    )

  if (problems.length > 0) {
    throw new Error(problems.join('\n\n'))
  }

  console.log(
    `listing metadata valid (${tags.length} tags, ${categories.length} categories)`,
  )
}

const filePart = (file, type) =>
  new File([fs.readFileSync(file)], path.basename(file), { type })

const zipPart = file => filePart(file, 'application/zip')

// AMO also requires the icon to be square, which it enforces server-side. That
// is left to it: reading dimensions here would mean parsing PNG and JPEG
// headers to re-derive an answer the API already gives clearly.
const imagePart = file => {
  const absolute = path.resolve(root, file)
  checkImageBytes(file, fs.statSync(absolute).size)

  return filePart(absolute, imageContentType(file))
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const messagesOf = validation =>
  (validation?.messages ?? [])
    .filter(message => message.type === 'error')
    .map(message => `  ${message.message} (${message.file ?? 'package'})`)
    .join('\n')

// Fails the run on a bad or expired credential before anything is uploaded,
// rather than after a package is already sitting in AMO's validation queue.
const verifyCredentials = async () => {
  const profile = await request('GET', '/accounts/profile/')
  console.log(`authenticated as ${profile.display_name ?? profile.username}`)
}

const uploadPackage = async () => {
  const form = new FormData()
  form.set('upload', zipPart(packagePath))
  form.set('channel', CHANNEL)

  const upload = await request('POST', '/addons/upload/', { form })
  console.log(`uploaded ${path.basename(packagePath)} as ${upload.uuid}`)

  return upload
}

const awaitValidation = async uuid => {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    const upload = await request('GET', `/addons/upload/${uuid}/`)

    if (upload.processed) {
      if (!upload.valid) {
        throw new Error(
          `upload ${uuid} failed validation\n${messagesOf(upload.validation)}`,
        )
      }

      console.log(`validated version ${upload.version}`)
      return upload
    }

    console.log(`waiting for validation (${attempt}/${POLL_ATTEMPTS})`)
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`timed out waiting for AMO to validate upload ${uuid}`)
}

// PUT on the guid creates the add-on when AMO has never seen it and creates a
// new version when it has, so first submission and every later release take the
// same path. It also re-applies the listing metadata each release, which keeps
// the public page in step with `amo/listing.json`.
const submitVersion = async uuid => {
  const addon = await request('PUT', `/addons/addon/${GUID}/`, {
    json: {
      ...listing(),
      version: {
        upload: uuid,
        license: LICENSE,
        compatibility: COMPATIBILITY,
        approval_notes: approvalNotes(),
      },
    },
  })

  console.log(`created version ${addon.version.version} (${addon.version.id})`)
  return addon
}

// Source cannot travel as JSON, and it cannot be nested inside the version
// object of a form-data request either, so it is always a second call.
const attachSource = async versionId => {
  const form = new FormData()
  form.set('source', zipPart(sourcePath))

  const version = await request(
    'PATCH',
    `/addons/addon/${GUID}/versions/${versionId}/`,
    { form },
  )

  console.log(`attached ${path.basename(sourcePath)}`)
  return version
}

// The listing icon is separate metadata from the icons in the package. The
// manifest `icons` key drives about:addons, not the AMO page, and the JSON PUT
// that carries the rest of the listing cannot carry a file at all — AMO
// documents `icon` as multipart-only and unsettable at creation.
//
// Sent only when the file has changed since the lock recorded it, or when AMO
// is still serving its placeholder. It is a call out of ten an hour, spent on
// re-uploading identical bytes on every release otherwise.
const uploadIcon = async () => {
  const form = new FormData()
  form.set('icon', imagePart(ICON))

  const addon = await request('PATCH', `/addons/addon/${GUID}/`, { form })

  console.log(`applied listing icon from ${ICON}`)
  return addon
}

// Previews and the icon are edited on the add-on rather than on a version, so
// AMO accepts them while a version sits in review — the same path that already
// lets the release PUT rewrite the description. Every call throws on a non-2xx,
// so a rejection stops the run instead of half-applying.
//
// What is sent is a delta: the lock says which published preview came from
// which file and with what bytes, AMO's own response says which of those still
// exist and what captions and positions they carry, and only the difference is
// written. A listing that already matches costs nothing, which is what makes a
// sync safe to run in the same hour as a release.
const applyListingAssets = async addon => {
  const lock = readLock()
  const iconDigest = digestOf(ICON)

  if (iconNeedsUpload(lock, ICON, iconDigest, addon.icon_url)) {
    await uploadIcon()
    lock.icon = { file: ICON, sha256: iconDigest }
    writeLock(lock)
  } else {
    console.log(`listing icon already applied from ${ICON}`)
  }

  const manifest = previewManifest()
  const digests = new Map(
    manifest.map(entry => [entry.file, digestOf(entry.file)]),
  )
  const plan = planPreviewSync(addon.previews ?? [], manifest, lock, digests)

  if (!syncPreviews) {
    console.log(describePreviewPlan(plan))
    return
  }

  if (isPlanEmpty(plan)) {
    console.log('previews: already in sync, nothing to send')
    return
  }

  // Every call below is an unsafe method on the add-on, so all of them draw on
  // the same 10/hour budget as the release itself. Saying the count up front is
  // the difference between a paced run and one that looks hung.
  console.log(`syncing previews in ${planCalls(plan)} throttled calls`)

  const ids = new Map(lock.previews.map(row => [row.file, row.id]))

  // Uploads before deletes, so a run that dies halfway leaves the listing with
  // too many images rather than too few. The orphan it leaves is not recorded
  // in the lock, so the next sync deletes it as something the manifest does not
  // account for.
  for (const upload of plan.uploads) {
    const form = new FormData()
    form.set('image', imagePart(upload.file))
    form.set('position', String(upload.position))

    const preview = await request('POST', `/addons/addon/${GUID}/previews/`, {
      form,
    })

    // `caption` is writable on create, but a localized value would have to
    // survive multipart as a bare string and land in whatever AMO treats as the
    // default locale. Sending it as JSON afterwards keeps the `{"en-US": ...}`
    // shape the rest of the listing is written in.
    await request('PATCH', `/addons/addon/${GUID}/previews/${preview.id}/`, {
      json: { caption: upload.caption },
    })

    // Recorded only once both calls have landed: a preview claimed by the lock
    // is a preview a later run will not touch, and one with no caption is worse
    // than one uploaded twice.
    ids.set(upload.file, preview.id)
    lock.previews = lockPreviews(manifest, digests, ids)
    writeLock(lock)

    console.log(`uploaded preview ${upload.position} from ${upload.file}`)
  }

  for (const { id, file, ...fields } of plan.patches) {
    await request('PATCH', `/addons/addon/${GUID}/previews/${id}/`, {
      json: fields,
    })

    console.log(`updated the ${Object.keys(fields).join(' and ')} of ${file}`)
  }

  for (const id of plan.deletes) {
    await request('DELETE', `/addons/addon/${GUID}/previews/${id}/`)
    console.log(`removed superseded preview ${id}`)
  }

  lock.previews = lockPreviews(manifest, digests, ids)
  writeLock(lock)
}

const requireEnv = () => {
  const missing = [
    ['MOZILLA_ADDON_JWT_ISSUER', issuer],
    ['MOZILLA_ADDON_JWT_SECRET', secret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(`missing credentials: ${missing.join(', ')}`)
  }
}

const requireFiles = (...files) => {
  for (const file of files) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `${path.relative(root, file)} is missing — run pnpm package:firefox ` +
          'and pnpm package:source first',
      )
    }
  }
}

const main = async () => {
  if (checkOnly) {
    requireEnv()
    await verifyCredentials()
    return
  }

  if (dryRun) {
    requireFiles(packagePath, sourcePath)
    console.log(JSON.stringify(listing(), null, 2))
    console.log(`\n--- approval notes ---\n${approvalNotes()}`)
    console.log(`\npackage ${path.relative(root, packagePath)}`)
    console.log(`source  ${path.relative(root, sourcePath)}`)
    console.log(`icon    ${ICON}`)

    // The manifest is parsed and every image resolved and size-checked here,
    // which is the point of printing it: a bad path or an oversized screenshot
    // fails now rather than partway through a real sync. Each file is also
    // compared against the lock, so a dry run says what a sync would upload.
    // What it cannot say is what AMO holds — that needs an authenticated call,
    // and a dry run makes none.
    console.log('\n--- previews ---')

    const lock = readLock()
    const rows = new Map(lock.previews.map(row => [row.file, row]))

    for (const preview of previewManifest()) {
      imagePart(preview.file)

      const row = rows.get(preview.file)
      const state =
        row === undefined
          ? 'no recorded upload'
          : row.sha256 === digestOf(preview.file)
            ? `unchanged since it was uploaded as preview ${row.id}`
            : `changed since it was uploaded as preview ${row.id}`

      console.log(`${preview.file} (${state})\n  ${preview.caption['en-US']}`)
    }

    console.log()
    await verifyListing()
    return
  }

  requireEnv()
  await verifyCredentials()
  await verifyListing()

  // Applying the assets on their own needs no package and no version, which is
  // what makes it the way to repair a listing that is already public.
  if (assetsOnly) {
    const addon = await request('GET', `/addons/addon/${GUID}/`)
    await applyListingAssets(addon)
    console.log(`\nlisting  https://addons.mozilla.org/addon/${addon.slug}/`)
    return
  }

  // An upload on its own creates nothing on AMO and does not claim the add-on
  // id — only creating a version does that — so this is a safe way to put a
  // candidate package through the real validator before cutting a release tag.
  if (validateOnly) {
    requireFiles(packagePath)
    await awaitValidation((await uploadPackage()).uuid)
    console.log('\nPackage passes AMO validation. Nothing was submitted.')
    return
  }

  requireFiles(packagePath, sourcePath)

  const upload = await awaitValidation((await uploadPackage()).uuid)
  const addon = await submitVersion(upload.uuid)
  const version = await attachSource(addon.version.id)

  // After `submitVersion`, because on a first-ever submission the add-on record
  // does not exist until that PUT creates it. Its response already carries the
  // current previews and icon, so reconciling costs no extra call.
  await applyListingAssets(addon)

  // A listed submission is queued for human review; it does not go live the way
  // a Chrome Web Store publish does. A file status of `unreviewed` and an
  // add-on status of `nominated` until the first approval are the expected
  // successful outcomes, so the job must not wait for `public` or it will fail
  // every release.
  console.log(
    [
      '',
      `add-on   ${addon.slug} (${addon.status})`,
      `version  ${version.version} (${version.file.status})`,
      `listing  https://addons.mozilla.org/addon/${addon.slug}/`,
      '',
      'Submitted. Listed versions wait for Mozilla review before going live.',
    ].join('\n'),
  )
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
