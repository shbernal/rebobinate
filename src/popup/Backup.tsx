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

    onImport(parsed)
    setDraft('')
    // Back to Export rather than to nothing, which also leaves the freshly
    // restored settings on screen as the backup they now are.
    setMode('export')
    say(restoredNote(parsed), true)
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
          onChange={event => setDraft(event.target.value)}
        />
      )}

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
      </div>

      {/* Directly under the button that fills it, and above the paragraph
          explaining the box: at the foot of the section it printed two lines
          away from the press it was reporting. Mounted even when it is empty —
          a live region added to the page at the same moment as its text is not
          reliably announced. */}
      <p className={status?.rule ? 'rule' : 'note'} role="status">
        {status?.text}
      </p>

      {mode === 'export' ? (
        /* Names where the text goes, which is the half of the job the pair's
           two words do not say: this is a backup you paste into the other
           computer's Import, not a file the browser puts somewhere. A paste is
           also the only import a popup can offer — a file picker tears the
           popup down on Gecko. */
        <p className="note">
          Your settings and every remembered site. Paste it into Import on your
          other computer.
        </p>
      ) : (
        <>
          {/* Why the button is dead, or what pressing it costs. A confirmation
              step is the wrong shape here: on Gecko the popup autohides on
              focus loss, so an extra step is another way to lose the paste.
              The refusal is painted the way the key editor paints its own, so
              the panel does not say no in the voice it says how. */}
          <p className={refusal === null ? 'rule' : 'rule rule-refused'}>
            {refusal ?? replacesNote}
          </p>

          {/* What the paste is, under what replacing costs. Two tiers rather
              than one sentence: a price and a preview read as one warning if
              they are painted the same. */}
          {parsed.ok ? <p className="note">{holdsNote(parsed)}</p> : null}
        </>
      )}
    </section>
  )
}

export default Backup
