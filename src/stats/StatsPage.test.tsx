import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import { SETTINGS_STORAGE_KEY } from '@/shared/settings'
import type { Settings } from '@/shared/settings'
import { STATS_STORAGE_KEY } from '@/shared/stats'
import { lastDays } from '@/shared/stats-summary'
import StatsPage from './StatsPage'

const NOW = new Date(2026, 0, 5, 12).getTime()

const seedStats = (
  days: Record<string, Record<string, Record<string, number>>>,
) => {
  getChromeMock().storage.local.seed({
    [STATS_STORAGE_KEY]: { schemaVersion: 1, days },
  })
}

const tile = (label: string) =>
  screen.getByText(label, { selector: '.tile-label' }).nextElementSibling
    ?.textContent

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

describe('stats page', () => {
  it('shows the totals for the chosen period', async () => {
    const [monthAgo] = lastDays(30, NOW)
    seedStats({
      '2026-01-05': { 'a.com': { '2': 3600 } },
      [monthAgo]: { 'b.com': { '1.5': 1200 } },
    })
    const user = userEvent.setup()
    render(<StatsPage />)

    expect(tile('Time saved')).toBe('1 h 00 min')

    await user.click(screen.getByRole('button', { name: 'Last 30 days' }))

    expect(tile('Time saved')).toBe('1 h 10 min')
    expect(tile('Time watched')).toBe('1 h 20 min')
    expect(screen.getByRole('rowheader', { name: 'b.com' })).toBeInTheDocument()
  })

  it('follows the store while open', async () => {
    render(<StatsPage />)

    expect(
      screen.getByText(/Nothing watched in this period/),
    ).toBeInTheDocument()

    await act(async () => {
      getChromeMock().storage.local.set({
        [STATS_STORAGE_KEY]: {
          schemaVersion: 1,
          days: { '2026-01-05': { 'a.com': { '1.5': 600 } } },
        },
      })
    })

    expect(tile('Time saved')).toBe('5 min')
  })

  it('saves the retention', async () => {
    const user = userEvent.setup()
    render(<StatsPage />)

    await user.selectOptions(screen.getByLabelText('Keep stats for'), '0')

    const stored = getChromeMock().storage.local.snapshot()[
      SETTINGS_STORAGE_KEY
    ] as Settings
    expect(stored.statsRetentionDays).toBe(0)
  })

  it('asks before clearing, and asks the service worker to do it', async () => {
    seedStats({ '2026-01-05': { 'a.com': { '1': 60 } } })
    const user = userEvent.setup()
    render(<StatsPage />)
    const sendMessage = getChromeMock().runtime.sendMessage

    await user.click(screen.getByRole('button', { name: 'Clear all stats' }))

    expect(screen.getByText(/Clear 1 day of stats/)).toBeInTheDocument()
    expect(sendMessage).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:clear-stats' },
      expect.any(Function),
    )
  })

  it('says when recording is off', () => {
    getChromeMock().storage.local.seed({
      [SETTINGS_STORAGE_KEY]: { rememberStats: false },
    })
    render(<StatsPage />)

    expect(screen.getByText(/Recording is off/)).toBeInTheDocument()
  })
})
