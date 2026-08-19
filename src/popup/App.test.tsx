import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { getChromeMock } from '@/test/chrome'
import { hexToHsl } from '@/shared/color'
import { DOMAINS_SCHEMA_VERSION, DOMAINS_STORAGE_KEY } from '@/shared/domains'
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

const stepField = () => screen.getByLabelText('Speed step') as HTMLInputElement

/**
 * The popup learns the active tab's domain from the service worker, which is
 * not running under jsdom, so the reply has to be stood in for.
 */
const answerPopupState = (domain: string | null, speed = 1) => {
  getChromeMock().runtime.sendMessage.mockImplementation(
    (message: unknown, callback?: (response?: unknown) => void) => {
      if ((message as { type?: string }).type === 'rebobinate:popup-state') {
        callback?.({ speed, hasVideo: true, domain })
        return
      }

      callback?.()
    },
  )
}

/** Seeded in the shape storage holds, so a marker carries no speed. */
const seedDomains = (
  entries: Record<
    string,
    { speed?: number; updatedAt: number; never?: boolean }
  >,
) => {
  getChromeMock().storage.local.seed({
    [DOMAINS_STORAGE_KEY]: { schemaVersion: DOMAINS_SCHEMA_VERSION, entries },
  })
}

const openTab = async (user: UserEvent, name: string) => {
  await user.click(screen.getByRole('tab', { name }))
}

const seedSettings = (patch: Partial<Settings> = {}) => {
  getChromeMock().storage.local.seed({
    [SETTINGS_STORAGE_KEY]: { ...DEFAULT_SETTINGS, ...patch },
  })
}

describe('popup tabs', () => {
  beforeEach(() => {
    seedSettings()
    answerPopupState('youtube.com', 1.5)
  })

  it('opens on the speed controls', () => {
    render(<App />)

    expect(screen.getByRole('tab', { name: 'Speed' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Faster' })).toBeInTheDocument()
  })

  /**
   * The one thing the popup cannot be slow about. Both storage reads answer on
   * a callback, and a popup that waits for them flashes an empty box every time
   * it is opened.
   */
  it('shows the speed on the first render, before any read has answered', () => {
    getChromeMock().storage.local.get.mockImplementation(() => {
      // Never calls back: nothing on screen may depend on a read.
    })
    render(<App />)

    // The readout, not one of the preset chips, which carry the same labels.
    expect(screen.getByRole('status')).toHaveTextContent('1.5×')
  })

  it('swaps the pane and leaves only the selected tab in the focus order', async () => {
    const user = userEvent.setup()
    render(<App />)

    await openTab(user, 'Settings')

    expect(screen.queryByRole('button', { name: 'Faster' })).toBeNull()
    expect(screen.getByLabelText('Speed step')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Speed' })).toHaveAttribute(
      'tabindex',
      '-1',
    )
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'tabindex',
      '0',
    )
  })

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<App />)

    screen.getByRole('tab', { name: 'Speed' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Sites' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Sites' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Wraps, so the strip cannot dead-end.
    await user.keyboard('{ArrowLeft}{ArrowLeft}')

    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus()
  })

  it('keeps the enabled switch out of the tabs', async () => {
    const user = userEvent.setup()
    render(<App />)

    await openTab(user, 'Sites')

    expect(screen.getByLabelText('Enabled')).toBeInTheDocument()
  })

  /**
   * The chips exist because the step grid is a long walk: at the default 0.05
   * step, 1.0× to 2.0× is twenty presses. They reuse the ordinary set message,
   * so the service worker clamps them like any other.
   */
  it('jumps straight to a preset speed', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '2.0×' }))

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:set', speed: 2 },
      expect.any(Function),
    )
  })

  it('marks the preset the tab is already at', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: '1.5×' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: '1.0×' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  // The service worker resets to the default speed, not to 1.0×, so a bare
  // "Reset" is wrong for anyone who has moved that default.
  it('names what reset goes back to', () => {
    seedSettings({ defaultSpeed: 1.5 })
    render(<App />)

    const reset = screen.getByRole('button', { name: 'Default' })

    expect(reset).toHaveAttribute('title', 'Back to 1.5×')

    fireEvent.click(reset)

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reset' }),
      expect.any(Function),
    )
  })

  it('calls it Reset while the default is 1.0×', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: 'Reset' })).toHaveAttribute(
      'title',
      'Back to 1.0×',
    )
  })

  // The hint stops being true the moment a key is rebound.
  it('names the bound keys in the hint', () => {
    seedSettings({
      keys: { increase: ['ArrowUp'], decrease: ['ArrowDown'], reset: ['r'] },
    })
    render(<App />)

    expect(screen.getByText('↑')).toBeInTheDocument()
    expect(screen.getByText('r')).toBeInTheDocument()
  })
})

describe('popup sites tab', () => {
  beforeEach(() => {
    seedSettings()
  })

  const openSites = async () => {
    const user = userEvent.setup()
    render(<App />)
    await openTab(user, 'Sites')

    return user
  }

  it('shows what the active tab domain is remembered at', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    await openSites()

    expect(screen.getByText('youtube.com')).toBeInTheDocument()
    expect(screen.getByLabelText('Speed for youtube.com')).toHaveValue('1.5')
    expect(
      screen.getByRole('button', { name: 'Forget youtube.com' }),
    ).toBeEnabled()
  })

  it('has nothing to forget on a site it has not seen', async () => {
    answerPopupState('vimeo.com')
    await openSites()

    expect(screen.getByLabelText('Speed for vimeo.com')).toHaveValue('default')
    expect(
      screen.getByRole('button', { name: 'Forget vimeo.com' }),
    ).toBeDisabled()
  })

  // The row used to spell "nothing remembered" as a blank em-dash option, which
  // said what the row was not rather than what the site would do.
  it('names the speed an unremembered site will start at', async () => {
    answerPopupState('vimeo.com')
    seedSettings({ defaultSpeed: 1.5 })
    await openSites()

    expect(
      within(screen.getByLabelText('Speed for vimeo.com')).getByRole('option', {
        name: 'Use default (1.5×)',
      }),
    ).toBeInTheDocument()
  })

  /**
   * The one thing this pane is for. Before this the select only appeared once
   * an entry existed, so a starting speed could not be chosen here until it had
   * been set from the Speed tab first.
   */
  it('sets a starting speed for a site with nothing remembered yet', async () => {
    answerPopupState('vimeo.com')
    const user = await openSites()

    await user.selectOptions(
      screen.getByLabelText('Speed for vimeo.com'),
      '1.5',
    )

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:set-domain-speed', domain: 'vimeo.com', speed: 1.5 },
      expect.any(Function),
    )
  })

  it('offers the default speed among an unset site’s choices', async () => {
    answerPopupState('vimeo.com')
    seedSettings({ defaultSpeed: 1.15 })
    await openSites()

    const options = within(screen.getByLabelText('Speed for vimeo.com'))
      .getAllByRole('option')
      .map(option => (option as HTMLOptionElement).value)

    expect(options).toContain('1.15')
  })

  // Every state a row can be in is an option of the one select, so there is no
  // blank option meaning "nothing remembered" and no second control saying the
  // same thing a different way.
  it('carries the whole state of a row in one control', async () => {
    answerPopupState('vimeo.com')
    seedDomains({ 'vimeo.com': { speed: 1.5, updatedAt: 1 } })
    await openSites()

    const row = within(screen.getByRole('listitem'))
    const options = row
      .getAllByRole('option')
      .map(option => (option as HTMLOptionElement).value)

    expect(options).not.toContain('')
    expect(options.slice(0, 2)).toEqual(['never', 'default'])
    expect(row.queryByRole('checkbox')).toBeNull()
  })

  it('says so on a page that is not a site', async () => {
    answerPopupState(null)
    await openSites()

    expect(
      screen.getByText(/not one a speed can be remembered for/),
    ).toBeInTheDocument()
  })

  // The service worker owns the write: a speed change on this domain may still
  // be sitting in its debounce, and only the worker can cancel that.
  it('asks the service worker to forget a site', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    const user = await openSites()

    await user.click(screen.getByRole('button', { name: 'Forget youtube.com' }))

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:forget-domain', domain: 'youtube.com' },
      expect.any(Function),
    )
  })

  it('lists the other remembered sites, most recent first', async () => {
    answerPopupState('youtube.com')
    seedDomains({
      'youtube.com': { speed: 1.5, updatedAt: 5 },
      'old.example': { speed: 1.25, updatedAt: 1 },
      'new.example': { speed: 2, updatedAt: 9 },
    })
    await openSites()

    const names = screen
      .getAllByRole('listitem')
      .map(row => row.querySelector('.site-name')?.textContent)

    expect(names).toEqual(['youtube.com', 'new.example', 'old.example'])
  })

  it('sends an edited speed for a site in the list', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'vimeo.com': { speed: 1.25, updatedAt: 1 } })
    const user = await openSites()

    await user.selectOptions(screen.getByLabelText('Speed for vimeo.com'), '2')

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:set-domain-speed', domain: 'vimeo.com', speed: 2 },
      expect.any(Function),
    )
  })

  // Speeds set from the keyboard land anywhere on the step grid, and opening
  // the list must not quietly round one away.
  it('keeps a remembered speed that is not one of the presets selectable', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'vimeo.com': { speed: 1.35, updatedAt: 1 } })
    await openSites()

    expect(screen.getByLabelText('Speed for vimeo.com')).toHaveValue('1.35')
  })

  it('switches a site out of the memory', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'vimeo.com': { speed: 1.25, updatedAt: 1 } })
    const user = await openSites()

    await user.selectOptions(
      screen.getByLabelText('Speed for vimeo.com'),
      'never',
    )

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:set-domain-never', domain: 'vimeo.com', never: true },
      expect.any(Function),
    )
  })

  it('says a site is switched off in the same control that sets its speed', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'vimeo.com': { speed: 1, updatedAt: 1, never: true } })
    await openSites()

    expect(screen.getByLabelText('Speed for vimeo.com')).toHaveValue('never')
  })

  /**
   * A marker is a stored entry like any other, and the switch that used to be
   * the only way back is gone, so the ✕ has to clear it. It cannot do that with
   * a forget: `forgetDomain` leaves a marker standing on purpose, so that `0`
   * on a site that is switched off does not start remembering it again.
   */
  it('forgets a site that is switched off', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'vimeo.com': { speed: 1, updatedAt: 1, never: true } })
    const user = await openSites()

    await user.click(screen.getByRole('button', { name: 'Forget vimeo.com' }))

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'rebobinate:set-domain-never',
        domain: 'vimeo.com',
        never: false,
      },
      expect.any(Function),
    )
  })

  it('takes a switched-off site back to the default from the select', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'vimeo.com': { speed: 1, updatedAt: 1, never: true } })
    const user = await openSites()

    await user.selectOptions(
      screen.getByLabelText('Speed for vimeo.com'),
      'default',
    )

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'rebobinate:set-domain-never',
        domain: 'vimeo.com',
        never: false,
      },
      expect.any(Function),
    )
  })

  it('forgets a site when its row is put back on the default', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'vimeo.com': { speed: 1.25, updatedAt: 1 } })
    const user = await openSites()

    await user.selectOptions(
      screen.getByLabelText('Speed for vimeo.com'),
      'default',
    )

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:forget-domain', domain: 'vimeo.com' },
      expect.any(Function),
    )
  })

  it('filters a long list down', async () => {
    answerPopupState(null)
    seedDomains(
      Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [
          `site-${index}.example`,
          { speed: 1.5, updatedAt: index },
        ]),
      ),
    )
    const user = await openSites()

    await user.type(screen.getByLabelText('Filter'), 'site-7')

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByTitle('site-7.example')).toBeInTheDocument()
  })

  it('hides the list while the memory is turned off', async () => {
    answerPopupState('youtube.com')
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    const user = await openSites()

    await user.click(screen.getByLabelText('Remember per site'))

    expect(storedSettings().rememberPerDomain).toBe(false)
    expect(screen.queryByText('youtube.com')).toBeNull()
  })

  it('saves the default speed for sites it has never seen', async () => {
    answerPopupState('youtube.com')
    const user = await openSites()

    await user.selectOptions(screen.getByLabelText('Default speed'), '1.5')

    expect(storedSettings().defaultSpeed).toBe(1.5)
  })

  it('keeps a default speed that is not one of the presets selectable', async () => {
    answerPopupState('youtube.com')
    seedSettings({ defaultSpeed: 1.15 })
    await openSites()

    expect(screen.getByLabelText('Default speed')).toHaveValue('1.15')
  })
})

describe('popup key bindings', () => {
  beforeEach(() => {
    seedSettings()
    answerPopupState('youtube.com')
  })

  const openSettings = async () => {
    const user = userEvent.setup()
    render(<App />)
    await openTab(user, 'Settings')

    return user
  }

  const capture = async (user: UserEvent, action: string) => {
    await user.click(
      screen.getByRole('button', { name: `Add a key for ${action}` }),
    )
  }

  // `=` and `Equal` are both stored, and both are the same key to the user.
  it('shows one chip per key, not one per stored form', async () => {
    await openSettings()

    const faster = screen.getByText('Faster').parentElement as HTMLElement

    expect(
      within(faster)
        .getAllByRole('button', { name: /^Remove/ })
        .map(button => button.getAttribute('aria-label')),
    ).toEqual([
      'Remove + from Faster',
      'Remove = from Faster',
      'Remove Num + from Faster',
    ])
  })

  it('binds the key that is pressed', async () => {
    const user = await openSettings()

    await capture(user, 'Reset')
    await user.keyboard('{r}')

    expect(storedSettings().keys.reset).toContain('r')
  })

  it('refuses a key another action already has', async () => {
    const user = await openSettings()

    await capture(user, 'Reset')
    await user.keyboard('{+}')

    expect(screen.getByText('+ is already faster.')).toBeInTheDocument()
    expect(storedSettings().keys.reset).not.toContain('+')
  })

  // The content script hands modified keystrokes back to the browser, so a
  // binding on one would never fire.
  it('refuses a modified keystroke', async () => {
    const user = await openSettings()

    await capture(user, 'Reset')
    await user.keyboard('{Control>}{m}{/Control}')

    expect(screen.getByText(/left to the browser/)).toBeInTheDocument()
    expect(storedSettings().keys.reset).not.toContain('m')
  })

  it('cancels on Escape', async () => {
    const user = await openSettings()

    await capture(user, 'Reset')
    await user.keyboard('{Escape}')

    expect(
      screen.getByRole('button', { name: 'Add a key for Reset' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(storedSettings().keys.reset).toEqual(DEFAULT_SETTINGS.keys.reset)
  })

  it('removes both stored forms of one key with one chip', async () => {
    const user = await openSettings()

    await user.click(
      screen.getByRole('button', { name: 'Remove = from Faster' }),
    )

    expect(storedSettings().keys.increase).toEqual(['+', 'NumpadAdd'])
  })

  /**
   * `normalizeSettings` reads an empty binding list as a missing one and fills
   * it from the defaults, so a row emptied here would come straight back.
   */
  it('will not let the last key of an action go', async () => {
    seedSettings({
      keys: { ...DEFAULT_SETTINGS.keys, reset: ['r'] },
    })
    await openSettings()

    expect(
      screen.getByRole('button', { name: 'Remove r from Reset' }),
    ).toBeDisabled()
  })

  it('puts the defaults back', async () => {
    seedSettings({
      keys: { increase: ['a'], decrease: ['b'], reset: ['c'] },
    })
    const user = await openSettings()

    await user.click(
      screen.getByRole('button', { name: 'Restore default keys' }),
    )

    expect(storedSettings().keys).toEqual(DEFAULT_SETTINGS.keys)
  })
})

describe('popup step field', () => {
  beforeEach(() => {
    seedSettings({ step: 0.2 })
    answerPopupState('youtube.com')
  })

  const openSettings = async () => {
    const user = userEvent.setup()
    render(<App />)
    await openTab(user, 'Settings')

    return user
  }

  it('lets a new step be typed through its invalid halfway states', async () => {
    const user = await openSettings()

    await user.clear(stepField())

    // Clearing must leave the field empty. Clamping an empty field back to the
    // minimum is what used to make 0.15 unreachable.
    expect(stepField()).toHaveValue(null)

    await user.type(stepField(), '0.15')

    expect(stepField()).toHaveValue(0.15)
    expect(storedSettings().step).toBe(0.15)
  })

  it('keeps a half-typed value out of storage', async () => {
    const user = await openSettings()

    await user.clear(stepField())
    await user.type(stepField(), '0')

    expect(stepField()).toHaveValue(0)
    expect(storedSettings().step).toBe(0.2)
  })

  it('clamps the typed value when the field is left', async () => {
    const user = await openSettings()

    await user.clear(stepField())
    await user.type(stepField(), '9')
    await user.tab()

    expect(stepField()).toHaveValue(1)
    expect(storedSettings().step).toBe(1)
  })

  it('restores the saved step when the field is left empty', async () => {
    const user = await openSettings()

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
    seedSettings()
    answerPopupState('youtube.com')
  })

  const openSettings = async () => {
    const user = userEvent.setup()
    render(<App />)
    await openTab(user, 'Settings')

    return user
  }

  // The whole reason this control exists: on Firefox the native chooser is a
  // toplevel window that closes the popup before it can report a colour.
  it('picks a color without a native color input', async () => {
    const user = await openSettings()

    expect(document.querySelector('input[type="color"]')).toBeNull()

    const picker = await openPicker(user, 'Text color')

    await user.click(within(picker).getByLabelText('#22c55e'))

    expect(storedSettings().badge.textColor).toBe('#22c55e')
  })

  it('shares one panel between the two swatches', async () => {
    const user = await openSettings()

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
    const user = await openSettings()

    const picker = await openPicker(user, 'Background color')
    const field = within(picker).getByLabelText('Background color hex')

    await user.clear(field)
    await user.type(field, '#ff88')

    expect(storedSettings().badge.backgroundColor).toBe('#000000')

    await user.type(field, '00')

    expect(storedSettings().badge.backgroundColor).toBe('#ff8800')
  })

  it('expands a three-digit hex when the field is left', async () => {
    const user = await openSettings()

    const picker = await openPicker(user, 'Background color')
    const field = within(picker).getByLabelText('Background color hex')

    await user.clear(field)
    await user.type(field, '#f80')
    await user.tab()

    expect(storedSettings().badge.backgroundColor).toBe('#ff8800')
  })

  it('moves the saved color along the hue slider', async () => {
    const user = await openSettings()

    const picker = await openPicker(user, 'Text color')

    // White has no hue to move, so start from a saturated preset.
    await user.click(within(picker).getByLabelText('#ef4444'))
    fireEvent.change(within(picker).getByLabelText('Hue'), {
      target: { value: '240' },
    })

    expect(hexToHsl(storedSettings().badge.textColor).h).toBe(240)
  })

  it('keeps the sliders on the value the popup already had', async () => {
    seedSettings({
      badge: { ...DEFAULT_SETTINGS.badge, textColor: 'rgb(255, 136, 0)' },
    })
    const user = await openSettings()

    const picker = await openPicker(user, 'Text color')

    // Storage still admits the `rgb()` form, so the picker has to read it.
    expect(within(picker).getByLabelText('Text color hex')).toHaveValue(
      '#ff8800',
    )
    expect(within(picker).getByLabelText('Hue')).toHaveValue('32')
  })
})

describe('popup toolbar badge toggle', () => {
  beforeEach(() => {
    seedSettings()
    answerPopupState('youtube.com')
  })

  const openSettings = async () => {
    const user = userEvent.setup()
    render(<App />)
    await openTab(user, 'Settings')

    return user
  }

  it('is on by default and switches off', async () => {
    const user = await openSettings()

    const toggle = screen.getByRole('checkbox', { name: 'Toolbar badge' })
    expect(toggle).toBeChecked()

    await user.click(toggle)

    expect(storedSettings().toolbarBadge).toBe(false)
  })

  // Two badges now, so the older one is named for where it is drawn.
  it('keeps the on-video badge as a separate control', async () => {
    await openSettings()

    expect(
      screen.getByRole('checkbox', { name: 'On-video badge' }),
    ).toBeChecked()
  })
})

describe('popup badge settings', () => {
  beforeEach(() => {
    seedSettings()
    answerPopupState('youtube.com')
  })

  const openSettings = async () => {
    const user = userEvent.setup()
    render(<App />)
    await openTab(user, 'Settings')

    return user
  }

  // A thumb position is not a value anybody can write down or come back to.
  it('writes the value of each slider next to it', async () => {
    await openSettings()

    expect(screen.getByText('14px')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('follows the slider it belongs to', async () => {
    await openSettings()

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '22' } })

    expect(screen.getByText('22px')).toBeInTheDocument()
  })

  // Every other switch on the pane means "more visible" when it is on.
  it('asks whether to show the badge at 1.0×, not whether to hide it', async () => {
    const user = await openSettings()

    const toggle = screen.getByRole('checkbox', { name: 'Show at 1.0×' })

    // Stored as `hideAtNormalSpeed`, which installed copies hold and the
    // content script reads: this is a label-and-render inversion only.
    expect(toggle).not.toBeChecked()

    await user.click(toggle)

    expect(storedSettings().badge.hideAtNormalSpeed).toBe(false)
  })

  /**
   * The preview cannot act the visibility rules out — it is pinned so it stays
   * on screen while the controls move, and honouring "hide at 1.0×" would blank
   * it for most users at rest — so it says them instead.
   */
  it('says when the badge is on screen, from both settings', async () => {
    const user = await openSettings()

    expect(
      screen.getByText(
        'Shown for 2 seconds after a speed change, and hidden at 1.0×.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Show at 1.0×' }))
    await user.selectOptions(screen.getByLabelText('Hide after'), '0')

    expect(
      screen.getByText(
        'Always shown while a video is playing, including at 1.0×.',
      ),
    ).toBeInTheDocument()
  })
})

describe('popup backup', () => {
  beforeEach(() => {
    seedSettings({ step: 0.25 })
    seedDomains({ 'vimeo.com': { speed: 1.75, updatedAt: 7 } })
    answerPopupState('vimeo.com')
  })

  const openBackup = async (button: 'Export' | 'Import') => {
    const user = userEvent.setup()
    render(<App />)
    await openTab(user, 'Settings')
    await user.click(screen.getByRole('button', { name: button }))

    return user
  }

  it('exports the settings and the site list as one document', async () => {
    await openBackup('Export')

    const exported = JSON.parse(
      (screen.getByLabelText('Backup') as HTMLTextAreaElement).value,
    )

    expect(exported.format).toBe('rebobinate-backup')
    expect(exported.settings.step).toBe(0.25)
    expect(exported.domains.entries['vimeo.com'].speed).toBe(1.75)
  })

  it('restores both stores the way each is normally written', async () => {
    const user = await openBackup('Import')

    const backup = {
      format: 'rebobinate-backup',
      version: 1,
      settings: { ...DEFAULT_SETTINGS, step: 0.5 },
      domains: {
        schemaVersion: DOMAINS_SCHEMA_VERSION,
        entries: { 'restored.example': { speed: 2, updatedAt: 3 } },
      },
    }

    // `paste` rather than `type`: a real restore is a paste, and typing 40
    // lines of JSON character by character is a minute of test time.
    await user.click(screen.getByLabelText('Backup to restore'))
    await user.paste(JSON.stringify(backup))
    await user.click(screen.getByRole('button', { name: 'Replace settings' }))

    expect(storedSettings().step).toBe(0.5)
    // The map is the service worker's to write: a debounced entry may still be
    // pending, and only it can cancel that before the restored map lands.
    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'rebobinate:import-domains',
        store: {
          schemaVersion: DOMAINS_SCHEMA_VERSION,
          entries: {
            'restored.example': { speed: 2, updatedAt: 3, never: false },
          },
        },
      },
      expect.any(Function),
    )
  })

  // The button that overwrites both stores is live exactly while there is
  // something valid to restore, and the note says why it is not.
  it('says why nothing can be restored and changes nothing', async () => {
    const user = await openBackup('Import')

    await user.click(screen.getByLabelText('Backup to restore'))
    await user.paste('{"step":0.5}')

    expect(
      screen.getByRole('button', { name: 'Replace settings' }),
    ).toBeDisabled()
    expect(
      screen.getByText('That is not a Rebobinate backup.'),
    ).toBeInTheDocument()
    expect(storedSettings().step).toBe(0.25)
    expect(getChromeMock().runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rebobinate:import-domains' }),
      expect.any(Function),
    )
  })

  it('counts what a restore would replace', async () => {
    await openBackup('Import')

    expect(
      screen.getByText('Replaces your settings and the 1 remembered site.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Replace settings' }),
    ).toBeDisabled()
  })

  // The reason this pane is two textareas rather than a download and a file
  // input: on Gecko either one closes the popup before it can finish.
  it('offers no file input', async () => {
    await openBackup('Export')

    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})
