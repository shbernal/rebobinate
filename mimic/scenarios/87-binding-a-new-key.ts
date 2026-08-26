import { look, metaOf, openVideoPage, type Ctx } from '../page.ts'

/**
 * The one control in the panel that stops and waits for you.
 *
 * Everything else here answers a click immediately. "Add" does not: it puts the
 * panel into a mode where the next keystroke anywhere in it is swallowed and
 * turned into a binding, the button relabels itself to "Press a key…", and a
 * line in the gap under that row explains the way out. Nothing about that is
 * visible in a still of the tab before or a still of the tab after — the whole
 * control is the interval between them, and a judge shown two stills would be
 * judging a list of keys rather than the thing that edits it.
 *
 * The refusal is filmed too, deliberately. Binding a key that already belongs
 * to another action is the mistake this control is most likely to meet, and it
 * answers by staying open and printing, in red on the same line, what the key
 * is already for. A control that stays in its mode after refusing is a
 * different design from one that drops out, and only a recording distinguishes
 * them.
 *
 * What the block does not do is move. The capture button has a column of its
 * own so relabelling it cannot squeeze the keycaps, and the message line is
 * reserved whether or not there is a message, so the only thing that changes
 * between these frames is the thing being reported.
 *
 * The removal at the end is here for the disabled state. Every action keeps at
 * least one key — `normalizeSettings` reads an empty list as a missing one and
 * fills it back from the defaults — so the last remaining ✕ is dead, and the
 * scenario ends on the row where that is visible rather than asserting it.
 *
 * Filmed through `openPanel`, since the real popup cannot be recorded. Keys are
 * on the Settings tab, which is the tallest of the three and scrolls, so the
 * window is sized for it and the pane is scrolled to the Keys block the way a
 * person would reach it.
 */
export default {
  id: 'binding-a-new-key',
  title: 'Teaching the extension a different key',
  intent:
    "Someone finds the extension's plus and minus awkward on their keyboard and wants to drive it from somewhere else — and wants to know, while they are doing it, whether the key they picked was accepted.",
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

    const keys = panel.locator('section.keys')
    const fasterRow = keys.locator('.key-row').first()
    const add = fasterRow.getByRole('button', { name: 'Add a key for Faster' })
    const note = keys.locator('p.note')

    // Reached by scrolling the pane, which is how a person gets to it: the Keys
    // block sits below the step field and above everything about the marker.
    await add.scrollIntoViewIfNeeded()
    await panel.waitForTimeout(400)

    await look(
      s,
      panel,
      'The Keys block on the Settings tab, scrolled to. Three rows — Faster, Slower, Reset — each listing the keys currently bound to it as small keycaps, each keycap carrying a ✕ to drop it, and each row ending in an "Add" button on the right. Faster is bound to three keys out of the box and carries them over two lines. Under the three rows is a blank line and then a "Restore default keys" button.',
      { name: 'keys', mustShow: add },
    )

    await add.click()
    await panel.waitForTimeout(500)

    if ((await add.textContent()) !== 'Press a key…') {
      throw new Error(
        `Add still reads "${await add.textContent()}" after being clicked`,
      )
    }

    await look(
      s,
      panel,
      '"Add" on the Faster row has been clicked once, and the panel is now waiting. The button has grown leftwards into its own column and relabelled itself to "Press a key…", and a line has appeared in the gap directly under the Faster row — not under the block — reading "Press the key to bind, or Esc to cancel." The Faster row itself has not moved, and neither has "Restore default keys" at the foot: the line was already holding its place, empty. Until a key is pressed or Esc is hit, the next keystroke anywhere in here belongs to this button.',
      { name: 'listening', mustShow: note },
    )

    // The mistake this control is most likely to meet: a key that is already
    // spoken for. It refuses without leaving the mode.
    await panel.keyboard.press('-')
    await panel.waitForTimeout(600)

    const refusal = await note.textContent()
    if (refusal === null || !refusal.toLowerCase().includes('already')) {
      throw new Error(`the refusal line reads "${refusal ?? ''}"`)
    }

    if ((await add.textContent()) !== 'Press a key…') {
      throw new Error('the panel dropped out of listening after refusing')
    }

    await look(
      s,
      panel,
      `The minus key was pressed, which is already the Slower key. The panel refused it and said why: the line under the Faster row, which a moment ago was a grey instruction, is now a red one reading "${refusal}". It is still waiting — the button still reads "Press a key…" — so the refusal costs a second attempt, not a second click on Add. No keycap was added to the Faster row, and nothing in the block moved to make room for the refusal.`,
      { name: 'refused', mustShow: note },
    )

    // A key nothing else owns.
    await panel.keyboard.press('.')
    await panel.waitForTimeout(700)

    if ((await add.textContent()) !== 'Add') {
      throw new Error('the panel stayed in listening after a key was accepted')
    }

    const bound = fasterRow.locator('.chip kbd')
    const labels = await bound.allTextContents()
    if (!labels.includes('.')) {
      throw new Error(`Faster is bound to ${labels.join(', ')}, without "."`)
    }

    await look(
      s,
      panel,
      `The full stop was pressed, and it was free, so it was taken. A fourth keycap reading "." has appeared on the Faster row, the button has gone back to reading "Add", and the line under the row has cleared itself and gone back to the blank one at the foot of the block. Faster is now bound to ${labels.length} keys, any of which does the same thing. Nothing was confirmed or saved — the binding took effect as it was pressed.`,
      { name: 'bound', mustShow: fasterRow },
    )

    // Straight back off again, which is the same control read backwards.
    await fasterRow
      .getByRole('button', { name: 'Remove . from Faster' })
      .click()
    await panel.waitForTimeout(600)

    const after = await bound.allTextContents()
    if (after.includes('.')) {
      throw new Error('the keycap survived its own remove button')
    }

    await look(
      s,
      panel,
      `The ✕ on the new keycap was clicked and it is gone again, with no confirmation asked for: Faster is back to the ${after.length} keys it shipped with. Adding a key and dropping one are the same weight of action, which is the right weight for something this reversible.`,
      { name: 'removed', mustShow: fasterRow },
    )

    // Down to the floor, which is where the control stops agreeing. An action
    // with no keys cannot be stored — `normalizeSettings` reads an empty list
    // as a missing one and fills it back from the defaults — so the last
    // remaining ✕ is dead rather than absent. Reached by clicking rather than
    // asserted, because how many keys an action ships with is not this
    // scenario's to know.
    const resetRow = keys.locator('.key-row').nth(2)
    const resetChips = resetRow.locator('.chip')
    const started = await resetChips.count()

    for (let removed = 0; removed < 6; removed += 1) {
      if ((await resetChips.count()) < 2) {
        break
      }

      await resetRow.locator('.chip button').first().click()
      await panel.waitForTimeout(400)
    }

    const left = await resetChips.count()
    if (left !== 1) {
      throw new Error(`the Reset row stopped at ${left} keys rather than one`)
    }

    const lastRemove = resetRow.locator('.chip button').first()
    if (!(await lastRemove.isDisabled())) {
      throw new Error('the last key of an action offered a live remove button')
    }

    const why = await lastRemove.getAttribute('title')
    await look(
      s,
      panel,
      `The Reset row has been taken the other way, from ${started} keys down to one by clicking the ✕ on the ones above it. On the last one the ✕ has gone quiet — greyed out and no longer clickable, rather than disappearing — and hovering it says "${why ?? ''}". An action with no key at all is not a state the extension will keep, and the row says so at the moment it would matter rather than by refusing afterwards.`,
      { name: 'floor', mustShow: resetRow },
    )

    s.showVideo(
      'The same visit as a recording, at real speed, filmed in a window the width of the panel and the height of its tallest tab, which is this one, so the panel fills the frame throughout. In order: the Settings tab is picked and the pane scrolled down to the Keys block; "Add" on the Faster row is clicked and the button grows leftwards and relabels itself to "Press a key…" while a line appears in the gap directly under that row explaining the way out; the minus key is pressed and refused, with the same line turning red and saying what that key is already for while the button stays in its waiting state; the full stop is pressed and accepted, appearing immediately as a fourth keycap on the row while the button goes back to "Add"; then that keycap\'s ✕ is clicked and it disappears; and finally the Reset row underneath is emptied one key at a time until a single one is left, where its ✕ greys out instead of vanishing. The thing to watch is the waiting state — how long the panel sits in it, how clearly it says it is in it, and how little of the block moves while it is on.',
    )
  },
}
