import type { IconName } from '../ui'

export interface NavItem {
  id: string
  label: string
  /** Route path, without the base path. */
  path: `/${string}`
  icon: IconName
  /** A gap separates groups. */
  group: 'track' | 'work' | 'billing' | 'admin'
}

/** The main navigation, in order. Later tasks hide items through AppShell's `isNavItemVisible`. */
export const navItems: readonly NavItem[] = [
  { id: 'time', label: 'Time', path: '/time', icon: 'time', group: 'track' },
  { id: 'expenses', label: 'Expenses', path: '/expenses', icon: 'expenses', group: 'track' },
  { id: 'projects', label: 'Projects', path: '/projects', icon: 'projects', group: 'work' },
  { id: 'clients', label: 'Clients', path: '/clients', icon: 'clients', group: 'work' },
  { id: 'team', label: 'Team', path: '/team', icon: 'team', group: 'work' },
  { id: 'schedule', label: 'Schedule', path: '/schedule', icon: 'schedule', group: 'work' },
  { id: 'time-off', label: 'Time off', path: '/time-off', icon: 'timeOff', group: 'work' },
  { id: 'reports', label: 'Reports', path: '/reports', icon: 'reports', group: 'billing' },
  { id: 'invoices', label: 'Invoices', path: '/invoices', icon: 'invoices', group: 'billing' },
  { id: 'estimates', label: 'Estimates', path: '/estimates', icon: 'estimates', group: 'billing' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'settings', group: 'admin' },
]

/** Whether `pathname` is the item's page or below it. Routes ignore case and a trailing slash. */
export function isCurrentItem(item: NavItem, pathname: string): boolean {
  return `${pathname.toLowerCase()}/`.startsWith(`${item.path}/`)
}
