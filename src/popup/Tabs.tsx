import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export type Tab<TId extends string> = {
  id: TId
  label: string
}

type TabsProps<TId extends string> = {
  tabs: Tab<TId>[]
  active: TId
  onSelect: (id: TId) => void
}

export const tabPanelId = (id: string) => `panel-${id}`

export const tabId = (id: string) => `tab-${id}`

/**
 * The ARIA tab pattern, including the part that is easy to skip: only the
 * selected tab is in the focus order, the arrow keys move between them, and
 * Home and End jump to the ends.
 * Without that a keyboard user has to tab through every tab to reach the panel.
 */
const Tabs = <TId extends string>({
  tabs,
  active,
  onSelect,
}: TabsProps<TId>) => {
  const buttons = useRef(new Map<TId, HTMLButtonElement | null>())

  const select = (next: Tab<TId>) => {
    onSelect(next.id)
    buttons.current.get(next.id)?.focus()
  }

  const handleKeyDown = (event: ReactKeyboardEvent, id: TId) => {
    const index = tabs.findIndex(tab => tab.id === id)
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null

    if (target === null) {
      return
    }

    event.preventDefault()
    select(tabs[target])
  }

  return (
    <div className="tabs" role="tablist" aria-label="Sections">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabId(tab.id)}
          // Only one panel is ever mounted, so only the selected tab has a
          // panel to name; the others would point at an id that is not there.
          aria-controls={tab.id === active ? tabPanelId(tab.id) : undefined}
          aria-selected={tab.id === active}
          tabIndex={tab.id === active ? 0 : -1}
          className={tab.id === active ? 'tab active' : 'tab'}
          ref={element => {
            buttons.current.set(tab.id, element)
          }}
          onClick={() => onSelect(tab.id)}
          onKeyDown={event => handleKeyDown(event, tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export default Tabs
