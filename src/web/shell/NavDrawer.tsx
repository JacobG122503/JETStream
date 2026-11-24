import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { IconButton } from '../ui'
import { focusPageHeading } from '../ui/overlay/focus'
import { useModalLayer, useOnMediaMatch } from '../ui/overlay/useModalLayer'
import { wideQuery } from '../ui/useMediaQuery'
import { Brand } from './Brand'
import { MainNav } from './MainNav'
import type { NavItem } from './navigation'

interface NavDrawerProps {
  id: string
  items: readonly NavItem[]
  onClose: () => void
}

/** Navigation on phones and tablets. Mounted only while open. */
export function NavDrawer({ id, items, onClose }: NavDrawerProps) {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const { pathname } = useLocation()

  useModalLayer({
    rootRef: root,
    panelRef: panel,
    initialFocus: () => closeButton.current,
    onEscape: onClose,
  })
  useOnMediaMatch(wideQuery, onClose)

  // Back or Forward while open: close, and go on as after any change of page.
  const openedAt = useRef(pathname)
  useEffect(() => {
    if (pathname === openedAt.current) return
    onClose()
    setTimeout(focusPageHeading)
  }, [pathname, onClose])

  const choose = (path: string) => {
    onClose()
    // A new page gets focus by itself (see RouteEffects). Choosing the current one changes nothing
    // but the drawer.
    if (path === pathname) setTimeout(focusPageHeading)
  }

  return createPortal(
    <div
      ref={root}
      className="drawer-layer"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={panel} id={id} role="dialog" aria-label="Main menu" tabIndex={-1} className="drawer">
        <div className="drawer-header">
          <Brand onClick={() => choose('/time')} />
          <IconButton ref={closeButton} icon="close" label="Close menu" className="drawer-close" onClick={onClose} />
        </div>
        <MainNav items={items} onChoose={(item) => choose(item.path)} />
      </div>
    </div>,
    document.body,
  )
}
