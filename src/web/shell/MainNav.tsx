import { Fragment, type MouseEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../ui'
import { classNames } from '../ui/classNames'
import { groupHeadings, isCurrentItem, type NavItem } from './navigation'

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
          const startsGroup = items[index - 1]?.group !== item.group
          const heading = groupHeadings[item.group]
          return (
            <Fragment key={item.id}>
              {startsGroup && heading && <li className="nav-heading">{heading}</li>}
              <li className={classNames(item.group === 'admin' && 'nav-last')}>
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
            </Fragment>
          )
        })}
      </ul>
    </nav>
  )
}
