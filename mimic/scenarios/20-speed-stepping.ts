import { look, start, type Ctx } from '../page.ts'

export default {
  id: 'speed-stepping',
  title: 'Speeding a talk up and putting it back',
  intent:
    'Someone is watching a conference talk that is too slow for them. They want to speed it up, find it has gone too far, and put it back to normal.',

  async run(s: Ctx) {
    const { popup } = await start(s)
    await look(
      s,
      popup,
      'The panel as it opens, over a page playing a talk. The large number in the middle is how fast the video is currently playing.',
      { name: 'panel' },
    )

    // Three presses, and the narration below says three presses. A caption that
    // rounds this to "pressing the button" invites a wrong critique about how
    // big each step is.
    for (let press = 0; press < 3; press += 1) {
      await popup.getByRole('button', { name: 'Faster' }).click()
    }
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "+" button on the right has been pressed three times in a row. Each press makes the video play a little faster.',
      { name: 'faster' },
    )

    await popup.getByRole('button', { name: 'Slower' }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "−" button on the left has been pressed once. It undoes one press of "+".',
      { name: 'slower' },
    )

    await popup.getByRole('button', { name: 'Reset' }).click()
    await popup.waitForTimeout(300)
    await look(
      s,
      popup,
      'The "Reset" button has been pressed. It puts the video straight back to its normal speed, however far from normal it had got.',
      { name: 'reset' },
    )
  },
}
