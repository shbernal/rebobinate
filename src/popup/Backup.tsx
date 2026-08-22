import { useMemo, useState } from 'react'
import type { BackupContents } from '@/shared/backup'
import { parseBackup, serializeBackup } from '@/shared/backup'
import type { DomainStore } from '@/shared/domains'
import type { Settings } from '@/shared/settings'

type Mode = 'export' | 'import'

/** What to say when the clipboard is not available or refuses the write. */
const COPY_BY_HAND = 'Select the text and copy it.'

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
  const [status, setStatus] = useState<string | null>(null)

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

  const copy = () => {
    const written = navigator.clipboard?.writeText(text)

    if (!written) {
      setStatus(COPY_BY_HAND)
      return
    }

    written.then(
      () => setStatus('Copied.'),
      () => setStatus(COPY_BY_HAND),
    )
  }

  const restore = () => {
    if (!parsed.ok) {
      setStatus(parsed.error)
      return
    }

    onImport(parsed)
    setDraft('')
    // Back to Export rather than to nothing, which also leaves the freshly
    // restored settings on screen as the backup they now are.
    setMode('export')
    setStatus('Restored.')
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

      {mode === 'export' ? (
        <>
          <textarea
            className="backup-text"
            aria-label="Backup"
            readOnly
            value={text}
            // Selecting on focus is what makes a keyboard copy one shortcut
            // rather than a drag through 40 lines of JSON.
            onFocus={event => event.target.select()}
          />
          <div className="backup-actions">
            <button type="button" onClick={copy}>
              Copy
            </button>
          </div>
          {/* Names where the text goes, which is the half of the job the
              pair's two words do not say: this is a backup you paste into the
              other computer's Import, not a file the browser puts somewhere.
              A paste is also the only import a popup can offer — a file
              picker tears the popup down on Gecko. */}
          <p className="note">
            Your settings and every remembered site. Paste it into Import on
            your other computer.
          </p>
        </>
      ) : null}

      {mode === 'import' ? (
        <>
          <textarea
            className="backup-text"
            aria-label="Backup to restore"
            placeholder="Paste a backup from Export on your other computer"
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
          <div className="backup-actions">
            {/* The button that actually overwrites says what it overwrites,
                rather than repeating the name of the panel it sits in. */}
            <button type="button" disabled={!parsed.ok} onClick={restore}>
              Replace settings
            </button>
          </div>
          {/* Why the button is dead, or what pressing it costs. A confirmation
              step is the wrong shape here: on Gecko the popup autohides on
              focus loss, so an extra step is another way to lose the paste. */}
          <p className="rule">
            {draft.trim() !== '' && !parsed.ok ? parsed.error : replacesNote}
          </p>
        </>
      ) : null}

      {/* Mounted even when it is empty: a live region added to the page at the
          same moment as its text is not reliably announced. */}
      <p className="note" role="status">
        {status}
      </p>
    </section>
  )
}

export default Backup
