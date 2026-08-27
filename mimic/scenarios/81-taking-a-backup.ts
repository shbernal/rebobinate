import type { Page } from '@playwright/test'
import {
  look,
  metaOf,
  openVideoPage,
  paneContentHeight,
  type Ctx,
  type SeedSite,
} from '../page.ts'

/**
 * The pair at the very foot of Settings, worked rather than looked at.
 *
 * `backup-restore` already stills this section, and stills are what it is good
 * for: which half is filled in, what the box holds, what the line under it
 * says. Three things here are not states at all.
 *
 * The button that overwrites everything is dead until the text in the box
 * parses, and the sentence beside it is the parse error while it does not.
 * Neither of those is a property of the panel; both are a property of what was
 * last pasted, and a pair of stills of a dead button and a live one is a pair
 * of stills with the cause left out. The failure in the middle is the ordinary
 * case rather than a contrived one — a paste that took only part of the
 * selection is what a 40-line box in a 320px popup invites.
 *
 * The two halves also share one slot, which the still scenario can say and
 * cannot show: pressing Import does not open a second panel under the first,
 * it replaces its contents in place, and the readout, the button and the line
 * under it all change together while nothing above the pair moves.
 *
 * And the status line under the button appears on a press and is gone the
 * moment the other half is chosen, which is a lifetime. The line's place is
 * held whether or not it has anything to say, and so is the foot under it, so
 * that none of those four changes moves what is below them. That is a claim
 * about four transitions rather than about a state, so the height of the tab's
 * contents is read at each of them and asserted to be the same number.
 *
 * What one capture cannot show is the point of the feature: this is one
 * profile, so the backup goes back into the computer it came from. The
 * scenario says so rather than dressing a round trip as a migration, and what
 * it can prove instead — that the text that comes back out is the text that
 * went in — it asserts and narrates.
 *
 * Filmed through `openPanel`, in the window the panel tops out at. The Settings
 * tab is taller than that, so the pane is scrolled to its end and stays there.
 */

/**
 * Four sites, so the sentence about what a restore costs has a number in it.
 * A fresh profile takes the other branch of that sentence — "You have no
 * remembered sites to lose" — which is the state every other exhibit of this
 * panel is already in.
 */
const SEEDED: SeedSite[] = [
  { domain: 'conference-talks.test', speed: 1.5 },
  { domain: 'guitar-lessons.test', speed: 0.75 },
  { domain: 'language-lab.test', speed: 0.5 },
  { domain: 'broadcast-news.test', never: true },
]

/** How much of the backup the bad paste takes: enough to look right, not enough to parse. */
const PARTIAL = 0.55

/** Whether the pane is scrolled as far down as it goes, which is where this section lives. */
const atFoot = (panel: Page): Promise<boolean> =>
  panel
    .locator('.pane')
    .evaluate(
      pane => pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1,
    )

/** Wheeled down rather than jumped, so the recording shows the section being reached. */
const wheelToFoot = async (panel: Page): Promise<void> => {
  await panel.mouse.move(160, 300)

  for (let notch = 0; notch < 40; notch += 1) {
    if (await atFoot(panel)) {
      await panel.waitForTimeout(400)
      return
    }

    await panel.mouse.wheel(0, 80)
    await panel.waitForTimeout(90)
  }

  throw new Error('the pane never reached the foot of the Settings tab')
}

export default {
  id: 'taking-a-backup',
  title: 'Taking a backup and putting it back',
  intent:
    'Someone wants a copy of everything this extension has learned about them — their settings and every site it remembers a speed for — and wants to be able to put that copy back.',
  video: true,

  async run(s: Ctx) {
    await metaOf(s).seedDomains(SEEDED)
    await openVideoPage(s.context)

    const panel = await metaOf(s).openPanel()
    s.use(panel)
    await panel.waitForTimeout(1200)

    await panel.getByRole('tab', { name: 'Settings' }).click()
    await panel.waitForTimeout(600)

    const exportHalf = panel.getByRole('button', {
      name: 'Export',
      exact: true,
    })
    const importHalf = panel.getByRole('button', {
      name: 'Import',
      exact: true,
    })
    const copy = panel.getByRole('button', { name: 'Copy', exact: true })
    const replace = panel.getByRole('button', { name: 'Replace settings' })
    const box = panel.locator('textarea.backup-text')
    // Not the status line, which earns the same tier once it has something to
    // report: both are `.rule` after a restore.
    const rule = panel.locator('.backup p.rule:not([role="status"])')
    const preview = panel.locator(
      '.backup p.rule:not([role="status"]) + p.note',
    )
    const status = panel.locator('.backup p[role="status"]')

    await wheelToFoot(panel)

    // What the person would have on their clipboard, read from the box they
    // are about to copy out of rather than rebuilt from the stores.
    const taken = await box.inputValue()
    if (!taken.includes('"rebobinate-backup"')) {
      throw new Error('the Export box is not holding a backup')
    }

    const exportSlot = await paneContentHeight(panel)

    /**
     * Every state the section goes through has to leave the tab's contents the
     * height they were. This section is the last thing on the tallest tab, so
     * that height is what a line appearing under the button would push.
     */
    const settled = (state: string, at: number) => {
      if (at !== exportSlot) {
        throw new Error(
          `the tab is ${at}px tall at "${state}" and was ${exportSlot}px at "export", so the foot of the section moved`,
        )
      }
    }

    await copy.click()
    await panel.waitForTimeout(600)

    const copied = (await status.textContent()) ?? ''
    if (copied !== 'Copied.') {
      throw new Error(
        `the Copy button reported "${copied}" rather than a successful copy`,
      )
    }

    settled('copied', await paneContentHeight(panel))

    await look(
      s,
      panel,
      `The foot of the Settings tab, scrolled all the way down past everything else. Above the rule at the middle of the frame is the tail of the block about the marker drawn over the video — the last of its rows, and its own header stuck to the top of the scrolling area with a striped live sample of that marker in it, which is why there is a grey box at the top of a frame that is not about it. Under the rule is the last thing on the tab: a "Backup" heading, then "Export" and "Import" joined into one small two-way switch with "Export" filled in, then a box of indented JSON — ${taken.split('\n').length} lines of it, in a monospaced face small enough that it reads as a blob of text rather than as something to be understood — then a "Copy" button. "Copy" has just been pressed, and a line has appeared directly under it reading "${copied}" — under the button, not under the paragraph that follows, which is where it used to land. It landed in a slot that was already being held empty for it, so nothing under it moved. Below that is the line saying what the text is and where it goes. Nothing was generated by pressing anything; the box arrives filled in, because the backup is simply what is currently stored, written out.`,
      { name: 'foot', mustShow: status },
    )

    await importHalf.click()
    await panel.waitForTimeout(600)

    if ((await status.textContent()) !== '') {
      throw new Error('the "Copied." line outstayed the switch to Import')
    }

    if (await replace.isEnabled()) {
      throw new Error('the overwrite button is live over an empty box')
    }

    settled('import', await paneContentHeight(panel))
    const waiting = (await rule.textContent()) ?? ''

    if (!waiting.includes(`all ${SEEDED.length} remembered sites`)) {
      throw new Error(
        `the line under the dead button reads "${waiting}", not what a restore would cost`,
      )
    }

    await look(
      s,
      panel,
      `"Import" has been pressed. The pair is one switch over one slot rather than two panels, so nothing opened underneath: the filled half moved from left to right and everything below it was replaced where it stood — the JSON is gone from the box, which now holds grey placeholder text reading "Paste a backup from Export on your other computer"; "Copy" has become "Replace settings", greyed out and unpressable; and the line under it is no longer about what the text is but about what pressing that button would cost: "${waiting.trim()}" There is nothing about what the box holds, because it holds nothing yet. The slot is exactly the same height it was, measured — Export's two lines of explanation and Import's one line of price are set in a box sized for the taller of the two, so the switch changes what the foot says without changing where the foot is. Nothing above the "Backup" heading moved either. The "${copied}" line from a moment ago has gone with the switch, so the only trace that anything was copied is that it is on the clipboard.`,
      { name: 'import', mustShow: replace },
    )

    // The ordinary accident: a selection that stopped short of the end of a
    // 40-line box, pasted in whole.
    await box.fill(taken.slice(0, Math.floor(taken.length * PARTIAL)))
    await panel.waitForTimeout(700)

    if (await replace.isEnabled()) {
      throw new Error('the overwrite button came alive over half a backup')
    }

    const complained = (await rule.textContent()) ?? ''
    if (complained !== 'That is not valid JSON.') {
      throw new Error(`half a backup was answered with "${complained}"`)
    }

    if (!((await rule.getAttribute('class')) ?? '').includes('rule-refused')) {
      throw new Error(
        'the refusal is painted exactly like the price it replaced',
      )
    }

    settled('bad paste', await paneContentHeight(panel))

    await look(
      s,
      panel,
      `A paste that went wrong: the selection stopped part of the way down the text, so what landed in the box is the first ${Math.round(PARTIAL * 100)}% of the backup. The box has scrolled to where the paste ended and it looks full and ordinary — indented JSON, the same face as before — with the only sign of trouble at the very bottom, where the last line stops mid-word. "Replace settings" is still greyed out, and the line under it has changed from what a restore would cost to why there will not be one: "${complained}" — and it is red where the price was the panel's ordinary grey, which is the panel refusing in a different voice from the one it explains in. The line under it is the same length either way and the foot has not moved. It answered the paste itself; nothing was pressed to make it check, and there is no third state where the button is live and the press then fails.`,
      { name: 'half', mustShow: rule },
    )

    await box.fill(taken)
    await panel.waitForTimeout(700)

    if (!(await replace.isEnabled())) {
      throw new Error('a whole backup left the overwrite button dead')
    }

    const costs = (await rule.textContent()) ?? ''
    if (costs !== waiting) {
      throw new Error(
        `a valid backup left the line reading "${costs}" rather than what it costs`,
      )
    }

    const holds = ((await preview.textContent()) ?? '').trim()
    if (!holds.includes(`${SEEDED.length} sites`)) {
      throw new Error(
        `the panel says "${holds}" about a paste carrying ${SEEDED.length} sites`,
      )
    }

    settled('good paste', await paneContentHeight(panel))

    await look(
      s,
      panel,
      `The paste has been done again, all of it this time. Nothing else was touched and no button was pressed, and three things under the box have changed together: "Replace settings" has come alive — it is a solid, pressable button rather than a grey one — the line beside it has gone back from the red complaint to the grey price, "${costs.trim()}", and a smaller line has appeared under that one, in the slot that was being held for it, saying what the paste actually holds: "${holds}" The two are in different sizes because they are different questions — one is what the press costs, the other is what it buys — and a backup carrying only one of the two stores says so here rather than nowhere. There is no "are you sure" after the press, deliberately, because this panel closes the instant anything outside it is clicked and a second step is one more way to lose the paste; the warning is put in front of the button instead of behind it.`,
      { name: 'live', mustShow: replace },
    )

    await replace.click()
    await panel.waitForTimeout(900)

    const done = (await status.textContent()) ?? ''
    if (!done.includes(`${SEEDED.length} sites`)) {
      throw new Error(`the restore reported "${done}"`)
    }

    if ((await exportHalf.getAttribute('aria-pressed')) !== 'true') {
      throw new Error('the pair did not go back to Export after the restore')
    }

    const returned = await box.inputValue()
    if (returned !== taken) {
      throw new Error(
        'what the panel writes out after the restore is not what went into it',
      )
    }

    await look(
      s,
      panel,
      `"Replace settings" has been pressed. Everything it warned about happened, and the panel names both halves of it on the same line that reported the copy earlier, directly under the button: "${done}" The pair has flipped itself back to "Export" and the box is filled in again, this time from what is now stored; it is character for character the text that was copied out of it, which on one computer is the whole of what a restore can be shown to have done. What it still does not say is what was there before it ran, which is the one thing that would make the press undoable.`,
      { name: 'restored', mustShow: status },
    )

    s.showVideo(
      `The same visit as a recording, at real speed, filmed in a window the width of the panel and the height it tops out at; the Settings tab is taller than the window, which is why it is scrolled. In order: the Settings tab is picked and the pane wheeled all the way down to the "Backup" section at its foot; "Copy" is pressed and "${copied}" appears directly under the button; "Import" is pressed and the whole slot changes over in place — the JSON out of the box, the button from "Copy" to a dead "Replace settings", the line under it from what the text is to what replacing it costs, and the "${copied}" gone; a partial backup is pasted in and the button stays dead while the line under it turns red and reads "${complained}"; the whole backup is pasted over it and the button comes alive as the line goes back to the price, with a second, smaller line appearing under it to say what the paste holds; and it is pressed, leaving "${done}" under the button and the pair back on Export. Through all of that the foot of the section stays at ${exportSlot}px from the top of the tab — every line that comes and goes down here is landing in a slot that was already held for it. The thing to watch is the second paste — the button and the two sentences beside it change on the text itself, with nothing pressed in between.`,
    )
  },
}
