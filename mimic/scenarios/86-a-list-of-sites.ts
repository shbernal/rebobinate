import type { Page } from '@playwright/test'
import {
  look,
  metaOf,
  openVideoPage,
  panelHeight,
  paneOverflows,
  scrollPaneToTop,
  type Ctx,
  type SeedSite,
} from '../page.ts'

/**
 * The Sites tab with a real list in it, being worked rather than read.
 *
 * Every other exhibit of this tab shows it holding one row or none, because
 * every other exhibit builds its state by clicking and one capture only ever
 * visits one site. That is a fair picture of a first week and a poor picture of
 * the tab: what it is designed for is a profile that has accumulated sites, and
 * three of the four things it does then are movement.
 *
 * The list arrives most recently touched first and then holds that order for as
 * long as the tab is open, so setting a speed leaves the row where the hand
 * that set it can still see it, and the next visit sorts afresh. Both halves of
 * that are temporal: a still of a row that did not move is indistinguishable
 * from a list that has no ordering at all, and the re-sort only exists in the
 * gap between two visits.
 *
 * The filter is the same kind of claim twice over. A dozen rows narrowing to
 * three under a box being typed into is a list answering per character, and a
 * query that matches nothing replaces the rows with a sentence. Neither reads as
 * a response to typing in a pair of frames.
 *
 * And the ✕ removes a row from the middle of the list, which is the only
 * destructive control on this tab and asks for no confirmation. What it leaves
 * in the row's place is a line offering the write back, which is a thing with a
 * lifetime rather than a state.
 *
 * This is the first scenario to seed storage rather than click it into being.
 * `mimic.config.ts` carries the rule that licence runs under; the short version
 * is that it may stand in for a dozen browsing sessions and for nothing else.
 * Every claim below is still produced by clicking, and the ✕ here deletes a
 * genuine entry.
 *
 * Filmed through `openPanel`, so it claims nothing about the page behind the
 * panel beyond it being a real site — which is the one that shows up under
 * "This tab", unremembered, above the list this is about. The window is the
 * height the panel tops out at, which this tab reaches, so the pane scrolls.
 */

/**
 * A profile's worth of sites, newest first. Twelve, because the filter box only
 * appears from eight up and a list that fits the pane whole would make the
 * scrolling and the narrowing under the filter both unreadable.
 *
 * None of them is 1.0×: an entry at the default reads in the row as an ordinary
 * speed and in the dropdown as the option that clears the row, and a list where
 * those are the same number teaches nothing. One is a "Never remember", which is
 * a stored decision rather than a stored speed and is listed for the same reason
 * — it is the only way back out of one.
 */
const SEEDED: SeedSite[] = [
  { domain: 'conference-talks.test', speed: 1.5 },
  { domain: 'screencast.test', speed: 1.75 },
  { domain: 'guitar-lessons.test', speed: 0.75 },
  { domain: 'film-club.test', speed: 1.25 },
  { domain: 'cooking-school.test', speed: 1.5 },
  { domain: 'podcast-video.test', speed: 2 },
  { domain: 'language-lab.test', speed: 0.5 },
  { domain: 'yoga-class.test', speed: 0.75 },
  { domain: 'lecture-hall.test', speed: 1.25 },
  { domain: 'broadcast-news.test', never: true },
  { domain: 'archive-reel.test', speed: 1.75 },
  { domain: 'workshop-stream.test', speed: 1.5 },
]

/** Matches three of the twelve, and none of the `.test` every domain ends in. */
const QUERY = 'cast'
const MATCHES = ['screencast.test', 'podcast-video.test', 'broadcast-news.test']

/**
 * The row that is edited: the oldest of the twelve, at the very foot of the
 * list, so that "it stayed where it was" and "it went to the top" are as far
 * apart as this list can put them.
 */
const OLDEST = 'workshop-stream.test'

/** The row that goes: one from the middle, where a removal is hardest to miss. */
const DROPPED = 'film-club.test'

/**
 * The second `ul.sites` on the tab. The first holds the one row for the tab
 * behind the panel, which is not part of the list and never moves.
 */
const listed = (panel: Page): Promise<string[]> =>
  panel.locator('ul.sites').nth(1).locator('.site-name').allInnerTexts()

/** Which of those names still has a live row rather than a line about one. */
const liveRows = (panel: Page): Promise<number> =>
  panel.locator('ul.sites').nth(1).locator('select.site-speed-select').count()

export default {
  id: 'a-list-of-sites',
  title: 'Working a list of remembered sites',
  intent:
    'Someone who has been using this for a while wants to go through the sites it has remembered speeds for: find one among a dozen, change what it starts at, and drop one they no longer want kept.',
  video: true,

  async run(s: Ctx) {
    await metaOf(s).seedDomains(SEEDED)
    await openVideoPage(s.context)

    const panel = await metaOf(s).openPanel()
    s.use(panel)
    await panel.waitForTimeout(1200)

    const sitesTab = panel.getByRole('tab', { name: 'Sites' })
    await sitesTab.click()
    await panel.waitForTimeout(700)

    const heading = panel.locator('.pane-heading', { hasText: 'Other sites' })
    const filter = panel.locator('#site-filter')
    await filter.waitFor()

    const opened = await listed(panel)
    if (opened.join() !== SEEDED.map(site => site.domain).join()) {
      throw new Error(
        `the list opened as ${opened.join(', ')}, not in the order the sites were last touched`,
      )
    }

    if (!(await paneOverflows(panel))) {
      throw new Error(
        'the pane holds the whole list without scrolling, so the frame is not the one the caption describes',
      )
    }

    const tall = await panelHeight(panel)
    await scrollPaneToTop(panel)

    await look(
      s,
      panel,
      `The Sites tab on a profile that has been used for a while, at the top of it and not scrolled. A "Default speed" of 1.0× and a "Remember per site" switch, then "This tab" with a single row for the site behind the panel — player.test, at "Use default (1.0×)", with a greyed-out ✕ beside it because there is nothing stored for it to drop. Then a rule, and "Other sites (${opened.length})" with a Filter box under it and the list itself: one row per site, the domain in a monospaced face on the left, what it starts at in a dropdown on the right, and a ✕ after that. The order is most recently used first rather than alphabetical. The list runs past the bottom of the panel — the last row on screen is cut by the edge and the rows above it fade down into it, which is this panel's way of saying there is more.`,
      { name: 'list', mustShow: filter },
    )

    // Typed rather than filled, because what the box does is answer per
    // character and a value set in one go is a different thing on screen.
    await filter.click()
    await filter.pressSequentially(QUERY, { delay: 220 })
    await panel.waitForTimeout(600)

    const narrowed = await listed(panel)
    if (narrowed.join() !== MATCHES.join()) {
      throw new Error(
        `"${QUERY}" left ${narrowed.join(', ')} rather than ${MATCHES.join(', ')}`,
      )
    }

    const narrowedHeading = (await heading.textContent()) ?? ''
    if (!narrowedHeading.includes(`(${narrowed.length} of ${opened.length})`)) {
      throw new Error(
        `under "${QUERY}" the heading reads "${narrowedHeading}", not both counts`,
      )
    }

    // The pane is held at the height it had while the box is in use, so the
    // window cannot resize under the typing. Both halves are asserted: the
    // panel is the height it was, and the list is now short enough that
    // without the floor it would not be.
    const narrowedTall = await panelHeight(panel)
    if (narrowedTall !== tall) {
      throw new Error(
        `the panel is ${narrowedTall}px under the filter and was ${tall}px before it, so it moved under the typing`,
      )
    }

    if (await paneOverflows(panel)) {
      throw new Error(
        `"${QUERY}" left the pane still overflowing, and the caption says the cut edge has gone`,
      )
    }

    await scrollPaneToTop(panel)

    await look(
      s,
      panel,
      `"${QUERY}" has been typed into the Filter box, four characters, and the list under it is now ${narrowed.length} rows rather than ${opened.length} — ${narrowed.join(', ')}, every one of them with those four letters somewhere in the middle of the name. The match is on any part of the domain and not only its start. The heading above now reads "${narrowedHeading.trim()}": what is showing, and what is remembered. The panel has not changed size — it is the same ${tall}px it was with all ${opened.length} rows in it, deliberately, so that a window does not jump on every keystroke — but the list inside no longer runs past the bottom, so the cut edge and the fade under it have both gone and there is bare pane under the last row.`,
      { name: 'filtered', mustShow: heading },
    )

    // The other half of a filter: what it says when it has nothing to show.
    await filter.click()
    await panel.keyboard.press('ControlOrMeta+a')
    await filter.pressSequentially('gardening', { delay: 120 })
    await panel.waitForTimeout(600)

    const note = panel.locator('p.note', { hasText: 'filter' })
    const said = (await note.textContent()) ?? ''
    if (said !== 'No site matches that filter.') {
      throw new Error(`the empty list says "${said}"`)
    }

    if ((await panel.locator('ul.sites').count()) !== 1) {
      throw new Error('a list is still rendered under an empty filter')
    }

    const emptyHeading = (await heading.textContent()) ?? ''
    await scrollPaneToTop(panel)

    await look(
      s,
      panel,
      `A site that is not in the list has been searched for: "gardening", typed over the previous query. Every row has gone and one line of small grey text has taken their place — "${said}" — so the tab says why it is empty rather than simply being empty. The heading has counted down with it, to "${emptyHeading.trim()}", and the Filter box still holds the query; those two are what make the sentence readable as an answer to what was typed rather than as the state of the profile.`,
      { name: 'no-match', mustShow: note },
    )

    await filter.click()
    await panel.keyboard.press('ControlOrMeta+a')
    await panel.keyboard.press('Backspace')
    await panel.waitForTimeout(600)

    if ((await listed(panel)).length !== SEEDED.length) {
      throw new Error('clearing the filter did not bring the whole list back')
    }

    // The oldest row, at the foot of the list, given a new speed. The list is
    // ordered by when a site was last touched and this is the edit that would
    // reorder it — so it is the edit that proves the order is being held.
    const wasAt = (await listed(panel)).indexOf(OLDEST)
    const edited = panel.locator('ul.sites').nth(1).locator('li.site').last()
    await panel
      .getByLabel(`Speed for ${OLDEST}`, { exact: true })
      .selectOption('2')
    await panel.waitForTimeout(1000)

    const after = await listed(panel)
    const nowAt = after.indexOf(OLDEST)

    if (nowAt !== wasAt) {
      throw new Error(
        `${OLDEST} was row ${wasAt + 1} and is now row ${nowAt + 1}, so the list moved under the edit`,
      )
    }

    if (after.join() !== opened.join()) {
      throw new Error('setting a speed changed the list, not only that row')
    }

    await look(
      s,
      panel,
      `The dropdown on ${OLDEST} — the last of the ${opened.length} rows, at the very foot of the list, which is where the pane is scrolled to here — has been set to 2.0×, and the row has stayed exactly where it was: row ${nowAt + 1} of ${after.length}, with the same rows above it in the same order. The list is ordered most recently used first and setting a speed counts as using it, so this row is now the most recently used of the ${opened.length}; it is being held in place anyway, for as long as this tab is open, so that the row somebody has their hand on does not leave for the top while they are reading the answer.`,
      { name: 'held', mustShow: edited },
    )

    // Leaving the tab is what ends the hold, so the ordering is only observable
    // across two visits.
    await panel.getByRole('tab', { name: 'Speed' }).click()
    await panel.waitForTimeout(500)
    await sitesTab.click()
    await panel.waitForTimeout(700)

    const revisited = await listed(panel)
    if (revisited[0] !== OLDEST) {
      throw new Error(
        `coming back to the tab left ${revisited[0]} at the top rather than ${OLDEST}`,
      )
    }

    const moved = panel.locator('ul.sites').nth(1).locator('li.site').first()
    await scrollPaneToTop(panel)

    await look(
      s,
      panel,
      `The Speed tab was visited and this one came back to — two clicks, and nothing on the list was touched in between. ${OLDEST}, which was the last row a moment ago and stayed the last row when its speed was set, is now the first: the order is worked out afresh each time the tab is opened, and by that reckoning the site whose speed was just changed is the most recently used of the ${revisited.length}. Everything else has shifted down one to make room. So the list does sort itself, and it does it between visits rather than under the hand that caused it.`,
      { name: 'resorted', mustShow: moved },
    )

    await panel
      .getByRole('button', { name: `Stop remembering ${DROPPED}` })
      .click()
    await panel.waitForTimeout(900)

    if ((await liveRows(panel)) !== SEEDED.length - 1) {
      throw new Error(`the ✕ left a live row for ${DROPPED}`)
    }

    const undo = panel.getByRole('button', { name: `Undo dropping ${DROPPED}` })
    if (!(await undo.isVisible())) {
      throw new Error(`nothing was offered to put ${DROPPED} back`)
    }

    const count = (await heading.textContent()) ?? ''
    if (!count.includes(`(${SEEDED.length - 1})`)) {
      throw new Error(
        `the heading reads "${count}" over ${SEEDED.length - 1} remembered sites`,
      )
    }

    await look(
      s,
      panel,
      `The ✕ at the end of the ${DROPPED} row has been clicked once. It asked nothing first: the entry is gone, and the heading has already counted itself down to "${count.trim()}" to say so. What is left in the row's own slot, in the same place in the list, is a quiet line — the domain in grey with an "Undo" beside it and no dropdown or ✕ — so the row is not there any more but its place still is. That line is a place rather than a period; it has no countdown on it, and it stands until another row is dropped, the filter is retyped, or this tab is left. The ✕'s own tooltip says what the click does in those words: "Stop remembering ${DROPPED}".`,
      { name: 'dropped', mustShow: undo },
    )

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel and the height the panel tops out at, so the panel fills the frame and the list inside it scrolls rather than the window growing. In order: the Sites tab is picked on a profile holding ${opened.length} remembered sites and the list runs off the bottom of the pane; "${QUERY}" is typed into the Filter box a character at a time and the list narrows to ${MATCHES.length} rows as it is typed, while the panel stays exactly the height it was; "gardening" is typed over that and every row is replaced by one line saying no site matches; the box is emptied and all ${opened.length} come back; the dropdown on ${OLDEST}, the last row in the list, is set to 2.0× and that row does not move; the Speed tab is visited and this one returned to, and now that row is at the top; and finally the ✕ on ${DROPPED} takes that row out of the middle, leaving a line in its slot offering it back and dropping the count in the heading by one. The thing to watch is where the list moves and when: not under the edit, and not under the typing, but on the way back in.`,
    )
  },
}
