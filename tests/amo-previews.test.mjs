import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_LOCK,
  MAX_IMAGE_BYTES,
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
} from '../scripts/amo-previews.mjs'
import manifest from '../amo/previews.json' with { type: 'json' }
import lockFile from '../amo/previews.lock.json' with { type: 'json' }

// This file is `.mjs` because the module under test is: the publish scripts are
// plain ESM run by node, not part of a TypeScript project reference. Vitest
// picks it up from the same default glob as the `.ts` suites.

const preview = (file, caption) => ({ file, caption: { 'en-US': caption } })

const valid = [
  preview('store/screenshots/a.png', 'first'),
  preview('store/screenshots/b.png', 'second'),
]

// The three sides a sync reconciles: the manifest, the lock, and what AMO says
// it holds.
const digests = new Map([
  ['store/screenshots/a.png', 'aaa'],
  ['store/screenshots/b.png', 'bbb'],
])

const lockOf = (...rows) => ({ icon: null, previews: rows })

const row = (file, sha256, id) => ({ file, sha256, id })

const published = (id, caption, position) => ({
  id,
  caption: { 'en-US': caption },
  position,
})

const synced = lockOf(
  row('store/screenshots/a.png', 'aaa', 11),
  row('store/screenshots/b.png', 'bbb', 12),
)

const remoteSynced = [published(11, 'first', 0), published(12, 'second', 1)]

describe('imageContentType', () => {
  it('maps the formats AMO accepts', () => {
    expect(imageContentType('a.png')).toBe('image/png')
    expect(imageContentType('a.jpg')).toBe('image/jpeg')
    expect(imageContentType('a.JPEG')).toBe('image/jpeg')
  })

  it('rejects anything else', () => {
    expect(() => imageContentType('a.gif')).toThrow(/PNG or JPEG/)
    expect(() => imageContentType('a')).toThrow(/PNG or JPEG/)
  })
})

describe('checkImageBytes', () => {
  it('accepts a file at the limit', () => {
    expect(() => checkImageBytes('a.png', MAX_IMAGE_BYTES)).not.toThrow()
  })

  it('rejects a file over the limit', () => {
    expect(() => checkImageBytes('a.png', MAX_IMAGE_BYTES + 1)).toThrow(
      /over 4MB/,
    )
  })
})

describe('parsePreviewManifest', () => {
  it('keeps the file order it was given', () => {
    expect(parsePreviewManifest(valid).map(entry => entry.file)).toEqual([
      'store/screenshots/a.png',
      'store/screenshots/b.png',
    ])
  })

  it('rejects a manifest that is not an array', () => {
    expect(() => parsePreviewManifest({})).toThrow(/must be an array/)
  })

  it('rejects an empty manifest rather than emptying the listing', () => {
    expect(() => parsePreviewManifest([])).toThrow(/no previews/)
  })

  it('rejects an entry with no file', () => {
    expect(() => parsePreviewManifest([{ caption: { 'en-US': 'x' } }])).toThrow(
      /entry 0 has no "file"/,
    )
  })

  it('rejects a file AMO would not accept', () => {
    expect(() => parsePreviewManifest([preview('a.gif', 'x')])).toThrow(
      /PNG or JPEG/,
    )
  })

  it('rejects the same file listed twice', () => {
    expect(() => parsePreviewManifest([valid[0], valid[0]])).toThrow(
      /entry 1 repeats/,
    )
  })

  it('rejects an entry with no en-US caption', () => {
    expect(() =>
      parsePreviewManifest([{ file: 'a.png', caption: { de: 'x' } }]),
    ).toThrow(/no "en-US" caption/)

    expect(() => parsePreviewManifest([preview('a.png', '  ')])).toThrow(
      /no "en-US" caption/,
    )
  })

  it('names the source file in its errors', () => {
    expect(() => parsePreviewManifest({}, 'amo/previews.json')).toThrow(
      /^amo\/previews\.json: /,
    )
  })
})

describe('parseAssetLock', () => {
  it('reads back what a sync writes', () => {
    expect(parseAssetLock(synced)).toEqual(synced)
  })

  // A bookkeeping file must never be able to block a release: anything it
  // cannot vouch for is simply not reusable.
  it('treats junk as nothing recorded rather than failing', () => {
    for (const raw of [undefined, null, 'nonsense', {}, { previews: {} }]) {
      expect(parseAssetLock(raw)).toEqual(EMPTY_LOCK)
    }
  })

  it('drops rows that are missing the pairing they exist to record', () => {
    const raw = {
      previews: [
        row('a.png', 'aaa', 11),
        { file: 'b.png', sha256: 'bbb' },
        { file: 'c.png', id: 13 },
        { file: 'd.png', sha256: 'ddd', id: '14' },
      ],
    }

    expect(parseAssetLock(raw).previews).toEqual([row('a.png', 'aaa', 11)])
  })
})

describe('planPreviewSync', () => {
  it('uploads everything when nothing was ever recorded', () => {
    const plan = planPreviewSync([], valid, EMPTY_LOCK, digests)

    expect(plan.uploads).toEqual([
      { ...valid[0], position: 0 },
      { ...valid[1], position: 1 },
    ])
    expect(plan.patches).toEqual([])
    expect(plan.deletes).toEqual([])
  })

  it('sends nothing when the listing already matches', () => {
    const plan = planPreviewSync(remoteSynced, valid, synced, digests)

    expect(isPlanEmpty(plan)).toBe(true)
    expect(plan.kept).toEqual([11, 12])
  })

  // The whole point of the digest: a screenshot swapped on disk cannot pass as
  // the one that was uploaded, however similar it looks.
  it('replaces a screenshot whose bytes have changed', () => {
    const changed = new Map(digests).set('store/screenshots/a.png', 'zzz')
    const plan = planPreviewSync(remoteSynced, valid, synced, changed)

    expect(plan.uploads).toEqual([{ ...valid[0], position: 0 }])
    expect(plan.deletes).toEqual([11])
    expect(planCalls(plan)).toBe(3)
  })

  // Caption and position are ordinary writable fields; only the image is
  // create-only. That is what makes a re-word cost one call instead of three.
  it('patches a re-worded caption without touching the image', () => {
    const reworded = [valid[0], preview('store/screenshots/b.png', 'clearer')]
    const plan = planPreviewSync(remoteSynced, reworded, synced, digests)

    expect(plan.uploads).toEqual([])
    expect(plan.deletes).toEqual([])
    expect(plan.patches).toEqual([
      {
        id: 12,
        file: 'store/screenshots/b.png',
        caption: { 'en-US': 'clearer' },
      },
    ])
  })

  it('patches position when the manifest is reordered', () => {
    const plan = planPreviewSync(
      remoteSynced,
      [valid[1], valid[0]],
      synced,
      digests,
    )

    expect(plan.patches).toEqual([
      { id: 12, file: 'store/screenshots/b.png', position: 0 },
      { id: 11, file: 'store/screenshots/a.png', position: 1 },
    ])
  })

  it('leaves translations it does not write alone', () => {
    const remote = [
      {
        ...published(11, 'first', 0),
        caption: { 'en-US': 'first', de: 'eins' },
      },
      published(12, 'second', 1),
    ]

    expect(isPlanEmpty(planPreviewSync(remote, valid, synced, digests))).toBe(
      true,
    )
  })

  // A recorded id that AMO no longer has is a preview someone removed by hand,
  // or one an interrupted run never finished.
  it('re-uploads when the recorded preview is gone from AMO', () => {
    const plan = planPreviewSync([remoteSynced[1]], valid, synced, digests)

    expect(plan.uploads).toEqual([{ ...valid[0], position: 0 }])
    expect(plan.deletes).toEqual([])
  })

  it('drops previews the manifest no longer lists', () => {
    const plan = planPreviewSync(
      [...remoteSynced, published(13, 'stray', 2)],
      [valid[0]],
      synced,
      digests,
    )

    expect(plan.deletes).toEqual([12, 13])
    expect(plan.uploads).toEqual([])
  })
})

describe('describePreviewPlan', () => {
  it('says so plainly when there is nothing to do', () => {
    const plan = planPreviewSync(remoteSynced, valid, synced, digests)

    expect(describePreviewPlan(plan)).toBe(
      'previews: in sync with amo/previews.json',
    )
  })

  it('counts the work and names the command that does it', () => {
    const line = describePreviewPlan(
      planPreviewSync([], valid, EMPTY_LOCK, digests),
    )

    expect(line).toContain('2 uploads')
    expect(line).toContain('4 calls')
    expect(line).toContain('--sync-previews')
  })
})

describe('iconNeedsUpload', () => {
  const applied = { icon: { file: 'icon.png', sha256: 'aaa' }, previews: [] }
  const live = 'https://addons.mozilla.org/user-media/addon_icons/1/1-64.png'

  it('skips an icon already applied from the same bytes', () => {
    expect(iconNeedsUpload(applied, 'icon.png', 'aaa', live)).toBe(false)
  })

  it('sends a changed icon', () => {
    expect(iconNeedsUpload(applied, 'icon.png', 'zzz', live)).toBe(true)
    expect(iconNeedsUpload(EMPTY_LOCK, 'icon.png', 'aaa', live)).toBe(true)
  })

  // The lock says what was sent, not what AMO kept. A placeholder is proof no
  // icon was ever accepted.
  it('sends it anyway while AMO serves its placeholder', () => {
    const placeholder =
      'https://addons.mozilla.org/static/img/addon-icons/default-64.png'

    expect(iconNeedsUpload(applied, 'icon.png', 'aaa', placeholder)).toBe(true)
    expect(iconNeedsUpload(applied, 'icon.png', 'aaa', undefined)).toBe(true)
  })
})

describe('lockPreviews', () => {
  it('records the manifest order, not the order things were uploaded', () => {
    const ids = new Map([
      ['store/screenshots/b.png', 12],
      ['store/screenshots/a.png', 11],
    ])

    expect(lockPreviews(valid, digests, ids)).toEqual(synced.previews)
  })

  it('forgets a screenshot the manifest no longer lists', () => {
    const ids = new Map([
      ['store/screenshots/a.png', 11],
      ['store/screenshots/gone.png', 99],
    ])

    expect(lockPreviews(valid, digests, ids)).toEqual([synced.previews[0]])
  })

  it('holds nothing for an entry that has not been uploaded yet', () => {
    expect(lockPreviews(valid, digests, new Map())).toEqual([])
  })
})

// The manifest points at files the publish script uploads by path, so a moved
// or deleted screenshot has to fail here rather than partway through a release.
describe('the checked-in previews manifest', () => {
  const entries = parsePreviewManifest(manifest)

  it.each(entries.map(entry => entry.file))('%s is present and valid', file => {
    const { size } = statSync(resolve(process.cwd(), file))

    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
  })

  // A lock that has stopped parsing would silently turn every sync back into a
  // full replace, which is the cost this file exists to avoid.
  it('has a lock file the sync can read', () => {
    expect(parseAssetLock(lockFile)).toEqual(lockFile)
  })
})
