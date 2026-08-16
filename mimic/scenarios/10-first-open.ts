import { look, start, type Ctx } from '../page.ts'

/**
 * The naive first impression, and the exhibit a code-blind judge earns most on.
 * Write the narration as though the reader has never seen this before — for the
 * judge, that is literally true.
 *
 * Depends on live tab state: the panel is showing what it knows about the video
 * page behind it. Captured through the real popup, which leaves that page
 * active; the popup opened as a tab would be the active tab itself and would
 * show a different, untrue thing.
 */
export default {
  id: 'first-open',
  title: 'Opening it for the first time',
  intent:
    'Someone has just installed this and clicked its icon while watching a conference talk. They want to know what it is and what it can do for them.',
  needsLiveTabState: true,

  async run(s: Ctx) {
    const { popup } = await start(s)
    await look(
      s,
      popup,
      'This is the whole panel, exactly as it appears the first time someone clicks the icon in the browser toolbar. Behind it is a page playing a 48-minute conference talk. Nothing has been set up or changed — this is what a new user sees.',
      { name: 'panel' },
    )

    await popup.getByRole('tab', { name: 'Sites' }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'This is the second of the three sections along the top, reached by clicking the word "Sites". It is about which speed each website should start at.',
      { name: 'sites' },
    )

    await popup.getByRole('tab', { name: 'Settings' }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'This is the third section, reached by clicking "Settings". The panel is now as tall as it can get, and this is only the top of the list — the rest is below and has to be scrolled to.',
      { name: 'settings' },
    )
  },
}
