import type { PermissionKey } from '../../shared/permissions'
import type { Formats } from '../../shared/work'
import type { IconName } from '../ui'

export interface NavItem {
  id: string
  label: string
  /** Route path, without the base path. */
  path: `/${string}`
  icon: IconName
  group: 'home' | 'track' | 'manage' | 'billing' | 'review' | 'admin'
  /** Any of these is enough. Without it the section is for everyone. */
  needs?: readonly PermissionKey[]
  /** Hidden where the company does not use it. */
  module?: keyof Formats['modules']
}

/** What stands above a group. */
export const groupHeadings: Partial<Record<NavItem['group'], string>> = { track: 'Track', manage: 'Manage', billing: 'Billing', review: 'Review' }

/** The main navigation, in order. Sections that are not built yet are not in it. */
export const navItems: readonly NavItem[] = [
  { id: 'home', label: 'Home', path: '/home', icon: 'home', group: 'home' },
  { id: 'time', label: 'Timesheet', path: '/time', icon: 'time', group: 'track' },
  { id: 'expenses', label: 'Expenses', path: '/expenses', icon: 'expenses', group: 'track', module: 'expenses' },
  { id: 'team', label: 'Team', path: '/team', icon: 'team', group: 'manage', needs: ['people.view'] },
  { id: 'clients', label: 'Clients', path: '/clients', icon: 'clients', group: 'manage', needs: ['clients.view'] },
  { id: 'projects', label: 'Projects', path: '/projects', icon: 'projects', group: 'manage' },
  { id: 'tasks', label: 'Tasks', path: '/tasks', icon: 'tasks', group: 'manage', needs: ['tasks.manage'] },
  { id: 'invoices', label: 'Invoices', path: '/invoices', icon: 'invoices', group: 'billing', needs: ['invoices.manage'], module: 'invoices' },
  { id: 'approvals', label: 'Approvals', path: '/approvals', icon: 'approvals', group: 'review', needs: ['time.approve'], module: 'approval' },
  { id: 'reports', label: 'Reports', path: '/reports', icon: 'reports', group: 'review' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'settings', group: 'admin' },
]

/** Whether `pathname` is the item's page or below it. Routes ignore case and a trailing slash. */
export function isCurrentItem(item: NavItem, pathname: string): boolean {
  return `${pathname.toLowerCase()}/`.startsWith(`${item.path}/`)
}
