import { type ReactNode, useId, useState } from 'react'
import { IconButton } from '../ui'
import { Brand } from './Brand'
import { MainNav } from './MainNav'
import { NavDrawer } from './NavDrawer'
import { type NavItem, navItems } from './navigation'
import { PageBoundary } from './PageBoundary'
import { mainId, SkipLink } from './SkipLink'
import { StreamLines } from './StreamLines'
import { ThemeMenu } from './ThemeMenu'
import './shell.css'

export interface AppShellProps {
  /** Hides navigation items, for example by permission or module. The order of the rest stays. */
  isNavItemVisible?: (item: NavItem) => boolean
  /** Placed in the header before the appearance control: running timer, notifications, account menu. */
  headerContent?: ReactNode
  /** The page is put up anew when this changes, so that nothing stays of what it had loaded. */
  contentKey?: string
}

export function AppShell({ isNavItemVisible = () => true, headerContent, contentKey }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerId = useId()
  const items = navItems.filter(isNavItemVisible)

  return (
    <div className="shell">
      <SkipLink />
      <div className="shell-sidebar">
        <Brand />
        <MainNav items={items} />
        <StreamLines className="nav-art" count={9} width={260} height={260} />
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
        <div className="shell-header-content">{headerContent}</div>
        <ThemeMenu />
      </header>
      <main id={mainId} tabIndex={-1} className="shell-main">
        <PageBoundary key={contentKey} />
      </main>
      {drawerOpen && <NavDrawer id={drawerId} items={items} onClose={() => setDrawerOpen(false)} />}
    </div>
  )
}
