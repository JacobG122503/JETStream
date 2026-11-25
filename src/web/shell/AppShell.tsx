import { type ReactNode, useId, useState } from 'react'
import { IconButton } from '../ui'
import { useMediaQuery, wideQuery } from '../ui/useMediaQuery'
import { Brand } from './Brand'
import { MainNav } from './MainNav'
import { NavDrawer } from './NavDrawer'
import { type NavItem, navItems } from './navigation'
import { PageBoundary } from './PageBoundary'
import { mainId, SkipLink } from './SkipLink'
import { ThemeMenu } from './ThemeMenu'
import './shell.css'

export interface AppShellProps {
  /** Hides navigation items, for example by permission or module. The order of the rest stays. */
  isNavItemVisible?: (item: NavItem) => boolean
  /** In the header on phones and tablets, before the appearance control. */
  headerContent?: ReactNode
  /** Above the navigation, such as quick actions. */
  navTop?: ReactNode
  /** Below the navigation on wide windows, beside the appearance control. */
  navFoot?: ReactNode
  /** The page is put up anew when this changes, so that nothing stays of what it had loaded. */
  contentKey?: string
}

export function AppShell({ isNavItemVisible = () => true, headerContent, navTop, navFoot, contentKey }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerId = useId()
  const wide = useMediaQuery(wideQuery)
  const items = navItems.filter(isNavItemVisible)

  return (
    <div className="shell">
      <SkipLink />
      <div className="shell-sidebar">
        <Brand />
        {navTop}
        <MainNav items={items} />
        {wide && (
          <div className="nav-foot">
            <div className="nav-foot-row">
              {navFoot}
              <ThemeMenu />
            </div>
          </div>
        )}
      </div>
      <header className="shell-header">
        <IconButton
          icon="menu"
          label="Menu"
          className="shell-menu-button"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls={drawerOpen ? drawerId : undefined}
          onClick={() => setDrawerOpen(true)}
        />
        <div className="shell-header-brand">
          <Brand />
        </div>
        <div className="shell-header-content">{!wide && headerContent}</div>
        {!wide && <ThemeMenu />}
      </header>
      <main id={mainId} tabIndex={-1} className="shell-main">
        <PageBoundary key={contentKey} />
      </main>
      {drawerOpen && <NavDrawer id={drawerId} items={items} top={navTop} onClose={() => setDrawerOpen(false)} />}
    </div>
  )
}
