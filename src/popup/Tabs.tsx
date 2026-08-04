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
 * selected tab is in the focus order, and the arrow keys move between them.
 * Without that a keyboard user has to tab through every tab to reach the panel.
 */
const Tabs = <TId extends string>({
  tabs,
  active,
  onSelect,
}: TabsProps<TId>) => {
  const buttons = useRef(new Map<TId, HTMLButtonElement | null>())

  const move = (from: TId, delta: number) => {
    const index = tabs.findIndex(tab => tab.id === from)
    const next = tabs[(index + delta + tabs.length) % tabs.length]

    onSelect(next.id)
    buttons.current.get(next.id)?.focus()
  }

  const handleKeyDown = (event: ReactKeyboardEvent, id: TId) => {
    const delta =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0

    if (delta === 0) {
      return
    }

    event.preventDefault()
    move(id, delta)
  }

  return (
    <div className="tabs" role="tablist" aria-label="Sections">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabId(tab.id)}
          aria-controls={tabPanelId(tab.id)}
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
