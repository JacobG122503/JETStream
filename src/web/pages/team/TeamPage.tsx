import { useSearchParams } from 'react-router-dom'
import type { HelpRequest, JoinRequests } from '../../../shared/api'
import { useCan } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Tabs } from '../../ui'
import { HelpPanel } from './HelpPanel'
import { InvitesPanel } from './InvitesPanel'
import { PeoplePanel } from './PeoplePanel'
import { RequestsPanel } from './RequestsPanel'
import '../auth/auth.css'
import './team.css'

export function TeamPage() {
  return <Page title="Team">{useCan()('people.manage') ? <TeamTabs /> : <PeoplePanel />}</Page>
}

const counted = (label: string, count: number | undefined) => (count ? `${label} (${count})` : label)

function TeamTabs() {
  const [query, setQuery] = useSearchParams()
  // Loaded here, because the tabs show how many there are.
  const requests = useLoad<JoinRequests>('requests')
  const help = useLoad<{ requests: HelpRequest[] }>('help-requests')
  return (
    <Tabs
      label="Team"
      value={query.get('tab') ?? 'people'}
      onChange={(tab) => setQuery(tab === 'people' ? {} : { tab }, { replace: true })}
      items={[
        { id: 'people', label: 'People', content: <PeoplePanel /> },
        { id: 'requests', label: counted('Requests', requests.data?.requests.length), content: <RequestsPanel load={requests} /> },
        { id: 'invites', label: 'Invites', content: <InvitesPanel /> },
        { id: 'help', label: counted('Help requests', help.data?.requests.length), content: <HelpPanel load={help} /> },
      ]}
    />
  )
}
