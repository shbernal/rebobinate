import type { Page } from '@playwright/test'
import { look, metaOf, openVideoPage, type Ctx } from '../page.ts'

/**
 * The tab the panel opens on, being used for what it is for.
 *
 * `20-speed-stepping` covers the same controls as stills and reaches the same
 * end state, and it is the gap between those two facts that this scenario is
 * about. Two things happen here that a still cannot hold.
 *
 * The first is the receipt. Stepping the speed writes a rule against the site,
 * and the service worker debounces that write by a second — so for a second
 * after the last click the line under the buttons still reads the promise, and
 * then it rewrites itself into a receipt naming the speed and grows a Forget
 * beside it. A still taken before is a different screen from a still taken
 * after, and nothing in either says the panel changed on its own a second
 * later. That delay is deliberate and legible, and a judge should get to see it
 * arrive rather than be told about it. The row is as tall as the button
 * whether or not the button is in it, so what arrives is the control and not
 * eight pixels of panel; that is asserted here rather than described, since a
 * window growing under a hand that has stopped moving is the other thing only
 * a recording can show.
 *
 * The second is the two ways to the same number. Six presets sit under a pair
 * of steppers, and 1.5× is one click on a chip or five on the plus. A recording
 * of both in a row is the only honest way to ask whether the chips read as the
 * shortcut they are.
 *
 * Filmed through `openPanel` — the real popup cannot be recorded — so the
 * scenario claims nothing about the page behind it beyond it being a real site
 * the panel reads a domain from, which is what the sentence under the buttons
 * names. The window is the height of this tab rather than of the tallest, since
 * this scenario never leaves it.
 */

/** The panel's own height, which the arrival of the receipt is not allowed to move. */
const panelHeight = (panel: Page): Promise<number> =>
  panel
    .locator('main.popup')
    .evaluate(node => Math.round(node.getBoundingClientRect().height))

export default {
  id: 'setting-a-speed',
  title: 'Setting a speed from the panel, and being told it was kept',
  intent:
    'Someone wants this site to play at one and a half times normal. They want to set it without hunting, and to know afterwards whether it stuck or whether they will be doing this again tomorrow.',
  video: true,

  async run(s: Ctx) {
    // A real site behind the panel, which is what puts a domain in the sentence
    // under the buttons. Nothing here is about that page.
    await openVideoPage(s.context)

    const panel = await metaOf(s).openPanel()
    s.use(panel)
    await panel.waitForTimeout(1200)

    const readout = panel.locator('.readout')
    const promise = panel.locator('.memory-link')
    await promise.waitFor()

    await look(
      s,
      panel,
      'The panel as it opens, on Speed, over a site playing a talk. The large "1.0×" in the middle is how fast that site is currently playing, with a minus and a plus either side of it and a Reset under them. The row of six speeds below goes straight to a speed rather than stepping to it. The underlined line at the foot names the site behind the panel and says speeds set here are kept for it — a promise about what will happen, not a record of anything that has. The line is itself a button, and leads to the Sites tab where the rule can be changed for every site rather than this one. Nothing sits beside it yet.',
      { name: 'opened', mustShow: promise },
    )

    // Five clicks on the plus, the long way to a number the row below reaches in
    // one. Five and not two, because the comparison is the point.
    for (let click = 0; click < 5; click += 1) {
      await panel.getByRole('button', { name: 'Faster' }).click()
      await panel.waitForTimeout(90)
    }

    if ((await readout.textContent()) !== '1.5×') {
      throw new Error(
        `five clicks on the plus left the readout at ${await readout.textContent()}, not 1.5×`,
      )
    }

    // Deliberately before the write lands: the panel is mid-promise here, and
    // the frame after this one is what shows it settling.
    await look(
      s,
      panel,
      'The plus has been clicked five times, one after another, and the readout has walked up to "1.5×" — five clicks, because the extension moves in steps of 0.1 out of the box. The line at the foot has not changed yet: it is still the underlined promise about speeds being kept for the site, with nothing beside it.',
      { name: 'stepped', mustShow: readout },
    )

    // Read while the line is still the promise, so the frame after this one
    // can say whether the panel moved when the receipt landed in it.
    const promised = await panelHeight(panel)

    // The service worker debounces the write by a second. Waited out rather
    // than slept past, so the caption below cannot describe a receipt that is
    // not there.
    const receipt = panel.locator('.memory .rule')
    const forget = panel.getByRole('button', { name: 'Forget' })
    await forget.waitFor({ timeout: 5000 })

    const kept = await receipt.textContent()
    if (kept === null || !kept.startsWith('1.5× remembered for ')) {
      throw new Error(`the receipt reads "${kept ?? ''}"`)
    }

    const withReceipt = await panelHeight(panel)

    if (withReceipt !== promised) {
      throw new Error(
        `the panel is ${withReceipt}px with the receipt in it and was ${promised}px with the promise, so it moved a second after the clicking stopped`,
      )
    }

    await look(
      s,
      panel,
      `About a second after the last click, with nothing touched in between, the line at the foot rewrote itself. It now reads "${kept}" — a record of what is stored rather than a promise about what will be — and a Forget button has appeared beside it, which is the way to undo the thing the panel has just announced. The panel is the same ${withReceipt}px it was: the row was already as tall as that button, so what arrives is the button and not a taller window.`,
      { name: 'kept', mustShow: forget },
    )

    // The same number the other way round, so the two routes are in one
    // recording rather than in two exhibits nobody compares.
    await panel.getByRole('button', { name: 'Forget' }).click()
    await panel.waitForTimeout(900)
    await panel.getByRole('button', { name: '2.0×', exact: true }).click()
    await panel.waitForTimeout(400)

    if ((await readout.textContent()) !== '2.0×') {
      throw new Error(
        `the 2.0× chip left the readout at ${await readout.textContent()}`,
      )
    }

    await forget.waitFor({ timeout: 5000 })
    await look(
      s,
      panel,
      'Forget was pressed, which dropped what had just been stored and put the promise back. Then the last chip in the row of six was pressed once: the readout went straight from 1.5× to "2.0×" in one click rather than the five it would have taken on the plus, and the chip itself is now shown as the one in use. A second later the line at the foot has settled into a receipt again, this time naming 2.0×.',
      { name: 'chip', mustShow: panel.locator('.speed-presets') },
    )

    await panel.waitForTimeout(1200)

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel and a little over the height of this tab — the Speed tab is the shortest of the three and this scenario never leaves it, so the panel fills the frame bar a thin grey band along the bottom, which is the window it is being filmed in rather than the panel. In order: the panel opens showing 1.0× and an underlined line promising that speeds set here are kept for the site; the plus is clicked five times and the readout walks up to 1.5× while that line stays a promise; then, a second after the clicking stops and with nothing touched, the line rewrites itself into a receipt naming 1.5× and a Forget button appears beside it, with the panel holding at the ${withReceipt}px it already was. Forget is then pressed, which puts the promise back, and the 2.0× chip in the row of six is pressed once — one click to a number the plus took five to reach — after which the receipt returns naming 2.0×. The thing to watch for is the delay: the receipt is always about a second behind the last click, and it arrives on its own.`,
    )
  },
}
