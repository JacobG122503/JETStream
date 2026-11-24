import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { Button, type ButtonSize, type ButtonVariant, IconButton } from './Button'
import { classNames } from './classNames'
import { Icon, type IconName } from './Icon'
import { popupAttributes, usePopup } from './overlay/usePopup'
import './Menu.css'
import './popup.css'

export interface MenuItem {
  id: string
  label: string
  icon?: IconName
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  /** Makes the item one of a set of choices, with this one chosen or not. */
  checked?: boolean
}

export interface MenuProps {
  /** Name of the button that opens the menu. */
  label: string
  items: MenuItem[]
  icon?: IconName
  /** Shows only the icon. */
  iconOnly?: boolean
  variant?: ButtonVariant
  size?: ButtonSize
  align?: 'start' | 'end'
  className?: string
}

/** A button that opens a list of actions or choices. */
export function Menu({ label, items, icon, iconOnly = false, variant, size, align = 'start', className }: MenuProps) {
  const menuId = useId()
  const anchor = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const open = active !== null
  const typed = useRef({ text: '', at: 0 })

  const close = (returnFocus: boolean) => {
    setActive(null)
    if (returnFocus) button.current?.focus()
  }
  const style = usePopup({ open, anchorRef: anchor, popupRef: popup, align, onPressOutside: () => close(false) })

  useEffect(() => {
    if (active === null) return
    popup.current?.querySelectorAll<HTMLElement>('.menu-item')[active]?.focus({ preventScroll: true })
    const item = popup.current?.querySelectorAll<HTMLElement>('.menu-item')[active]
    if (item && popup.current) {
      const { offsetTop: top, offsetHeight: height } = item
      if (top < popup.current.scrollTop) popup.current.scrollTop = top
      else if (top + height > popup.current.scrollTop + popup.current.clientHeight) {
        popup.current.scrollTop = top + height - popup.current.clientHeight
      }
    }
  }, [active])

  const first = () => {
    const chosen = items.findIndex((item) => item.checked)
    return chosen === -1 ? 0 : chosen
  }

  const select = (item: MenuItem) => {
    if (item.disabled) return
    // Focus goes back first, so that a dialog opened by the item returns it to the button.
    close(true)
    item.onSelect()
  }

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const index = active ?? 0
    const last = items.length - 1
    if (event.key === 'Tab') {
      // From the button, the browser moves on.
      close(true)
      return
    }
    if (event.key === 'Escape') close(true)
    else if (event.key === 'ArrowDown') setActive(index === last ? 0 : index + 1)
    else if (event.key === 'ArrowUp') setActive(index === 0 ? last : index - 1)
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(last)
    else if (event.key === 'Enter' || event.key === ' ') {
      const item = items[index]
      if (item) select(item)
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const { text, at } = typed.current
      const now = Date.now()
      const search = (now - at < 600 ? text : '') + event.key.toLowerCase()
      typed.current = { text: search, at: now }
      const from = search.length === 1 ? index + 1 : index
      const found = items.map((_, i) => (from + i) % items.length).find((i) => items[i]?.label.toLowerCase().startsWith(search))
      if (found !== undefined) setActive(found)
    } else return
    event.preventDefault()
    event.stopPropagation()
  }

  const trigger = {
    ref: button,
    size,
    className,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => (open ? close(true) : setActive(first())),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActive(event.key === 'ArrowDown' ? first() : items.length - 1)
      }
    },
  }

  return (
    <div
      ref={anchor}
      className="menu-anchor"
      onBlur={(event) => {
        // Not when the window itself loses focus, or on a press that the popup handles.
        if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close(false)
      }}
    >
      {iconOnly ? (
        <IconButton {...trigger} label={label} icon={icon ?? 'more'} variant={variant ?? 'quiet'} />
      ) : (
        <Button {...trigger} icon={icon} variant={variant}>
          {label}
          <Icon name="chevronDown" className="menu-chevron" />
        </Button>
      )}
      {open && (
        <div
          {...popupAttributes}
          ref={popup}
          id={menuId}
          role="menu"
          aria-label={label}
          className="popup menu"
          style={style}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <div
              key={item.id}
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              aria-disabled={item.disabled || undefined}
              tabIndex={index === active ? 0 : -1}
              className={classNames('menu-item', item.destructive && 'is-destructive')}
              onClick={() => select(item)}
              onPointerMove={() => {
                if (index !== active) setActive(index)
              }}
            >
              {item.icon && <Icon name={item.icon} />}
              <span className="menu-item-label">{item.label}</span>
              {item.checked !== undefined && <Icon name="check" className={classNames(!item.checked && 'is-hidden')} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
