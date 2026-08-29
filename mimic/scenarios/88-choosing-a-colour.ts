import type { Locator, Page } from '@playwright/test'
import {
  insidePane,
  look,
  metaOf,
  offsetInPane,
  openVideoPage,
  paneContentHeight,
  pinned,
  wheelUntil,
  type Ctx,
} from '../page.ts'

/**
 * The picker, which is the one control here that is a panel rather than a row.
 *
 * The extension draws its own instead of using `<input type="color">`, because
 * on Firefox the native chooser takes focus and destroys the popup document
 * before anything is picked. That makes it the largest piece of bespoke design
 * in the product, and the two things it is designed around are both movement.
 *
 * It opens *inside* the pane, under both colour rows rather than under the row
 * that was clicked, so the pair the person is comparing stays on screen while
 * either one is edited. A still of the open panel cannot say whether the rows
 * were pushed off to make room for it. And one panel is shared: clicking the
 * second swatch while the first is open does not open a second panel, it
 * re-points this one, which in a still is indistinguishable from having opened
 * a different thing.
 *
 * The sample stuck at the top of the pane is the other half of it. Everything
 * done here — a preset, a slider, a typed code — lands on that sample as it is
 * done, and "as it is done" is the claim a recording exists to settle.
 *
 * The panel is filmed opening on the shipped #ffffff, where the Saturation
 * track runs white to white and renders as an empty bar with a dot on it, and
 * the preset is the first thing that gives the three tracks anything to show.
 * That order is deliberate: it is what a new user meets, and hiding it behind
 * a colour set off camera would be exhibiting a panel nobody opens.
 *
 * Filmed through `openPanel`, so it claims nothing about the page behind it.
 */

/** `rgb(...)` the way a computed style writes it, from the hex the panel shows. */
const asRgb = (hex: string): string =>
  `rgb(${[1, 3, 5]
    .map(at => Number.parseInt(hex.slice(at, at + 2), 16))
    .join(', ')})`

/**
 * What the sample at the top of the pane is actually painted in.
 *
 * The sample is what every claim in here rests on, and a claim that a colour
 * arrived somewhere is only worth filming if it can be false. Read computed
 * rather than from the props that set it, since a rule further down the
 * stylesheet overriding an inline colour is exactly the failure this would
 * otherwise film without noticing.
 */
const sampleColours = (
  panel: Page,
): Promise<{ text: string; background: string }> =>
  panel.locator('.preview-badge').evaluate(node => {
    const style = getComputedStyle(node)

    return { text: style.color, background: style.backgroundColor }
  })

/** The hex a row prints beside its swatch, which is the value in words. */
const rowHex = (row: Locator): Promise<string> =>
  row.locator('.field-value').innerText()

export default {
  id: 'choosing-a-colour',
  title: 'Choosing a colour for the marker',
  intent:
    'Someone finds the marker over their video hard to read against the picture behind it and wants to change what colour it is drawn in — and wants to see what a colour looks like before settling on it, rather than picking one and going back to the video to find out.',
  video: true,

  async run(s: Ctx) {
    // A real site behind the panel. Nothing here is about it; it is what keeps
    // the panel reading a live extension rather than defaults with no subject.
    await openVideoPage(s.context)

    const panel = await metaOf(s).openPanel()
    s.use(panel)
    await panel.waitForTimeout(1000)

    await panel.getByRole('tab', { name: 'Settings' }).click()
    await panel.waitForTimeout(600)

    const block = panel.locator('.badge-settings')
    const textRow = block.locator('.field').filter({ hasText: 'Text color' })
    const backRow = block
      .locator('.field')
      .filter({ hasText: 'Background color' })
    const picker = panel.locator('.color-picker')

    /**
     * Scrolled until the first colour row is directly under the pinned header,
     * rather than to a fixed number of notches. The picker opens below both
     * rows and is about 200px of a 440px pane, so where the rows are sitting
     * when it opens decides whether the frame can show the rows and the panel
     * at once — which is the whole claim this scenario makes about it.
     */
    const headerHeight = await panel
      .locator('.badge-header')
      .evaluate(node => Math.round(node.getBoundingClientRect().height))

    await wheelUntil(
      panel,
      async () => (await offsetInPane(textRow)) <= headerHeight + 26,
      'the colour rows, under the block header',
    )

    // Under the header, not behind it. The stop used to be a flat 120px, which
    // was that band measured against a shorter header — and when a line was
    // added to the header the same number put the first row underneath it,
    // where the frame's own caption stops being true.
    const textAt = await offsetInPane(textRow)

    if (textAt < headerHeight) {
      throw new Error(
        `the first colour row is behind the pinned header, not under it: ` +
          `row at ${textAt} in a header ${headerHeight}px tall`,
      )
    }

    if (!(await pinned(panel))) {
      throw new Error(
        'the marker block header is not stuck to the top of the pane',
      )
    }

    await look(
      s,
      panel,
      'The two colour rows in the block about the marker drawn over the video, scrolled up under that block\'s own header. The header has stopped at the top of the scrolling area and stays there: it carries the switch that turns the marker off and a live sample of the marker, drawn on a striped backdrop so that a white marker on it is still visible. Under it, "Text color" reads #ffffff and ends in a white square, and "Background color" reads #000000 and ends in a black one. Each square is a button, and each row prints its colour as a code as well as painting it — in a monospaced face, the same one the picker\'s own box uses further down, so the two places the same code appears are set in the same type. A white square on a white panel is still legible as a value.',
      { name: 'colours', mustShow: backRow },
    )

    const before = await paneContentHeight(panel)
    const scrolledBefore = await panel
      .locator('.pane')
      .evaluate(pane => Math.round(pane.scrollTop))
    await panel.getByRole('button', { name: 'Text color', exact: true }).click()
    await panel.waitForTimeout(600)

    const grew = (await paneContentHeight(panel)) - before

    if (!(await insidePane(textRow)) || !(await insidePane(backRow))) {
      // With the numbers, and with where the pane was standing. The rows only
      // leave the frame if something moved them, and "a row is off screen"
      // without saying whether the pane scrolled costs a whole re-capture to
      // find out which.
      throw new Error(
        `a colour row was pushed out of sight by the panel that opened under it: ` +
          `text at ${await offsetInPane(textRow)}, background at ${await offsetInPane(backRow)}, ` +
          `in a pane whose contents grew ${grew}px to ${await paneContentHeight(panel)}px, ` +
          `scrolled from ${scrolledBefore} to ${await panel
            .locator('.pane')
            .evaluate(pane => Math.round(pane.scrollTop))}`,
      )
    }

    const swatch = panel.getByRole('button', {
      name: 'Text color',
      exact: true,
    })
    if ((await swatch.getAttribute('aria-expanded')) !== 'true') {
      throw new Error(
        'the swatch that opened the panel does not say it is open',
      )
    }

    await look(
      s,
      panel,
      `The white square on the "Text color" row has been clicked once. A panel has opened inside the pane, under both rows rather than under the one that was clicked, and both are still on screen above it — which is the point of it opening there, since what makes a marker legible is the two colours against each other. The pane got ${grew}px longer to hold it. Across the top of the panel is the name of the row it is editing, "Text color", and a ✕ that closes it; the square that opened it now wears a ring. Inside are sixteen ready-made colours, then three sliders named Hue, Saturation and Lightness, then a box holding the colour written out as a code.`,
      { name: 'open', mustShow: picker },
    )

    const yellow = '#eab308'
    await picker.getByRole('button', { name: yellow }).click()
    await panel.waitForTimeout(500)

    const afterPreset = await sampleColours(panel)
    if (afterPreset.text !== asRgb(yellow)) {
      throw new Error(
        `the sample is drawn in ${afterPreset.text} after picking ${yellow}`,
      )
    }

    if ((await rowHex(textRow)) !== yellow) {
      throw new Error(
        `the row reads ${await rowHex(textRow)} rather than ${yellow}`,
      )
    }

    await look(
      s,
      panel,
      `One of the sixteen ready-made colours, the yellow, has been clicked. Three things changed on that single click and nothing was confirmed afterwards: the code box at the foot of the panel now reads ${yellow}, the "Text color" row above the panel reads ${yellow} and its square is yellow, and the marker in the sample stuck at the top of the pane is drawn in that yellow. The clicked colour in the grid is ringed the same way the row's square is.`,
      { name: 'preset', mustShow: picker },
    )

    // Sixty small steps rather than a jump. What the sample is for is answering
    // while a colour is being chosen, and an instant yellow-to-green is a cut
    // between two states rather than an answer.
    const hue = picker.getByLabel('Hue')
    await hue.focus()

    for (let press = 0; press < 60; press += 1) {
      await panel.keyboard.press('ArrowRight')
      await panel.waitForTimeout(45)
    }

    await panel.waitForTimeout(500)

    const walked = await rowHex(textRow)
    if (walked === yellow) {
      throw new Error('the Hue slider moved sixty steps and changed nothing')
    }

    const afterHue = await sampleColours(panel)
    if (afterHue.text !== asRgb(walked)) {
      throw new Error(
        `the row says ${walked} and the sample is drawn in ${afterHue.text}`,
      )
    }

    await look(
      s,
      panel,
      `The "Hue" slider has been walked to the right in sixty small steps, the distance an arrow key moves it, taking the colour from the yellow to ${walked}. The marker in the sample changed with every step rather than at the end of the drag, and so did the code box and the square on the row. The two sliders under Hue repainted as it moved: "Saturation" runs from grey to the hue now selected, and "Lightness" from black through that hue to white, so each track is a preview of what its own handle will do rather than a bar with a dot on it.`,
      { name: 'hue', mustShow: picker },
    )

    const wasAt = await offsetInPane(picker)
    await panel
      .getByRole('button', { name: 'Background color', exact: true })
      .click()
    await panel.waitForTimeout(600)

    const nowAt = await offsetInPane(picker)
    if (Math.abs(nowAt - wasAt) > 2) {
      throw new Error(
        `the panel moved from ${wasAt}px to ${nowAt}px when it changed rows`,
      )
    }

    if ((await panel.locator('.color-picker').count()) !== 1) {
      throw new Error('clicking the second swatch opened a second panel')
    }

    if (
      (await picker.getByLabel('Background color hex').inputValue()) !==
      '#000000'
    ) {
      throw new Error('the panel did not re-point at the row that was clicked')
    }

    await look(
      s,
      panel,
      `The black square on the "Background color" row has been clicked while the panel was still open on the other row. No second panel opened and this one did not move — measured on this run it is at the same ${nowAt}px down the scrolling area as before. It is the same panel, now pointed at the other row: its caption reads "Background color", its code box reads #000000, and the ring has moved off the yellow square onto the black one. The sixteen ready-made colours are the same sixteen, and the sliders have re-seeded themselves to the colour they are now editing.`,
      { name: 'other-row', mustShow: picker },
    )

    // The code box, typed into rather than filled: the panel holds a
    // half-written colour without acting on it, and that is only visible while
    // it is being written.
    const navy = '#1d3b8a'
    const hexBox = picker.getByLabel('Background color hex')
    await hexBox.click()
    await panel.keyboard.press('ControlOrMeta+a')
    await hexBox.pressSequentially(navy, { delay: 140 })
    await panel.waitForTimeout(600)

    const afterTyping = await sampleColours(panel)
    if (afterTyping.background !== asRgb(navy)) {
      throw new Error(
        `the sample's backdrop is ${afterTyping.background} after typing ${navy}`,
      )
    }

    await look(
      s,
      panel,
      `A colour typed rather than picked: ${navy} has been typed into the code box a character at a time. The backdrop of the marker in the sample turned navy on the last character and not before — a half-written code is not a colour, and the panel holds what is being typed without acting on it rather than lurching through whatever the first few characters happen to spell. The Lightness and Saturation tracks moved to match the finished colour.`,
      { name: 'typed', mustShow: picker },
    )

    const openHeight = await paneContentHeight(panel)
    const rowWas = await offsetInPane(textRow)
    await picker
      .getByRole('button', { name: 'Close Background color picker' })
      .click()
    await panel.waitForTimeout(600)

    if ((await panel.locator('.color-picker').count()) !== 0) {
      throw new Error('the ✕ did not close the panel')
    }

    const shrank = openHeight - (await paneContentHeight(panel))
    const rowNow = await offsetInPane(textRow)

    if (Math.abs(rowNow - rowWas) > 2) {
      throw new Error(
        `closing the panel moved the rows above it from ${rowWas}px to ${rowNow}px`,
      )
    }

    const finalRows = [await rowHex(textRow), await rowHex(backRow)]
    const finalSample = await sampleColours(panel)

    if (
      finalSample.text !== asRgb(finalRows[0] ?? '') ||
      finalSample.background !== asRgb(finalRows[1] ?? '')
    ) {
      throw new Error(
        `the rows read ${finalRows.join(' and ')} and the sample is ${finalSample.text} on ${finalSample.background}`,
      )
    }

    await look(
      s,
      panel,
      `The ✕ at the top of the panel has been clicked and the panel is gone, ${shrank}px of pane with it. Neither row moved when it went — both are still ${rowNow}px down the scrolling area, where they were before it opened — and they now read ${finalRows[0]} and ${finalRows[1]}, each with its square painted to match. The marker in the sample above is drawn in the first colour on a backdrop of the second, which is what it will look like over the video. Nothing was saved, applied or confirmed at any point in this — the panel has no such button, and the ✕ closes an edit that has already happened.`,
      { name: 'closed', mustShow: backRow },
    )

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel and the height of its tallest tab, which is the one it is on throughout, so the panel fills the frame. In order: the Settings tab is picked and the pane is scrolled down until the two colour rows sit under the marker block's own header, which stops at the top of the scrolling area and stays there with the marker's sample on it; the white square on "Text color" is clicked and a panel opens under both rows, pushing neither of them off screen; a yellow is clicked in its grid of sixteen and lands on the row, the code box and the sample at once; the Hue slider is walked sixty steps to the right and the sample follows it the whole way while the two tracks below repaint; the black square on "Background color" is clicked and the same panel, without moving, re-points at that row; ${navy} is typed into the code box and the sample's backdrop changes on the last character; and the ✕ closes the panel, leaving the two rows unmoved and the sample showing both colours together. The thing to watch is the sample: it is stuck at the top of the pane for the whole recording, and every change reaches it as it is made.`,
    )
  },
}
