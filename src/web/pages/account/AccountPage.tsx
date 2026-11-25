import { useState } from 'react'
import type { Account } from '../../../shared/api'
import { useAuth } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { ErrorState, LoadingState } from '../../ui'
import { AccessCard } from './AccessCard'
import { DevicesCard } from './DevicesCard'
import { PasswordCard } from './PasswordCard'
import { PhotoCard } from './PhotoCard'
import { ProfileCard } from './ProfileCard'
import '../auth/auth.css'
import './account.css'

export function AccountPage() {
  const { info, refresh } = useAuth()
  const { status, data, error, reload, setData } = useLoad<Account>('account')
  /** Counts up when the list of devices is out of date. */
  const [devicesChanged, setDevicesChanged] = useState(0)

  const change = (account: Account) => {
    setData(account)
    // The header shows name and photo too.
    void refresh()
  }

  return (
    <Page title="Account" description="Your profile, password and the devices you are signed in on.">
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading your account" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data && info && (
        <>
          <ProfileCard account={data} companyTimeZone={info.company.timeZone} onChange={change} onReload={reload} />
          <PhotoCard account={data} onChange={change} />
          <PasswordCard email={data.email} onChanged={() => setDevicesChanged((count) => count + 1)} />
          <AccessCard />
          <DevicesCard key={devicesChanged} />
        </>
      )}
    </Page>
  )
}
