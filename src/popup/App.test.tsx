import { act, fireEvent, render, screen, within } from '@testing-library/react'
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

/**
 * The service worker's half of an edit. It is not running under jsdom, so a
 * write the popup asked for has to be made here: the list follows the stored
 * map rather than the message that asked for it.
 */
const workerWrote = async (
  entries: Record<
    string,
    { speed?: number; updatedAt: number; never?: boolean }
  >,
) => {
  await act(async () => {
    getChromeMock().storage.local.set({
      [DOMAINS_STORAGE_KEY]: { schemaVersion: DOMAINS_SCHEMA_VERSION, entries },
    })
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

  /**
   * The chip that lands on the default speed is Reset under another name. As
   * an ordinary set it wrote an entry at the default speed while the button
   * above it dropped that entry, so two controls arriving at the same number
   * left opposite stored state.
   */
  it('forgets the site from the chip that lands on the default speed', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '1.0×' }))

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:intent', action: 'reset', currentSpeed: 1.5 },
      expect.any(Function),
    )
    expect(getChromeMock().runtime.sendMessage).not.toHaveBeenCalledWith(
      { type: 'rebobinate:set', speed: 1 },
      expect.any(Function),
    )
  })

  // It follows the default rather than the number 1: once the default has been
  // moved, 1.0× is an ordinary speed and setting it is an ordinary set.
  it('sends a plain set from a chip the default has moved off', async () => {
    const user = userEvent.setup()
    seedSettings({ defaultSpeed: 1.25 })
    render(<App />)

    // The relabel is what says the seeded settings have arrived.
    await screen.findByRole('button', { name: 'Default' })
    await user.click(screen.getByRole('button', { name: '1.0×' }))

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:set', speed: 1 },
      expect.any(Function),
    )

    await user.click(screen.getByRole('button', { name: '1.25×' }))

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reset' }),
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
  it('names what reset goes back to', async () => {
    seedSettings({ defaultSpeed: 1.5 })
    render(<App />)

    const reset = screen.getByRole('button', { name: 'Default' })

    expect(await screen.findByTitle(/^Back to 1\.5×/)).toBe(reset)

    fireEvent.click(reset)

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reset' }),
      expect.any(Function),
    )
  })

  it('calls it Reset while the default is 1.0×', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })

  /**
   * Reset and the 1.0× chip land on the same number and do opposite things to
   * the map: the chip is an ordinary set and the service worker treats a reset
   * as the signal to drop the entry. Nothing on screen distinguishes them, so
   * the tooltip is what has to.
   */
  it('says that reset also drops what the site remembers', async () => {
    render(<App />)

    expect(
      await screen.findByTitle(
        'Back to 1.0×, and stops remembering a speed for youtube.com',
      ),
    ).toBeInTheDocument()
  })

  it('promises reset no more than it can deliver on an unremembered site', async () => {
    seedSettings({ rememberPerDomain: false, defaultSpeed: 1.5 })
    render(<App />)

    // The relabel is what says the seeded settings have arrived; the title is
    // read from the same object.
    expect(
      await screen.findByRole('button', { name: 'Default' }),
    ).toHaveAttribute('title', 'Back to 1.5×')
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

/**
 * Per-site memory is on out of the box, so a speed set here outlives the tab.
 * Nothing on this pane used to say so, and the Sites tab — where it is said —
 * is not somewhere anybody goes before being surprised by it.
 */
/**
 * The master switch is the one control in the panel that is not about a
 * preference: it is about the extension. What it turns off is enforced in the
 * service worker, which refuses every intent while it is off, so the panel's
 * job here is only to say so and to stop offering presses that cannot land.
 */
describe('popup with the extension switched off', () => {
  beforeEach(() => {
    seedSettings({ enabled: false })
    answerPopupState('youtube.com', 1.5)
  })

  // Above the tab strip, where the switch is, so it is on screen whichever tab
  // is open — the Sites and Settings tabs stay live and this is what tells them
  // they are dormant.
  it('says what the switch did, on every tab', async () => {
    const user = userEvent.setup()
    render(<App />)

    const line = await screen.findByText(
      'Off. No video is being sped up and the shortcuts do nothing. Everything below is kept.',
    )

    expect(line).toHaveClass('rule')

    await openTab(user, 'Sites')
    expect(line).toBeInTheDocument()

    await openTab(user, 'Settings')
    expect(line).toBeInTheDocument()
  })

  // The refusal is visible rather than a dead press: the service worker would
  // answer any of these with the speed it was already at.
  it('offers no press that the service worker would refuse', async () => {
    render(<App />)

    await screen.findByText(/^Off\./)

    expect(screen.getByRole('button', { name: 'Faster' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Slower' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '2.0×' })).toBeDisabled()
  })

  /**
   * Throwing the switch puts the video back to 1.0× and the service worker
   * forgets the tab's speed, so the number the popup opened with describes
   * nothing. A dash rather than "1.0×", which would be a fresh claim about a
   * video nothing is holding.
   */
  it('prints no speed it is not holding', async () => {
    render(<App />)

    await screen.findByText(/^Off\./)

    expect(screen.getByRole('status')).toHaveTextContent('—')
    expect(screen.getByRole('status')).not.toHaveTextContent('1.5')
  })

  /**
   * What is remembered for the site is still true and still applies the moment
   * the switch goes back on, so the receipt stays — and it names the stored
   * speed rather than the one the panel arrived holding. With the switch on
   * the receipt follows the readout, because a write may be in its debounce;
   * with it off nothing is pending and the readout has no number, so the
   * stored figure is the only true one.
   */
  it('keeps the per-site receipt, at the speed that is stored', async () => {
    seedDomains({ 'youtube.com': { speed: 1.25, updatedAt: 1 } })
    render(<App />)

    expect(
      await screen.findByText('1.25× remembered for youtube.com'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Forget' })).toBeEnabled()
  })

  it('puts the controls back when the switch goes back on', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText(/^Off\./)
    await user.click(screen.getByLabelText('Enabled'))

    expect(screen.queryByText(/^Off\./)).toBeNull()
    expect(screen.getByRole('button', { name: 'Faster' })).toBeEnabled()
  })

  /**
   * Throwing the switch off drops the tab's speed in the service worker and
   * puts the video back to 1.0×, so the number the popup was holding describes
   * nothing by the time the switch comes back on. Asking again is the only way
   * to find out, and the chip's pressed state comes along with it: it is
   * derived from the same speed.
   */
  it('asks again for the speed when the switch goes back on', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText(/^Off\./)

    // What the service worker answers once the switch has cleared the tab:
    // `tabSpeeds.get(tab.id) ?? 1`, with nothing left in the map.
    answerPopupState('youtube.com', 1)
    await act(async () => {
      await user.click(screen.getByLabelText('Enabled'))
    })

    expect(screen.getByRole('status')).toHaveTextContent('1.0×')
    expect(screen.getByRole('status')).not.toHaveTextContent('1.5')
    expect(screen.getByRole('button', { name: '1.5×' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

describe('popup speed tab receipt', () => {
  beforeEach(() => {
    seedSettings()
  })

  // Per-site memory being on is not the same as this site having been
  // remembered, and on a fresh profile the second is never true. The promise
  // states the rule rather than describing a state, so it cannot be read as a
  // claim that something is already stored.
  it('promises the speed will be kept for a site with nothing stored', async () => {
    answerPopupState('youtube.com', 1.5)
    render(<App />)

    expect(
      await screen.findByText('Speeds set here are kept for youtube.com'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/remembered for/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull()
  })

  // "From here on" has to lead somewhere: the tab where the rule can be
  // changed for this site and every other one.
  it('takes the promise to the Sites tab', async () => {
    const user = userEvent.setup()
    answerPopupState('youtube.com', 1.5)
    render(<App />)

    await user.click(
      await screen.findByRole('button', {
        name: 'Speeds set here are kept for youtube.com',
      }),
    )

    expect(screen.getByRole('tab', { name: 'Sites' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('says the speed is being kept once the site has an entry', async () => {
    answerPopupState('youtube.com', 1.5)
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    render(<App />)

    expect(
      await screen.findByText('1.5× remembered for youtube.com'),
    ).toBeInTheDocument()
  })

  /**
   * The service worker debounces the write by a second. This line used to read
   * the stored map, so for that second the panel printed one speed in the
   * readout and a different one directly under it — on the one screen whose
   * job is to say what speed this site plays at. The stored entry still picks
   * the tense; the number is the readout's.
   */
  it('names the speed the tab is at, not the one still in the debounce', async () => {
    answerPopupState('youtube.com', 1.75)
    seedDomains({ 'youtube.com': { speed: 1.25, updatedAt: 1 } })
    render(<App />)

    expect(
      await screen.findByText('1.75× remembered for youtube.com'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/1\.25× remembered/)).toBeNull()
  })

  // The same thing as it actually happens: a step, and no window in which the
  // two lines disagree.
  it('keeps the readout and the receipt on the same number through a step', async () => {
    const user = userEvent.setup()
    answerPopupState('youtube.com', 1.5)
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })

    // The service worker's answer to an intent. Its write to the domain map is
    // a second away and is not made here, which is exactly the window this is
    // about.
    getChromeMock().runtime.sendMessage.mockImplementation(
      (message: unknown, callback?: (response?: unknown) => void) => {
        const sent = message as { type?: string }

        if (sent.type === 'rebobinate:popup-state') {
          callback?.({ speed: 1.5, hasVideo: true, domain: 'youtube.com' })
          return
        }

        if (sent.type === 'rebobinate:intent') {
          callback?.({ speed: 1.6 })
          return
        }

        callback?.()
      },
    )

    render(<App />)
    await screen.findByText('1.5× remembered for youtube.com')

    await user.click(screen.getByRole('button', { name: 'Faster' }))

    expect(screen.getByRole('status')).toHaveTextContent('1.6×')
    expect(
      screen.getByText('1.6× remembered for youtube.com'),
    ).toBeInTheDocument()
  })

  /**
   * The write is announced here and used to be undoable only from another tab,
   * where the user then had to work out which control reversed it. The Forget
   * beside the receipt sends what the Sites row's ✕ sends.
   */
  it('forgets the site from the receipt itself', async () => {
    const user = userEvent.setup()
    answerPopupState('youtube.com', 1.5)
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Forget' }))

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'rebobinate:forget-domain', domain: 'youtube.com' },
      expect.any(Function),
    )
  })

  it('says nothing while per-site memory is off', async () => {
    seedSettings({ rememberPerDomain: false })
    answerPopupState('youtube.com', 1.5)
    seedDomains({ 'youtube.com': { speed: 1.5, updatedAt: 1 } })
    render(<App />)

    expect(await screen.findByText(/faster/)).toBeInTheDocument()
    expect(screen.queryByText(/remembered for/)).toBeNull()
    expect(screen.queryByText(/are kept for/)).toBeNull()
  })

  it('says nothing on a page there is no domain for', async () => {
    answerPopupState(null, 1.5)
    render(<App />)

    expect(await screen.findByText(/faster/)).toBeInTheDocument()
    expect(screen.queryByText(/remembered for/)).toBeNull()
    expect(screen.queryByText(/are kept for/)).toBeNull()
  })

  // A marker means the opposite of a receipt: this site is being left out.
  it('says nothing on a site that is switched off', async () => {
    answerPopupState('vimeo.com', 1.5)
    seedDomains({ 'vimeo.com': { speed: 1, updatedAt: 1, never: true } })
    render(<App />)

    expect(await screen.findByText(/faster/)).toBeInTheDocument()
    expect(screen.queryByText(/remembered for/)).toBeNull()
    expect(screen.queryByText(/are kept for/)).toBeNull()
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
      screen.getByRole('button', {
        name: 'Stop remembering youtube.com',
      }),
    ).toBeEnabled()
  })

  it('has nothing to forget on a site it has not seen', async () => {
    answerPopupState('vimeo.com')
    await openSites()

    expect(screen.getByLabelText('Speed for vimeo.com')).toHaveValue('default')
    expect(
      screen.getByRole('button', {
        name: 'Stop remembering vimeo.com',
      }),
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

  // "Other" is a claim about this tab's site, and on a profile with nothing
  // stored it claims a first entry that does not exist.
  it('does not say "other" when there is no other', async () => {
    answerPopupState('vimeo.com')
    await openSites()

    expect(screen.getByText('No sites are remembered yet.')).toBeInTheDocument()
  })

  it('says "other" once this tab’s site is the only one stored', async () => {
    answerPopupState('vimeo.com')
    seedDomains({ 'vimeo.com': { speed: 1.5, updatedAt: 1 } })
    await openSites()

    expect(
      screen.getByText('No other site is remembered yet.'),
    ).toBeInTheDocument()
  })

  /**
   * A marker is a stored entry and the opposite of a memory, so choosing
   * "Never remember" for this tab used to flip the message into claiming the
   * site was remembered — at the moment the user had asked for the opposite.
   */
  it('does not call this tab remembered when it is switched off', async () => {
    answerPopupState('vimeo.com')
    seedDomains({ 'vimeo.com': { speed: 1, updatedAt: 1, never: true } })
    await openSites()

    expect(screen.getByText('No sites are remembered yet.')).toBeInTheDocument()
  })

  // The list is how an exclusion is undone, so a switched-off site is listed —
  // under a heading that counts rows rather than memories.
  it('lists another site that is switched off without calling it remembered', async () => {
    answerPopupState('vimeo.com')
    seedDomains({ 'other.example': { speed: 1, updatedAt: 1, never: true } })
    await openSites()

    expect(screen.getByText('Other sites (1)')).toBeInTheDocument()
    expect(screen.getByLabelText('Speed for other.example')).toHaveValue(
      'never',
    )
    expect(screen.queryByText(/remembered yet/)).toBeNull()
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

    await user.click(
      screen.getByRole('button', {
        name: 'Stop remembering youtube.com',
      }),
    )

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

    await user.click(
      screen.getByRole('button', {
        name: 'Start remembering vimeo.com again',
      }),
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

  /**
   * A dozen sites, oldest last, which is the shape the list is designed for
   * and the shape the two tests below need.
   */
  const twelveSites = () =>
    Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `site-${index}.example`,
        { speed: 1.5, updatedAt: index },
      ]),
    )

  const listedNames = () =>
    screen
      .getAllByRole('listitem')
      .map(row => row.querySelector('.site-name')?.textContent)

  /**
   * The list is ordered by when each site was last touched and setting a speed
   * touches one, so the row the user had their hand on used to travel to the
   * top the moment the write landed — off the top of a scrolled pane, taking
   * the only confirmation of what they had just chosen with it.
   */
  it('leaves an edited row where it was', async () => {
    answerPopupState(null)
    const seeded = twelveSites()
    seedDomains(seeded)
    const user = await openSites()

    const before = listedNames()
    expect(before[before.length - 1]).toBe('site-0.example')

    await user.selectOptions(
      screen.getByLabelText('Speed for site-0.example'),
      '2',
    )
    await workerWrote({
      ...seeded,
      'site-0.example': { speed: 2, updatedAt: 99 },
    })

    expect(listedNames()).toEqual(before)
    expect(screen.getByLabelText('Speed for site-0.example')).toHaveValue('2')
  })

  // A site that has never been listed is new to the pane, so it belongs at the
  // front rather than wherever the frozen order has no opinion about it.
  it('puts a site the list has not seen on the front', async () => {
    answerPopupState(null)
    const seeded = twelveSites()
    seedDomains(seeded)
    await openSites()

    await workerWrote({
      ...seeded,
      'brand-new.example': { speed: 2, updatedAt: 99 },
    })

    expect(listedNames()[0]).toBe('brand-new.example')
  })

  /**
   * The ✕ is a 20px button beside the dropdown and the row it clears leaves the
   * list, so a misclick used to cost a setting the pane could not re-enter: the
   * site is listed nowhere until it is next visited.
   */
  it('holds the slot of a dropped row and puts the row back', async () => {
    answerPopupState(null)
    seedDomains({
      'keep.example': { speed: 1.25, updatedAt: 2 },
      'drop.example': { speed: 1.75, updatedAt: 1 },
    })
    const user = await openSites()

    await user.click(
      screen.getByRole('button', { name: 'Stop remembering drop.example' }),
    )
    await workerWrote({ 'keep.example': { speed: 1.25, updatedAt: 2 } })

    expect(listedNames()).toEqual(['keep.example', 'drop.example'])
    expect(screen.queryByLabelText('Speed for drop.example')).toBeNull()
    // The entry really is gone, and the count says so before the undo is taken.
    expect(screen.getByText('Other sites (1)')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Undo dropping drop.example' }),
    )

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'rebobinate:set-domain-speed',
        domain: 'drop.example',
        speed: 1.75,
      },
      expect.any(Function),
    )
  })

  // A marker is not a speed, so putting one back is the other write.
  it('puts a dropped marker back as a marker', async () => {
    answerPopupState(null)
    seedDomains({
      'keep.example': { speed: 1.25, updatedAt: 2 },
      'off.example': { speed: 1, updatedAt: 1, never: true },
    })
    const user = await openSites()

    await user.click(
      screen.getByRole('button', {
        name: 'Start remembering off.example again',
      }),
    )
    await workerWrote({ 'keep.example': { speed: 1.25, updatedAt: 2 } })
    await user.click(
      screen.getByRole('button', { name: 'Undo dropping off.example' }),
    )

    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'rebobinate:set-domain-never',
        domain: 'off.example',
        never: true,
      },
      expect.any(Function),
    )
  })

  // The slot answers the list the user was looking at. Ask a different question
  // of it and the answer goes with it.
  it('drops the undo when the filter is retyped', async () => {
    answerPopupState(null)
    const seeded = twelveSites()
    seedDomains(seeded)
    const user = await openSites()

    await user.click(
      screen.getByRole('button', { name: 'Stop remembering site-3.example' }),
    )
    const { 'site-3.example': _dropped, ...rest } = seeded
    await workerWrote(rest)

    expect(
      screen.getByRole('button', { name: 'Undo dropping site-3.example' }),
    ).toBeInTheDocument()

    await user.type(screen.getByLabelText('Filter'), 'site-7')

    expect(
      screen.queryByRole('button', { name: 'Undo dropping site-3.example' }),
    ).toBeNull()
  })

  // The heading counts what is stored, which is the right thing for it to
  // count and the one number on the pane that a filter can put at odds with
  // the rows under it.
  it('says how much of the list the filter is showing', async () => {
    answerPopupState(null)
    seedDomains(twelveSites())
    const user = await openSites()

    expect(screen.getByText('Other sites (12)')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Filter'), 'site-1')

    expect(screen.getByText('Other sites (3 of 12)')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Filter'))
    await user.type(screen.getByLabelText('Filter'), 'gardening')

    expect(screen.getByText('Other sites (0 of 12)')).toBeInTheDocument()
    expect(screen.getByText('No site matches that filter.')).toBeInTheDocument()
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

  /**
   * The instruction and the refusal share one line, so the only thing that can
   * tell them apart is how the line is painted. jsdom has no cascade, so what
   * is asserted here is the hook the stylesheet hangs the colour on.
   */
  it('paints a refusal differently from the instruction it replaces', async () => {
    const user = await openSettings()
    const note = () =>
      document.querySelector('section.keys p.note') as HTMLElement

    await capture(user, 'Reset')

    expect(note()).toHaveTextContent('Press the key to bind')
    expect(note()).not.toHaveClass('note-refused')

    await user.keyboard('{+}')

    expect(note()).toHaveTextContent('+ is already faster.')
    expect(note()).toHaveClass('note-refused')
  })

  /**
   * The note is one element parked in the slot under whichever row is
   * listening, rather than one paragraph per row: three reserved lines would
   * cost more height than the message is worth, and inserting one on demand
   * would push the rows under it down. The slot is a flex `order`, so the row
   * order is `index * 2` and the note takes the odd number after its row.
   */
  it('parks its note in the slot under the row that is listening', async () => {
    const user = await openSettings()
    const note = document.querySelector('section.keys p.note') as HTMLElement

    expect(note.style.order).toBe('6')

    await capture(user, 'Faster')
    expect(note.style.order).toBe('1')

    await capture(user, 'Reset')
    expect(note.style.order).toBe('5')

    await user.keyboard('{Escape}')
    expect(note.style.order).toBe('6')
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

  /**
   * The default text colour is #ffffff on a Canvas pane, so the panel opens
   * with a saturation track running white to white and a swatch the same shape
   * and colour as an empty text input. Words are what carry the value there.
   */
  it('names every channel on screen, not only to a screen reader', async () => {
    const user = await openSettings()

    const picker = await openPicker(user, 'Text color')

    for (const channel of ['Hue', 'Saturation', 'Lightness']) {
      expect(within(picker).getByText(channel)).toBeInTheDocument()
      expect(within(picker).getByLabelText(channel)).toBeInTheDocument()
    }
  })

  // Re-clicking the swatch closes the panel, but the ring on it reads as "this
  // is the one being edited" rather than as "press me again".
  it('closes from inside the panel', async () => {
    const user = await openSettings()

    const picker = await openPicker(user, 'Text color')

    await user.click(
      within(picker).getByRole('button', { name: 'Close Text color picker' }),
    )

    expect(
      screen.queryByRole('group', { name: 'Text color picker' }),
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

  /**
   * The colour rows were the only badge rows stating no value at all. With the
   * default white text on a Canvas pane, that left a control whose whole job
   * is to show a colour rendering as an empty box the shape of a text input.
   */
  it('writes the hex of each colour next to its swatch', async () => {
    await openSettings()

    expect(screen.getByText('#ffffff')).toBeInTheDocument()
    expect(screen.getByText('#000000')).toBeInTheDocument()
  })

  it('follows the slider it belongs to', async () => {
    await openSettings()

    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '22' } })

    expect(screen.getByText('22px')).toBeInTheDocument()
  })

  /**
   * The corner grid was the one child of the block that survived the switch:
   * it carried `disabled` and no `hidden`, so it stayed on screen greyed out
   * while the sample, the sliders, the colour rows and the sentence all left.
   */
  it('collapses the whole block when the badge is turned off', async () => {
    const user = await openSettings()

    expect(screen.getByRole('button', { name: 'top-left' })).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'On-video badge' }))

    expect(screen.queryByRole('button', { name: 'top-left' })).toBeNull()
    expect(screen.queryByRole('slider', { name: 'Size' })).toBeNull()
  })

  // What is left after the collapse is a switch and a foreign toggle. The line
  // is the only thing on screen that says the settings are still there.
  it('says the settings are kept, and only once they are out of sight', async () => {
    const user = await openSettings()

    const kept = screen.getByText('Size, colours and timing are kept.')
    expect(kept).not.toBeVisible()

    await user.click(screen.getByRole('checkbox', { name: 'On-video badge' }))

    expect(kept).toBeVisible()
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

  /**
   * The one live region the section has. Scoped, because the sliders on the
   * same tab report through `<output>` and carry the same implicit role.
   */
  const backupStatus = () =>
    document.querySelector('.backup p[role="status"]') as HTMLElement

  // The pair arrives on Export, so a click is what a person does to get to the
  // *other* half.
  const openBackup = async (button: 'Export' | 'Import') => {
    const user = userEvent.setup()
    render(<App />)
    await openTab(user, 'Settings')

    await user.click(screen.getByRole('button', { name: button }))

    return user
  }

  // Two outlined buttons at the bottom of a long scroll do not read as a
  // switch until one of them is filled in.
  it('arrives with the read-only half already chosen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await openTab(user, 'Settings')

    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('Backup')).toBeInTheDocument()
  })

  /**
   * The pair is styled as a segmented control, which is the grammar of a
   * choice that always has an answer. It used to collapse: pressing the chosen
   * half again left neither chosen and took the panel away with it.
   */
  it('stays on the half that is already chosen', async () => {
    const user = await openBackup('Export')

    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(screen.getByLabelText('Backup')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  // A restore leaves the pair on Export, which is where the settings that were
  // just restored can be read back.
  it('goes back to the readable half once a backup is restored', async () => {
    const user = await openBackup('Import')

    await user.click(screen.getByLabelText('Backup to restore'))
    await user.paste(
      JSON.stringify({
        format: 'rebobinate-backup',
        version: 1,
        settings: { ...DEFAULT_SETTINGS, step: 0.5 },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Replace settings' }))

    expect(screen.getByLabelText('Backup')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Restored your settings. Your remembered sites are kept.',
      ),
    ).toBeInTheDocument()
  })

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

  /**
   * The largest irreversible action in the product, made reversible with what
   * the section already had: the export box is the serialization of what is
   * live, and at the moment Replace settings is pressed it still describes
   * what is about to be replaced.
   */
  it('puts back what a restore replaced', async () => {
    const user = await openBackup('Import')

    await user.click(screen.getByLabelText('Backup to restore'))
    await user.paste(
      JSON.stringify({
        format: 'rebobinate-backup',
        version: 1,
        settings: { ...DEFAULT_SETTINGS, step: 0.5 },
        domains: {
          schemaVersion: DOMAINS_SCHEMA_VERSION,
          entries: { 'restored.example': { speed: 2, updatedAt: 3 } },
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Replace settings' }))

    expect(storedSettings().step).toBe(0.5)

    await user.click(screen.getByRole('button', { name: 'Undo restore' }))

    expect(storedSettings().step).toBe(0.25)
    // The same road back: the snapshot goes through the same import the paste
    // did, so the map is the service worker's to write either way.
    expect(getChromeMock().runtime.sendMessage).toHaveBeenCalledWith(
      {
        type: 'rebobinate:import-domains',
        store: {
          schemaVersion: DOMAINS_SCHEMA_VERSION,
          entries: { 'vimeo.com': { speed: 1.75, updatedAt: 7, never: false } },
        },
      },
      expect.any(Function),
    )
    expect(backupStatus()).toHaveTextContent(
      'Put back the settings and sites from before the restore.',
    )
    expect(screen.queryByRole('button', { name: 'Undo restore' })).toBeNull()
  })

  /**
   * A place rather than a countdown, the rule the dropped row's Undo on the
   * Sites tab already follows. Leaving the pair is leaving the place.
   */
  it('spends the undo when the pair is switched back to Import', async () => {
    const user = await openBackup('Import')

    await user.click(screen.getByLabelText('Backup to restore'))
    await user.paste(
      JSON.stringify({
        format: 'rebobinate-backup',
        version: 1,
        settings: { ...DEFAULT_SETTINGS, step: 0.5 },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Replace settings' }))

    expect(
      screen.getByRole('button', { name: 'Undo restore' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(screen.queryByRole('button', { name: 'Undo restore' })).toBeNull()
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

  // "all 0 remembered sites" on a fresh profile describes a loss that cannot
  // happen, which is the half of the sentence a reader weighs.
  it('does not count a list that does not exist yet', async () => {
    getChromeMock().storage.local.seed({
      [DOMAINS_STORAGE_KEY]: {
        schemaVersion: DOMAINS_SCHEMA_VERSION,
        entries: {},
      },
    })
    await openBackup('Import')

    expect(
      screen.getByText(
        'Replaces your settings. You have no remembered sites to lose.',
      ),
    ).toBeInTheDocument()
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

  /**
   * The refusal and the price share one line, so how it is painted is the only
   * thing that tells them apart — the same problem the key editor already
   * solved with `.note-refused`. jsdom has no cascade, so what is asserted is
   * the hook the stylesheet hangs the colour on.
   */
  it('paints the refusal differently from the price it replaces', async () => {
    const user = await openBackup('Import')
    const line = () => document.querySelector('.backup p.rule') as HTMLElement

    expect(line()).toHaveTextContent('Replaces your settings')
    expect(line()).not.toHaveClass('rule-refused')

    await user.click(screen.getByLabelText('Backup to restore'))
    await user.paste('{ half of a bac')

    expect(line()).toHaveTextContent('That is not valid JSON.')
    expect(line()).toHaveClass('rule-refused')
  })

  /**
   * A backup restores only what it carries, and a settings-only one leaves the
   * site list alone — which changes what the warning above it means. The quiet
   * tier under the warning's own, so a price and a preview do not read as one
   * sentence.
   */
  it('names what the paste holds, under what replacing it costs', async () => {
    const user = await openBackup('Import')

    await user.click(screen.getByLabelText('Backup to restore'))
    await user.paste(
      JSON.stringify({
        format: 'rebobinate-backup',
        version: 1,
        settings: DEFAULT_SETTINGS,
      }),
    )

    const preview = screen.getByText(
      'This backup holds settings only. Your remembered sites are kept.',
    )

    expect(preview).toHaveClass('note')
    expect(
      screen.getByText('Replaces your settings and the 1 remembered site.'),
    ).toBeInTheDocument()
  })

  it('counts the sites a whole backup would bring in', async () => {
    const user = await openBackup('Import')

    await user.click(screen.getByLabelText('Backup to restore'))
    await user.paste(
      JSON.stringify({
        format: 'rebobinate-backup',
        version: 1,
        settings: DEFAULT_SETTINGS,
        domains: {
          schemaVersion: DOMAINS_SCHEMA_VERSION,
          entries: {
            'a.test': { speed: 2, updatedAt: 1 },
            'b.test': { speed: 1.5, updatedAt: 2 },
          },
        },
      }),
    )

    expect(
      screen.getByText('This backup holds your settings and 2 sites.'),
    ).toBeInTheDocument()
  })

  // "Restored." named neither of the two things it had just replaced.
  it('says in the past tense what the restore actually replaced', async () => {
    const user = await openBackup('Import')

    await user.click(screen.getByLabelText('Backup to restore'))
    await user.paste(
      JSON.stringify({
        format: 'rebobinate-backup',
        version: 1,
        settings: DEFAULT_SETTINGS,
        domains: {
          schemaVersion: DOMAINS_SCHEMA_VERSION,
          entries: { 'a.test': { speed: 2, updatedAt: 1 } },
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Replace settings' }))

    const said = backupStatus()

    expect(said).toHaveTextContent('Restored your settings and 1 site.')
    // The same element the copy reports through, so the live region is never
    // remounted with its text already in it.
    expect(said).toHaveClass('rule')
  })

  /**
   * At the foot of the section both messages printed two lines under the
   * button that produced them, past the paragraph explaining the box. One
   * element still, lifted rather than duplicated.
   */
  it('reports directly under the button that was pressed', async () => {
    await openBackup('Export')

    const actions = document.querySelectorAll('.backup .backup-actions')
    const said = backupStatus()

    // The mode pair is the first action row, the Copy button the second.
    expect(actions[1].nextElementSibling).toBe(said)
    expect(said.nextElementSibling).toHaveTextContent(
      'Paste it into Import on your other computer.',
    )
  })

  /**
   * Two words on two buttons do not say that the text one produces is what the
   * other wants. Each half names the other, since the two are used on
   * different computers and never at the same time.
   */
  it('says on each half where the other one is', async () => {
    await openBackup('Export')

    expect(
      screen.getByText(/Paste it into Import on your other computer\./),
    ).toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Import' }))

    expect(screen.getByLabelText('Backup to restore')).toHaveAttribute(
      'placeholder',
      'Paste a backup from Export on your other computer',
    )
  })

  // The reason this pane is two textareas rather than a download and a file
  // input: on Gecko either one closes the popup before it can finish.
  it('offers no file input', async () => {
    await openBackup('Export')

    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})
