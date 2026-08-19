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
      'The very bottom of the Settings section, reached by scrolling all the way down past everything else. These two buttons are the only thing here about moving settings between computers.',
      { name: 'backup', mustShow: backup },
    )

    await popup.getByRole('button', { name: 'Export', exact: true }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "Export" button has been pressed. This is everything it produces.',
      { name: 'export', mustShow: backup },
    )

    await popup.getByRole('button', { name: 'Import', exact: true }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "Import" button has been pressed instead. This is what someone doing the other half of the job — putting their settings onto a second computer — would see.',
      { name: 'import', mustShow: backup },
    )
  },
}
