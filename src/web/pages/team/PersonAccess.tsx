import { type FormEvent, type ReactNode, useState } from 'react'
import type { AccessInput, PersonAccessDetails, RoleChoice, RoleDetails } from '../../../shared/api'
import { asManagerExtras, compareGrants, everything, grantedKeys, type Grants, sameGrants } from '../../../shared/permissions'
import { callApi } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { useForm } from '../../auth/useForm'
import { type Load, useLoad } from '../../auth/useLoad'
import { Button, ConfirmDialog, ErrorState, IconButton, LinkButton, LoadingState, MultiCombobox, Notice, Switch, Tooltip, useToast } from '../../ui'
import { Changes } from '../settings/Changes'
import { DeleteRole } from '../settings/DeleteRole'
import { accessLines, chosenGrants, hasManaged, projectLabel } from './accessWords'
import { PermissionList } from './PermissionList'

interface AccessProps {
  personId: number
  name: string
  onSaved: () => void
}

interface PartProps extends AccessProps {
  details: PersonAccessDetails
  load: Load<PersonAccessDetails>
}

/** Loads someone's access for one of the forms that change a part of it. */
function WithAccess({ part: Part, ...props }: AccessProps & { part: (props: PartProps) => ReactNode }) {
  const load = useLoad<PersonAccessDetails>(`people/${props.personId}/access`)
  const { status, data, error, reload } = load
  return (
    <>
      {status === 'loading' && <LoadingState look="skeleton" label="Loading the access" />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}
      {data && <Part key={data.state} {...props} details={data} load={load} />}
    </>
  )
}

export const PersonPermissions = (props: AccessProps) => <WithAccess {...props} part={Permissions} />
export const ManagedPeople = (props: AccessProps) => <WithAccess {...props} part={People} />
export const ManagedProjects = (props: AccessProps) => <WithAccess {...props} part={Projects} />

const fields = ['roleId', 'extras', 'permissions', 'managedPersonIds', 'managedProjectIds'] as const

/** What is stored now, as it is sent when only a part of it changes. */
const stored = ({ roleId, extras, permissions, managedPeople, projects, state }: PersonAccessDetails): AccessInput => ({
  roleId, extras, permissions, managedPersonIds: managedPeople.map(({ id }) => id), managedProjectIds: projects.filter(({ isManager }) => isManager).map(({ id }) => id), state,
})

function useAccessForm({ personId, details, load, onSaved }: PartProps, done: string) {
  const toast = useToast()
  const form = useForm(`access-${personId}`, fields)
  const save = (change: Partial<AccessInput>) =>
    form.submit(async () => {
      const saved = await callApi<PersonAccessDetails>('PUT', `people/${personId}/access`, { ...stored(details), ...change })
      toast.success(done)
      load.setData(saved)
      onSaved()
    })
  return { form, save }
}

const roleOf = (details: PersonAccessDetails, id: number) => details.roles.find((role) => role.id === id)
const isAdministrator = (role: RoleChoice | undefined) => role?.builtIn === true && role.key === 'administrator'

function Permissions(props: PartProps) {
  const { personId, name, details, load } = props
  const { form, save } = useAccessForm(props, 'Permissions updated')
  const before: Grants = details.permissions ?? chosenGrants(details, details.roleId, details.extras)
  const [roleId, setRoleId] = useState(details.roleId)
  const [grants, setGrants] = useState<Grants>(before)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  const all = details.editable === 'all'
  const role = roleOf(details, roleId)
  const administrator = isAdministrator(role)
  const wasAdministrator = isAdministrator(roleOf(details, details.roleId))
  const after = administrator ? everything() : grants
  const { gained, lost } = compareGrants(wasAdministrator ? everything() : before, after)
  const changed = roleId !== details.roleId || !sameGrants(before, after)

  const choose = (next: RoleChoice) => {
    setRoleId(next.id)
    setGrants(next.id === details.roleId ? before : next.grants)
  }

  const update = () => {
    const extras = role?.builtIn && role.key === 'manager' ? asManagerExtras(grants) : null
    const asProfile = administrator || extras !== null || (role !== undefined && sameGrants(grants, role.grants))
    return save({ roleId, extras: extras ?? [], permissions: asProfile ? null : grants })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!changed) return
    if (wasAdministrator || grantedKeys(lost).length > 0) setConfirming(true)
    else void update()
  }

  const profile = (option: RoleChoice) => {
    const refused = option.refusal !== null && option.id !== details.roleId
    const chosen = option.id === roleId
    const hint = `profile-${option.id}-hint`
    return (
      <div key={option.id} className="profile">
        <div className="profile-head">
          <label className={`choice${!all || refused ? ' is-disabled' : ''}`}>
            <input type="radio" className="radio" name={`profile-${personId}`} checked={chosen} disabled={!all || refused} aria-describedby={option.description || refused ? hint : undefined} onChange={() => choose(option)} />
            <span className="choice-label strong">{option.name}</span>
          </label>
          {!option.builtIn && all && (
            <IconButton size="small" variant="secondary" icon="trash" label={`Delete the profile ${option.name}`} onClick={() => setDeleting(option.id)} />
          )}
        </div>
        {(option.description || refused) && (
          <p id={hint} className="muted profile-text">
            {option.description} {refused && 'It needs more access than you have.'}
          </p>
        )}
        {chosen && !administrator && (
          <PermissionList value={grants} onChange={setGrants} held={details.held} disabled={!all} profile={option.name} changed={!sameGrants(grants, option.grants)} onReset={() => setGrants(option.grants)} />
        )}
      </div>
    )
  }
  const builtIn = details.roles.filter((option) => option.builtIn)
  const custom = details.roles.filter((option) => !option.builtIn)

  return (
    <form className="profiles" noValidate onSubmit={submit}>
      <FormMessages form={form} onReload={load.reload} />
      {details.reason && <Notice tone="info">{details.reason}</Notice>}
      <div className="profile-row" role="group" aria-labelledby="profiles">
        <h2 id="profiles">Profiles</h2>
        <div>{builtIn.map(profile)}</div>
      </div>
      <div className="profile-row" role="group" aria-labelledby="custom-profiles">
        <div className="profile-title">
          <h2 id="custom-profiles">Custom Profiles</h2>
          <Tooltip text="Profiles you made yourself. They can be given to anyone, and changed in Settings under Roles.">
            <IconButton size="small" variant="quiet" icon="info" label="About custom profiles" />
          </Tooltip>
        </div>
        <div>
          {custom.length === 0 && <p className="muted">There are none yet.</p>}
          {custom.map(profile)}
          <LinkButton size="small" variant="quiet" icon="plus" to="/settings/roles/new">
            New custom profile
          </LinkButton>
        </div>
      </div>
      {hasManaged(after) && !administrator && (
        <p className="muted">
          {accessLines({
            administrator: false, grants: after, projects: details.projects.filter(({ isManager }) => isManager).map((project) => project.name), people: details.managedPeople.map((person) => person.name),
          })
            .slice(-2)
            .join(' ')}
        </p>
      )}
      {all && (
        <div className="profile-foot">
          <Button type="submit" variant="primary" aria-disabled={!changed || undefined} loading={form.busy} loadingLabel="Updating permissions">
            Update permissions
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Change what ${name} can do?`}
        message={
          <>
            {wasAdministrator && <p>{name} is no longer an administrator.</p>}
            <Changes title="They gain" grants={gained} />
            <Changes title="They lose" grants={lost} />
          </>
        }
        confirmLabel="Update permissions"
        destructive
        onConfirm={async () => {
          setConfirming(false)
          await update()
        }}
      />
      {deleting !== null && <DeleteProfile id={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); load.reload(); props.onSaved() }} />}
    </form>
  )
}

function DeleteProfile({ id, onClose, onDeleted }: { id: number; onClose: () => void; onDeleted: () => void }) {
  const { data, error } = useLoad<RoleDetails>(`roles/${id}`)
  const refusal = data ? data.refusal : error || null
  if (refusal) return <ConfirmDialog open onClose={onClose} title="This profile cannot be deleted" message={refusal} confirmLabel="OK" onConfirm={onClose} />
  return data ? <DeleteRole role={data} onClose={onClose} onDeleted={onDeleted} /> : null
}

/** What the rest of one's access makes of managing someone or something. */
const effect = (details: PersonAccessDetails) => {
  const grants = details.permissions ?? chosenGrants(details, details.roleId, details.extras)
  return isAdministrator(roleOf(details, details.roleId)) || !hasManaged(grants)
}

function People(props: PartProps) {
  const { name, details, load } = props
  const { form, save } = useAccessForm(props, 'Assigned people saved')
  const [chosen, setChosen] = useState(details.managedPeople.map(({ id }) => String(id)))
  const all = details.editable === 'all'
  // Also those who are managed but not active any more, so that their names are shown.
  const choices = new Map([...details.people, ...details.managedPeople].map((person) => [person.id, person]))
  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void save({ managedPersonIds: chosen.map(Number) })
      }}
    >
      <FormMessages form={form} onReload={load.reload} />
      {details.reason && <Notice tone="info">{details.reason}</Notice>}
      {effect(details) && <Notice tone="info">With the profile {name} has now, this makes no difference: nothing in it is limited to what they manage.</Notice>}
      <MultiCombobox
        label="Manages these people"
        placeholder="Search people"
        disabled={!all}
        value={chosen}
        options={[...choices.values()].map(({ id, name: label, active }) => ({ value: String(id), label: active ? label : `${label} (not active)` }))}
        onChange={setChosen}
        {...form.field('managedPersonIds')}
      />
      {all && (
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving the assigned people">
            Save assigned people
          </Button>
        </div>
      )}
    </form>
  )
}

function Projects(props: PartProps) {
  const { name, details, load } = props
  const { form, save } = useAccessForm(props, 'Managed projects saved')
  const [chosen, setChosen] = useState(stored(details).managedProjectIds)
  const flags = details.editable !== 'none'
  if (details.projects.length === 0) return <p className="muted">{name} is on no project yet.</p>
  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void save({ managedProjectIds: chosen })
      }}
    >
      <FormMessages form={form} onReload={load.reload} />
      {!flags && details.reason && <Notice tone="info">{details.reason}</Notice>}
      <div className="extras-grid">
        {details.projects.map((project) => (
          <Switch
            key={project.id}
            label={projectLabel(project)}
            checked={chosen.includes(project.id)}
            disabled={!flags}
            onChange={(on) => setChosen((list) => (on ? [...list, project.id] : list.filter((id) => id !== project.id)))}
          />
        ))}
      </div>
      {flags && (
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving the managed projects">
            Save managed projects
          </Button>
        </div>
      )}
    </form>
  )
}
