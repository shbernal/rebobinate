import type { Page } from '@playwright/test'
import {
  insidePane,
  look,
  metaOf,
  offsetInPane,
  openVideoPage,
  paneOverflows,
  panelHeight,
  type Ctx,
} from '../page.ts'

/**
 * The line under the speed presets, which is a button, and where it goes.
 *
 * `84-setting-a-speed` films that line changing tense — promise to receipt —
 * and stays on the Speed tab throughout. This one never sets a speed. It is
 * about the other half of that line: while nothing is stored for the site, the
 * whole sentence is a button leading to the tab where the rule it describes is
 * set, and every still of it so far has been read as a sentence with a
 * decoration on it. A frame cannot say otherwise. A click and the tab change in
 * one continuous shot can.
 *
 * So the three things this films are all movement. The pointer going over the
 * line, where its underline thickens under the cursor. The click, where the
 * panel changes tab and grows. And what is on screen at the end of that —
 * because landing at the top of a tab and having to look for the row about the
 * site you came from is a different design from landing with that row in front
 * of you, and only the arrival says which one this is.
 *
 * Then the return leg, which is what makes the link's destination matter: the
 * row that is now on screen is set to "Never remember", and back on Speed the
 * line the person followed has gone — along with the whole slot it sat in.
 *
 * A few other sites are seeded so the arrival is a real question rather than a
 * rigged one; three, which is under the count that grows a filter box, so this
 * scenario shows the Sites tab as somebody who has used the extension a little
 * finds it. `86-a-list-of-sites` is the crowded version.
 *
 * Filmed through `openPanel`, so it claims nothing about the page behind the
 * panel beyond it being a real site the panel reads a domain from. The window
 * is the height of the Sites tab, which is the taller of the two visited, so on
 * Speed there is a band of grey window under the panel. That band is the
 * recorder and the narration says so.
 */

/** How the line is actually painted, which is the whole question about it. */
const linkPaint = (panel: Page) =>
  panel.locator('.memory-link').evaluate(node => {
    const style = getComputedStyle(node)

    return {
      line: style.textDecorationLine,
      style: style.textDecorationStyle,
      thickness: style.textDecorationThickness,
      cursor: style.cursor,
      color: style.color,
      /* What everything else on the tab is set in, so the line's own colour
         can be said to be a departure from it rather than merely named. */
      around: getComputedStyle(node.parentElement as HTMLElement).color,
    }
  })

/** The sites already remembered when this profile's owner opens the panel. */
const ELSEWHERE = [
  { domain: 'conference-talks.test', speed: 1.5 },
  { domain: 'guitar-lessons.test', speed: 0.75 },
  { domain: 'film-club.test', speed: 1.25 },
]

export default {
  id: 'following-the-link',
  title: 'Following the line under the speeds to the tab it names',
  intent:
    'Someone reading the Speed tab notices it says speeds are being kept for the site they are on, and wants to know where that is decided — and to change it for this site, having decided they would rather it were not kept at all.',
  video: true,

  async run(s: Ctx) {
    // Nothing is stored for this tab's own site, which is what leaves the line
    // in the tense that makes it a button. The other three are elsewhere.
    await metaOf(s).seedDomains(ELSEWHERE)
    await openVideoPage(s.context)

    const panel = await metaOf(s).openPanel()
    s.use(panel)
    await panel.waitForTimeout(1200)

    const link = panel.locator('.memory-link')
    await link.waitFor()

    const onSpeed = await panelHeight(panel)
    const resting = await linkPaint(panel)

    if (resting.line !== 'underline' || resting.style !== 'solid') {
      throw new Error(
        `the line is drawn ${resting.style} ${resting.line}, and the caption calls it a solid underline`,
      )
    }

    if (resting.color === resting.around) {
      throw new Error(
        `the line is set in ${resting.color}, the same colour as the text around it`,
      )
    }

    await look(
      s,
      panel,
      `The panel on the Speed tab, over a site playing a talk, with nothing yet remembered for it. Under the row of six speeds is a single line of small text: "Speeds set here are kept for player.test". It is underlined — a solid underline, the whole width of the sentence — and it is set in the system's own link colour, ${resting.color}, where every other word on the tab is ${resting.around}. It is the only thing on this tab that is neither a number, a button with a border, nor the grey key reminder at the foot.`,
      { name: 'line', mustShow: link },
    )

    // The pointer over it, which is the only answer the panel gives before it
    // is clicked, and one no still taken with the mouse elsewhere can contain.
    await link.hover()
    await panel.waitForTimeout(500)

    const hovered = await linkPaint(panel)

    if (hovered.cursor !== 'pointer') {
      throw new Error(
        `the pointer over the line is "${hovered.cursor}", not a hand`,
      )
    }

    if (hovered.thickness === resting.thickness) {
      throw new Error(
        `the underline stayed at ${resting.thickness} under the pointer, so nothing answered the hover`,
      )
    }

    await look(
      s,
      panel,
      `The pointer has been moved over that line and nothing else has happened. The line answered: its underline has thickened from ${resting.thickness} to ${hovered.thickness}, and the cursor over it is the hand a link gets rather than the arrow the rest of the panel gets. It is a button, and this is the panel saying so before it is pressed.`,
      { name: 'hover', mustShow: link },
    )

    await link.click()
    await panel.waitForTimeout(800)

    const sitesTab = panel.getByRole('tab', { name: 'Sites' })
    if ((await sitesTab.getAttribute('aria-selected')) !== 'true') {
      throw new Error('clicking the line did not move the panel to Sites')
    }

    const onSites = await panelHeight(panel)
    if (onSites <= onSpeed) {
      throw new Error(
        `the panel is ${onSites}px on Sites and was ${onSpeed}px on Speed, so it did not grow`,
      )
    }

    // The row the line was about, which is what the arrival is judged on.
    const thisTab = panel.locator('ul.sites').first().locator('li.site')
    const row = thisTab.first()

    if (await paneOverflows(panel)) {
      throw new Error(
        'the Sites tab arrived scrolling, and the caption says nothing had to be',
      )
    }

    if (!(await insidePane(row))) {
      throw new Error(
        'the row for the site the link named is not on screen on arrival',
      )
    }

    const at = await offsetInPane(row)

    await look(
      s,
      panel,
      `The line has been clicked once. The panel is on the Sites tab — the tab strip has moved its underline across, and everything under it has been replaced — and it has grown from ${onSpeed}px to ${onSites}px to fit what is here. Nothing was scrolled: this is the top of that tab. In order down it: a "Default speed" set to 1.0×, a "Remember per site" switch that is on, then a heading reading "This tab" with a single row under it — player.test, the site the line named, ${at}px down the pane and in plain sight rather than somewhere to be found. Its speed reads "Use default (1.0×)", which is the same fact the line stated in words. Below that, three other sites this profile has remembered.`,
      { name: 'arrived', mustShow: row },
    )

    // The reason for coming here. The row is a control, not a report.
    await panel
      .getByLabel('Speed for player.test', { exact: true })
      .selectOption({ label: 'Never remember' })
    await panel.waitForTimeout(900)

    const chosen = await panel
      .getByLabel('Speed for player.test', { exact: true })
      .inputValue()
    if (chosen !== 'never') {
      throw new Error(`the row for player.test reads "${chosen}"`)
    }

    await look(
      s,
      panel,
      'The dropdown on that row has been opened and "Never remember" picked out of it — the same list that otherwise holds "Use default" and the speeds. The row now reads that back, and the ✕ beside it has come alive, because there is now something stored for this site to undo. The rest of the tab has not moved.',
      { name: 'never', mustShow: row },
    )

    await panel.getByRole('tab', { name: 'Speed' }).click()
    await panel.waitForTimeout(900)

    if ((await panel.locator('.memory').count()) !== 0) {
      throw new Error('the line is still on the Speed tab after "never"')
    }

    const after = await panelHeight(panel)
    if (after >= onSpeed) {
      throw new Error(
        `the panel is ${after}px with the line gone and was ${onSpeed}px with it there, so it did not shrink`,
      )
    }

    await look(
      s,
      panel,
      `Back on the Speed tab. The line that started this is gone, and so is the space it occupied — the panel is ${after}px where it was ${onSpeed}px, and under the row of six speeds there is now nothing but the grey reminder of the three keys. Nothing else changed: the readout still says 1.0× and the speeds still work. What has gone is the extension's claim to be keeping anything for this site, which is exactly what was turned off one tab away.`,
      { name: 'gone', mustShow: panel.locator('.speed-presets') },
    )

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel and the height of the taller of the two tabs it visits — so on Speed the grey band under the panel is the window, tinted so it is not read as the panel having an empty bottom. In order: the panel opens on Speed with an underlined line under the six speeds naming the site, set in the system link colour rather than the panel's own text colour; the pointer moves onto that line and its underline thickens under the cursor, with no click yet; the line is clicked and the panel changes to the Sites tab and grows from ${onSpeed}px to ${onSites}px, arriving at the top of that tab with the row for that same site ${at}px down it; that row's dropdown is set to "Never remember"; and the Speed tab is picked again, where the line has gone entirely and the panel has shrunk to ${after}px. The thing to watch is the click: the line and the tab change are in one shot, so there is no gap in which the sentence could have been static text and the tab could have been picked by hand.`,
    )
  },
}
