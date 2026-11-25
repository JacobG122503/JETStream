import { useState } from 'react'
import { useParams } from 'react-router-dom'
import type { AssignmentClient, PersonDetails, SavedAssignments } from '../../../shared/api'
import { callApi } from '../../api'
import { useCan } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { photoUrl } from '../../shell/photo'
import { Avatar, Button, Card, ConfirmDialog, ErrorState, LinkButton, LoadingState, Notice, useToast } from '../../ui'
import { choiceOf, removedClients } from './assignmentChoice'
import { AssignmentPicker } from './AssignmentPicker'
import { InviteDialog } from './InvitesPanel'
import { signInLabels } from './labels'
import { LinkDialog, type ShownLink } from './LinkDialog'
import { PersonAccess } from './PersonAccess'
import { ResetLink, type ResetTarget } from './ResetLink'
import { StatusBadge } from './StatusBadge'
import '../auth/auth.css'
import './team.css'

export function PersonPage() {
  const { id = '' } = useParams()
  return <PersonLoader key={id} id={id} />
}

function PersonLoader({ id }: { id: string }) {
  const { status, data, error, reload, refresh, setData } = useLoad<PersonDetails>(`people/${encodeURIComponent(id)}`)
  return (
    <Page
      title={data?.name ?? 'Person'}
      actions={
        <LinkButton to="/team" icon="chevronLeft">
          Back to Team
        </LinkButton>
      }
    >
      {status === 'loading' && <LoadingState size="page" look="skeleton" label="Loading the person" />}
      {status === 'error' && (
        <ErrorState
          size="page"
          headingLevel={2}
          message={error === 'Not found' ? 'There is no such person.' : error}
          onRetry={reload}
        />
      )}
      {data && <Person person={data} onChange={setData} onReload={reload} onRefresh={refresh} />}
    </Page>
  )
}

interface PersonProps {
  person: PersonDetails
  onChange: (person: PersonDetails) => void
  onReload: () => void
}

function Person({ person, onChange, onReload, onRefresh }: PersonProps & { onRefresh: () => void }) {
  const [target, setTarget] = useState<ResetTarget | null>(null)
  const [inviting, setInviting] = useState(false)
  const [link, setLink] = useState<ShownLink | null>(null)
  const can = useCan()
  const active = person.status === 'active'
  const actions = active && person.signIn !== undefined && person.accountRefusal === null
  return (
    <>
      <Card
        title="Details"
        actions={
          actions &&
          (person.signIn === 'password' ? (
            <Button icon="unlock" onClick={() => setTarget(person)}>
              Make reset link
            </Button>
          ) : (
            person.signIn === 'none' && <Button onClick={() => setInviting(true)}>Invite</Button>
          ))
        }
      >
        <div className="photo-row">
          <Avatar name={person.name} src={photoUrl(person.photoId)} size="large" decorative />
          <dl className="facts">
            <dt>Email</dt>
            <dd>{person.email}</dd>
            <dt>Role</dt>
            <dd>{person.role}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={person.status} />
            </dd>
            {person.signIn && (
              <>
                <dt>Sign-in</dt>
                <dd>{signInLabels[person.signIn]}</dd>
              </>
            )}
            <dt>Time zone</dt>
            <dd>{person.timeZone.replaceAll('_', ' ')}</dd>
          </dl>
        </div>
        {active && person.accountRefusal && <Notice tone="info">{person.accountRefusal}</Notice>}
      </Card>
      {person.clients && (
        <Assignments key={person.state} person={person} clients={person.clients} onChange={onChange} onReload={onReload} />
      )}
      {can('roles.manage') && <PersonAccess key={`access ${person.state ?? ''}`} personId={person.id} name={person.name} onSaved={onRefresh} />}
      <ResetLink target={target} onClose={() => setTarget(null)} />
      {inviting && (
        <InviteDialog
          invitee={person}
          onClose={() => setInviting(false)}
          onInvited={(made) => {
            setInviting(false)
            setLink(made)
            onReload()
          }}
        />
      )}
      <LinkDialog link={link} onClose={() => setLink(null)} />
    </>
  )
}

const fields: readonly string[] = []

function Assignments({ person, clients, onChange, onReload }: PersonProps & { clients: AssignmentClient[] }) {
  const toast = useToast()
  const [choice, setChoice] = useState(() => choiceOf(clients))
  const [confirming, setConfirming] = useState(false)
  const form = useForm('assignments', fields)
  const removed = removedClients(clients, choice)
  const active = person.status === 'active'

  const save = () =>
    form.submit(async () => {
      const { notManaged = [], ...saved } = await callApi<SavedAssignments>('PUT', `people/${person.id}/assignments`, { ...choice, state: person.state })
      toast.success('Assignments saved')
      if (notManaged.length > 0) {
        toast.warning(`${person.name} is on ${notManaged.join(', ')} again, but no longer as manager. Someone who may give that can switch it on.`)
      }
      onChange(saved)
    })

  return (
    <Card title="Clients and projects">
      <form
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (removed.length > 0) setConfirming(true)
          else void save()
        }}
      >
        <FormMessages form={form} onReload={onReload} />
        {!active && <Notice tone="info">Only active people can be assigned.</Notice>}
        <AssignmentPicker clients={clients} value={choice} onChange={setChoice} disabled={!active || form.busy} />
        {active && clients.length > 0 && (
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving assignments">
              Save assignments
            </Button>
          </div>
        )}
      </form>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={removed.length === 1 ? `Remove ${removed[0]?.name}?` : `Remove ${removed.length} clients?`}
        message={
          <>
            <p>{person.name} is also taken off these projects. Logged time and expenses stay.</p>
            <ul className="confirm-list">
              {removed.map(({ name, projects }) => (
                <li key={name}>
                  {name}: {projects.length > 0 ? projects.join(', ') : 'no projects'}
                </li>
              ))}
            </ul>
          </>
        }
        confirmLabel="Remove and save"
        destructive
        onConfirm={async () => {
          setConfirming(false)
          await save()
        }}
      />
    </Card>
  )
}
