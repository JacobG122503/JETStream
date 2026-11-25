import { Link } from 'react-router-dom'
import { notificationKinds, type NotificationList, type NotificationPreference } from '../../../shared/notifications'
import { usePerson } from '../../auth/authContext'
import { formatInstant } from '../../auth/timeZones'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Button, Checkbox, EmptyState, ErrorState, LinkButton, LoadingState, Notice } from '../../ui'
import { useActions } from '../../work/useActions'
import { useAuth } from '../../auth/authContext'
import { SettingsLayout } from './SettingsLayout'
import '../../work/work.css'

/** Everything the person was told. */
export function NotificationsPage() {
  const { status, data, error, reload, setData } = useLoad<NotificationList>('notifications')
  const { timeZone } = usePerson()
  const { run } = useActions()
  return (
    <Page
      title="Notifications"
      actions={
        <>
          <LinkButton to="/settings/notifications">Choose what you are told</LinkButton>
          {data && data.unread > 0 && <Button onClick={() => void run('POST', 'notifications/read', { id: null }, '', setData)}>Mark all as read</Button>}
        </>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading notifications" />}
      {status === 'error' && <ErrorState size="page" headingLevel={2} message={error} onRetry={reload} />}
      {data?.rows.length === 0 && <EmptyState icon="bell" headingLevel={2} title="Nothing yet" description="What concerns you appears here." />}
      {data && data.rows.length > 0 && (
        <ul className="payments">
          {data.rows.map(({ id, title, body, path, read, at }) => (
            <li key={id}>
              <span className="cell-two">
                <span className={read ? undefined : 'strong'}>{path?.startsWith('/') ? <Link to={path}>{title}</Link> : title}</span>
                <span className="cell-sub lines">{body}</span>
              </span>
              <span className="muted">{formatInstant(at, timeZone)}</span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

/** What the person wants to be told, and how. */
export function NotificationSettingsPage() {
  const { status, data, error, reload, setData } = useLoad<{ preferences: NotificationPreference[] }>('notifications/preferences')
  const { info } = useAuth()
  const { run } = useActions()
  const save = (preference: NotificationPreference) => void run('PUT', 'notifications/preferences', preference, '', setData)
  return (
    <SettingsLayout title="Notifications" current="/settings/notifications">
      {info && !info.emailDelivers && <Notice>No email service is set up, so emails are only kept in the Outbox.</Notice>}
      {status === 'loading' && <LoadingState look="skeleton" label="Loading" />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <table className="edit-table">
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">In the app</th>
              <th scope="col">By email</th>
            </tr>
          </thead>
          <tbody>
            {data.preferences.map((preference) => {
              const { label } = notificationKinds[preference.kind]
              return (
                <tr key={preference.kind}>
                  <th scope="row">{label}</th>
                  <td>
                    <Checkbox label={`${label}, in the app`} hideLabel checked={preference.inApp} onChange={(inApp) => save({ ...preference, inApp })} />
                  </td>
                  <td>
                    <Checkbox label={`${label}, by email`} hideLabel checked={preference.email} onChange={(email) => save({ ...preference, email })} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </SettingsLayout>
  )
}
