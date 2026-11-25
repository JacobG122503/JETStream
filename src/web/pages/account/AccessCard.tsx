import type { AccessInfo } from '../../../shared/api'
import { useLoad } from '../../auth/useLoad'
import { Card, ErrorState, LoadingState } from '../../ui'
import { accessLines } from '../team/accessWords'
import { AccessSummary } from '../team/PersonAccess'
import '../team/team.css'

/** What one may do, to look at. */
export function AccessCard() {
  const { status, data, error, reload } = useLoad<AccessInfo>('account/access')
  return (
    <Card title="Your access">
      {status === 'loading' && <LoadingState look="skeleton" label="Loading your access" />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="stack">
          <p>
            Your role is <strong>{data.role.name}</strong>. An administrator can change it.
          </p>
          <AccessSummary title="What you can do" lines={accessLines({ ...data, projects: data.managedProjects, people: data.managedPeople })} />
        </div>
      )}
    </Card>
  )
}
