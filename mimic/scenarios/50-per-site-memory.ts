import { look, metaOf, start, type Ctx } from '../page.ts'

/**
 * Depends on live tab state: the "This tab" row only means anything if the panel
 * is looking at the video page rather than at itself. This is one of the two
 * scenarios that the popup-opened-as-a-tab path would have quietly falsified.
 *
 * The speed is changed with the panel's own buttons rather than by messaging the
 * page. A speed poked straight at the page never reaches the part that writes
 * the memory down, so the panel would open again showing nothing and the
 * narration below would be describing something that had not happened.
 */
export default {
  id: 'per-site-memory',
  title: 'Getting a site to remember a speed',
  intent:
    'Someone always watches this particular site faster than normal and is tired of setting it every time. They want it to start out fast on its own.',
  needsLiveTabState: true,

  async run(s: Ctx) {
    const { popup } = await start(s)
    await popup.getByRole('tab', { name: 'Sites' }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "Sites" section, opened while a talk is playing on player.test in the tab behind. "This tab" means the site currently being watched, and no speed is shown against it yet.',
      { name: 'before' },
    )

    // Three presses of the panel's own button, then a wait: the speed is
    // written down a second after it stops changing, not on each press.
    await popup.getByRole('tab', { name: 'Speed' }).click()
    for (let press = 0; press < 3; press += 1) {
      await popup.getByRole('button', { name: 'Faster' }).click()
    }
    await popup.waitForTimeout(2000)

    const reopened = await metaOf(s).openPopup()
    s.use(reopened)
    await reopened.getByRole('tab', { name: 'Sites' }).click()
    await reopened.waitForTimeout(400)
    await look(
      s,
      reopened,
      'The "+" button was pressed three times, and then the panel was closed and opened again on the same page. The row under "This tab" now shows a speed against player.test.',
      { name: 'remembered' },
    )

    // "Never remember" is an option of the row's own dropdown rather than a
    // switch beside it, so saying it and saying a speed are the same gesture.
    await reopened
      .getByRole('combobox', { name: 'Speed for player.test' })
      .selectOption('never')
    await reopened.waitForTimeout(500)
    await look(
      s,
      reopened,
      'The dropdown on that row has been changed from a speed to "Never remember". It is the same dropdown a speed is chosen from, and it is how someone says this particular site should be left out of the memory altogether. Under it, the list of other sites says no sites are remembered yet, which is now true of player.test as well.',
      { name: 'never' },
    )
  },
}
