import { useMemo, useState } from 'react'
import type { BackupContents, BackupSummary } from '@/shared/backup'
import { parseBackup, serializeBackup } from '@/shared/backup'
import type { DomainStore } from '@/shared/domains'
import type { Settings } from '@/shared/settings'

type Mode = 'export' | 'import'

/** What to say when the clipboard is not available or refuses the write. */
const COPY_BY_HAND = 'Select the text and copy it.'

/**
 * What the status line is saying, and how loudly.
 *
 * "Copied." is a receipt for something reversible and stays in the quiet tier.
 * The restore message names the two stores it just replaced, which is the same
 * kind of sentence as the warning that preceded it, so it takes `.rule`. One
 * element either way — the class changes, the node does not.
 */
type Status = { text: string; rule: boolean }

const sites = (count: number) => (count === 1 ? '1 site' : `${count} sites`)

/**
 * What the paste holds, said before it is pressed. The settings-only case is
 * the one this exists for: it is invisible otherwise, and it changes what the
 * warning above it means — a backup with no site list leaves the site list
 * alone, whatever the warning says it would cost.
 */
const holdsNote = (parsed: BackupContents & BackupSummary): string => {
  if (!parsed.hasSettings) {
    return `This backup holds ${sites(parsed.siteCount)} and no settings. Your settings are kept.`
  }

  if (!parsed.domains) {
    return 'This backup holds settings only. Your remembered sites are kept.'
  }

  if (parsed.siteCount === 0) {
    return 'This backup holds your settings and an empty list of sites.'
  }

  return `This backup holds your settings and ${sites(parsed.siteCount)}.`
}

/** The same sentence in the past tense, once the press has happened. */
const restoredNote = (parsed: BackupContents & BackupSummary): string => {
  if (!parsed.hasSettings) {
    return `Restored ${sites(parsed.siteCount)}. Your settings are kept.`
  }

  if (!parsed.domains) {
    return 'Restored your settings. Your remembered sites are kept.'
  }

  if (parsed.siteCount === 0) {
    return 'Restored your settings and emptied your remembered sites.'
  }

  return `Restored your settings and ${sites(parsed.siteCount)}.`
}

type BackupProps = {
  settings: Settings
  domains: DomainStore
  onImport: (contents: BackupContents) => void
}

/**
 * Export and import, as two panels sharing one slot.
 *
 * Both halves are text in a textarea, which is not a stylistic choice: on Gecko
 * the popup is a XUL panel that autohides the moment a native dialog takes the
 * focus, so a file picker would tear the popup down before a file could be
 * chosen (`docs/build-targets.md`). Pasting is the only import a popup can
 * offer on both engines, and once import is a paste, export being a copy keeps
 * the pair symmetrical.
 *
 * The two halves are rendered into one skeleton — box, buttons, status,
 * explanation — rather than as two blocks. That is what lets the status line
 * sit directly under the button that fills it while staying the same element
 * across a mode change: a restore flips back to Export and writes the status in
 * the same breath, and a live region that arrives with its text is not reliably
 * announced.
 */
const Backup = ({ settings, domains, onImport }: BackupProps) => {
  /**
   * Which half of the pair is chosen — always one of the two, never neither.
   * It is styled as a segmented control, which is the grammar of a choice that
   * always has an answer, and it used to behave like a disclosure: pressing
   * the open half a second time left both halves out and the panel gone. The
   * collapse bought nothing either, since Backup is the last section in the
   * pane. Export is the half it arrives on — read-only, and the one needed
   * first.
   */
  const [mode, setMode] = useState<Mode>('export')
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status | null>(null)
  /**
   * The export of what was there a moment ago, held from the press of Replace
   * settings until it is spent.
   *
   * A restore overwrites the settings and the whole site map at once, and by
   * the time it happens the pair has been on Import long enough that the
   * export the user might have kept is gone from the box. It is the largest
   * irreversible action in the product, and it costs nothing to make it not
   * one: `text` below is already the serialization of the live settings and
   * domains, and at the moment `restore` runs it is still the pre-import
   * snapshot.
   *
   * Spent on a mode change and on any edit to the draft, the same rule the
   * dropped row's Undo in `SitesPane` follows: it is a place rather than a
   * countdown, and the popup closing spends it too.
   */
  const [undoText, setUndoText] = useState<string | null>(null)

  const text = useMemo(
    () => serializeBackup(settings, domains),
    [settings, domains],
  )

  /**
   * Parsed as the box is typed into rather than on the click, so the button
   * that overwrites everything is live exactly while there is something valid
   * to restore. `restore` reads this same result rather than parsing twice.
   */
  const parsed = useMemo(() => parseBackup(draft), [draft])

  /**
   * The sentence the parse refused with, or null while there is nothing to
   * refuse — an empty box is waiting rather than wrong. It picks both the text
   * and the class, so the panel cannot say no in the voice it says how.
   */
  const refusal = draft.trim() !== '' && !parsed.ok ? parsed.error : null

  const siteCount = Object.keys(domains.entries).length

  /**
   * What pressing the button costs, with the count — "the whole list" is not a
   * number anybody can weigh. A fresh profile has no list at all, and counting
   * it as "all 0 remembered sites" describes a loss that cannot happen. Both
   * branches stay about the loss: an empty branch that reported the state of
   * the profile instead left the reader sorting a warning from a status line.
   */
  const replacesNote =
    siteCount === 0
      ? 'Replaces your settings. You have no remembered sites to lose.'
      : `Replaces your settings and ${
          siteCount === 1
            ? 'the 1 remembered site'
            : `all ${siteCount} remembered sites`
        }.`

  const choose = (next: Mode) => {
    setMode(next)
    setStatus(null)
    setUndoText(null)
  }

  const say = (text: string, rule = false) => setStatus({ text, rule })

  const copy = () => {
    const written = navigator.clipboard?.writeText(text)

    if (!written) {
      say(COPY_BY_HAND)
      return
    }

    written.then(
      () => say('Copied.'),
      () => say(COPY_BY_HAND),
    )
  }

  const restore = () => {
    if (!parsed.ok) {
      say(parsed.error)
      return
    }

    // Read before the write, while it still describes what is about to be
    // replaced. `setMode` below does not spend it: `choose` is what carries
    // that rule, and this is not a choice the user made.
    setUndoText(text)
    onImport(parsed)
    setDraft('')
    // Back to Export rather than to nothing, which also leaves the freshly
    // restored settings on screen as the backup they now are.
    setMode('export')
    say(restoredNote(parsed), true)
  }

  /**
   * The same road back, travelled by the same code: the snapshot goes through
   * `parseBackup` and `onImport` exactly as a paste would, so an undo cannot
   * write a shape a restore could not.
   */
  const undo = () => {
    if (undoText === null) {
      return
    }

    const snapshot = parseBackup(undoText)

    setUndoText(null)

    if (!snapshot.ok) {
      say(snapshot.error)
      return
    }

    onImport(snapshot)
    say('Put back the settings and sites from before the restore.', true)
  }

  return (
    <section className="backup">
      {/* One two-way switch over one panel: the pair chooses which direction
          the shared slot is showing, and one of them is always chosen.
          `aria-pressed` rather than `aria-expanded`, because neither button
          opens or closes anything. */}
      <div className="backup-actions backup-modes">
        <button
          type="button"
          aria-pressed={mode === 'export'}
          onClick={() => choose('export')}
        >
          Export
        </button>
        <button
          type="button"
          aria-pressed={mode === 'import'}
          onClick={() => choose('import')}
        >
          Import
        </button>
      </div>

      {/* Keyed per half, so switching the pair swaps the box rather than
          re-labelling one: the two carry different text and different scroll
          positions, and reusing the node would carry one into the other. */}
      {mode === 'export' ? (
        <textarea
          key="export"
          className="backup-text"
          aria-label="Backup"
          readOnly
          value={text}
          // Selecting on focus is what makes a keyboard copy one shortcut
          // rather than a drag through 40 lines of JSON.
          onFocus={event => event.target.select()}
        />
      ) : (
        <textarea
          key="import"
          className="backup-text"
          aria-label="Backup to restore"
          placeholder="Paste a backup from Export on your other computer"
          value={draft}
          onChange={event => {
            setDraft(event.target.value)
            setUndoText(null)
          }}
        />
      )}

      {/* What pressing the button costs, in front of the button rather than
          behind it. It used to print under "Replace settings", which is to say
          under the press it was about — a warning a reader reaches after they
          have spent the thing it warns about. A confirmation step is the wrong
          shape here: on Gecko the popup autohides on focus loss, so an extra
          step is another way to lose the paste. The order is the whole of it.

          The refusal takes the same slot and is painted the way the key editor
          paints its own, so the panel does not say no in the voice it says
          how. */}
      {mode === 'import' ? (
        <p
          className={
            refusal === null
              ? 'backup-price rule'
              : 'backup-price rule rule-refused'
          }
        >
          {refusal ?? replacesNote}
        </p>
      ) : null}

      <div className="backup-actions">
        {mode === 'export' ? (
          <button key="copy" type="button" onClick={copy}>
            Copy
          </button>
        ) : (
          /* The button that actually overwrites says what it overwrites,
             rather than repeating the name of the panel it sits in. */
          <button
            key="restore"
            type="button"
            disabled={!parsed.ok}
            onClick={restore}
          >
            Replace settings
          </button>
        )}

        {/* Beside Copy rather than in a row of its own: the restore has
            already flipped the pair back to Export, so this row is on screen
            holding one button and the way back fits in it without the section
            growing. */}
        {undoText === null ? null : (
          <button key="undo" type="button" onClick={undo}>
            Undo restore
          </button>
        )}
      </div>

      {/* Directly under the button that fills it, and above the paragraph
          explaining the box: at the foot of the section it printed two lines
          away from the press it was reporting. Mounted even when it is empty —
          a live region added to the page at the same moment as its text is not
          reliably announced. */}
      <p
        className={`backup-status ${status?.rule ? 'rule' : 'note'}`}
        role="status"
      >
        {status?.text}
      </p>

      {/* The foot, in a box sized for whichever half is showing. This section
          is the last on the tallest tab, so every line that appears down here
          moves the bottom edge of the popup itself. Export's two lines of
          explanation and Import's preview are different heights, and the price
          above the button is a slot Export does not have at all, so the two
          reservations are what keep the mode switch from moving the foot. */}
      <div className={`backup-foot backup-foot-${mode}`}>
        {mode === 'export' ? (
          /* Names where the text goes, which is the half of the job the pair's
             two words do not say: this is a backup you paste into the other
             computer's Import, not a file the browser puts somewhere. A paste
             is also the only import a popup can offer — a file picker tears
             the popup down on Gecko. */
          <p className="note">
            Your settings and every remembered site. Paste it into Import on
            your other computer.
          </p>
        ) : (
          /* What the paste is, as against what replacing costs, which is above
             the button. Two tiers rather than one sentence: a price and a
             preview read as one warning if they are painted the same. Mounted
             empty rather than absent, so the line it will need is already
             reserved and a valid paste fills a slot instead of pushing the
             popup down. */
          <p className="note">{parsed.ok ? holdsNote(parsed) : ''}</p>
        )}
      </div>
    </section>
  )
}

export default Backup
