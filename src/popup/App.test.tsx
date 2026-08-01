import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type Settings,
} from '@/shared/settings'
import App from './App'

const storedSettings = (): Settings => {
  const stored = getChromeMock().storage.local.snapshot()

  return stored[SETTINGS_STORAGE_KEY] as Settings
}

const stepField = () => screen.getByLabelText('Step') as HTMLInputElement

describe('popup step field', () => {
  beforeEach(() => {
    getChromeMock().storage.local.seed({
      [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, step: 0.2 },
    })
  })

  it('lets a new step be typed through its invalid halfway states', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.clear(stepField())

    // Clearing must leave the field empty. Clamping an empty field back to the
    // minimum is what used to make 0.15 unreachable.
    expect(stepField()).toHaveValue(null)

    await user.type(stepField(), '0.15')

    expect(stepField()).toHaveValue(0.15)
    expect(storedSettings().step).toBe(0.15)
  })

  it('keeps a half-typed value out of storage', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.clear(stepField())
    await user.type(stepField(), '0')

    expect(stepField()).toHaveValue(0)
    expect(storedSettings().step).toBe(0.2)
  })

  it('clamps the typed value when the field is left', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.clear(stepField())
    await user.type(stepField(), '9')
    await user.tab()

    expect(stepField()).toHaveValue(1)
    expect(storedSettings().step).toBe(1)
  })

  it('restores the saved step when the field is left empty', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.clear(stepField())
    await user.tab()

    expect(stepField()).toHaveValue(0.2)
    expect(storedSettings().step).toBe(0.2)
  })
})
