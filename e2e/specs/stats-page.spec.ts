import { lastDays } from '../../src/shared/stats-summary'
import { expect, test } from '../fixtures/extension'

test('the popup opens the stats page, which shows what is stored', async ({
  extensionContext,
  openPopup,
  seedStats,
}) => {
  const [today] = lastDays(1, Date.now())
  await seedStats({ [today]: { 'youtube.com': { '2': 1800 } } })

  const popup = await openPopup()
  await popup.getByRole('tab', { name: 'Stats' }).click()

  const [page] = await Promise.all([
    extensionContext.waitForEvent('page'),
    popup.getByRole('button', { name: 'Open full stats' }).click(),
  ])

  await expect(page.getByRole('heading', { name: 'Watch time' })).toBeVisible()
  await expect(
    page.locator('.tile', { hasText: 'Time saved' }).locator('.tile-value'),
  ).toHaveText('30 min')
  await expect(
    page.getByRole('rowheader', { name: 'youtube.com' }),
  ).toBeVisible()
})
