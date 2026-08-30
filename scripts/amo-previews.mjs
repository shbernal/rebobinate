// Decision logic for the AMO listing-asset sync, kept out of `publish-amo.mjs`
// so it can be unit-tested without an HTTP layer or a credential. Everything
// here is pure: it takes the manifest, the lock file and whatever AMO reports,
// and returns the work to do.
import path from 'node:path'

// `ImageField` in addons-server rejects anything that is not a non-animated
// PNG or JPEG under `MAX_IMAGE_UPLOAD_SIZE`, which is 4MB. Checking locally
// turns a mid-release API rejection into a failure before anything is uploaded.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

export const imageContentType = file => {
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()]

  if (type === undefined) {
    throw new Error(`${file} is not a PNG or JPEG; AMO accepts only those`)
  }

  return type
}

export const checkImageBytes = (file, bytes) => {
  if (bytes > MAX_IMAGE_BYTES) {
    const megabytes = (bytes / 1024 / 1024).toFixed(1)
    throw new Error(`${file} is ${megabytes}MB; AMO rejects images over 4MB`)
  }
}

// Display order is the order of the file. `position` is derived from the index
// rather than written out, so there is only one place to change an ordering and
// no way for the two to disagree.
export const parsePreviewManifest = (raw, source = 'amo/previews.json') => {
  const fail = message => {
    throw new Error(`${source}: ${message}`)
  }

  if (!Array.isArray(raw)) {
    fail('must be an array of previews')
  }

  if (raw.length === 0) {
    fail('has no previews; AMO would be left with an empty listing')
  }

  const seen = new Set()

  return raw.map((entry, index) => {
    const at = `entry ${index}`

    if (typeof entry?.file !== 'string' || entry.file === '') {
      fail(`${at} has no "file"`)
    }

    imageContentType(entry.file)

    if (seen.has(entry.file)) {
      fail(`${at} repeats ${entry.file}`)
    }

    seen.add(entry.file)

    const caption = entry.caption?.['en-US']

    if (typeof caption !== 'string' || caption.trim() === '') {
      fail(`${at} has no "en-US" caption`)
    }

    return { file: entry.file, caption: entry.caption }
  })
}

// The ledger that makes a delta sync possible. AMO re-encodes every image on
// ingest, so a local file and its published copy never share a hash, and
// nothing on a preview says which manifest entry produced it — the pairing
// exists only if the side that uploaded records it. So this file records, per
// entry, the digest of the bytes that were sent and the id AMO gave back.
//
// It is only ever trusted alongside AMO's own answer: a recorded id has to
// still exist on the add-on, and a recorded digest has to still match the file
// on disk. Anything else is re-uploaded. Deleting the file forces a full
// replace, which is the escape hatch when the two sides have drifted in a way
// nothing here can see.
export const EMPTY_LOCK = { icon: null, previews: [] }

const isRow = row =>
  typeof row?.file === 'string' &&
  typeof row?.sha256 === 'string' &&
  Number.isInteger(row?.id)

// A lock that cannot be read is not an error: it means nothing is reusable, and
// a full replace is always a correct answer. Failing the run instead would turn
// a bookkeeping file into something that can block a release.
export const parseAssetLock = raw => {
  const icon =
    typeof raw?.icon?.file === 'string' && typeof raw?.icon?.sha256 === 'string'
      ? { file: raw.icon.file, sha256: raw.icon.sha256 }
      : null

  const previews = Array.isArray(raw?.previews)
    ? raw.previews.filter(isRow).map(({ file, sha256, id }) => ({
        file,
        sha256,
        id,
      }))
    : []

  return { icon, previews }
}

// Only the locales the manifest sets are compared: nothing here ever writes the
// others, so a translation AMO holds that we do not is not drift.
const captionMatches = (published, wanted) =>
  Object.entries(wanted).every(([locale, text]) => published?.[locale] === text)

// The image of a published preview cannot be replaced — `PreviewSerializer`
// marks it create-only — so a changed screenshot is always an upload plus a
// delete. Caption and position are ordinary writable fields, which is what
// makes a re-worded caption or a reorder cost one call instead of a replace.
export const planPreviewSync = (remote, manifest, lock, digests) => {
  const byId = new Map(remote.map(preview => [preview.id, preview]))
  const rows = new Map(lock.previews.map(row => [row.file, row]))

  const uploads = []
  const patches = []
  const kept = new Set()

  manifest.forEach((entry, position) => {
    const row = rows.get(entry.file)
    const published = row === undefined ? undefined : byId.get(row.id)

    if (published === undefined || row.sha256 !== digests.get(entry.file)) {
      uploads.push({ ...entry, position })
      return
    }

    kept.add(published.id)

    const patch = { id: published.id, file: entry.file }

    if (!captionMatches(published.caption, entry.caption)) {
      patch.caption = entry.caption
    }

    if (published.position !== position) {
      patch.position = position
    }

    if (patch.caption !== undefined || patch.position !== undefined) {
      patches.push(patch)
    }
  })

  // Whatever is left is either superseded or something this repository did not
  // put there. Both are dropped: the manifest is the listing.
  return {
    uploads,
    patches,
    deletes: remote
      .filter(preview => !kept.has(preview.id))
      .map(({ id }) => id),
    kept: [...kept],
  }
}

// Uploading is two calls because a localized caption cannot ride the multipart
// create: `TranslationSerializerField` takes a dictionary only outside the
// `l10n_flat_input_output` gate, which API v5 does not carry.
export const planCalls = plan =>
  plan.uploads.length * 2 + plan.patches.length + plan.deletes.length

export const isPlanEmpty = plan => planCalls(plan) === 0

const countOf = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

export const PREVIEWS_IN_SYNC = 'previews: in sync with amo/previews.json'

export const describePlanWork = plan =>
  [
    plan.uploads.length > 0 && countOf(plan.uploads.length, 'upload'),
    plan.patches.length > 0 && countOf(plan.patches.length, 'metadata fix'),
    plan.deletes.length > 0 && countOf(plan.deletes.length, 'removal'),
  ]
    .filter(Boolean)
    .join(', ')

export const describeSyncStart = plan =>
  `syncing previews: ${describePlanWork(plan)} in ` +
  countOf(planCalls(plan), 'call')

// Printed when a release finds more preview work than the hour has room for,
// which in practice means a full replace: the lock does not account for what is
// published, so every image has to go up again. That is a deliberate act, not
// something a release should stall an hour on, so it is handed back as a
// command to run on its own.
export const describeDeferredPlan = (plan, budget) =>
  `previews: ${describePlanWork(plan)} needs ` +
  `${countOf(planCalls(plan), 'call')} and only ${budget} are left this hour ` +
  '— deferred. Run pnpm publish:amo --assets-only --sync-previews'

// The listing icon has no id to reconcile against, so the digest is the whole
// check — with one exception. If AMO is still serving its placeholder then no
// icon was ever accepted, whatever the lock claims, and it has to be sent.
export const iconNeedsUpload = (lock, file, digest, iconUrl) =>
  iconUrl === undefined ||
  iconUrl.includes('/addon-icons/default-') ||
  lock.icon?.file !== file ||
  lock.icon?.sha256 !== digest

// Rewritten from the manifest each time rather than patched, so a row for a
// screenshot the manifest no longer lists cannot survive in the file.
export const lockPreviews = (manifest, digests, ids) =>
  manifest
    .filter(entry => ids.has(entry.file))
    .map(entry => ({
      file: entry.file,
      sha256: digests.get(entry.file),
      id: ids.get(entry.file),
    }))
