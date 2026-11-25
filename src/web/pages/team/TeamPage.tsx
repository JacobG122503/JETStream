import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { HelpRequest, JoinRequests } from '../../../shared/api'
import { callApi } from '../../api'
import { useCan } from '../../auth/authContext'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { Button, Tabs, useToast } from '../../ui'
import { FormDialog } from '../../work/FormDialog'
import { HelpPanel } from './HelpPanel'
import { InvitesPanel } from './InvitesPanel'
import { MembersPanel } from './MembersPanel'
import { PeoplePanel } from './PeoplePanel'
import { personFields } from './PersonWorkCards'
import { RequestsPanel } from './RequestsPanel'
import '../auth/auth.css'
import './team.css'

export function TeamPage() {
  const manages = useCan()('people.manage')
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  return (
    <Page
      title="Team"
      actions={
        manages && (
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Add person
          </Button>
        )
      }
    >
      {manages ? <TeamTabs /> : <MembersPanel />}
      {adding && (
        <FormDialog
          title="Add person"
          submitLabel="Add person"
          intro={<p className="muted">They start as a Member without a password. Invite them, and give another role, on their page.</p>}
          initial={{ kind: 'employee', weeklyCapacityMinutes: 2400 }}
          fields={personFields}
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            const { id } = await callApi<{ id: number }>('POST', 'people', values)
            toast.success('Person added')
            navigate(`/team/${id}`)
          }}
        />
      )}
    </Page>
  )
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
      value={query.get('tab') ?? 'members'}
      onChange={(tab) => setQuery(tab === 'members' ? {} : { tab }, { replace: true })}
      items={[
        { id: 'members', label: 'Members', content: <MembersPanel /> },
        { id: 'people', label: 'Accounts', content: <PeoplePanel /> },
        { id: 'requests', label: counted('Requests', requests.data?.requests.length), content: <RequestsPanel load={requests} /> },
        { id: 'invites', label: 'Invites', content: <InvitesPanel /> },
        { id: 'help', label: counted('Help requests', help.data?.requests.length), content: <HelpPanel load={help} /> },
      ]}
    />
  )
}
