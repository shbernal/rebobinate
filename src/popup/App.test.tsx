import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import { hexToHsl } from '@/shared/color'
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

const openPicker = async (user: UserEvent, label: string) => {
  await user.click(screen.getByLabelText(label))

  return screen.getByRole('group', { name: `${label} picker` })
}

describe('popup color picker', () => {
  beforeEach(() => {
    getChromeMock().storage.local.seed({
      [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS,
    })
  })

  // The whole reason this control exists: on Firefox the native chooser is a
  // toplevel window that closes the popup before it can report a colour.
  it('picks a color without a native color input', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(document.querySelector('input[type="color"]')).toBeNull()

    const picker = await openPicker(user, 'Text color')

    await user.click(within(picker).getByLabelText('#22c55e'))

    expect(storedSettings().badge.textColor).toBe('#22c55e')
  })

  it('shares one panel between the two swatches', async () => {
    const user = userEvent.setup()
    render(<App />)

    await openPicker(user, 'Text color')
    await openPicker(user, 'Background color')

    expect(
      screen.queryByRole('group', { name: 'Text color picker' }),
    ).toBeNull()

    await user.click(screen.getByLabelText('Background color'))

    expect(
      screen.queryByRole('group', { name: 'Background color picker' }),
    ).toBeNull()
  })

  it('saves a hex only once it is a whole color', async () => {
    const user = userEvent.setup()
    render(<App />)

    const picker = await openPicker(user, 'Background color')
    const field = within(picker).getByLabelText('Background color hex')

    await user.clear(field)
    await user.type(field, '#ff88')

    expect(storedSettings().badge.backgroundColor).toBe('#000000')

    await user.type(field, '00')

    expect(storedSettings().badge.backgroundColor).toBe('#ff8800')
  })

  it('expands a three-digit hex when the field is left', async () => {
    const user = userEvent.setup()
    render(<App />)

    const picker = await openPicker(user, 'Background color')
    const field = within(picker).getByLabelText('Background color hex')

    await user.clear(field)
    await user.type(field, '#f80')
    await user.tab()

    expect(storedSettings().badge.backgroundColor).toBe('#ff8800')
  })

  it('moves the saved color along the hue slider', async () => {
    const user = userEvent.setup()
    render(<App />)

    const picker = await openPicker(user, 'Text color')

    // White has no hue to move, so start from a saturated preset.
    await user.click(within(picker).getByLabelText('#ef4444'))
    fireEvent.change(within(picker).getByLabelText('Hue'), {
      target: { value: '240' },
    })

    expect(hexToHsl(storedSettings().badge.textColor).h).toBe(240)
  })

  it('keeps the sliders on the value the popup already had', async () => {
    const user = userEvent.setup()
    getChromeMock().storage.local.seed({
      [SETTINGS_STORAGE_KEY]: {
        ...DEFAULT_SETTINGS,
        badge: { ...DEFAULT_SETTINGS.badge, textColor: 'rgb(255, 136, 0)' },
      },
    })
    render(<App />)

    const picker = await openPicker(user, 'Text color')

    // Storage still admits the `rgb()` form, so the picker has to read it.
    expect(within(picker).getByLabelText('Text color hex')).toHaveValue(
      '#ff8800',
    )
    expect(within(picker).getByLabelText('Hue')).toHaveValue('32')
  })
})
