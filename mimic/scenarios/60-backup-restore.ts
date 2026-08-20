import { look, start, type Ctx } from '../page.ts'

export default {
  id: 'backup-restore',
  title: 'Moving settings to another computer',
  intent:
    'Someone has set this up the way they like on one computer and wants the same setup on another, without going through every option again.',

  async run(s: Ctx) {
    const { popup } = await start(s)
    await popup.getByRole('tab', { name: 'Settings' }).click()
    await popup.waitForTimeout(300)

    const backup = popup.locator('.backup')
    await look(
      s,
      popup,
      'The very bottom of the Settings section, reached by scrolling all the way down past everything else. "Export" and "Import" are joined into one pair, and that pair is the only thing here about moving settings between computers. Nothing has been pressed: "Export" arrives already filled in, and the box of text under it is what that half opens onto.',
      { name: 'export', mustShow: backup },
    )

    await popup.getByRole('button', { name: 'Import', exact: true }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "Import" half has been pressed, so it is filled in and "Export" no longer is. This is what someone doing the other half of the job — putting their settings onto a second computer — would see: an empty box to paste a backup into.',
      { name: 'import', mustShow: backup },
    )

    await popup.getByRole('button', { name: 'Import', exact: true }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "Import" half has been pressed a second time. Pressing the half that is already filled in puts it out again, so neither half is filled and the box below the pair has gone.',
      { name: 'closed', mustShow: backup },
    )
  },
}
