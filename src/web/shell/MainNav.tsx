import type { MouseEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../ui'
import { classNames } from '../ui/classNames'
import { isCurrentItem, type NavItem } from './navigation'

interface MainNavProps {
  items: readonly NavItem[]
  /** A plain click on an item, not one that opens a new tab or window. */
  onChoose?: (item: NavItem) => void
}

export function MainNav({ items, onChoose }: MainNavProps) {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Main" className="main-nav">
      <ul>
        {items.map((item, index) => {
          const current = isCurrentItem(item, pathname)
          const startsGroup = index > 0 && items[index - 1]?.group !== item.group
          return (
            <li key={item.id} className={classNames(startsGroup && 'nav-group-start')}>
              <Link
                to={item.path}
                className="nav-link"
                aria-current={current ? 'page' : undefined}
                onClick={(event: MouseEvent) => {
                  const newWindow = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
                  if (!newWindow) onChoose?.(item)
                }}
              >
                <Icon name={item.icon} />
                <span className="nav-label">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
