import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import './Tabs.css'

export interface TabItem {
  id: string
  label: string
  content: ReactNode
}

export interface TabsProps {
  /** Accessible name of the set of tabs. */
  label: string
  items: TabItem[]
  /** Id of the shown tab. Without it the tabs remember it themselves. */
  value?: string
  onChange?: (id: string) => void
}

export function Tabs({ label, items, value, onChange }: TabsProps) {
  const base = useId()
  const list = useRef<HTMLDivElement>(null)
  const [own, setOwn] = useState(items[0]?.id)
  const wanted = value ?? own
  const index = Math.max(0, items.findIndex((item) => item.id === wanted))
  const current = items[index]

  // Brings the current tab into view inside the list only.
  useEffect(() => {
    const tab = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list.current || !tab) return
    const { offsetLeft: left, offsetWidth: width } = tab
    if (left < list.current.scrollLeft) list.current.scrollLeft = left
    else if (left + width > list.current.scrollLeft + list.current.clientWidth) {
      // One more, because the sizes are rounded.
      list.current.scrollLeft = left + width + 1 - list.current.clientWidth
    }
  }, [index])

  const select = (next: number) => {
    const item = items[next]
    if (!item) return
    setOwn(item.id)
    onChange?.(item.id)
    document.getElementById(`${base}-tab-${item.id}`)?.focus({ preventScroll: true })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % items.length,
      ArrowLeft: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }
    const next = targets[event.key]
    if (next === undefined) return
    event.preventDefault()
    select(next)
  }

  return (
    <div className="tabs">
      <div ref={list} className="tabs-list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((item, position) => (
          <button
            key={item.id}
            id={`${base}-tab-${item.id}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={position === index}
            aria-controls={position === index ? `${base}-panel` : undefined}
            tabIndex={position === index ? 0 : -1}
            onClick={() => select(position)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {current && (
        <div
          key={current.id}
          id={`${base}-panel`}
          className="tab-panel"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`${base}-tab-${current.id}`}
        >
          {current.content}
        </div>
      )}
    </div>
  )
}
