import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { AssignmentClient, PersonDetails, SavedAssignments } from '../../../shared/api'
import { callApi } from '../../api'
import { useCan } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { useLoad } from '../../auth/useLoad'
import { Page } from '../../shell/Page'
import { photoUrl } from '../../shell/photo'
import { useDocumentTitle } from '../../shell/useDocumentTitle'
import { Avatar, Button, Card, ConfirmDialog, ErrorState, Icon, LinkButton, LoadingState, Notice, PageHeader, useToast } from '../../ui'
import { NotFoundPage } from '../NotFoundPage'
import { choiceOf, removedClients } from './assignmentChoice'
import { AssignmentPicker } from './AssignmentPicker'
import { InviteDialog } from './InvitesPanel'
import { signInLabels } from './labels'
import { LinkDialog, type ShownLink } from './LinkDialog'
import { ManagedPeople, ManagedProjects, PersonPermissions } from './PersonAccess'
import { PersonRates, PersonWorkCards } from './PersonWorkCards'
import { ResetLink, type ResetTarget } from './ResetLink'
import { StatusBadge } from './StatusBadge'
import '../auth/auth.css'
import './team.css'

type Section = 'info' | 'rates' | 'projects' | 'people' | 'permissions' | 'security'

/** "Jacob A" of "Jacob A Garcia". */
const firstName = (name: string) => name.trim().split(/\s+/).slice(0, -1).join(' ') || name.trim()
const possessive = (name: string) => `${name}\u2019s`

const titles: Record<Section, (name: string) => string> = {
  info: (name) => `${possessive(name)} basic info`,
  rates: (name) => `${possessive(name)} rates`,
  projects: (name) => `${possessive(name)} assigned projects`,
  people: (name) => `${possessive(name)} assigned people`,
  permissions: (name) => `${possessive(name)} permissions`,
  security: (name) => `${possessive(name)} security`,
}

export function PersonPage() {
  const { id = '', section = '' } = useParams()
  return <PersonLoader key={id} id={id} section={section} />
}

function PersonLoader({ id, section }: { id: string; section: string }) {
  const { status, data, error, reload, refresh, setData } = useLoad<PersonDetails>(`people/${encodeURIComponent(id)}`)
  if (data) return <Person person={data} section={section} onChange={setData} onReload={reload} onRefresh={refresh} />
  return (
    <Page
      title="Person"
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
    </Page>
  )
}

interface PersonProps {
  person: PersonDetails
  onChange: (person: PersonDetails) => void
  onReload: () => void
}

function Person({ person, section, onChange, onReload, onRefresh }: PersonProps & { section: string; onRefresh: () => void }) {
  const can = useCan()
  const { id, name } = person
  const access = can('roles.manage')
  const sections: { id: Section; label: string; shown: boolean }[] = [
    { id: 'info', label: 'Basic info', shown: true },
    { id: 'rates', label: 'Rates', shown: can('billable.view') || can('cost.view') },
    { id: 'projects', label: 'Assigned projects', shown: access || person.clients !== undefined },
    { id: 'people', label: 'Assigned people', shown: access },
    { id: 'permissions', label: 'Permissions', shown: access },
    { id: 'security', label: 'Security', shown: person.signIn !== undefined },
  ]
  const shown = sections.filter((one) => one.shown)
  const current = section === '' ? 'info' : shown.find((one) => one.id === section)?.id
  const first = firstName(name)
  const title = current ? titles[current](first) : 'Person'
  useDocumentTitle(title)
  if (!current) return <NotFoundPage />
  const props = { personId: id, name, onSaved: onRefresh }
  return (
    <div className="page person">
      <p className="person-back">
        <Link to={can('time.view') ? `/reports/detailed?people=${id}` : '/team'} className="back-link">
          <Icon name="arrowLeft" />
          {can('time.view') ? `Back to ${possessive(first)} report` : 'Back to Team'}
        </Link>
      </p>
      <div className="person-columns">
        <aside className="person-side">
          <div className="person-card">
            <Avatar name={name} src={photoUrl(person.photoId)} size="large" decorative />
            <div>
              <p className="strong">{name}</p>
              <p className="person-email">{person.email}</p>
              <p>
                <span className="person-role">{person.role}</span> {person.status !== 'active' && <StatusBadge status={person.status} />}
              </p>
            </div>
          </div>
          <nav aria-label="Person" className="person-nav">
            {shown.map((one) => (
              <Link key={one.id} to={one.id === 'info' ? `/team/${id}` : `/team/${id}/${one.id}`} aria-current={one.id === current ? 'page' : undefined}>
                {one.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="person-main">
          <PageHeader title={title} description={current === 'permissions' ? `This setting determines what ${first} can see and do in this account.` : undefined} />
          {current === 'info' && (
            <>
              <Card title="Details">
                <dl className="facts">
                  <dt>Name</dt>
                  <dd>{name}</dd>
                  <dt>Email</dt>
                  <dd>{person.email}</dd>
                  <dt>Permissions</dt>
                  <dd>{person.role}</dd>
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={person.status} />
                  </dd>
                  <dt>Time zone</dt>
                  <dd>{person.timeZone.replaceAll('_', ' ')}</dd>
                </dl>
              </Card>
              <PersonWorkCards id={id} onChange={onRefresh} />
            </>
          )}
          {current === 'rates' && <PersonRates id={id} />}
          {current === 'projects' && (
            <>
              {person.clients && <Assignments key={person.state} person={person} clients={person.clients} onChange={onChange} onReload={onReload} />}
              {access && (
                <Card title="Manages these projects">
                  <ManagedProjects key={person.state} {...props} />
                </Card>
              )}
            </>
          )}
          {current === 'people' && <ManagedPeople {...props} />}
          {current === 'permissions' && <PersonPermissions {...props} />}
          {current === 'security' && <Security person={person} onReload={onReload} />}
        </div>
      </div>
    </div>
  )
}

function Security({ person, onReload }: { person: PersonDetails; onReload: () => void }) {
  const [target, setTarget] = useState<ResetTarget | null>(null)
  const [inviting, setInviting] = useState(false)
  const [link, setLink] = useState<ShownLink | null>(null)
  const active = person.status === 'active'
  const actions = active && person.signIn !== undefined && person.accountRefusal === null
  return (
    <>
      <Card
        title="Sign-in"
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
        <dl className="facts">
          <dt>Email</dt>
          <dd>{person.email}</dd>
          <dt>Sign-in</dt>
          <dd>{person.signIn && signInLabels[person.signIn]}</dd>
        </dl>
        {active && person.accountRefusal && <Notice tone="info">{person.accountRefusal}</Notice>}
      </Card>
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
