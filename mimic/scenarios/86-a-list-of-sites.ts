import type { Page } from '@playwright/test'
import {
  look,
  metaOf,
  openVideoPage,
  paneContentHeight,
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
 * The list is ordered most recently touched first, so changing a row's speed
 * moves that row. A still of the list before and a still after are two orderings
 * with nothing between them to say the second was produced by a row travelling
 * rather than by the list being redrawn from scratch — and which of those it is
 * is the difference between a person being able to follow their own edit and
 * losing it.
 *
 * The filter is the same kind of claim twice over. A dozen rows narrowing to
 * three is a pane visibly shortening under the box being typed into, and a query
 * that matches nothing replaces the rows with a sentence. Neither reads as a
 * response to typing in a pair of frames.
 *
 * And the ✕ removes a row from the middle of the list, which is the only
 * destructive control on this tab and has no confirmation step.
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
 * scrolling and the shortening under the filter both unreadable.
 *
 * None of them is 1.0×: an entry at the default reads in the row as an ordinary
 * speed and in the ✕'s tooltip as the thing being returned to, and a list where
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

/** The row that travels: the oldest of the twelve, so it has furthest to go. */
const OLDEST = 'workshop-stream.test'

/** The row that goes: one from the middle, where a removal is hardest to miss. */
const DROPPED = 'film-club.test'

/**
 * The second `ul.sites` on the tab. The first holds the one row for the tab
 * behind the panel, which is not part of the list and never moves.
 */
const listed = (panel: Page): Promise<string[]> =>
  panel.locator('ul.sites').nth(1).locator('.site-name').allInnerTexts()

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

    await panel.getByRole('tab', { name: 'Sites' }).click()
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

    const full = await paneContentHeight(panel)
    await scrollPaneToTop(panel)

    await look(
      s,
      panel,
      `The Sites tab on a profile that has been used for a while, at the top of it and not scrolled. A "Default speed" of 1.0× and a "Remember per site" switch, then "This tab" with a single row for the site behind the panel — player.test, at "Use default (1.0×)", with a greyed-out ✕ beside it because there is nothing stored for it to undo. Then a rule, and "Other sites (${opened.length})" with a Filter box under it and the list itself: one row per site, the domain in a monospaced face on the left, what it starts at in a dropdown on the right, and a ✕ after that. The order is most recently used first rather than alphabetical. The list runs past the bottom of the panel — the last row on screen is cut by the edge and the rows above it fade down into it, which is this panel's way of saying there is more.`,
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

    const shortened = full - (await paneContentHeight(panel))

    if (await paneOverflows(panel)) {
      throw new Error(
        `"${QUERY}" left the pane still overflowing, and the caption says the cut edge has gone`,
      )
    }

    await scrollPaneToTop(panel)

    await look(
      s,
      panel,
      `"${QUERY}" has been typed into the Filter box, four characters, and the list under it is now ${narrowed.length} rows rather than ${opened.length} — ${narrowed.join(', ')}, every one of them with those four letters somewhere in the middle of the name. The match is on any part of the domain and not only its start. The pane lost ${shortened}px doing it and no longer runs past the bottom of the panel, so the cut edge and the fade under the list have both gone. The heading above still reads "Other sites (${opened.length})", which counts what is remembered rather than what is showing.`,
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

    await scrollPaneToTop(panel)

    await look(
      s,
      panel,
      `A site that is not in the list has been searched for: "gardening", typed over the previous query. Every row has gone and one line of small grey text has taken their place — "${said}" — so the tab says why it is empty rather than simply being empty. The "Other sites (${opened.length})" heading and the Filter box holding the query are both still there, which is what makes the sentence readable as an answer to what was typed.`,
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
    // ordered by when a site was last touched, so this is the edit that moves.
    const wasAt = (await listed(panel)).indexOf(OLDEST)
    await panel
      .getByLabel(`Speed for ${OLDEST}`, { exact: true })
      .selectOption('2')
    await panel.waitForTimeout(1000)

    const after = await listed(panel)
    const nowAt = after.indexOf(OLDEST)

    if (nowAt !== 0) {
      throw new Error(
        `${OLDEST} was row ${wasAt + 1} and is now row ${nowAt + 1}, not the first`,
      )
    }

    if (after.length !== SEEDED.length) {
      throw new Error('changing a speed changed how many sites are listed')
    }

    const moved = panel.locator('ul.sites').nth(1).locator('li.site').first()
    await scrollPaneToTop(panel)

    await look(
      s,
      panel,
      `The dropdown on ${OLDEST} — which was the last of the ${opened.length} rows, at the very foot of the list — has been set to 2.0×, and the row has moved to the top. Nothing else was touched and no other row changed its speed; they have each shifted down one to make room. This is the ordering doing what it says: the list is most recently used first, and setting a speed counts as using it. The scrolling area is showing the top of the list here, which is where the row travelled to.`,
      { name: 'moved', mustShow: moved },
    )

    const beforeDrop = await paneContentHeight(panel)
    await panel
      .getByRole('button', { name: `Back to the default speed for ${DROPPED}` })
      .click()
    await panel.waitForTimeout(900)

    const remaining = await listed(panel)
    if (remaining.includes(DROPPED)) {
      throw new Error(`the ✕ left ${DROPPED} in the list`)
    }

    const count = (await heading.textContent()) ?? ''
    if (!count.includes(`(${remaining.length})`)) {
      throw new Error(
        `the heading reads "${count}" over ${remaining.length} rows`,
      )
    }

    const lost = beforeDrop - (await paneContentHeight(panel))
    await scrollPaneToTop(panel)

    await look(
      s,
      panel,
      `The ✕ at the end of the ${DROPPED} row has been clicked once. The row is gone, with no confirmation asked for and nothing offered to put it back; the rows under it have closed up over the ${lost}px it occupied, and the heading has counted itself down to "${count}". What the ✕ does is drop what was remembered, so that site starts at the default again — which is what its tooltip says, "Back to the default speed for ${DROPPED}", rather than naming the deletion.`,
      { name: 'dropped', mustShow: heading },
    )

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel and the height the panel tops out at, so the panel fills the frame and the list inside it scrolls rather than the window growing. In order: the Sites tab is picked on a profile holding ${opened.length} remembered sites and the list runs off the bottom of the pane; "${QUERY}" is typed into the Filter box a character at a time and the list narrows to ${MATCHES.length} rows as it is typed, the pane shortening by ${shortened}px under it; "gardening" is typed over that and every row is replaced by one line saying no site matches; the box is emptied and all ${opened.length} come back; the dropdown on ${OLDEST}, the last row in the list, is set to 2.0× and that row travels to the top while the rest shift down; and finally the ✕ on ${DROPPED} removes that row and the count in the heading above drops by one. The two things to watch are both order: the list is arranged by when each site was last used, and the row that was edited moves rather than the list being redrawn.`,
    )
  },
}
