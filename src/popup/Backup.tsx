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
  const [mode, setMode] = useState<Mode | null>(null)
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
   * it as "all 0 remembered sites" describes a loss that cannot happen.
   */
  const replacesNote =
    siteCount === 0
      ? 'Replaces your settings. No sites are remembered yet.'
      : `Replaces your settings and ${
          siteCount === 1
            ? 'the 1 remembered site'
            : `all ${siteCount} remembered sites`
        }.`

  const show = (next: Mode) => {
    setMode(open => (open === next ? null : next))
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
    setMode(null)
    setStatus('Restored.')
  }

  return (
    <section className="backup">
      {/* One switch over one panel, so it is styled as one: the pair opens and
          closes a shared slot rather than each doing something on its own. */}
      <div className="backup-actions backup-modes">
        <button
          type="button"
          aria-expanded={mode === 'export'}
          onClick={() => show('export')}
        >
          Export
        </button>
        <button
          type="button"
          aria-expanded={mode === 'import'}
          onClick={() => show('import')}
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
          <p className="note">Your settings and every remembered site.</p>
        </>
      ) : null}

      {mode === 'import' ? (
        <>
          <textarea
            className="backup-text"
            aria-label="Backup to restore"
            placeholder="Paste a backup"
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
          <p className="note">
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
