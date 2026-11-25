import type { PermissionKey } from '../../shared/permissions'
import type { IconName } from '../ui'

export interface NavItem {
  id: string
  label: string
  /** Route path, without the base path. */
  path: `/${string}`
  icon: IconName
  /** A gap separates groups. */
  group: 'home' | 'track' | 'work' | 'billing' | 'admin'
  /** Any of these is enough. Without it the section is for everyone. */
  needs?: readonly PermissionKey[]
}

/** The main navigation, in order. Sections that are not built yet are not in it. */
export const navItems: readonly NavItem[] = [
  { id: 'home', label: 'Home', path: '/home', icon: 'home', group: 'home' },
  { id: 'time', label: 'Time', path: '/time', icon: 'time', group: 'track' },
  { id: 'expenses', label: 'Expenses', path: '/expenses', icon: 'expenses', group: 'track' },
  { id: 'projects', label: 'Projects', path: '/projects', icon: 'projects', group: 'work' },
  { id: 'clients', label: 'Clients', path: '/clients', icon: 'clients', group: 'work', needs: ['clients.view'] },
  { id: 'team', label: 'Team', path: '/team', icon: 'team', group: 'work', needs: ['people.view'] },
  { id: 'reports', label: 'Reports', path: '/reports', icon: 'reports', group: 'billing' },
  { id: 'invoices', label: 'Invoices', path: '/invoices', icon: 'invoices', group: 'billing', needs: ['invoices.manage'] },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'settings', group: 'admin', needs: ['roles.manage'] },
]

/** Whether `pathname` is the item's page or below it. Routes ignore case and a trailing slash. */
export function isCurrentItem(item: NavItem, pathname: string): boolean {
  return `${pathname.toLowerCase()}/`.startsWith(`${item.path}/`)
}
