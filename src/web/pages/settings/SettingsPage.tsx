import { Link } from 'react-router-dom'
import { useCan } from '../../auth/authContext'
import { Page } from '../../shell/Page'
import { Icon } from '../../ui'
import './settings.css'

export function SettingsPage() {
  const can = useCan()
  return (
    <Page title="Settings" description="How JET Engineering uses the app.">
      <ul className="settings-list">
        {can('roles.manage') && (
          <li>
            <Link to="/settings/roles" className="settings-link">
              <span className="settings-icon">
                <Icon name="shield" />
              </span>
              <span>
                <span className="settings-title">Roles</span>
                <span className="settings-text">What people may see and do</span>
              </span>
              <Icon name="chevronRight" />
            </Link>
          </li>
        )}
      </ul>
    </Page>
  )
}
