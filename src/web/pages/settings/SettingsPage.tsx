import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, useCan } from '../../auth/authContext'
import { Page } from '../../shell/Page'
import { setStartsAtHome, startsAtHome } from '../../theme/startPage'
import { type ThemeChoice, useThemeChoice } from '../../theme/theme'
import { Checkbox } from '../../ui'
import './settings.css'

export function SettingsPage() {
  const can = useCan()
  return (
    <Page title="Settings">
      <div className="settings">
        <nav aria-label="Settings" className="settings-nav">
          <Link to="/settings" aria-current="page">
            My preferences
          </Link>
          <Link to="/account">My account</Link>
          {can('roles.manage') && <Link to="/settings/roles">Roles</Link>}
        </nav>
        <Preferences />
      </div>
    </Page>
  )
}

const themes: { id: ThemeChoice; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
]

function Preferences() {
  const { info } = useAuth()
  const [home, setHome] = useState(startsAtHome)
  const [theme, setTheme] = useThemeChoice()
  const group = useId()
  return (
    <section className="settings-main" aria-labelledby="preferences">
      <h2 id="preferences">My preferences</h2>
      <p className="muted">These apply to you on this device only, and not to anyone else at {info?.company.name}.</p>
      <div className="settings-row">
        <h3>Home</h3>
        <Checkbox
          label="Show Home when you open the app"
          hint="When off, the app opens with your timesheet."
          checked={home}
          onChange={(on) => {
            setHome(on)
            setStartsAtHome(on)
          }}
        />
      </div>
      <div className="settings-row">
        <h3 id={group}>Theme</h3>
        <div className="themes" role="radiogroup" aria-labelledby={group}>
          {themes.map(({ id, label }) => (
            <label key={id} className={id === theme ? 'theme is-chosen' : 'theme'}>
              <span className={`theme-picture theme-${id}`} aria-hidden="true">
                <span />
                <span />
              </span>
              <span className="theme-label">
                <input type="radio" className="radio" name={group} checked={id === theme} onChange={() => setTheme(id)} /> {label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </section>
  )
}
