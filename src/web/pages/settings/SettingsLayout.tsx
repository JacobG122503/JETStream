import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PermissionKey } from '../../../shared/permissions'
import { useCan, usePerson } from '../../auth/authContext'
import { Page } from '../../shell/Page'
import { getFormats } from '../../work/format'
import '../../work/work.css'
import './settings.css'

interface SettingsItem {
  path: string
  label: string
  needs?: PermissionKey
  administrator?: boolean
}

const items: SettingsItem[] = [
  { path: '/settings', label: 'My preferences' },
  { path: '/account', label: 'My account' },
  { path: '/settings/notifications', label: 'Notifications' },
  { path: '/settings/company', label: 'Company', needs: 'settings.manage' },
  { path: '/settings/categories', label: 'Expense categories', needs: 'tasks.manage' },
  { path: '/settings/roles', label: 'Roles', needs: 'roles.manage' },
  { path: '/settings/outbox', label: 'Outbox', needs: 'outbox.view' },
  { path: '/settings/export', label: 'Export', administrator: true },
  { path: '/settings/activity', label: 'Activity log', needs: 'activity.view' },
]

/** Settings, with the list of them at the side. */
export function SettingsLayout({ title, current, actions, children }: { title: string; current: string; actions?: ReactNode; children: ReactNode }) {
  const can = useCan()
  const person = usePerson()
  const { modules } = getFormats()
  return (
    <Page title={current === '/settings' ? 'Settings' : title} actions={actions}>
      <div className="settings">
        <nav aria-label="Settings" className="settings-nav">
          {items
            .filter(({ path, needs, administrator }) => (!needs || can(needs)) && (!administrator || person.administrator) && (path !== '/settings/categories' || modules.expenses))
            .map(({ path, label }) => (
              <Link key={path} to={path} aria-current={path === current ? 'page' : undefined}>
                {label}
              </Link>
            ))}
        </nav>
        <div className="settings-main">{children}</div>
      </div>
    </Page>
  )
}
