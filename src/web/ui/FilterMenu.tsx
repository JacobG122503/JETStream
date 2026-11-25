import { type KeyboardEvent, useRef, useState } from 'react'
import { Button } from './Button'
import { filterOptions } from './comboboxFilter'
import { SearchField } from './fields'
import { Icon } from './Icon'
import { popupAttributes, usePopup } from './overlay/usePopup'
import './FilterMenu.css'
import './popup.css'

export interface FilterMenuProps {
  label: string
  options: { value: string; label: string }[]
  value: readonly string[]
  onChange: (value: string[]) => void
}

/** From this many on, the list can be searched. */
const searchFrom = 10

/** A button that opens a list to tick, to look at a part of what is there. */
export function FilterMenu({ label, options, value, onChange }: FilterMenuProps) {
  const anchor = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const close = () => {
    setOpen(false)
    setSearch('')
  }
  const style = usePopup({ open, anchorRef: anchor, popupRef: popup, onPressOutside: close })
  const chosen = value.filter((item) => options.some((option) => option.value === item))
  const only = chosen.length === 1 ? options.find((option) => option.value === chosen[0])?.label : undefined
  const none = options.length === 0

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    close()
    button.current?.focus()
  }

  return (
    <div
      ref={anchor}
      className="filter-menu"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close()
      }}
    >
      <Button
        ref={button}
        size="small"
        className={chosen.length > 0 ? 'is-chosen' : undefined}
        aria-expanded={open}
        aria-disabled={none || undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {label}
        {chosen.length > 0 && `: ${only ?? chosen.length}`}
        <Icon name="chevronDown" className="menu-chevron" />
      </Button>
      {open && (
        <div {...popupAttributes} ref={popup} className="popup filter-popup" style={style} role="group" aria-label={label}>
          {options.length >= searchFrom && <SearchField label={`Search ${label}`} hideLabel placeholder="Search" value={search} onChange={setSearch} />}
          <div className="filter-list">
            {filterOptions(options, search).map((option) => (
              <label key={option.value} className="filter-option">
                <input
                  type="checkbox"
                  className="check"
                  checked={chosen.includes(option.value)}
                  onChange={(event) => onChange(event.target.checked ? [...chosen, option.value] : chosen.filter((item) => item !== option.value))}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {chosen.length > 0 && (
            <Button size="small" variant="quiet" onClick={() => onChange([])}>
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
