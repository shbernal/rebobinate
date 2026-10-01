import { readdirSync } from 'node:fs'
import path from 'node:path'
import { rateOf, pressSpeedKey } from '../fixtures/controls'
import { expect, test } from '../fixtures/extension'
import { extensionPath } from '../fixtures/extensionRuntime'

/**
 * Every file the package ships, as a page would ask for it. Any one a page can
 * fetch is a free "is Rebobinate installed" probe, since the Web Store id is
 * public.
 */
const shippedFiles = (dir = extensionPath): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? shippedFiles(path.join(dir, entry.name))
      : [path.relative(extensionPath, path.join(dir, entry.name))],
  )

test('a page cannot fetch anything the extension ships', async ({
  openFixture,
  extensionId,
}) => {
  const page = await openFixture('/simple')

  // The content script is running on this page, so whatever it needs is
  // loaded, and still nothing is reachable from here.
  await pressSpeedKey(page, '+')
  expect(await rateOf(page)).toBeCloseTo(1.1, 3)

  const reachable = await page.evaluate(
    ({ id, files }) =>
      Promise.all(
        files.map(file =>
          fetch(`chrome-extension://${id}/${file}`).then(
            () => file,
            () => null,
          ),
        ),
      ).then(results => results.filter(Boolean)),
    { id: extensionId, files: shippedFiles() },
  )

  expect(reachable).toEqual([])
})
